/* Torreto's Garage — scrollytelling engine.
 *
 * State on <html>:  data-scene (1..5) · data-state (boot|transition|idle|error) · data-direction (none|forward|backward)
 * Events (bubble from <html>): scenechange · transitionstart · transitionend   — detail: { from, to, direction, ... }
 *
 * Rules implemented here (see README for the why):
 *  - viewport is fixed; 1 gesture / swipe / key = exactly 1 step; never skip a scene
 *  - a new gesture only after ~180 ms of input silence; input during a transition is dropped, never queued
 *  - rest state = exact last frame of the incoming video (no poster images)
 *  - forward = native playback of the forward file, backward = native playback of the reversed file;
 *    currentTime scrubbing via rAF is only the fallback (autoplay refused / reversed file broken)
 *  - every wait is bounded (load timeout, seek timeout, playback watchdog); hidden tab / stalled
 *    buffer still lands on the scene's final frame
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var C = window.SCENES_CONFIG;
  var params = new URLSearchParams(location.search);

  /* ───────────────────────── system message ───────────────────────── */
  function fail(title, html) {
    clearTimeout(window.__bootGuard);
    var s = document.getElementById('sys');
    document.getElementById('sysTitle').textContent = title;
    document.getElementById('sysBody').innerHTML = html;
    s.hidden = false;
    root.dataset.state = 'error';
  }

  if (location.protocol === 'file:') {
    fail('Сайт открыт как файл (file://)',
      '<p>Браузер блокирует управление видео и загрузку данных для страниц, открытых прямо с диска, поэтому сценарий не может стартовать.</p>' +
      '<p>Запустите локальный сервер в папке проекта:</p><p><code>npm run serve</code></p>' +
      '<p>и откройте <code>http://localhost:5173</code>. Подойдёт и любой другой статический сервер с поддержкой HTTP Range (например, <code>npx serve</code>).</p>');
    return;
  }
  if (!C || !C.scenes || !C.transitions) {
    fail('Нет конфигурации сцен', '<p>Файл <code>scenes.config.js</code> не загрузился или повреждён. Проверьте, что он лежит рядом с <code>index.html</code>.</p>');
    return;
  }
  window.addEventListener('error', function (e) {
    if (root.dataset.state === 'boot') fail('Движок не запустился', '<p>Ошибка при старте: <code>' + String(e.message).replace(/</g, '&lt;') + '</code></p>');
  });

  /* ───────────────────────── setup ───────────────────────── */
  var FPS = C.fps;
  var RATE = C.playbackRate || 1;
  var N = C.scenes.length;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var isStatic = params.has('static');
  if (isStatic) root.classList.add('is-static');

  var layer = document.getElementById('videoLayer');
  var uis = Array.prototype.slice.call(document.querySelectorAll('.scene-ui'));
  var counterNum = document.getElementById('counterNum');
  var counterSr = document.getElementById('counterSr');

  var stats = { steps: 0, ignoredBusy: 0, ignoredGesture: 0, ignoredEdge: 0, scrubbed: 0, watchdog: 0, blends: 0, snaps: 0, playRejected: 0 };
  var log = [];
  function trace(msg) { log.push(Math.round(performance.now()) + ' ' + msg); if (log.length > 200) log.shift(); }

  var cur = 0;               // scene index (0-based)
  var busy = true;           // locked during boot + transitions
  var visible = null;        // { el, src, frame } — frame in forward numbering

  /* frame f → time at the middle of the frame (robust against rounding on seek) */
  function ft(f, src) {
    var max = C.sources[src].frames - 1;
    f = Math.max(0, Math.min(max, f));
    return (f + 0.5) / FPS;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function race(p, ms, fallback) { return Promise.race([p, wait(ms).then(function () { return fallback; })]); }

  /* ───────────────────────── video pool ───────────────────────── */
  var pool = {}; // src → { fwd: V, rev: V }
  /* phones / Save-Data get the lighter encode */
  var conn = navigator.connection || {};
  var mobileSet = !!(C.mobileQuery && window.matchMedia(C.mobileQuery).matches) || conn.saveData === true;
  root.dataset.media = mobileSet ? 'mobile' : 'desktop';

  function makeVideo(url, name, preload) {
    var el = document.createElement('video');
    el.muted = true; el.defaultMuted = true;
    el.playsInline = true;
    el.setAttribute('playsinline', '');
    el.setAttribute('muted', '');
    el.setAttribute('disablepictureinpicture', '');
    el.setAttribute('disableremoteplayback', '');
    el.preload = preload || 'auto';
    el.dataset.name = name;
    el.src = url;
    layer.appendChild(el);
    var v = { el: el, name: name, ok: null };
    /* "ready" = metadata known, so the element can be seeked. iOS Safari never buffers frames
       before the first seek/play, so waiting for loadeddata there would always hit the timeout. */
    v.ready = race(new Promise(function (res) {
      function done(ok) { v.ok = ok; el.removeEventListener('loadedmetadata', y); el.removeEventListener('error', n); res(ok); }
      function y() { done(true); }
      function n() { done(false); }
      if (el.readyState >= 1) return done(true);
      el.addEventListener('loadedmetadata', y);
      el.addEventListener('error', n);
    }), C.loadTimeoutMs, false).then(function (ok) {
      if (!ok) { v.ok = false; trace('load failed/timeout ' + name); }
      return ok;
    });
    return v;
  }
  /* Lazy preload: only the first scene's forward file buffers right away; everything else
     loads metadata and is promoted to preload=auto when it is about to be needed. */
  var first = C.scenes[0].rest.src;
  var clipMode = mobileSet && !!(C.mobileClips && C.mobileClips.enabled) && !params.has('noclips');
  root.dataset.videoMode = clipMode ? 'clips' : 'segments';
  if (!clipMode) Object.keys(C.sources).forEach(function (k) {
    var s = C.sources[k], u = mobileSet && s.mobile ? s.mobile : s;
    pool[k] = {
      fwd: makeVideo(u.forward, k + ':fwd', k === first ? 'auto' : 'metadata'),
      rev: makeVideo(u.reverse, k + ':rev', 'metadata'),
    };
  });
  function warm(v) { if (v && v.el.preload !== 'auto') { v.el.preload = 'auto'; trace('warm ' + v.name); } }
  /* what may be needed from scene i: the segments on both sides of it */
  function warmAround(i) {
    if (clipMode) return clipWarm(i);
    var a = C.transitions[i], b = C.transitions[i - 1];
    if (a) warm(pool[a.src].fwd);
    if (b) warm(pool[b.src].rev);
  }
  /* desktop: once the page is quiet, buffer the rest too — and pull every file into memory */
  if (!mobileSet) {
    window.addEventListener('load', function () {
      setTimeout(function () { Object.keys(pool).forEach(function (k) { warm(pool[k].fwd); warm(pool[k].rev); }); }, 1500);
      setTimeout(bufferToMemory, 600);
    });
  }
  /* Each file is fetched once into RAM (blob) — neighbours of the current scene first — and the
     element switches to that copy while it is hidden and idle (position restored), so no
     transition ever waits on the network or the HTTP cache. */
  function bufferToMemory() {
    if (clipMode || !window.fetch || !window.URL || !URL.createObjectURL) return;
    var order = [];
    var t = C.transitions[cur], b = C.transitions[cur - 1];
    if (t) order.push(pool[t.src].fwd);
    if (b) order.push(pool[b.src].rev);
    Object.keys(pool).forEach(function (k) { order.push(pool[k].fwd, pool[k].rev); });
    var seen = [];
    order = order.filter(function (v) { if (!v || seen.indexOf(v) >= 0) return false; seen.push(v); return true; });
    (function next() {
      var v = order.shift();
      if (!v) return;
      var url = v.el.getAttribute('src');
      if (v.ok === false || !url || /^blob:/.test(url)) return next();
      fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(function (bl) { v.blob = URL.createObjectURL(bl); v.httpSrc = url; adopt(v); })
        .catch(function () {}).then(next);
    })();
  }
  function adopt(v) {
    if (!v.blob || v.adopted || busy || (visible && visible.el === v.el) || v.el.classList.contains('is-on')) return;
    var el = v.el, t = el.currentTime, primed = el.classList.contains('is-under');
    v.adopted = true;
    v.ready = race(new Promise(function (res) {
      function ok() { el.removeEventListener('error', bad); res(true); }
      function bad() { el.removeEventListener('loadedmetadata', ok); res(false); }
      el.addEventListener('loadedmetadata', ok, { once: true });
      el.addEventListener('error', bad, { once: true });
    }), C.loadTimeoutMs, false).then(function (ok) {
      if (!ok) { el.src = v.httpSrc; trace('blob refused, back to http ' + v.name); return true; }
      trace('in memory ' + v.name);
      return t > 0 ? seek(v, t).then(function () { if (primed && !busy) el.className = 'is-under'; return true; }) : true;
    });
    el.src = v.blob;
  }
  function adoptIdle() { if (!clipMode) Object.keys(pool).forEach(function (k) { adopt(pool[k].fwd); adopt(pool[k].rev); }); }

  /* ───────────────────────── scene-1 poster ───────────────────────── */
  var posterEl = document.getElementById('poster');
  var posterScene = C.poster ? C.poster.scene : -1;
  var posterOk = !!posterEl;
  if (posterEl) {
    var pimg = posterEl.querySelector('img');
    posterEl.style.setProperty('--poster-fade', ((C.poster && C.poster.fadeMs) || 700) + 'ms');
    if (C.poster && C.poster.position) pimg.style.objectPosition = C.poster.position;
    pimg.addEventListener('error', function () { posterOk = false; posterEl.classList.remove('is-on'); trace('poster failed'); });
  }
  function setPoster(on, instant) {
    if (!posterEl || clipMode) return;   // clip mode: the poster is scene 1's still (showStill)
    on = on && posterOk;
    if (instant) posterEl.classList.add('no-fade');
    posterEl.classList.toggle('is-on', on);
    if (instant) { void posterEl.offsetWidth; posterEl.classList.remove('no-fade'); }
    root.dataset.poster = on ? 'on' : 'off';
  }

  function seek(v, t) {
    var el = v.el;
    /* already on that frame (same frame index) → nothing to seek, nothing to wait for */
    if (!el.seeking && el.readyState >= 2 && Math.floor(el.currentTime * FPS + 1e-6) === Math.floor(t * FPS + 1e-6)) return Promise.resolve('noop');
    return race(new Promise(function (res) {
      function on() { el.removeEventListener('seeked', on); res(true); }
      el.addEventListener('seeked', on);
      try { el.currentTime = t; } catch (e) { el.removeEventListener('seeked', on); res(false); }
    }), C.seekTimeoutMs, false);
  }
  /* resolve once the new frame is actually composited (or after a short cap) */
  function painted(v) {
    var el = v.el;
    if (!el.requestVideoFrameCallback || document.hidden) return wait(16);
    return race(new Promise(function (r) { el.requestVideoFrameCallback(function () { r(); }); }), 120);
  }

  var blendAnim = null;
  function show(v, blend) {
    if (visible && visible.el === v.el) return Promise.resolve();
    var prev = visible && visible.el;
    Object.keys(pool).forEach(function (k) {
      [pool[k].fwd.el, pool[k].rev.el].forEach(function (el) { if (el !== v.el && el !== prev) el.className = ''; });
    });
    if (blendAnim) { blendAnim.cancel(); blendAnim = null; }
    if (!blend || !prev || reduced.matches && blend > .5 || document.hidden) {
      v.el.className = 'is-on';
      if (prev) prev.className = '';
      return Promise.resolve();
    }
    stats.blends++;
    prev.className = 'is-under';
    v.el.className = 'is-on';
    blendAnim = v.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: blend * 1000, easing: 'ease-in-out' });
    return race(blendAnim.finished.catch(function () {}), blend * 1000 + 400).then(function () {
      if (prev && prev !== v.el && visible && visible.el !== prev) prev.className = '';
      blendAnim = null;
    });
  }

  /* pick the element that can show `frame` of `src` — forward file preferred */
  function holder(src, frame, preferRev) {
    var p = pool[src], N0 = C.sources[src].frames;
    var a = { v: p.fwd, t: ft(frame, src) }, b = { v: p.rev, t: ft(N0 - 1 - frame, src) };
    if (preferRev) { var x = a; a = b; b = x; }
    if (a.v.ok !== false) return a;
    if (b.v.ok !== false) return b;
    return null;
  }

  /* ───────────────────────── playback core ───────────────────────── */
  function tryPlay(el) {
    if (params.has('noautoplay')) { stats.playRejected++; return Promise.resolve(false); }
    el.playbackRate = RATE;
    var p;
    try { p = el.play(); } catch (e) { return Promise.resolve(false); }
    if (!p || !p.then) return Promise.resolve(!el.paused);
    return race(p.then(function () { return true; }, function (e) { trace('play() rejected: ' + (e && e.name)); stats.playRejected++; return false; }), 1500, 'timeout')
      .then(function (r) { if (r === 'timeout') { el.pause(); stats.playRejected++; return false; } return r; });
  }

  /* native playback until endT; bounded by a watchdog, stall timer and visibility */
  function playUntil(v, endT, expectMs) {
    var el = v.el;
    return new Promise(function (resolve) {
      var finished = false, stallTimer = 0, lastT = el.currentTime, lastMove = performance.now();
      var thr = endT - 0.75 / FPS;
      function finish(why) {
        if (finished) return; finished = true;
        clearTimeout(dog); clearTimeout(stallTimer); clearInterval(poll);
        el.removeEventListener('ended', onEnd); el.removeEventListener('waiting', onWait);
        el.removeEventListener('pause', onPause); document.removeEventListener('visibilitychange', onVis);
        el.pause();
        if (why !== 'done') { stats.watchdog++; trace('playUntil → ' + why); }
        resolve(why);
      }
      function check() {
        if (finished) return;
        var t = el.currentTime;
        if (t >= thr) return finish('done');
        if (t !== lastT) { lastT = t; lastMove = performance.now(); }
        else if (performance.now() - lastMove > 2000) return finish('stall');
        if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(check); else requestAnimationFrame(check);
      }
      function onEnd() { finish('done'); }
      function onWait() { clearTimeout(stallTimer); stallTimer = setTimeout(function () { finish('stall'); }, 2000); }
      function onPause() { if (!finished) setTimeout(function () { if (!finished && el.paused) finish('paused'); }, 250); }
      function onVis() { if (document.hidden) finish('hidden'); }
      el.addEventListener('ended', onEnd); el.addEventListener('waiting', onWait);
      el.addEventListener('pause', onPause); document.addEventListener('visibilitychange', onVis);
      el.addEventListener('playing', function () { clearTimeout(stallTimer); }, { once: true });
      var dog = setTimeout(function () { finish('watchdog'); }, expectMs * 1.6 + 1500);
      /* rVFC/rAF stop in hidden tabs; a coarse timer keeps the end check alive */
      var poll = setInterval(function () { if (el.currentTime >= thr) finish('done'); }, 250);
      check();
    });
  }

  /* fallback: drive currentTime by hand (autoplay refused, reversed file missing) */
  function scrub(v, t0, t1, ms) {
    stats.scrubbed++;
    var el = v.el;
    el.pause();
    return new Promise(function (resolve) {
      var start = performance.now(), finished = false;
      function finish(why) {
        if (finished) return; finished = true;
        clearTimeout(dog); document.removeEventListener('visibilitychange', onVis);
        resolve(why);
      }
      function onVis() { if (document.hidden) finish('hidden'); }
      document.addEventListener('visibilitychange', onVis);
      var dog = setTimeout(function () { finish('watchdog'); }, ms * 1.6 + 1500);
      (function step() {
        if (finished) return;
        var p = Math.min(1, (performance.now() - start) / ms);
        if (!el.seeking) { try { el.currentTime = t0 + (t1 - t0) * p; } catch (e) {} }
        if (p >= 1) return finish('done');
        requestAnimationFrame(step);
      })();
    });
  }

  /* play scenes[from] → scenes[to] through its transition segment */
  function runSegment(from, to) {
    if (clipMode) return runClip(from, to);
    var dir = to > from ? 1 : -1;
    var T = C.transitions[dir > 0 ? from : to];
    var src = T.src, Nf = C.sources[src].frames;
    var startF = dir > 0 ? T.in : T.out;
    var endF = dir > 0 ? T.out : T.in;
    var rest = C.scenes[to].rest;
    var p = pool[src];

    /* native element for this direction; reversed file missing → scrub the forward one backwards */
    var native = dir > 0 ? p.fwd : p.rev;
    return native.ready.then(function (ok) {
      var v, t0, t1, mode;
      if (ok) {
        v = native; mode = 'native';
        t0 = dir > 0 ? ft(startF, src) : ft(Nf - 1 - startF, src);
        t1 = dir > 0 ? ft(endF, src) : ft(Nf - 1 - endF, src);
      } else if (dir < 0 && p.fwd.ok) {
        v = p.fwd; mode = 'scrub';
        t0 = ft(startF, src); t1 = ft(endF, src);
      } else {
        v = null;
      }
      var ms = Math.abs(endF - startF) / FPS / RATE * 1000;

      if (!v || (reduced.matches && !params.has('motion'))) {
        /* nothing playable, or reduced motion: dissolve straight to the rest frame */
        return landOnRest(to, v ? (T.blend || 0.5) : 0, true);
      }

      return seek(v, t0).then(function (r) { return r === 'noop' ? null : painted(v); }).then(function () {
        var same = visible && visible.src === src && visible.frame === startF;
        var blending = show(v, same ? 0 : (T.blend || 0.35));
        visible = { el: v.el, src: src, frame: startF };
        if (from === posterScene) setPoster(false);   // sharp still → live video (cross-fade)
        root.dataset.mode = mode;
        var run = mode === 'scrub'
          ? scrub(v, t0, t1, ms)
          : tryPlay(v.el).then(function (played) {
              if (played) return playUntil(v, t1, ms);
              root.dataset.mode = 'scrub';
              return scrub(v, v.el.currentTime || t0, t1, ms);
            });
        return Promise.all([run, blending]);
      }).then(function () {
        /* snap: always finish exactly on the segment's last frame */
        v.el.pause();
        if (Math.floor(v.el.currentTime * FPS + 1e-6) === Math.floor(t1 * FPS)) return 'noop';
        stats.snaps++;
        return seek(v, t1);
      }).then(function () {
        visible = { el: v.el, src: src, frame: endF };
        if (rest.src !== src || rest.frame !== endF) return landOnRest(to, T.blend || 0.35, false);
      });
    });
  }

  /* make sure the exact rest frame of scene i is on screen */
  function landOnRest(i, blend, force) {
    if (clipMode) return showStill(i, blend);
    var rest = C.scenes[i].rest;
    if (!force && visible && visible.src === rest.src && visible.frame === rest.frame) return Promise.resolve();
    var h = holder(rest.src, rest.frame);
    if (!h) { root.classList.add('no-video'); return Promise.resolve(); }
    return h.v.ready.then(function (ok) {
      if (!ok) { root.classList.add('no-video'); return; }
      return seek(h.v, h.t).then(function (r) { return r === 'noop' ? null : painted(h.v); }).then(function () {
        var b = show(h.v, blend);
        visible = { el: h.v.el, src: rest.src, frame: rest.frame };
        return b;
      });
    });
  }

  /* ───────────────────────── UI blocks ───────────────────────── */
  var leaveTimers = [];
  function showUI(i) {
    var el = uis[i];
    clearTimeout(leaveTimers[i]);
    el.hidden = false; el.inert = false;
    el.classList.remove('is-leaving');
    void el.offsetWidth; // restart the stagger
    el.classList.add('is-active');
    el.setAttribute('aria-hidden', 'false');
  }
  function hideUI(i) {
    var el = uis[i];
    if (!el.classList.contains('is-active')) return;
    el.classList.remove('is-active');
    el.classList.add('is-leaving');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    leaveTimers[i] = setTimeout(function () { el.classList.remove('is-leaving'); el.hidden = true; }, C.leaveMs + 30);
  }
  function setCounter(i) {
    var n = String(i + 1).padStart(2, '0');
    if (counterNum.textContent !== n) {
      counterNum.textContent = n;
      counterNum.classList.remove('is-tick'); void counterNum.offsetWidth; counterNum.classList.add('is-tick');
    }
    root.style.setProperty('--scene', i + 1);
    counterSr.textContent = (root.lang === 'es' ? 'Bloque ' : 'Блок ') + (i + 1) + (root.lang === 'es' ? ' de ' : ' из ') + N;
  }
  function emit(type, detail) { root.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: detail })); }
  function setState(s, d) { root.dataset.state = s; if (d) root.dataset.direction = d; }

  /* ───────────────────────── navigation ───────────────────────── */
  function step(dir, source) {
    if (root.dataset.state === 'error') return Promise.resolve(false);
    if (busy) { stats.ignoredBusy++; trace('drop ' + source + ' (busy)'); return Promise.resolve(false); }
    var to = cur + dir;
    if (to < 0 || to >= N) {
      stats.ignoredEdge++; trace('edge ' + source);
      emit('sceneedge', { scene: cur + 1, direction: dir > 0 ? 'forward' : 'backward' });
      return Promise.resolve(false);
    }
    return transition(cur, to, source);
  }

  function transition(from, to, source) {
    busy = true;
    stats.steps++;
    var direction = to > from ? 'forward' : 'backward';
    var t0 = performance.now();
    setState('transition', direction);
    trace('→ ' + (from + 1) + '→' + (to + 1) + ' via ' + source);
    emit('transitionstart', { from: from + 1, to: to + 1, direction: direction, source: source });
    cards(false);
    /* UI timeline (config.timeline): a scene's screen owns its whole interval.
       Forward  — the current screen stays still while its interval plays, switches at the end.
       Backward — time re-enters the previous interval, so that screen is shown at once
                  while the interval rewinds to its start frame. */
    if (direction === 'backward') switchUI(from, to);
    warmAround(to);
    return runSegment(from, to).catch(function (e) {
      trace('segment error ' + e);
      return landOnRest(to, 0, true);
    }).then(function () {
      cur = to;
      root.dataset.scene = String(to + 1);
      setPoster(to === posterScene);
      if (direction === 'forward') switchUI(from, to);
      setState('idle');
      busy = false;
      cards(true);
      prime(to);
      var detail = { from: from + 1, to: to + 1, direction: direction, source: source, ms: Math.round(performance.now() - t0), mode: root.dataset.mode || 'native' };
      emit('transitionend', detail);
      emit('scenechange', { scene: to + 1, previous: from + 1, direction: direction });
      if (history.replaceState && !isStatic) history.replaceState(null, '', '#' + C.scenes[to].id);
      if (C.autoAdvance && direction === 'forward' && to < N - 1 && source !== 'walk') {
        setTimeout(function () { if (!document.querySelector('dialog[open]')) step(1, 'auto'); }, 0);
      }
      return true;
    });
  }

  /* smooth screen switch: old one fades out (leaveMs), new one staggers in */
  function switchUI(from, to) {
    hideUI(from);
    showUI(to);
    setCounter(to);
  }

  /* walk scene-by-scene to a target (menu links) — every transition still plays */
  var walking = false;
  function walkTo(n) {
    var target = Math.max(0, Math.min(N - 1, n - 1));
    if (walking || busy || target === cur) return;
    walking = true;
    (function next() {
      if (cur === target || root.dataset.state === 'error') { walking = false; return; }
      transition(cur, cur + (target > cur ? 1 : -1), 'walk').then(function () { setTimeout(next, 120); });
    })();
  }

  /* ───────────────────────── input ───────────────────────── */
  /* One gesture = one step. A gesture starts after `quietMs` of silence on that channel;
     everything after it (trackpad inertia, repeats) is part of the same gesture and dropped. */
  var lastInput = { wheel: -1e9, key: -1e9, touch: -1e9 };
  function gate(channel) {
    var now = performance.now();
    var quiet = now - lastInput[channel] >= C.quietMs;
    lastInput[channel] = now;
    return quiet;
  }

  window.addEventListener('wheel', function (e) {
    if (document.querySelector('dialog[open]')) return; // let the open pop-up scroll natively
    e.preventDefault();
    var d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 1) return;
    if (!gate('wheel')) { stats.ignoredGesture++; return; }
    step(d > 0 ? 1 : -1, 'wheel');
  }, { passive: false });

  var KEYS = { ArrowDown: 1, PageDown: 1, ArrowRight: 1, ' ': 1, Spacebar: 1, ArrowUp: -1, PageUp: -1, ArrowLeft: -1 };
  window.addEventListener('keydown', function (e) {
    if (document.querySelector('dialog[open]')) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var dir = KEYS[e.key];
    if (e.key === ' ' && e.shiftKey) dir = -1;
    if (!dir) return;
    if (e.key === ' ' && tag === 'BUTTON') return; // let Space press buttons
    e.preventDefault();
    if (e.repeat || !gate('key')) { stats.ignoredGesture++; return; }
    step(dir, 'key');
  });

  /* Swipes fire mid-gesture (as soon as the finger has travelled swipeMin) instead of on lift —
     the video starts while the finger is still moving. One swipe = one step. */
  var touch = null;
  function swipeDir(t) {
    var dx = touch.x - t.clientX, dy = touch.y - t.clientY;
    var d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    return { d: d, moved: Math.max(Math.abs(dx), Math.abs(dy)) };
  }
  window.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, fired: false, target: e.target };
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (!touch || touch.fired || e.touches.length !== 1) return;
    if (gestureMode) return;                                  // iOS Low Power: start on lift (a real gesture)
    var m = swipeDir(e.touches[0]);
    if (Math.abs(m.d) < C.swipeMin) return;
    touch.fired = true;
    if (!gate('touch')) { stats.ignoredGesture++; return; }
    step(m.d > 0 ? 1 : -1, 'touch');
  }, { passive: false });
  window.addEventListener('touchend', function (e) {
    runGesturePlay();                                         // a refused play() gets its retry inside this gesture
    if (!touch || document.querySelector('dialog[open]')) { touch = null; return; }
    var t = e.changedTouches[0], m = swipeDir(t), start = touch;
    touch = null;
    if (start.fired) return;
    if (m.moved < 10) {                                     // a tap on the footage: panels on / off
      var interactive = start.target && start.target.closest && start.target.closest('a, button, input, select, textarea, label, dialog');
      if (!interactive && mobileSet && root.dataset.state === 'idle') cards(root.dataset.cards !== 'on');
      return;
    }
    if (Math.abs(m.d) < C.swipeMin) return;                 // quick flick that only crossed the line on lift
    if (!gate('touch')) { stats.ignoredGesture++; return; }
    step(m.d > 0 ? 1 : -1, 'touch');
  });

  /* ───────────────────────── phone clip mode ─────────────────────────
     Every transition is a separate clip played start → end. Rest = exact still frame (JPEG).
     No seek, no scrub: the only time currentTime is touched is a rewind to 0 of an idle,
     hidden clip after it has finished. */
  var CM = C.mobileClips || {};
  var blobs = {};            // url → Promise<blob: URL | original url>
  var clipEls = {};          // 'i:f' / 'i:r' → clip record
  var stills = [];           // per scene: .still element
  var gestureMode = false;   // set once iOS refused play() outside a gesture
  var pendingPlay = null;    // play() to retry inside the next touchend / click
  function runGesturePlay() { if (pendingPlay) { var f = pendingPlay; pendingPlay = null; f(); } }
  document.addEventListener('click', runGesturePlay, true);

  if (clipMode) {
    (CM.stills || []).forEach(function (src, k) {
      if (k === posterScene && posterEl) { stills[k] = posterEl; posterEl.querySelector('img').dataset.name = 'still:' + (k + 1); return; }
      var d = document.createElement('div');
      d.className = 'poster still';
      var img = document.createElement('img');
      img.alt = ''; img.decoding = 'async'; img.dataset.name = 'still:' + (k + 1);
      img.src = src;
      d.appendChild(img);
      layer.appendChild(d);
      stills[k] = d;
    });
  }
  function stillImg(i) { return stills[i] && stills[i].querySelector('img'); }

  function showStill(i, fade) {
    var on = stills[i];
    stills.forEach(function (d, k) {
      if (!d) return;
      d.style.setProperty('--poster-fade', ((fade || 0) * 1000) + 'ms');
      if (!fade) d.classList.add('no-fade');
      d.classList.toggle('is-on', k === i);
      if (!fade) { void d.offsetWidth; d.classList.remove('no-fade'); }
    });
    var rest = C.scenes[i].rest;
    visible = { el: stillImg(i) || document.createElement('i'), src: rest.src, frame: rest.frame };
    root.dataset.poster = i === posterScene ? 'on' : 'off';
    return fade && on ? wait(fade * 1000) : Promise.resolve();
  }
  function hideStill(i, fade) {
    var d = stills[i];
    if (!d) return;
    d.style.setProperty('--poster-fade', ((fade || 0) * 1000) + 'ms');
    if (!fade) d.classList.add('no-fade');
    d.classList.remove('is-on');
    if (!fade) { void d.offsetWidth; d.classList.remove('no-fade'); }
    if (i === posterScene) root.dataset.poster = 'off';
  }

  function fetchBlob(url) {
    if (!blobs[url]) {
      blobs[url] = (window.fetch && window.URL && URL.createObjectURL)
        ? race(fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
            .then(function (b) { return URL.createObjectURL(b); }), C.loadTimeoutMs * 2, null)
            .then(function (u) { return u || url; }, function () { return url; })
        : Promise.resolve(url);
    }
    return blobs[url];
  }
  function clipUrl(i, dir) { return (dir > 0 ? CM.forward : CM.reverse).replace('{i}', i); }
  function prefetchClips(i) {
    var list = [];
    for (var d = 0; d < C.transitions.length; d++) {
      [i + d, i - 1 - d].forEach(function (k, n) { if (C.transitions[k]) list.push(clipUrl(k, n === 0 ? 1 : -1)); });
    }
    C.transitions.forEach(function (T, k) { list.push(clipUrl(k, 1), clipUrl(k, -1)); });
    (function next() { var u = list.shift(); if (!u) return; (blobs[u] || fetchBlob(u)).then(next, next); })();
  }
  if (clipMode) prefetchClips(posterScene >= 0 ? posterScene : 0);
  function clip(i, dir) {
    var key = i + (dir > 0 ? ':f' : ':r');
    if (clipEls[key]) return clipEls[key];
    var el = document.createElement('video');
    el.muted = true; el.defaultMuted = true; el.playsInline = true;
    el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
    el.setAttribute('disablepictureinpicture', ''); el.setAttribute('disableremoteplayback', '');
    el.preload = 'auto';
    el.dataset.name = 'clip:t' + i + (dir > 0 ? '' : '.rev');
    layer.insertBefore(el, layer.firstChild);
    var c = { key: key, i: i, dir: dir, el: el, loaded: false, busy: false };
    c.ready = fetchBlob(clipUrl(i, dir)).then(function (src) {
      if (clipEls[key] !== c) return false;
      el.src = src;
      c.loaded = true;
      return race(new Promise(function (res) {
        if (el.readyState >= 1) return res(true);
        el.addEventListener('loadedmetadata', function () { res(true); }, { once: true });
        el.addEventListener('error', function () { res(false); }, { once: true });
      }), 2500, true);   // iOS may not even load metadata before play(); the blob is local anyway
    });
    clipEls[key] = c;
    return c;
  }
  function releaseClip(c) {
    if (c.busy) return;
    delete clipEls[c.key];
    c.el.removeAttribute('src'); try { c.el.load(); } catch (e) {}
    c.el.remove();
  }
  /* keep only what the next gesture can need (≤ 2 decoders), fetch one step further ahead */
  function clipWarm(i) {
    var keep = {};
    if (C.transitions[i]) keep[i + ':f'] = clip(i, 1);
    if (C.transitions[i - 1]) keep[(i - 1) + ':r'] = clip(i - 1, -1);
    if (C.transitions[i + 1]) fetchBlob(clipUrl(i + 1, 1));
    if (C.transitions[i - 2]) fetchBlob(clipUrl(i - 2, -1));
    return keep;
  }
  /* idle: rewind finished clips (hidden) so the next play() starts at frame 0 with no seek */
  function clipPrime(i) {
    setTimeout(function () {
      if (busy || cur !== i) return;
      var keep = clipWarm(i);
      Object.keys(clipEls).forEach(function (k) { if (!keep[k]) releaseClip(clipEls[k]); });
      Object.keys(clipEls).forEach(function (k) {
        var c = clipEls[k];
        if (!c.busy && c.loaded && (c.el.ended || c.el.currentTime >= 1 / FPS)) { c.el.pause(); c.el.currentTime = 0; c.warm = false; }
      });
      Object.keys(keep).forEach(function (k) { warmClip(keep[k]); });
    }, 300);
  }
  /* double buffer: start the decoder and get frame 0 decoded & composited under the still,
     so play() on the gesture shows motion on the very next frame */
  function warmClip(c) {
    if (!c || c.warm || c.busy) return;
    c.ready.then(function (ok) {
      if (!ok || c.busy || busy) return;
      var el = c.el;
      el.className = 'is-under';
      var p;
      try { p = el.play(); } catch (e) { return; }
      if (!p || !p.then) return;
      var stop = function () {
        if (c.busy) return;
        el.pause();
        if (el.currentTime >= 1 / FPS) el.currentTime = 0;   // idle only; keeps the clip on frame 0
        c.warm = true;
      };
      p.then(function () {
        if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(stop); else setTimeout(stop, 20);
      }, function () { /* iOS without a gesture: fine, play() on the swipe still works */ });
    });
  }

  function runClip(from, to) {
    var dir = to > from ? 1 : -1, i = dir > 0 ? from : to;
    var T = C.transitions[i], c = clip(i, dir), el = c.el;
    var segStart = dir > 0 ? T.in : T.out, segEnd = dir > 0 ? T.out : T.in;
    var rFrom = C.scenes[from].rest, rTo = C.scenes[to].rest;
    var blendIn = (rFrom.src === T.src && rFrom.frame === segStart) ? 0 : (T.blend || 0.35);
    var blendOut = (rTo.src === T.src && rTo.frame === segEnd) ? 0 : (T.blend || 0.35);
    var ms = (T.out - T.in) / FPS / RATE * 1000;
    if (reduced.matches && !params.has('motion')) return showStill(to, 0.5);
    c.busy = true;
    root.dataset.mode = 'clip';

    function start() {
      el.className = 'is-on';                          // under the still, which still covers it
      el.playbackRate = RATE;
      var p;
      try { p = el.play(); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(function () { return true; }, function (e) { trace('clip play refused: ' + (e && e.name)); return false; });
    }
    /* play() is called synchronously when the clip is already in memory → still inside the
       user's gesture on iOS */
    var played = c.loaded ? start() : c.ready.then(function (ok) { return ok ? start() : false; });

    return played.then(function (ok) {
      if (ok || reduced.matches) return ok;
      stats.playRejected++;
      gestureMode = true;
      /* retry inside the very next touchend / click (the finger is usually still on the glass) */
      return race(new Promise(function (res) { pendingPlay = function () { start().then(res); }; }), 1200, false)
        .then(function (r) { pendingPlay = null; return r; });
    }).then(function (ok) {
      if (!ok) {
        /* last resort — a dissolve between the two stills; never frame-by-frame scrubbing */
        stats.dissolves = (stats.dissolves || 0) + 1;
        el.className = '';
        c.busy = false;
        return showStill(to, 0.6);
      }
      return new Promise(function (resolve) {
        var done = false, dog;
        function finish(why) {
          if (done) return; done = true;
          clearTimeout(dog);
          el.removeEventListener('ended', onEnd);
          document.removeEventListener('visibilitychange', onVis);
          if (why !== 'ended') { stats.watchdog++; trace('clip → ' + why); }
          resolve(why);
        }
        function onEnd() { finish('ended'); }
        function onVis() { if (document.hidden) finish('hidden'); }
        el.addEventListener('ended', onEnd);
        document.addEventListener('visibilitychange', onVis);
        dog = setTimeout(function () { finish('watchdog'); }, ms * 1.6 + 1500);
        if (el.requestVideoFrameCallback) {
          var lastFrame = function (now, md) {
            if (done) return;
            if (el.duration && md.mediaTime >= el.duration - 1.2 / FPS) return finish('ended');
            el.requestVideoFrameCallback(lastFrame);
          };
          el.requestVideoFrameCallback(lastFrame);
        }
        /* reveal the video once its first frame is on screen */
        var reveal = function () { if (!done) hideStill(from, blendIn); };
        if (el.requestVideoFrameCallback) {
          var t = setTimeout(reveal, 300);
          el.requestVideoFrameCallback(function () { clearTimeout(t); reveal(); });
        } else { setTimeout(reveal, 60); }
        if (el.ended) finish('ended');
      }).then(function () {
        var landed = showStill(to, blendOut);           // exact rest frame on top (same image)
        return landed.then(function () {
          el.pause();
          el.className = '';
          c.busy = false;
        });
      });
    });
  }

  /* ───────────────────────── phone panels window ─────────────────────────
     On phones the heavy overlays (HUD, blueprint, cards) are shown for a short window after a
     scene lands and hidden while video plays, so the GPU only composites the video. */
  var cardsTimer = 0;
  var cardsHold = (C.mobilePanels && C.mobilePanels.holdMs) || 3500;
  function cards(on) {
    if (!mobileSet) return;
    clearTimeout(cardsTimer);
    root.dataset.cards = on ? 'on' : 'off';
    if (on && !isStatic) cardsTimer = setTimeout(function () { root.dataset.cards = 'off'; }, cardsHold);
  }

  /* Pre-seek the files the next gesture will need to their first frame (while idle), so a
     transition starts on the very next frame instead of waiting for a seek over the network. */
  function prime(i) {
    if (clipMode) return clipPrime(i);
    setTimeout(adoptIdle, 900);
    setTimeout(function () {
      if (busy || cur !== i) return;
      var T = C.transitions[i], B = C.transitions[i - 1];
      [[T && pool[T.src].fwd, T && ft(T.in, T.src)],
       [B && pool[B.src].rev, B && ft(C.sources[B.src].frames - 1 - B.out, B.src)]].forEach(function (job) {
        var v = job[0];
        if (!v || v.ok === false || (visible && visible.el === v.el)) return;
        v.ready.then(function (ok) {
          if (!ok || busy || cur !== i || (visible && visible.el === v.el)) return;
          seek(v, job[1]).then(function () { if (!busy && !(visible && visible.el === v.el)) v.el.className = 'is-under'; });
        });
      });
    }, 350);
  }

  /* ───────────────────────── header modules ───────────────────────── */
  (function tachTicks() {
    var g = document.getElementById('tachTicks'), ns = 'http://www.w3.org/2000/svg';
    for (var a = -140; a <= 140; a += 10) {
      var big = a % 30 === 0, r1 = big ? 43.5 : 45.2, r2 = 48.4, rad = (a - 90) * Math.PI / 180;
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', (Math.cos(rad) * r1).toFixed(2)); l.setAttribute('y1', (Math.sin(rad) * r1).toFixed(2));
      l.setAttribute('x2', (Math.cos(rad) * r2).toFixed(2)); l.setAttribute('y2', (Math.sin(rad) * r2).toFixed(2));
      if (a >= 95) l.setAttribute('class', 'red');
      g.appendChild(l);
    }
  })();

  (function speakerDots() {
    var g = document.querySelector('.snd__dots'), ns = 'http://www.w3.org/2000/svg';
    [[6.2, 8], [9, 14]].forEach(function (ring) {
      for (var i = 0; i < ring[1]; i++) {
        var a = i / ring[1] * Math.PI * 2, c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', (12 + Math.cos(a) * ring[0]).toFixed(2)); c.setAttribute('cy', (12 + Math.sin(a) * ring[0]).toFixed(2));
        c.setAttribute('r', '0.55');
        g.appendChild(c);
      }
    });
  })();

  /* Matrix LED — day / night theme for the whole UI (header, panels, pop-ups), remembered */
  var THEME_KEY = 'torreto.theme', themeTimer = 0;
  var sweep = document.getElementById('themeSweep');
  var themeMeta = document.getElementById('themeColor');
  function setTheme(t, animate) {
    t = t === 'day' ? 'day' : 'night';
    if (animate && !reduced.matches) {
      root.classList.add('theme-anim');
      if (sweep) { sweep.classList.remove('is-run'); void sweep.offsetWidth; sweep.classList.add('is-run'); }
      clearTimeout(themeTimer);
      themeTimer = setTimeout(function () { root.classList.remove('theme-anim'); if (sweep) sweep.classList.remove('is-run'); }, 800);
    }
    root.dataset.led = t;
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', String(t === 'day')); });
    if (themeMeta) themeMeta.content = t === 'day' ? '#e9ecef' : '#0a0d18';
    if (animate) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* storage blocked */ } }
    root.dispatchEvent(new CustomEvent('themechange', { bubbles: true, detail: { theme: t } }));
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-theme-toggle]')) setTheme(root.dataset.led === 'day' ? 'night' : 'day', true);
  });
  setTheme(root.dataset.led === 'day' ? 'day' : 'night', false);

  /* High-end sound (Burmester module): a two-channel mixer, never autoplays.
       music bus — the site soundtrack, streamed (preload none), the dominant layer
       sfx bus   — PorscheSFX (porsche-sfx.js): flat-six rev, crackle and a light tyre squeal on
                   every scene change; the music ducks a little under the roar, never drops out
     Both buses → master (fades, wheel / ↑↓ volume) → soft compressor → speakers.
     No Web Audio → the soundtrack alone, faded through element volume. */
  var AU = C.audio || {};
  var SX = AU.sfx || {};
  var track = null, sndOn = false, fadeRaf = 0, volMsgTimer = 0;
  var vol = Math.min(1, Math.max(0.05, AU.volume || 0.6));
  function makeTrack() {
    var el = new Audio();
    el.src = String(AU.src || '').split('/').map(encodeURIComponent).join('/');
    el.loop = true;
    el.preload = 'none';
    el.setAttribute('playsinline', '');
    var t = { el: el, gain: null, ctx: null, music: null, sfx: null };
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';   // iOS: play with the silent switch on
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC();
      var comp = ctx.createDynamicsCompressor();          // glues the layers, catches rev peaks
      comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 3.5;
      comp.attack.value = 0.004; comp.release.value = 0.25;
      comp.connect(ctx.destination);
      t.gain = ctx.createGain(); t.gain.gain.value = 0; t.gain.connect(comp);
      t.music = ctx.createGain(); t.music.connect(t.gain);
      ctx.createMediaElementSource(el).connect(t.music);
      var bus = ctx.createGain(); bus.gain.value = SX.level != null ? SX.level : 0.3; bus.connect(t.gain);
      if (window.PorscheSFX && SX.enabled !== false) t.sfx = window.PorscheSFX(ctx, bus);
      t.ctx = ctx;
      el.volume = 1;
    } catch (e) { t.gain = null; t.ctx = null; el.volume = 0; trace('audio graph ' + e); }
    el.addEventListener('error', function () { trace('audio failed to load'); if (sndOn) setSound(false); });
    return t;
  }
  function level(v, ms, done) {
    if (track.gain) {
      var g = track.gain.gain, now = track.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + ms / 1000);
      if (done) setTimeout(done, ms + 40);
      return;
    }
    cancelAnimationFrame(fadeRaf);
    var el = track.el, v0 = el.volume, t0 = performance.now();
    (function f(t) {
      var p = Math.min(1, (t - t0) / ms), e = p * p * (3 - 2 * p);
      el.volume = Math.min(1, Math.max(0, v0 + (v - v0) * e));
      if (p < 1) fadeRaf = requestAnimationFrame(f); else if (done) done();
    })(t0);
  }
  /* music dips under the engine for `sec`, then comes back */
  function duck(sec) {
    var g = track.music.gain, now = track.ctx.currentTime, d = SX.duck != null ? SX.duck : 0.8;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(d, now + 0.25);
    g.setValueAtTime(d, now + Math.max(0.3, sec - 0.4));
    g.linearRampToValueAtTime(1, now + sec + 0.6);
  }
  function soundLabel(text) {
    document.querySelectorAll('.snd__state').forEach(function (n) { n.textContent = text; });
  }
  function setSound(on) {
    sndOn = on;
    root.dataset.sound = on ? 'on' : 'off';
    soundLabel(on ? 'On' : 'Off');
    document.querySelectorAll('[data-sound-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', String(on)); });
    if (!track) track = makeTrack();
    try {
      if (on) {
        if (track.ctx && track.ctx.state !== 'running') track.ctx.resume();
        var p = track.el.play();                          // inside the click → allowed everywhere
        if (p && p.catch) p.catch(function (e) { trace('audio play ' + (e && e.name)); setSound(false); });
        level(vol, AU.fadeInMs || 1600);
        if (track.sfx) duck(track.sfx.ignition());        // both channels start together: the engine fires up
      } else {
        if (track.sfx) track.sfx.stop();
        level(0, AU.fadeOutMs || 900, function () { if (!sndOn) track.el.pause(); });
      }
    } catch (e) { trace('audio ' + e); }
  }
  /* scroll / swipe / key → scene change → the engine answers */
  root.addEventListener('transitionstart', function (e) {
    if (!e.detail || !sndOn || !track || !track.sfx || document.hidden) return;   // CSS transitionstart bubbles here too
    var d = e.detail, k = Math.min(d.from, d.to) - 1, seg = C.transitions[k];
    var ms = seg ? (seg.out - seg.in) / C.fps / (C.playbackRate || 1) * 1000 : 4800;
    var sec;
    try {
      if (d.source === 'walk') sec = track.sfx.rev('blip');
      else if (d.direction === 'forward') sec = track.sfx.rev('launch', ms);
      else sec = track.sfx.rev('downshift', ms * 0.7);
      var drift = (SX.driftTransition != null ? SX.driftTransition : 1) === k;
      if (d.source !== 'walk') {
        if (d.direction === 'forward') track.sfx.squeal(drift ? 1.7 : 0.12, drift ? 1.6 : 0.55, drift ? 0.85 : 0.4);
        else track.sfx.squeal(0.35, 0.45, 0.3);
      }
      duck(sec);
    } catch (err) { trace('sfx ' + err); }
  });
  function nudgeVolume(d) {
    vol = Math.min(1, Math.max(0.05, Math.round((vol + d) * 100) / 100));
    if (sndOn) {
      level(vol, 260);
      soundLabel('On ' + Math.round(vol * 100) + '%');
      clearTimeout(volMsgTimer);
      volMsgTimer = setTimeout(function () { if (sndOn) soundLabel('On'); }, 1400);
    }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-sound-toggle]')) setSound(!sndOn);
  });
  var snd = document.getElementById('soundToggle');
  snd.addEventListener('wheel', function (e) {               // volume, not scenes, while over the module
    e.preventDefault(); e.stopPropagation();
    if (Math.abs(e.deltaY) >= 1) nudgeVolume(e.deltaY < 0 ? 0.05 : -0.05);
  }, { passive: false });
  snd.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault(); e.stopPropagation();
    nudgeVolume(e.key === 'ArrowUp' ? 0.05 : -0.05);
  });

  /* logo → walk back to the first scene (every transition still plays) */
  document.addEventListener('click', function (e) {
    var w = e.target.closest && e.target.closest('[data-walk]');
    if (w) { e.preventDefault(); walkTo(+w.dataset.walk); }
  });

  /* ───────────────────────── boot ───────────────────────── */
  function startAt(i, withIntro) {
    cur = i;
    setPoster(i === posterScene, true);
    if (clipMode) showStill(i, 0);
    warmAround(i);
    root.dataset.scene = String(i + 1);
    setCounter(i);
    return landOnRest(i, 0, true).then(function () {
      clearTimeout(window.__bootGuard);
      if (withIntro) {
        /* scene 1 owns 0–5 s: its screen is up while its interval plays by itself */
        root.classList.add('is-intro');
        setState('transition', 'none');
        showUI(i);
        return wait(C.intro.delayMs).then(function () {
          busy = false;
          return step(1, 'intro');
        }).then(function () { root.classList.remove('is-intro'); });
      }
      setState('idle', 'none');
      cards(true);
      prime(i);
      showUI(i);
      busy = false;
      emit('scenechange', { scene: i + 1, previous: null, direction: 'none' });
    });
  }

  var deep = parseInt(params.get('scene'), 10);
  var allBroken = function () {
    return Object.keys(pool).every(function (k) { return pool[k].fwd.ok === false && pool[k].rev.ok === false; });
  };
  (clipMode ? Promise.resolve(true) : pool[C.scenes[0].rest.src].fwd.ready).then(function () {
    if (!clipMode && allBroken()) root.classList.add('no-video');
    if (deep >= 1 && deep <= N) return startAt(deep - 1, false);
    return startAt(0, C.intro.enabled && !params.has('nointro'));
  }).catch(function (e) {
    fail('Движок не запустился', '<p>' + String(e && e.message || e).replace(/</g, '&lt;') + '</p>');
  });

  /* language switch (i18n.js): refresh the engine-owned live text */
  root.addEventListener('langchange', function (ev) { if (ev instanceof CustomEvent) setCounter(cur); });

  /* tab came back: make sure we sit on the exact rest frame */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !busy && root.dataset.state === 'idle') { landOnRest(cur, 0, false); setPoster(cur === posterScene, true); }
    if (document.hidden && clipMode) Object.keys(clipEls).forEach(function (k) { if (!clipEls[k].busy) clipEls[k].el.pause(); });
  });

  /* ───────────────────────── public API ───────────────────────── */
  window.TorretoEngine = {
    config: C,
    stats: stats,
    log: log,
    get scene() { return cur + 1; },
    get theme() { return root.dataset.led; },
    get sound() { return { on: sndOn, volume: vol, playing: !!(track && !track.el.paused), time: track ? track.el.currentTime : 0, level: track ? (track.gain ? track.gain.gain.value : track.el.volume) : 0 }; },
    setTheme: function (t) { setTheme(t, true); },
    get state() { return root.dataset.state; },
    get busy() { return busy; },
    get visible() { return visible && { name: visible.el.dataset.name, src: visible.src, frame: visible.frame, currentTime: visible.el.currentTime || 0 }; },
    get videoMode() { return clipMode ? 'clips' : 'segments'; },
    next: function () { return step(1, 'api'); },
    prev: function () { return step(-1, 'api'); },
    walkTo: walkTo,
  };
})();

/* Torreto's Garage — Porsche SFX layer (second channel of the Burmester mixer).
 *
 * Fully procedural Web Audio: a flat-six engine voice, overrun burble and tyre squeal, heard
 * from inside an insulated cabin — deep, low and muffled, a background layer under the music.
 * No sample files, nothing to license, and every rev is shaped to the length of the
 * transition it accompanies.
 *
 *   var sfx = PorscheSFX(audioContext, outputNode);
 *   sfx.rev('launch' | 'downshift' | 'blip', durationMs)   → seconds the voice lasts
 *   sfx.squeal(delaySec, durationSec, amount 0..1)
 *   sfx.ignition()                                          → seconds
 *   sfx.stop()                                              quick fade of everything playing
 *
 * Timbre: harmonics of the 4-stroke cycle frequency (rpm / 120). Order 6 = the six firing
 * pulses per cycle; orders 3, 9, 15 = the boxer's unequal exhaust paths, which give the 911
 * its hollow metallic growl; the rest = a little mechanical roughness.
 * Cabin: two low-pass stages that never open above ~600 Hz, a low shelf and a body boom
 * around 60 Hz — what is left of a flat-six behind good insulation.
 */
(function () {
  'use strict';
  var TAU = Math.PI * 2;

  function PorscheSFX(ctx, out) {
    var sr = ctx.sampleRate;
    var noise = ctx.createBuffer(1, sr * 2, sr);
    (function (d) { for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; })(noise.getChannelData(0));

    var H = 48, re = new Float32Array(H + 1), im = new Float32Array(H + 1), seed = 911;
    function prng() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var h = 1; h <= H; h++) {
      var a = h % 6 === 0 ? 1 / Math.pow(h / 6, 0.85)
            : h % 3 === 0 ? 0.42 / Math.pow(h / 3, 0.9)
            : 0.07 / Math.sqrt(h);
      var ph = prng() * TAU;
      re[h] = a * Math.cos(ph);
      im[h] = a * Math.sin(ph);
    }
    var wave = ctx.createPeriodicWave(re, im);

    var curve = new Float32Array(2048);
    for (var i = 0; i < curve.length; i++) {
      var x = i / (curve.length - 1) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
    }

    var live = [];                       // { env, nodes } of everything still sounding

    function gain(v) { var n = ctx.createGain(); n.gain.value = v; return n; }
    function filter(type, f, q) { var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }
    function forget(v, until) {
      live.push(v);
      setTimeout(function () { var k = live.indexOf(v); if (k >= 0) live.splice(k, 1); }, (until - ctx.currentTime) * 1000 + 300);
    }
    function track(env, nodes, until) {
      nodes.forEach(function (n) { try { n.start(ctx.currentTime); n.stop(until); } catch (e) { /* already scheduled */ } });
      forget({ env: env, nodes: nodes }, until);
    }

    /* keyframes [t, rpm, throttle, ease] → points every 25 ms */
    var EASE = {
      lin: function (p) { return p; },
      load: function (p) { return Math.pow(p, 1.25); },                 // pulling under load
      free: function (p) { return 1 - Math.pow(1 - p, 2.2); },          // free rev / blip
      fall: function (p) { return 1 - Math.pow(1 - p, 3); },            // revs dropping off throttle
    };
    function sample(keys, scale) {
      var pts = [], k = 0, end = keys[keys.length - 1][0] * scale;
      for (var t = 0; t <= end + 1e-6; t += 0.025) {
        while (k < keys.length - 2 && keys[k + 1][0] * scale < t) k++;
        var A = keys[k], B = keys[k + 1] || A;
        var span = (B[0] - A[0]) * scale, p = span > 0 ? Math.min(1, Math.max(0, (t - A[0] * scale) / span)) : 1;
        var e = (EASE[B[3]] || EASE.lin)(p);
        pts.push({ t: t, rpm: A[1] + (B[1] - A[1]) * e, thr: A[2] + (B[2] - A[2]) * p });
      }
      return pts;
    }

    function engine(pts, T, level) {
      var end = T + pts[pts.length - 1].t;
      var o1 = ctx.createOscillator(); o1.setPeriodicWave(wave);
      var o2 = ctx.createOscillator(); o2.setPeriodicWave(wave); o2.detune.value = 9;
      var sub = ctx.createOscillator(); sub.type = 'sine';
      var drive = gain(1), shaper = ctx.createWaveShaper();
      shaper.curve = curve; shaper.oversample = '4x';
      var lp = filter('lowpass', 400, 0.7), lp2 = filter('lowpass', 400, 0.7);       // cabin insulation
      var shelf = filter('lowshelf', 110, 0.7); shelf.gain.value = 7;
      var boom = filter('peaking', 62, 1.1); boom.gain.value = 5;                       // body resonance
      var env = gain(0);
      o1.connect(gain(0.5)).connect(drive);
      o2.connect(gain(0.32)).connect(drive);
      sub.connect(gain(0.45)).connect(drive);
      drive.connect(shaper).connect(lp).connect(lp2).connect(shelf).connect(boom).connect(env).connect(out);

      /* exhaust rumble: noise pulsed at the firing frequency, muffled like the tone */
      var ns = ctx.createBufferSource(); ns.buffer = noise; ns.loop = true;
      var bp = filter('bandpass', 200, 0.9), am = gain(0.5), lfo = ctx.createOscillator(), nl = gain(0);
      lfo.type = 'triangle';
      lfo.connect(gain(0.5)).connect(am.gain);
      ns.connect(bp).connect(filter('lowpass', 260, 0.7)).connect(am).connect(nl).connect(env);

      function auto(param, fn) {
        pts.forEach(function (p, i) {
          var v = fn(p), at = T + p.t;
          if (i) param.linearRampToValueAtTime(v, at); else param.setValueAtTime(v, at);
        });
      }
      auto(o1.frequency, function (p) { return p.rpm / 120; });
      auto(o2.frequency, function (p) { return p.rpm / 120 * 1.004; });
      auto(sub.frequency, function (p) { return p.rpm / 40; });
      auto(lfo.frequency, function (p) { return p.rpm / 20; });
      auto(bp.frequency, function (p) { return p.rpm / 20 * 1.5; });
      auto(lp.frequency, function (p) { return 240 + p.rpm * 0.045 + p.thr * 80; });
      auto(lp2.frequency, function (p) { return 240 + p.rpm * 0.045 + p.thr * 80; });
      auto(drive.gain, function (p) { return 0.55 + p.thr * 1.9; });
      auto(nl.gain, function (p) { return 0.08 + p.thr * 0.22; });
      env.gain.setValueAtTime(0, T);
      pts.forEach(function (p) {
        var v = level * (0.32 + 0.68 * Math.pow(p.thr, 0.6)) * (0.6 + 0.4 * Math.min(1, p.rpm / 7000));
        env.gain.linearRampToValueAtTime(v, T + Math.max(p.t, 0.06));
      });
      env.gain.linearRampToValueAtTime(0, end + 0.25);
      track(env, [o1, o2, sub, lfo, ns], end + 0.4);
    }

    /* overrun burble: soft low thumps after lifting off (the crackle, through the bulkhead) */
    function crackle(t0, t1, n, level) {
      for (var i = 0; i < n; i++) {
        var at = t0 + Math.random() * (t1 - t0), len = 0.03 + Math.random() * 0.04;
        var s = ctx.createBufferSource(); s.buffer = noise;
        var f = filter('lowpass', 140 + Math.random() * 180, 0.7), env = gain(0);
        var lv = level * (0.25 + Math.random() * 0.45);
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(lv, at + 0.006);
        env.gain.exponentialRampToValueAtTime(0.0001, at + len);
        s.connect(f).connect(env).connect(out);
        s.start(at, Math.random() * 1.5);
        s.stop(at + len + 0.02);
        forget({ env: env, nodes: [] }, at + len + 0.02);
      }
    }

    /* tyre squeal, muted by the cabin: two soft sines with stick-slip wobble, low-passed */
    function squeal(delay, dur, amt) {
      var T = ctx.currentTime + 0.02 + (delay || 0), f0 = 560 + Math.random() * 120, end = T + dur;
      var a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = b.type = 'sine';
      a.frequency.setValueAtTime(f0, T); a.frequency.linearRampToValueAtTime(f0 * 0.88, end);
      b.frequency.setValueAtTime(f0 * 1.47, T); b.frequency.linearRampToValueAtTime(f0 * 1.47 * 0.88, end);
      var w1 = ctx.createOscillator(), w2 = ctx.createOscillator();          // rubber stick-slip wobble
      w1.frequency.value = 6.3; w2.frequency.value = 11.7;
      [a, b].forEach(function (o, k) {
        var m = k ? 1.47 : 1;
        w1.connect(gain(12 * m)).connect(o.frequency);
        w2.connect(gain(5 * m)).connect(o.frequency);
      });
      var tone = filter('lowpass', 900, 0.7), env = gain(0);
      a.connect(gain(0.7)).connect(tone);
      b.connect(gain(0.2)).connect(tone);
      var ns = ctx.createBufferSource(); ns.buffer = noise; ns.loop = true;
      ns.connect(filter('bandpass', 700, 1.5)).connect(gain(0.12)).connect(env);
      tone.connect(filter('lowpass', 1100, 0.7)).connect(env).connect(out);
      var lv = 0.6 * Math.max(0, Math.min(1, amt));
      env.gain.setValueAtTime(0, T);
      env.gain.linearRampToValueAtTime(lv, T + 0.06);
      env.gain.setValueAtTime(lv, Math.max(T + 0.06, end - 0.25));
      env.gain.linearRampToValueAtTime(0, end);
      track(env, [a, b, w1, w2, ns], end + 0.05);
    }

    var PROFILES = {
      /* forward scene change: pull away, upshift, pull to 6800, lift-off with burble */
      launch: { base: 4.9, keys: [
        [0, 900, 0.25], [0.18, 1300, 1, 'free'], [1.55, 6000, 1, 'load'], [1.62, 6050, 0],
        [1.78, 4300, 0.05, 'fall'], [1.86, 4350, 1], [3.2, 6800, 1, 'load'], [3.32, 6600, 0],
        [4.6, 1700, 0.02, 'fall'], [4.9, 1500, 0]], crackle: [3.35, 4.3, 5] },
      /* backward scene change: braking with heel-and-toe rev-matched blips */
      downshift: { base: 3.2, keys: [
        [0, 4000, 0.5], [0.35, 3300, 0, 'fall'], [0.5, 5000, 0.8, 'free'], [0.95, 3400, 0.05, 'fall'],
        [1.1, 4600, 0.75, 'free'], [1.6, 2800, 0.05, 'fall'], [1.75, 3700, 0.6, 'free'],
        [2.6, 1300, 0.05, 'fall'], [3.2, 1000, 0]], crackle: [0.6, 2.4, 5] },
      /* logo walk-back: one short throttle blip per step */
      blip: { base: 0.9, keys: [[0, 1100, 0.3], [0.12, 4500, 1, 'free'], [0.5, 2200, 0.05, 'fall'], [0.9, 1200, 0]] },
    };

    function rev(kind, ms) {
      var P = PROFILES[kind] || PROFILES.launch;
      var scale = ms ? Math.min(1.4, Math.max(0.6, ms / 1000 / P.base)) : 1;
      fade(0.12);                                         // a new gesture cuts the previous rev
      var T = ctx.currentTime + 0.03;
      engine(sample(P.keys, scale), T, 0.25);
      if (P.crackle) crackle(T + P.crackle[0] * scale, T + P.crackle[1] * scale, P.crackle[2], 0.15);
      return P.base * scale;
    }

    function ignition() {
      fade(0.1);
      var T = ctx.currentTime + 0.03;
      /* starter motor: buzzy saw chopped by the compression strokes */
      var st = ctx.createOscillator(), chop = ctx.createOscillator(), am = gain(0.5), env = gain(0);
      st.type = 'sawtooth'; st.frequency.value = 165;
      chop.type = 'square'; chop.frequency.value = 11;
      chop.connect(gain(0.5)).connect(am.gain);
      st.connect(filter('lowpass', 320, 0.7)).connect(am).connect(env).connect(out);
      env.gain.setValueAtTime(0, T);
      env.gain.linearRampToValueAtTime(0.04, T + 0.04);
      env.gain.setValueAtTime(0.04, T + 0.5);
      env.gain.linearRampToValueAtTime(0, T + 0.6);
      track(env, [st, chop], T + 0.65);
      /* catch, flare, settle to idle */
      engine(sample([[0, 500, 0.6], [0.35, 3400, 0.9, 'free'], [0.65, 2200, 0.3, 'fall'],
        [1.1, 1150, 0.25, 'fall'], [2.1, 1000, 0.2], [2.5, 950, 0]], 1), T + 0.5, 0.25);
      return 3;
    }

    function fade(sec) {
      var now = ctx.currentTime;
      live.splice(0).forEach(function (v) {
        try {
          var g = v.env.gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(0, now + sec);
          v.nodes.forEach(function (n) { try { n.stop(now + sec + 0.05); } catch (e) { /* stopped */ } });
        } catch (e) { /* node gone */ }
      });
    }

    return { rev: rev, squeal: squeal, ignition: ignition, stop: function () { fade(0.25); } };
  }

  window.PorscheSFX = PorscheSFX;
})();

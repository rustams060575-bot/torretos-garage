/* Torreto's Garage — entrance effects for the four stat tiles at the bottom of every scene.
 *
 * Each time a scene becomes active (.scene-ui gets .is-active) its tiles replay:
 *   numeric value (100%, 360°, 0 Logs) → count-up; a zero counts down to it (errors cleared)
 *   text value (Alicante, OEM, Expert) → slow typewriter with a PCM-style block cursor
 *
 * Only the existing text node's value is animated (i18n.js keeps references to those nodes),
 * and every running effect is completed at once before a language switch or when the scene
 * leaves. Static mode (pixel check) and prefers-reduced-motion show the final values only.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var NUM = /^(\d+)(%|°|\s.*)?$/;                        // 100% · 360° · 0 Logs — not 3D Diag
  var COUNT_MS = 1500, TYPE_MS = 105, REVEAL_MS = 75, LEAD_MS = 380;
  var runs = new Map();                                  // <b> → { node, full, timer, raf }

  function valueNode(b) {
    for (var n = b.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return n;
    return null;
  }
  function finish(b) {
    var r = runs.get(b);
    if (!r) return;
    clearTimeout(r.timer);
    cancelAnimationFrame(r.raf);
    r.node.nodeValue = r.full;
    b.classList.remove('is-typing', 'is-counting');
    runs.delete(b);
  }
  function finishAll(scope) {
    runs.forEach(function (r, b) { if (!scope || scope.contains(b)) finish(b); });
  }

  function count(b, r, m, delay) {
    var to = +m[1], from = to === 0 ? 99 : 0, suffix = m[2] || '';
    r.node.nodeValue = from + suffix;
    b.classList.add('is-counting');
    r.timer = setTimeout(function () {
      var t0 = performance.now();
      (function f(t) {
        var p = Math.min(1, (t - t0) / COUNT_MS), e = 1 - Math.pow(1 - p, 3);
        r.node.nodeValue = Math.round(from + (to - from) * e) + suffix;
        if (p < 1) r.raf = requestAnimationFrame(f); else finish(b);
      })(t0);
    }, delay);
  }

  function type(b, r, delay) {
    var chars = Array.from(r.full), i = 0;
    r.node.nodeValue = '';
    b.classList.add('is-typing');
    r.timer = setTimeout(function next() {
      r.node.nodeValue = chars.slice(0, ++i).join('');
      if (i < chars.length) r.timer = setTimeout(next, TYPE_MS);
      else r.timer = setTimeout(function () { finish(b); }, 650);   // cursor lingers, then goes
    }, delay);
  }

  function play(scene) {
    if (reduced.matches || root.classList.contains('is-static')) return;
    scene.querySelectorAll('.stat b').forEach(function (b) {
      finish(b);
      var node = valueNode(b);
      if (!node) return;
      var li = b.closest('.stat');
      var i = li ? +getComputedStyle(li).getPropertyValue('--i') || 0 : 0;
      var full = node.nodeValue, delay = i * REVEAL_MS + LEAD_MS;
      var r = { node: node, full: full, timer: 0, raf: 0 };
      runs.set(b, r);
      var m = full.trim().match(NUM);
      if (m) count(b, r, m, delay); else type(b, r, delay);
    });
  }

  var scenes = document.querySelectorAll('.scene-ui');
  var active = new WeakMap();
  var mo = new MutationObserver(function (list) {
    list.forEach(function (rec) {
      var el = rec.target, on = el.classList.contains('is-active');
      if (on === !!active.get(el)) return;
      active.set(el, on);
      if (on) play(el); else finishAll(el);
    });
  });
  scenes.forEach(function (el) {
    active.set(el, el.classList.contains('is-active'));
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    if (active.get(el)) play(el);
  });

  /* capture phase: runs before i18n.js swaps the text nodes */
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-lang]')) finishAll();
  }, true);
})();

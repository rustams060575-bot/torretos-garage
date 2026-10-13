// Mechanics autotest runner.
//   node tools/run-autotest.mjs            (headless Chrome)
//   node tools/run-autotest.mjs --headed
//
// 1) opens autotest.html (the in-browser scenario page) and collects its results;
// 2) runs the scenarios that need a real browser around the page: trusted wheel / keyboard /
//    touch input, autoplay refused, broken + hanging video files, hidden tab, file://, reduced motion.
// Browser is launched WITHOUT autoplay flags (no --autoplay-policy etc.) on purpose.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const headed = process.argv.includes('--headed');
const server = await startServer(0, { quiet: true });
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: !headed });
const results = [];
const VIEW = { viewport: { width: 1440, height: 810 } };

function line(r) { console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ms != null ? `  (${r.ms} ms)` : ''}${r.detail ? `\n    ${String(r.detail).replace(/\n/g, '\n    ')}` : ''}`); }
async function scenario(name, fn) {
  const t0 = Date.now();
  let r;
  try { const d = await fn(); r = { name, ok: true, detail: d || '' }; }
  catch (e) { r = { name, ok: false, detail: e.message.split('\n')[0] }; }
  r.ms = Date.now() - t0; results.push(r); line(r);
}
const idle = (p, ms = 20000) => p.waitForFunction(() => document.documentElement.dataset.state === 'idle', null, { timeout: ms });
const busy = (p, ms = 4000) => p.waitForFunction(() => document.documentElement.dataset.state === 'transition', null, { timeout: ms });
const st = (p) => p.evaluate(() => ({ scene: +document.documentElement.dataset.scene, state: document.documentElement.dataset.state, mode: document.documentElement.dataset.mode, v: window.TorretoEngine && TorretoEngine.visible, stats: window.TorretoEngine && TorretoEngine.stats }));
function expect(c, msg) { if (!c) throw new Error(msg); }
async function expectRest(p, n) {
  const s = await st(p);
  const rest = await p.evaluate((n) => SCENES_CONFIG.scenes[n - 1].rest, n);
  expect(s.scene === n && s.state === 'idle', `expected idle scene ${n}, got ${JSON.stringify(s)}`);
  expect(s.v && s.v.src === rest.src && s.v.frame === rest.frame, `rest frame ${JSON.stringify(s.v)} ≠ ${JSON.stringify(rest)}`);
  return s;
}

/* ── 1. in-page scenario suite ── */
console.log('— autotest.html (сценарии механики)');
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 720 } });
  await page.goto(`${BASE}/autotest.html`);
  await page.waitForFunction(() => window.__AUTOTEST && window.__AUTOTEST.done, null, { timeout: 480000 });
  const r = await page.evaluate(() => window.__AUTOTEST);
  for (const x of r.results) { results.push(x); line(x); }
  console.log('  engine stats:', JSON.stringify(r.engineStats));
  await page.close();
}

/* ── 2. real-browser scenarios ── */
console.log('— реальный ввод и отказоустойчивость');

await scenario('Звук High-End: реальный клик → трек играет с плавным нарастанием, колесо = громкость, повторный клик → затухание и пауза', async () => {
  const p = await browser.newPage(VIEW);
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  await p.click('#soundToggle');
  await p.waitForTimeout(400);
  const early = await p.evaluate(() => TorretoEngine.sound);
  await p.waitForTimeout(2200);
  const s1 = await p.evaluate(() => TorretoEngine.sound);
  expect(s1.on && s1.playing && s1.time > 0.5, 'track not playing: ' + JSON.stringify(s1));
  expect(early.level < s1.level && Math.abs(s1.level - s1.volume) < 0.02, 'no fade-in: ' + JSON.stringify([early, s1]));
  await p.mouse.move(1075, 55);
  await p.mouse.wheel(0, -120);
  await p.waitForTimeout(500);
  const s2 = await p.evaluate(() => ({ s: TorretoEngine.sound, scene: TorretoEngine.scene }));
  expect(s2.s.volume > s1.volume && s2.scene === 1, 'wheel over the module: ' + JSON.stringify(s2));
  await p.click('#soundToggle');
  await p.waitForTimeout(1400);
  const s3 = await p.evaluate(() => TorretoEngine.sound);
  expect(!s3.on && !s3.playing && s3.level < 0.01, 'not faded out / paused: ' + JSON.stringify(s3));
  await p.close();
  return `playing at ${s1.time.toFixed(1)} s, volume ${s1.volume} → ${s2.s.volume}, then faded out`;
});

await scenario('Настоящее колесо мыши (trusted wheel) и клавиатура', async () => {
  const p = await browser.newPage(VIEW);
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  await p.mouse.move(700, 400);
  await p.mouse.wheel(0, 120);
  await busy(p); await idle(p);
  await expectRest(p, 2);
  await p.waitForTimeout(250);
  await p.keyboard.press('ArrowDown');
  await busy(p); await idle(p);
  await expectRest(p, 3);
  await p.waitForTimeout(250);
  await p.keyboard.press('ArrowUp');
  await busy(p); await idle(p);
  await expectRest(p, 2);
  await p.close();
});

await scenario('Настоящий свайп (CDP touch)', async () => {
  const ctx = await browser.newContext({ ...VIEW, hasTouch: true, isMobile: false });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  const cdp = await ctx.newCDPSession(p);
  const swipe = async (y0, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: y0 }] });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 700, y: y0 + (y1 - y0) * i / 6 }] }); await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(600, 300);
  await busy(p); await idle(p);
  await expectRest(p, 2);
  await p.waitForTimeout(250);
  await swipe(300, 600);
  await busy(p); await idle(p);
  await expectRest(p, 1);
  await ctx.close();
});

await scenario('Браузер отклонил play(): переход протягивается currentTime, без скачка', async () => {
  const p = await browser.newPage(VIEW);
  await p.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); };
  });
  await p.goto(`${BASE}/`);
  await idle(p);
  await p.keyboard.press('ArrowDown');
  await busy(p);
  const t0 = Date.now();
  const samples = [];
  for (let i = 0; i < 8; i++) { samples.push(await p.evaluate(() => TorretoEngine.visible && TorretoEngine.visible.currentTime)); await p.waitForTimeout(250); }
  await idle(p);
  const ms = Date.now() - t0;
  const s = await expectRest(p, 2);
  expect(s.stats.playRejected > 0 && s.stats.scrubbed > 0, 'fallback not used: ' + JSON.stringify(s.stats));
  const mid = samples.filter((t) => t > 0.3 && t < 4.7).length;
  expect(mid >= 3, 'no intermediate frames — looks like an instant jump: ' + samples.join(','));
  expect(ms > 1500, 'too fast for a scrub: ' + ms);
  await p.close();
  return `scrub ${ms} ms, samples ${samples.map((x) => x && x.toFixed(2)).join(' ')}`;
});

await scenario('Битый реверс-файл: обратный ход работает через currentTime', async () => {
  const p = await browser.newPage(VIEW);
  await p.route('**/media/2.rev.mp4', (r) => r.abort());
  await p.goto(`${BASE}/?scene=3`);
  await idle(p);
  await p.waitForTimeout(300);
  await p.keyboard.press('ArrowUp');
  await busy(p); await idle(p);
  const s = await expectRest(p, 2);
  expect(s.stats.scrubbed > 0, 'expected scrub fallback');
  await p.close();
});

await scenario('Зависший файл (нет ответа): таймаут загрузки, навигация не блокируется', async () => {
  const p = await browser.newPage(VIEW);
  await p.route('**/media/1.rev.mp4', () => { /* never respond */ });
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  await p.keyboard.press('ArrowDown');
  await busy(p); await idle(p);
  await p.waitForTimeout(250);
  const t0 = Date.now();
  await p.keyboard.press('ArrowUp');           // 2 → 1 needs 1.rev.mp4, which hangs
  await busy(p); await idle(p, 30000);
  await expectRest(p, 1);
  await p.close();
  return `landed after ${Date.now() - t0} ms`;
});

await scenario('Вкладку свернули посреди перехода: кадр доводится в финал', async () => {
  const p = await browser.newPage(VIEW);
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  await p.keyboard.press('ArrowDown');
  await busy(p);
  await p.waitForTimeout(600);
  const t0 = Date.now();
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await idle(p, 6000);
  const ms = Date.now() - t0;
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectRest(p, 2);
  expect(ms < 2500, 'took too long to land after hide: ' + ms);
  await p.close();
  return `landed ${ms} ms after hide`;
});

await scenario('Открытие по file:// — понятное объяснение вместо чёрного экрана', async () => {
  const p = await browser.newPage(VIEW);
  await p.goto(pathToFileURL(join(ROOT, 'index.html')).href);
  await p.waitForSelector('#sys:not([hidden])', { timeout: 5000 });
  const txt = await p.textContent('#sys');
  expect(/file:\/\//.test(txt) && /npm run serve/.test(txt), 'message text: ' + txt.slice(0, 120));
  expect((await p.evaluate(() => document.documentElement.dataset.state)) === 'error', 'state should be error');
  await p.close();
});

await scenario('Движок не загрузился (engine.js 404) — объяснение', async () => {
  const p = await browser.newPage(VIEW);
  await p.route('**/engine.js', (r) => r.fulfill({ status: 404, body: '' }));
  await p.goto(`${BASE}/`);
  await p.waitForSelector('#sys:not([hidden])', { timeout: 9000 });
  await p.close();
});

await scenario('prefers-reduced-motion: простое проявление', async () => {
  const ctx = await browser.newContext({ ...VIEW, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  const t0 = Date.now();
  await p.keyboard.press('ArrowDown');
  await busy(p); await idle(p);
  const ms = Date.now() - t0;
  await expectRest(p, 2);
  const tr = await p.evaluate(() => {
    const el = document.querySelector('.scene-ui.is-active [data-r]');
    const cs = getComputedStyle(el);
    return { prop: cs.transitionProperty, translate: cs.translate, filter: cs.filter };
  });
  expect(tr.prop === 'opacity' && (tr.translate === 'none' || tr.translate === '0px') && tr.filter === 'none', 'UI animation not reduced: ' + JSON.stringify(tr));
  expect(ms < 2000, 'transition not reduced: ' + ms);
  await ctx.close();
  return `transition ${ms} ms, UI: ${JSON.stringify(tr)}`;
});

/* ── 3. phones ── */
console.log('— смартфоны (эмуляция iPhone 14 / Pixel 7, без флагов автозапуска)');
const PHONES = {
  iphone: { viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  pixel: { viewport: { width: 412, height: 839 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
};
async function touchSwipe(cdp, p, y0, y1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 6 }] }); await p.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

await scenario('iPhone: свайп вверх/вниз листает сцены, грузится лёгкий мобильный набор видео', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await idle(p);
  await p.waitForTimeout(600);
  const media = await p.evaluate(() => ({ set: document.documentElement.dataset.media, mode: TorretoEngine.videoMode,
    v: [...document.querySelectorAll('video')].map((v) => v.dataset.name + '=' + v.src.slice(0, 5)) }));
  expect(media.set === 'mobile' && media.mode === 'clips' && media.v.length && media.v.every((x) => /^clip:.*=blob:$/.test(x)),
    'phone clip mode not used: ' + JSON.stringify(media));
  const cdp = await ctx.newCDPSession(p);
  await touchSwipe(cdp, p, 520, 220);                       // finger up → next
  await busy(p); await idle(p);
  await expectRest(p, 2);
  await p.waitForTimeout(250);
  await touchSwipe(cdp, p, 520, 220);
  await busy(p); await idle(p);
  await expectRest(p, 3);
  await p.waitForTimeout(250);
  await touchSwipe(cdp, p, 220, 520);                       // finger down → back
  await busy(p); await idle(p);
  await expectRest(p, 2);
  await p.waitForTimeout(250);
  await touchSwipe(cdp, p, 400, 380);                       // too short — ignored
  await p.waitForTimeout(500);
  expect((await st(p)).scene === 2, 'short swipe moved the page');
  await ctx.close();
});

for (const [name, dev] of Object.entries(PHONES)) {
  await scenario(`${name}: все 5 экранов в пределах экрана, без горизонтального скролла и наложений`, async () => {
    const ctx = await browser.newContext(dev);
    const p = await ctx.newPage();
    const issues = [];
    for (const lang of ['ru', 'es']) for (let n = 1; n <= 5; n++) {
      await p.goto(`${BASE}/?scene=${n}&static&lang=${lang}`);
      await idle(p);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => {
        const W = innerWidth, H = innerHeight, out = [];
        if (document.documentElement.scrollWidth > W) out.push('page scrollWidth ' + document.documentElement.scrollWidth);
        const vis = (el) => { const cs = getComputedStyle(el); const b = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
        const blocks = [...document.querySelectorAll('.scene-ui.is-active > *, .tach, .lang, .m-act, .counter__n')].filter(vis);
        for (const el of blocks) {
          const b = el.getBoundingClientRect();
          if (el.classList.contains('wheel-ring')) continue;
          if (b.left < -1 || b.right > W + 1 || b.top < -1 || b.bottom > H + 1) out.push('off-screen: ' + (el.className.baseVal || el.className) + ' ' + JSON.stringify([b.left, b.top, b.right, b.bottom].map(Math.round)));
        }
        // stacked blocks of the active scene must not overlap each other
        const main = [...document.querySelectorAll('.scene-ui.is-active > .pill, .scene-ui.is-active > .ttl, .scene-ui.is-active > .hud, .scene-ui.is-active > .blueprint, .scene-ui.is-active > .svc, .scene-ui.is-active > .stats')].filter(vis).map((el) => [el.className, el.getBoundingClientRect()]);
        for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) {
          const a = main[i][1], b = main[j][1];
          const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
          if (ov) out.push('overlap: ' + main[i][0] + ' × ' + main[j][0]);
        }
        const ttl = document.querySelector('.scene-ui.is-active .ttl');
        if (parseFloat(getComputedStyle(ttl).fontSize) < 24) out.push('title too small ' + getComputedStyle(ttl).fontSize);
        const stat = document.querySelector('.scene-ui.is-active .stat span');
        if (stat && parseFloat(getComputedStyle(stat).fontSize) < 10.5) out.push('card text too small ' + getComputedStyle(stat).fontSize);
        return out;
      });
      r.forEach((x) => issues.push(`${lang} scene ${n}: ${x}`));
    }
    await ctx.close();
    expect(!issues.length, issues.slice(0, 6).join(' | '));
  });
}

await scenario('iPhone: поп-ап из меню — на весь экран, без горизонтального переполнения, листается пальцем', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?static`);
  await idle(p);
  await p.tap('.m-act [data-pop]');
  await p.waitForFunction(() => document.getElementById('pcm').open);
  await p.waitForTimeout(600);
  for (const tab of ['about', 'advantages', 'services', 'contacts']) {
    await p.tap(`[data-tab="${tab}"]`);
    const r = await p.evaluate(() => {
      const d = document.getElementById('pcm'), f = d.querySelector('.pcm__frame'), sc = d.querySelector('.pcm__screen');
      const b = d.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight, fo: f.scrollWidth - f.clientWidth, so: sc.scrollWidth - sc.clientWidth, scrollable: sc.scrollHeight > sc.clientHeight };
    });
    expect(r.w === r.vw && r.h === r.vh, `${tab}: dialog not full-screen ${JSON.stringify(r)}`);
    expect(r.fo <= 1 && r.so <= 1, `${tab}: horizontal overflow ${JSON.stringify(r)}`);
  }
  await p.tap('[data-close]');
  await p.waitForFunction(() => !document.getElementById('pcm').open);
  await p.tap('.m-btn--book');
  await p.waitForFunction(() => document.getElementById('pcm').open && document.querySelector('[data-tab="contacts"]').getAttribute('aria-selected') === 'true');
  await ctx.close();
});

await scenario('Телефон: плашки живут только в окне сцены, во время видео скрыты, тап возвращает; без backdrop-filter', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await idle(p);
  const probe = () => p.evaluate(() => {
    const h = document.querySelector('.scene-ui.is-active .hud, .scene-ui.is-active .blueprint, .scene-ui.is-active .svc');
    const st = document.querySelector('.scene-ui.is-active .stats');
    return { cards: document.documentElement.dataset.cards, hud: h && getComputedStyle(h).visibility, stats: getComputedStyle(st).visibility,
      bf: h && (getComputedStyle(h).backdropFilter || getComputedStyle(h).webkitBackdropFilter), state: document.documentElement.dataset.state };
  });
  let s = await probe();
  expect(s.cards === 'on' && s.hud === 'visible' && s.stats === 'visible', 'panels not shown on landing: ' + JSON.stringify(s));
  expect(!s.bf || s.bf === 'none', 'backdrop-filter still on phones: ' + s.bf);
  await p.waitForTimeout(4300);
  s = await probe();
  expect(s.cards === 'off' && s.hud === 'hidden' && s.stats === 'hidden', 'panels not hidden after the window: ' + JSON.stringify(s));
  await p.touchscreen.tap(200, 420);
  await p.waitForTimeout(150);
  s = await probe();
  expect(s.cards === 'on' && s.hud === 'visible', 'tap did not bring panels back: ' + JSON.stringify(s));
  const cdp = await ctx.newCDPSession(p);
  await touchSwipe(cdp, p, 520, 220);
  await busy(p);
  await p.waitForTimeout(500);
  s = await probe();
  expect(s.state === 'transition' && s.cards === 'off' && s.stats === 'hidden', 'panels visible during the video: ' + JSON.stringify(s));
  await idle(p);
  s = await probe();
  expect(s.cards === 'on', 'panels did not come back on the new scene: ' + JSON.stringify(s));
  await ctx.close();
});

await scenario('Телефон: свайп срабатывает во время движения пальца (до отрыва), видео соседей заранее на старте', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 520 }] });
  for (let i = 1; i <= 4; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 520 - 18 * i }] }); await p.waitForTimeout(16); }
  const mid = await p.evaluate(() => document.documentElement.dataset.state);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(mid === 'transition', 'transition did not start before lift-off (state=' + mid + ')');
  await idle(p);
  await expectRest(p, 2);
  await p.waitForTimeout(900);   // priming runs once the scene is idle
  // double buffer: both neighbour clips in RAM (blob), decoded (readyState ≥ 2), paused on frame 0, composited under the still
  const pr = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('video')].map((v) => [v.dataset.name, [v.src.slice(0, 5), v.readyState, v.paused, Math.floor(v.currentTime * 24 + 1e-6), v.className]])));
  const ready = (x) => x && x[0] === 'blob:' && x[1] >= 2 && x[2] && x[3] === 0 && x[4] === 'is-under';
  expect(ready(pr['clip:t1']), 'next clip not buffered/decoded on frame 0: ' + JSON.stringify(pr));
  expect(ready(pr['clip:t0.rev']), 'reverse clip not buffered/decoded on frame 0: ' + JSON.stringify(pr));
  await ctx.close();
});

await scenario('Телефон: кнопка ☀/☾ — дневная тема, сохраняется после перезагрузки', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?nointro`);
  await idle(p);
  await p.tap('.m-btn--theme');
  expect((await p.evaluate(() => document.documentElement.dataset.led)) === 'day', 'theme not switched');
  await p.reload();
  await idle(p);
  const r = await p.evaluate(() => ({ led: document.documentElement.dataset.led, meta: document.getElementById('themeColor').content, sun: getComputedStyle(document.querySelector('.m-btn--theme .i-sun')).display }));
  expect(r.led === 'day' && r.meta === '#e9ecef' && r.sun === 'block', 'not restored: ' + JSON.stringify(r));
  await ctx.close();
});

/* counts every write to video.currentTime, split by engine state */
const COUNT_SEEKS = () => {
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  window.__ct = { transition: 0, idle: 0 };
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return d.get.call(this); },
    set(v) { window.__ct[document.documentElement.dataset.state === 'transition' ? 'transition' : 'idle']++; d.set.call(this, v); } });
};

await scenario('Телефон (клипы): 5 → 1 → 5 без единой перемотки/протяжки currentTime во время видео, кадр покоя = точный стоп-кадр', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  await ctx.addInitScript(COUNT_SEEKS);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await idle(p);
  const cdp = await ctx.newCDPSession(p);
  const seq = [1, 1, 1, 1, -1, -1, -1, -1, 1];
  const times = [];
  for (const d of seq) {
    await p.waitForTimeout(350);
    const t0 = Date.now();
    await touchSwipe(cdp, p, d > 0 ? 520 : 220, d > 0 ? 220 : 520);
    await busy(p);
    await p.waitForTimeout(1200);
    const mid = await p.evaluate(() => { const v = document.querySelector('video.is-on'); return v && !v.paused && v.currentTime > 0.5 && v.dataset.name; });
    expect(mid, 'no clip playing mid-transition');
    await idle(p);
    times.push(Date.now() - t0);
  }
  await expectRest(p, 2);
  const r = await p.evaluate(() => ({ ct: window.__ct, st: TorretoEngine.stats, vis: TorretoEngine.visible.name }));
  expect(r.ct.transition === 0, 'currentTime written during transitions: ' + JSON.stringify(r.ct));
  expect(r.st.scrubbed === 0 && !r.st.dissolves, 'fallback used: ' + JSON.stringify(r.st));
  expect(/^still:/.test(r.vis), 'rest is not a still: ' + r.vis);
  expect(times.every((t) => t > 4300 && t < 7000), 'interval timings: ' + times.join(','));
  await ctx.close();
  return 'intervals ' + times.join(', ') + ' ms; currentTime writes during video: 0';
});

await scenario('iOS энергосбережение: play() только в жесте → повтор на отрыве пальца, дальше свайпы стартуют на отрыве; без протяжки', async () => {
  const ctx = await browser.newContext(PHONES.iphone);
  await ctx.addInitScript(COUNT_SEEKS);
  await ctx.addInitScript(() => {
    // WebKit-like policy: play() allowed only inside touchend / click handling
    window.__gesture = false;
    const mark = () => { window.__gesture = true; setTimeout(() => { window.__gesture = false; }, 0); };
    window.addEventListener('touchend', mark, true);
    window.addEventListener('click', mark, true);
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!window.__gesture) return Promise.reject(new DOMException('gesture required', 'NotAllowedError'));
      return orig.call(this);
    };
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await idle(p);
  await p.waitForTimeout(800);
  const cdp = await ctx.newCDPSession(p);
  await touchSwipe(cdp, p, 520, 220);
  await busy(p);
  await p.waitForTimeout(1200);
  const mid = await p.evaluate(() => { const v = document.querySelector('video.is-on'); return v && !v.paused && v.dataset.name; });
  expect(mid === 'clip:t0', 'clip did not start after the gesture retry: ' + mid);
  await idle(p);
  await expectRest(p, 2);
  await p.waitForTimeout(400);
  await touchSwipe(cdp, p, 520, 220);                       // now fires on lift → play() inside the gesture
  await busy(p);
  await p.waitForTimeout(1200);
  const mid2 = await p.evaluate(() => { const v = document.querySelector('video.is-on'); return v && !v.paused && v.dataset.name; });
  await idle(p);
  await expectRest(p, 3);
  const r = await p.evaluate(() => ({ ct: window.__ct, st: TorretoEngine.stats }));
  expect(mid2 === 'clip:t1', 'second swipe not playing: ' + mid2);
  expect(r.ct.transition === 0 && r.st.scrubbed === 0 && !r.st.dissolves, 'scrub/dissolve used: ' + JSON.stringify(r));
  await ctx.close();
  return 'play refused ' + r.st.playRejected + '× → retried in touchend, no scrubbing';
});

await scenario('Телефон в альбомной ориентации: шапка из крупных кнопок, сцены листаются', async () => {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await idle(p);
  const vis = await p.evaluate(() => ['.m-act', '.lang', '.nav', '.led'].map((s) => getComputedStyle(document.querySelector(s)).display));
  expect(vis[0] === 'flex' && vis[2] === 'none' && vis[3] === 'none', 'landscape header: ' + vis.join(','));
  const cdp = await ctx.newCDPSession(p);
  await touchSwipe(cdp, p, 300, 80);
  await busy(p); await idle(p);
  await expectRest(p, 2);
  await ctx.close();
});

await browser.close();
server.close();

const ok = results.filter((r) => r.ok).length;
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(join(ROOT, 'reports', 'autotest.json'), JSON.stringify({ date: new Date().toISOString(), passed: ok, total: results.length, results }, null, 2));
console.log(`\n${ok}/${results.length} passed → reports/autotest.json`);
process.exit(ok === results.length ? 0 : 1);

// Seam latency probe: how long the picture stays frozen when a scene change starts, and the
// longest gap between presented video frames while it plays (desktop + phone emulation).
//   node tools/latency.mjs
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const server = await startServer(0, { quiet: true });
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });

const PROBE = () => {
  window.__lat = [];
  window.addEventListener('transitionstart', (e) => {
    const R = document.documentElement;
    if (!(e instanceof CustomEvent)) return;
    const t0 = performance.now(), rec = { to: e.detail.to, start: null, maxGap: 0, frames: 0 };
    window.__lat.push(rec);
    let last = null, lastEl = null, startTime = null;
    const initial = new Map([...document.querySelectorAll('video')].map((v) => [v, v.currentTime]));
    const watch = (v) => {
      const cb = (now, md) => {
        if (R.dataset.state !== 'transition' || window.__lat[window.__lat.length - 1] !== rec) return;
        if (v.classList.contains('is-on') && !v.paused) {
          // motion = a presented frame different from the frame the element rested on
          if (startTime === null) startTime = initial.has(v) ? initial.get(v) : 0;
          if (rec.start === null && Math.floor(md.mediaTime * 24 + 1e-6) !== Math.floor(startTime * 24 + 1e-6)) rec.start = Math.round(now - t0);
          if (last !== null && lastEl === v && rec.start !== null) rec.maxGap = Math.max(rec.maxGap, Math.round(now - last));
          last = now; lastEl = v; rec.frames++;
        }
        v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
    };
    document.querySelectorAll('video').forEach(watch);
  });
};

async function run(name, ctxOpts, input) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(PROBE);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await p.waitForFunction(() => document.documentElement.dataset.state === 'idle');
  await p.waitForTimeout(2500);                       // let buffering settle, like a real visitor
  const cdp = ctxOpts.hasTouch ? await ctx.newCDPSession(p) : null;
  for (const d of [1, 1, 1, 1, -1, -1, -1, -1]) {
    if (cdp) {
      const [y0, y1] = d > 0 ? [520, 220] : [220, 520];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: y0 }] });
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: y0 + (y1 - y0) * i / 6 }] }); await p.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await p.keyboard.press(d > 0 ? 'ArrowDown' : 'ArrowUp');
    }
    await p.waitForFunction(() => document.documentElement.dataset.state === 'transition', null, { timeout: 4000 });
    await p.waitForFunction(() => document.documentElement.dataset.state === 'idle', null, { timeout: 20000 });
    await p.waitForTimeout(700);
  }
  const lat = await p.evaluate(() => window.__lat);
  await ctx.close();
  const starts = lat.map((x) => x.start), gaps = lat.map((x) => x.maxGap);
  console.log(`${name.padEnd(8)} start latency ms: ${starts.join(' ')}   | max frame gap ms: ${gaps.join(' ')}`);
  return { name, lat };
}

const out = [];
out.push(await run('desktop', { viewport: { width: 1440, height: 810 } }));
out.push(await run('phone', { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }));
await browser.close();
server.close();
if (process.argv.includes('--json')) console.log(JSON.stringify(out));

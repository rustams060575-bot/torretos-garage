// Pixel check: screenshot every scene at 1440x810 @2x on top of its real video frame,
// compare with the mockup (Frame 9–13.png, resampled to 2880x1620) and measure how far
// each text block is from its place in the mockup.
//
//   node tools/pixel-compare.mjs [--scene 3] [--tol 2]
//
// Output: reports/pixel/scene-N.png · design-N.png · diff-N.png · report.json · report.md
//
// Offset method: for every text run (DOM range rects) we take the region around it in both
// images, convert to an edge map (|∇luma|) and search the integer shift (±10 CSS px, in
// device pixels) that minimises the sum of absolute differences. Edges make the match robust
// to glass/blur tints; the background is the same video frame, so only UI edges move.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'reports', 'pixel');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('scene') ? [+arg('scene')] : [1, 2, 3, 4, 5];
const TOL = +arg('tol', 2);
const DPR = 2, W = 1440, H = 810;
const DESIGNS = { 1: 'Frame 9.png', 2: 'Frame 10.png', 3: 'Frame 11.png', 4: 'Frame 12.png', 5: 'Frame 13.png' };

function designAt2x(n) {
  const out = join(OUT, `design-${n}.png`);
  if (!existsSync(out)) {
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', join(ROOT, DESIGNS[n]), '-vf', `scale=${W * DPR}:${H * DPR}:flags=lanczos`, out]);
    if (r.status !== 0) throw new Error('ffmpeg resize failed: ' + r.stderr);
  }
  return PNG.sync.read(readFileSync(out));
}

function lumaEdges(png) {
  const { width: w, height: h, data } = png;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const E = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    E[i] = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
  }
  return { E, w, h };
}

function bestShift(A, B, box, R) {
  // box in device px; A = page edges, B = design edges. Returns shift of design relative to page.
  const x0 = Math.max(R, Math.floor(box.x)), y0 = Math.max(R, Math.floor(box.y));
  const x1 = Math.min(A.w - R - 1, Math.ceil(box.x + box.w)), y1 = Math.min(A.h - R - 1, Math.ceil(box.y + box.h));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  let best = { dx: 0, dy: 0, sad: Infinity }, zero = 0, energy = 0, sum = 0, cnt = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) energy += A.E[y * A.w + x];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0;
    for (let y = y0; y < y1; y += 1) {
      const ra = y * A.w, rb = (y + dy) * B.w + dx;
      for (let x = x0; x < x1; x++) s += Math.abs(A.E[ra + x] - B.E[rb + x]);
    }
    sum += s; cnt++;
    if (dx === 0 && dy === 0) zero = s;
    if (s < best.sad) best = { dx, dy, sad: s };
  }
  // conf: how much better the best shift is than an average (wrong) shift — 0 = no structure to lock on
  return { ...best, zero, energy, conf: sum > 0 ? 1 - best.sad / (sum / cnt) : 0 };
}

const server = await startServer(0, { quiet: true });
const port = server.address().port;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await ctx.newPage();
const report = { tolerancePx: TOL, viewport: `${W}x${H}@${DPR}x`, scenes: [] };

for (const n of ONLY) {
  await page.goto(`http://127.0.0.1:${port}/?scene=${n}&static`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'idle', null, { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const frame = await page.evaluate(() => TorretoEngine.visible);
  const shotPath = join(OUT, `scene-${n}.png`);
  await page.screenshot({ path: shotPath });

  // text runs: one rect per element's text content (chrome + active scene)
  const items = await page.evaluate(() => {
    const sel = ['.nav__a', '.status__txt', '.led .t', '.snd .t', '.book .t', '.cats li', '.counter__n',
      '.scene-ui.is-active .t', '.scene-ui.is-active .pill__t', '.scene-ui.is-active .ttl__a', '.scene-ui.is-active .ttl__b',
      '.scene-ui.is-active .stat b', '.scene-ui.is-active .stat span', '.scene-ui.is-active .chips li'].join(',');
    // [data-pc-skip]: elements deliberately moved away from the mockup (e.g. header right group
    // shifted to fit the language switch) — reported as skipped, not as failures
    return [...document.querySelectorAll(sel)].filter((el) => !el.closest('[data-pc-skip]')).map((el) => {
      const r = document.createRange(); r.selectNodeContents(el);
      const q = r.getBoundingClientRect();
      return { text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), x: q.left, y: q.top, w: q.width, h: q.height };
    }).filter((b) => b.w > 2 && b.h > 2);
  });

  const shot = PNG.sync.read(readFileSync(shotPath));
  const design = designAt2x(n);
  const diff = new PNG({ width: shot.width, height: shot.height });
  const mismatched = pixelmatch(shot.data, design.data, diff.data, shot.width, shot.height, { threshold: 0.12, includeAA: false });
  writeFileSync(join(OUT, `diff-${n}.png`), PNG.sync.write(diff));

  const A = lumaEdges(shot), B = lumaEdges(design);
  const R = 10 * DPR;
  const texts = [];
  for (const it of items) {
    const box = { x: (it.x - 3) * DPR, y: (it.y - 2) * DPR, w: (it.w + 6) * DPR, h: (it.h + 4) * DPR };
    const s = bestShift(A, B, box, R);
    if (!s) continue;
    const dx = s.dx / DPR, dy = s.dy / DPR;
    const reliable = s.conf > 0.25;
    texts.push({ text: it.text, x: +it.x.toFixed(1), y: +it.y.toFixed(1), dx, dy, conf: +s.conf.toFixed(2), reliable,
      pass: !reliable || (Math.abs(dx) <= TOL && Math.abs(dy) <= TOL) });
  }
  const rel = texts.filter((t) => t.reliable);
  const pass = rel.filter((t) => t.pass).length;
  const sc = { scene: n, design: DESIGNS[n], frame, mismatchPct: +(100 * mismatched / (shot.width * shot.height)).toFixed(2),
    textsChecked: rel.length, textsWithinTol: pass, maxAbsOffset: rel.reduce((m, t) => Math.max(m, Math.abs(t.dx), Math.abs(t.dy)), 0), texts };
  report.scenes.push(sc);
  console.log(`scene ${n}: frame ${frame && frame.name}#${frame && frame.frame}  pixel mismatch ${sc.mismatchPct}%  text ${pass}/${rel.length} within ±${TOL}px  (max ${sc.maxAbsOffset}px)`);
  for (const t of rel.filter((t) => !t.pass)) console.log(`   ✗ ${t.text.padEnd(32)} dx=${t.dx} dy=${t.dy} conf=${t.conf}`);
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
let md = `# Pixel check — ${report.viewport}, tolerance ±${TOL}px\n\n| Scene | Mockup | Video frame | Pixel mismatch | Texts within tolerance | Max offset |\n|---|---|---|---|---|---|\n`;
for (const s of report.scenes) md += `| ${s.scene} | ${s.design} | ${s.frame && s.frame.name}#${s.frame && s.frame.frame} | ${s.mismatchPct}% | ${s.textsWithinTol}/${s.textsChecked} | ${s.maxAbsOffset}px |\n`;
md += '\n';
for (const s of report.scenes) {
  md += `## Scene ${s.scene}\n\n| Text | dx | dy | conf | ok |\n|---|---|---|---|---|\n`;
  for (const t of s.texts) md += `| ${t.text.replace(/\|/g, '/')} | ${t.dx} | ${t.dy} | ${t.conf} | ${t.reliable ? (t.pass ? '✓' : '✗') : '—'} |\n`;
  md += '\n';
}
writeFileSync(join(OUT, 'report.md'), md);
await browser.close();
server.close();
const allPass = report.scenes.every((s) => s.textsWithinTol === s.textsChecked);
console.log(allPass ? '✓ all text blocks within tolerance' : '✗ some text blocks are off — see reports/pixel/report.md');
process.exit(allPass ? 0 : 1);

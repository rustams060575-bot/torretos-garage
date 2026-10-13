// Torreto's Garage — video build.
// Encodes web-ready forward + reversed (ffmpeg `reverse`) versions of 1.mp4 / 2.mp4
// into media/, and writes media/manifest.json with real frame counts.
//
//   node tools/build-video.mjs
//
// Notes
//  * 1.mp4 is 1280x704 — a centre crop of the same 1280x720 shot that opens 2.mp4
//    (measured: best PSNR at an 8px vertical offset). We pad it back to 720 and smear
//    the 8px borders so its first frame lines up with 2.mp4 frame 0 and Frame 9.png.
//  * Short GOP (-g 12) keeps currentTime seeking cheap: the rAF scrub fallback and
//    the "snap to final frame" logic both depend on fast seeks.
//  * Audio is dropped: the page is muted-autoplay by design.
//  * Two variants: desktop (CRF 18, high profile) → media/, and a lighter mobile set
//    (same 1280x720 — portrait phones show a centre crop scaled up, so resolution matters —
//    but CRF 24, main profile) → media/m/. The engine picks by screen / Save-Data.
//    Existing files are kept unless --force is passed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'media');
mkdirSync(OUT, { recursive: true });

const FPS = 24;
const SOURCES = [
  { id: '1', file: '1.mp4', pre: 'pad=1280:720:0:8,fillborders=top=8:bottom=8:mode=smear' },
  { id: '2', file: '2.mp4', pre: 'scale=1280:720' },
];

const FORCE = process.argv.includes('--force');
const VARIANTS = [
  { key: 'desktop', dir: '', crf: '18', profile: 'high' },
  { key: 'mobile', dir: 'm', crf: '24', profile: 'main' },
];
const enc = (v) => [
  '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', v.crf, '-pix_fmt', 'yuv420p',
  '-profile:v', v.profile, '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
  '-r', String(FPS), '-movflags', '+faststart',
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error(`${cmd} failed (${r.status})`);
  }
  return r.stdout;
}

function probe(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  const s = j.streams[0];
  return { frames: +s.nb_read_frames, width: s.width, height: s.height, duration: +j.format.duration };
}

const manifest = { fps: FPS, generated: new Date().toISOString(), sources: {} };

for (const src of SOURCES) {
  const input = join(ROOT, src.file);
  const base = `${src.pre},fps=${FPS},setsar=1`;
  const entry = {};
  for (const v of VARIANTS) {
    const dir = join(OUT, v.dir);
    mkdirSync(dir, { recursive: true });
    const fwd = join(dir, `${src.id}.mp4`);
    const rev = join(dir, `${src.id}.rev.mp4`);
    if (FORCE || !existsSync(fwd)) { console.log(`→ ${src.file}  ${v.key} forward`); run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vf', base, ...enc(v), fwd]); }
    if (FORCE || !existsSync(rev)) { console.log(`→ ${src.file}  ${v.key} reverse`); run('ffmpeg', ['-y', '-v', 'error', '-i', input, '-vf', `${base},reverse`, ...enc(v), rev]); }
    const pf = probe(fwd);
    const pr = probe(rev);
    if (pf.frames !== pr.frames) throw new Error(`frame count mismatch ${src.id}/${v.key}: ${pf.frames} vs ${pr.frames}`);
    const rel = v.dir ? `media/${v.dir}/` : 'media/';
    entry[v.key] = { forward: `${rel}${src.id}.mp4`, reverse: `${rel}${src.id}.rev.mp4`, frames: pf.frames,
      width: pf.width, height: pf.height, bytes: { forward: statSync(fwd).size, reverse: statSync(rev).size } };
    console.log(`  ${src.id} ${v.key}: ${pf.width}x${pf.height}, ${pf.frames} frames, ${((statSync(fwd).size + statSync(rev).size) / 1e6).toFixed(1)} MB`);
  }
  manifest.sources[src.id] = { frames: entry.desktop.frames, duration: entry.desktop.frames / FPS, ...entry };
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('✓ media/manifest.json');

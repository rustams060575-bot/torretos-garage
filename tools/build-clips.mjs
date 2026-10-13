// Torreto's Garage — phone clip set.
//   node tools/build-clips.mjs [--force]
//
// Phones never seek or scrub. Every transition is its own small clip (forward + reversed),
// always played from frame 0 to the end with video.play(); the rest state of each scene is an
// exact still frame (JPEG). Segments and rest frames come straight from scenes.config.js.
//
//   media/clips/t{i}.mp4 / t{i}.rev.mp4   transition i → i+1 / i+1 → i
//   media/stills/s{n}.jpg                 rest frame of scene n (scene 1 uses top.jpeg)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'scenes.config.js'), 'utf8'), sandbox);
const C = sandbox.window.SCENES_CONFIG;

const SRC = {
  '1': { file: '1.mp4', pre: 'pad=1280:720:0:8,fillborders=top=8:bottom=8:mode=smear' },
  '2': { file: '2.mp4', pre: 'scale=1280:720' },
};
const CLIPS = join(ROOT, 'media', 'clips');
const STILLS = join(ROOT, 'media', 'stills');
mkdirSync(CLIPS, { recursive: true });
mkdirSync(STILLS, { recursive: true });

// Played start→end only, so a long GOP is fine (smaller files); main profile / level 4.0 for
// every phone decoder; faststart so playback can begin before the last byte.
const ENC = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p',
  '-profile:v', 'main', '-level', '4.0', '-g', '48', '-bf', '2', '-r', String(C.fps), '-movflags', '+faststart'];

function run(args) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}
function frames(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return +r.stdout.trim();
}

const manifest = { fps: C.fps, clips: [], stills: {} };
C.transitions.forEach((T, i) => {
  const s = SRC[T.src];
  const seg = `${s.pre},fps=${C.fps},setsar=1,trim=start_frame=${T.in}:end_frame=${T.out + 1},setpts=PTS-STARTPTS`;
  const fwd = join(CLIPS, `t${i}.mp4`), rev = join(CLIPS, `t${i}.rev.mp4`);
  if (FORCE || !existsSync(fwd)) { console.log(`→ t${i} forward  (${s.file} ${T.in}→${T.out})`); run(['-i', join(ROOT, s.file), '-vf', seg, ...ENC, fwd]); }
  if (FORCE || !existsSync(rev)) { console.log(`→ t${i} reverse`); run(['-i', join(ROOT, s.file), '-vf', `${seg},reverse`, ...ENC, rev]); }
  const n = frames(fwd), nr = frames(rev), want = T.out - T.in + 1;
  if (n !== want || nr !== want) throw new Error(`t${i}: ${n}/${nr} frames, expected ${want}`);
  manifest.clips.push({ i, forward: `media/clips/t${i}.mp4`, reverse: `media/clips/t${i}.rev.mp4`, frames: n,
    bytes: statSync(fwd).size + statSync(rev).size });
  console.log(`  t${i}: ${n} frames, ${((statSync(fwd).size + statSync(rev).size) / 1e6).toFixed(2)} MB fwd+rev`);
});

C.scenes.forEach((sc, k) => {
  if (C.poster && C.poster.scene === k) { manifest.stills[k + 1] = C.poster.src; return; }
  const out = join(STILLS, `s${k + 1}.jpg`);
  const s = SRC[sc.rest.src];
  if (FORCE || !existsSync(out)) {
    run(['-i', join(ROOT, s.file), '-vf', `${s.pre},fps=${C.fps},setsar=1,select=eq(n\\,${sc.rest.frame})`, '-frames:v', '1', '-q:v', '2', out]);
  }
  manifest.stills[k + 1] = `media/stills/s${k + 1}.jpg`;
  console.log(`  still ${k + 1}: ${s.file}#${sc.rest.frame}  ${(statSync(out).size / 1e3).toFixed(0)} kB`);
});

writeFileSync(join(CLIPS, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('✓ media/clips/manifest.json');

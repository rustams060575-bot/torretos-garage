/* Torreto's Garage — single source of truth for scenes & video transitions.
 *
 * Frame numbers are 0-based and refer to the re-encoded files in media/
 * (built by `npm run build:video`, 24 fps, 1280x720). Rest frames were found by
 * matching Frame 9–13.png against every video frame (RMSE), see README.
 *
 *   1.mp4  0 ─────────────────────────────▶ 120      hero  → blue smoke
 *   2.mp4  0 ─────────▶ 118 ──────▶ 238 ──────▶ 360   hero → garage drift → close-up → front
 *
 * A transition is an in/out segment of one source. Forward plays the forward file
 * from `in` to `out`; backward plays the ffmpeg-reversed file over the mirrored
 * range, so both directions are native playback. currentTime scrubbing is only the
 * fallback (autoplay refused, reversed file failed to load).
 *
 * `blend` (seconds): crossfade used when a segment's first frame is not the frame on
 * screen. Only 2→3 needs it — there is no footage bridging the blue smoke (end of
 * 1.mp4) and the start of 2.mp4, so that cut is softened by a short dissolve.
 */
window.SCENES_CONFIG = {
  fps: 24,
  /* 1× — every scene interval lasts ~5 s (see timeline below). */
  playbackRate: 1,

  /* Max wait for a video to become seekable before we stop waiting on it.
     A broken file must never freeze navigation. */
  loadTimeoutMs: 8000,
  /* Max wait for one seek to land. */
  seekTimeoutMs: 2500,
  /* Quiet window that separates two gestures (trackpad inertia damping). */
  quietMs: 180,
  /* UI switch (old screen fades out) at the end of an interval. */
  leaveMs: 350,
  /* Minimum swipe distance (CSS px) for touch. */
  swipeMin: 40,

  /* forward/reverse = desktop set; mobile = lighter encode (CRF 24) used on phones / Save-Data. */
  sources: {
    '1': { forward: 'media/1.mp4', reverse: 'media/1.rev.mp4', frames: 121,
           mobile: { forward: 'media/m/1.mp4', reverse: 'media/m/1.rev.mp4' } },
    '2': { forward: 'media/2.mp4', reverse: 'media/2.rev.mp4', frames: 361,
           mobile: { forward: 'media/m/2.mp4', reverse: 'media/m/2.rev.mp4' } },
  },
  /* High-end sound module (Burmester): two-channel mixer, one button toggles both.
     volume  = master; the soundtrack plays at full level inside it and stays the dominant layer.
     sfx     = procedural Porsche flat-six layer (porsche-sfx.js) fired on every scene change:
               level — SFX bus vs. music (1 = same level), duck — music level under the roar,
               driftTransition — transitions[i] that gets the long tyre squeal (2→3, garage drift). */
  audio: { src: 'media/audio/soundtrack.mp3', volume: 0.6, fadeInMs: 1600, fadeOutMs: 900,
           sfx: { enabled: true, level: 0.3, duck: 0.8, driftTransition: 1 } },

  /* phones: heavy overlays (HUD, blueprint, cards) are shown this long after a scene lands, then hidden */
  mobilePanels: { holdMs: 3500 },
  /* PHONE CLIP MODE (built by `npm run build:clips`).
     Phones never seek or scrub: each transition is its own short clip, played from frame 0
     to the end with video.play(); clips are fetched whole into memory (blob) ahead of time,
     and the rest state of a scene is its exact still frame. If iOS refuses play() outside a
     gesture (Low Power Mode), it is retried on finger lift; the last resort is a dissolve
     between stills — never frame-by-frame currentTime. */
  mobileClips: {
    enabled: true,
    forward: 'media/clips/t{i}.mp4',
    reverse: 'media/clips/t{i}.rev.mp4',
    stills: ['top.jpeg', 'media/stills/s2.jpg', 'media/stills/s3.jpg', 'media/stills/s4.jpg', 'media/stills/s5.jpg'],
  },
  /* which screens get the mobile set */
  mobileQuery: '(max-width: 760px), (max-height: 520px) and (pointer: coarse)',

  /* Sharp still for scene 1 (0–5 s). top.jpeg is a clean render of video frame 0 of 1.mp4:
     registered numerically — same scale, centred, vertical offset 49.3 % in a 16:9 cover box.
     Shown on load; dissolves when the scene-1 interval starts, fades back in on return. */
  poster: { scene: 0, src: 'top.jpeg', position: '50% 49.3%', fadeMs: 700 },

  /* Rest state of each scene = exact frame of the video that leads into it. */
  scenes: [
    { id: 'hero',        label: 'ЭТАЛОН КАЧЕСТВА',              design: 'Frame 9.png',  rest: { src: '1', frame: 0 } },
    { id: 'engineering', label: 'БЕЗКОМПРОМИССНЫЙ СЕРВИС',      design: 'Frame 10.png', rest: { src: '1', frame: 120 } },
    { id: 'control',     label: 'АБСОЛЮТНЫЙ КОНТРОЛЬ',          design: 'Frame 11.png', rest: { src: '2', frame: 118 } },
    { id: 'maintenance', label: 'ТЕХНИЧЕСКИЙ РЕГЛАМЕНТ',        design: 'Frame 12.png', rest: { src: '2', frame: 238 } },
    { id: 'booking',     label: 'ТВОЙ АВТОМОБИЛЬ. НАШ СТАНДАРТ.', design: 'Frame 13.png', rest: { src: '2', frame: 360 } },
  ],

  /* transitions[i] connects scenes[i] → scenes[i+1]. */
  transitions: [
    { src: '1', in: 0,   out: 120 },
    { src: '2', in: 0,   out: 118, blend: 0.6 },
    { src: '2', in: 118, out: 238 },
    { src: '2', in: 238, out: 360 },
  ],

  /* UI timeline (25 s). The UI of scene N stays still on screen for its whole interval while
     the video of that interval plays underneath, and switches to scene N+1 only at the end.
       scene 1:  0– 5 s   1.mp4  0 → 120
       scene 2:  5–10 s   2.mp4  0 → 118
       scene 3: 10–15 s   2.mp4 118 → 238
       scene 4: 15–20 s   2.mp4 238 → 360
       scene 5: 20–25 s   last frame (hold)
     Forward: the screen you are on is held, then switches at the end of the video.
     Backward: time re-enters the previous interval, so its screen is shown right away
     while the interval rewinds to its start frame. */
  timeline: [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25]],

  /* On load the site stands still on the sharp scene-1 poster; the first scroll / swipe
     starts the scene-1 interval. Set enabled: true to let it play by itself instead. */
  intro: { enabled: false, delayMs: 150 },

  /* true = play the whole 25 s timeline by itself (scroll still works, one step per gesture). */
  autoAdvance: false,
};

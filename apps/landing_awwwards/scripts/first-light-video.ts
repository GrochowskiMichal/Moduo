// Prepares the home hero's moving background from Mike's clip (an office over Osaka at sunset,
// 1920 × 1080; the first was 20 s, the drawn sunset of 30 October 30 s): a seamless loop (the last second cross-fades into the
// first), encoded for the web at two sizes, a first frame as the still's base, and the sun's
// track (where it is and how strongly it shines, ten times a second), which the live glass follows.
//   bun scripts/first-light-video.ts ~/Desktop/golden-hour.mp4
// Writes public/hero/osaka-office{,-720}.{webm,mp4}, public/hero/osaka-office.webp and
// src/data/first-light-sun.json. Then run scripts/first-light-poster.ts for the stills.
// Needs ffmpeg and cwebp (brew install ffmpeg webp).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error("usage: bun scripts/first-light-video.ts <clip.mp4>");
  process.exit(1);
}
const out = path.resolve("public/hero");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "first-light-"));
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
// The clip's length, whole seconds (20 for the first clip, 30 for the sunset), and its frame
// rate (the sunset is 24; the web copies keep it, no frames made up).
const D = Math.floor(
  Number(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      src,
    ])
      .toString()
      .trim(),
  ),
);
const FPS = execFileSync("ffprobe", [
  "-v",
  "error",
  "-select_streams",
  "v:0",
  "-show_entries",
  "stream=r_frame_rate",
  "-of",
  "csv=p=0",
  src,
])
  .toString()
  .trim();

// The loop: seconds 1 to D, its last second cross-faded into seconds 0 to 1, so the end leads
// back into the start (D - 1 s).
const loop = path.join(tmp, "loop.mp4");
ff(
  "-i",
  src,
  "-filter_complex",
  `[0:v]trim=start=1:end=${D},setpts=PTS-STARTPTS[main];[0:v]trim=start=0:end=1,setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=1:offset=${D - 2}[v]`,
  "-map",
  "[v]",
  "-an",
  "-c:v",
  "libx264",
  "-crf",
  "14",
  "-preset",
  "slow",
  "-pix_fmt",
  "yuv420p",
  loop,
);
// The look: the frame is drawn with far more detail than a photograph (every window of the city
// lit, every cloud edged), which read as busy under the words and beside the glass (Mike, 30
// October: "very busy, very unclean"). The web copies are defocused a little, as a lens focused on
// the desk would leave the city, and a step quieter in contrast and colour, so the room is a
// mood behind the words and the one sharp thing in the frame is the glass (the shader draws it
// over this, sharp). The sun's track is measured on the clip as it is, below.
const LOOK = "gblur=sigma=5:steps=3,eq=contrast=0.93:saturation=0.84";
const look = path.join(tmp, "look.mp4");
ff(
  "-i",
  loop,
  "-vf",
  LOOK,
  "-an",
  "-c:v",
  "libx264",
  "-crf",
  "14",
  "-preset",
  "slow",
  "-pix_fmt",
  "yuv420p",
  look,
);
const encode = (file: string, scale: string | null) =>
  ff(
    "-i",
    look,
    ...(scale ? ["-vf", `scale=${scale}:flags=lanczos`] : []),
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "29",
    "-preset",
    "veryslow",
    "-tune",
    "film",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-r",
    FPS,
    path.join(out, file),
  );
encode("osaka-office.mp4", null);
encode("osaka-office-720.mp4", "1280:720");
// VP9, smaller, for the browsers that play it (the driver asks canPlayType).
const encodeWebm = (file: string, scale: string | null) =>
  ff(
    "-i",
    look,
    ...(scale ? ["-vf", `scale=${scale}:flags=lanczos`] : []),
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "40",
    "-b:v",
    "0",
    "-row-mt",
    "1",
    "-deadline",
    "good",
    "-cpu-used",
    "2",
    "-r",
    FPS,
    path.join(out, file),
  );
encodeWebm("osaka-office.webm", null);
encodeWebm("osaka-office-720.webm", "1280:720");

// The first frame, the still's base (with the look).
const png = path.join(tmp, "frame.png");
ff("-i", look, "-frames:v", "1", png);
execFileSync("cwebp", [
  "-quiet",
  "-q",
  "82",
  "-m",
  "6",
  "-sharp_yuv",
  png,
  "-o",
  path.join(out, "osaka-office.webp"),
]);

// The sun's track: the centroid and size of the blown-out disc, ten times a second, at a quarter
// of the size (positions are given in full-size px).
const W = 480;
const H = 270;
const raw = path.join(tmp, "frames.rgb");
ff("-i", loop, "-vf", `fps=10,scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", raw);
const buf = fs.readFileSync(raw);
const F = W * H * 3;
const frames = buf.length / F;
const xs: number[] = [];
const ys: number[] = [];
const sizes: number[] = [];
for (let f = 0; f < frames; f++) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < H * 0.7; y++)
    for (let x = Math.floor(W * 0.3); x < W; x++) {
      const i = f * F + (y * W + x) * 3;
      if (0.3 * buf[i] + 0.59 * buf[i + 1] + 0.11 * buf[i + 2] > 245) {
        sx += x;
        sy += y;
        n++;
      }
    }
  xs.push(n ? (sx / n) * 4 : NaN);
  ys.push(n ? (sy / n) * 4 : NaN);
  sizes.push(n);
}
const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const track = {
  fps: 10,
  x: xs.map((v) => round(v)),
  y: ys.map((v) => round(v)),
  // how strongly it shines, 1 on average, held within 0.8 to 1.2 (the glass's beam and the
  // sun's breathing are tuned for a gentle pulse; the drawn sunset flares to 1.5 and dips to
  // 0.56, which the shader would overdo; 0.7 to 1.3 still read as restless)
  power: sizes.map((v) => round(Math.min(1.2, Math.max(0.8, v / mean)), 3)),
};
fs.writeFileSync(path.resolve("src/data/first-light-sun.json"), `${JSON.stringify(track)}\n`);
fs.rmSync(tmp, { recursive: true });
for (const f of [
  "osaka-office.mp4",
  "osaka-office-720.mp4",
  "osaka-office.webm",
  "osaka-office-720.webm",
  "osaka-office.webp",
])
  console.log(f, `${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`);
console.log(
  `sun: ${frames} samples, x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}, y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}, power ${Math.min(...track.power)}..${Math.max(...track.power)}`,
);

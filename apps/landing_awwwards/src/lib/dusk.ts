// Dusk, the home hero (components/home/Dusk.astro, motion/dusk.ts): one email, from before dawn to
// sunrise. The words stand on black on the left; on the right a plate holds a live sky and Moduo's
// Home leaning back in it, and one camera glides through the window chapter by chapter while the
// sky runs from night to first light. This file is the hero's pure part: its measure (how much
// scroll it takes, where its chapters fall), the camera's math (a pose that frames a rect, the
// blend between keyframes) and the sky's shader. The driver reads it; the tests prove it.

/** The chapters of the story, in order (data/site.ts holds their words). */
export const CHAPTERS = 7;

/** Scroll the hero takes, in svh: about a screen a chapter (the scene is taller by this much,
 *  components/home/Scene.astro; lib/scene.ts turns it into the hero's share of the scroll). */
export const DUSK_SVH = 660;

/** A phone frames one module at a time (the camera gets closer and the window is wider). */
export const NARROW = "(max-width: 899px)";

/** Where a camera keyframe sits (hero progress, 0 → 1) and how much of a chapter the move to the
 *  next keyframe takes: the first part of each chapter is the glide, the rest holds, so a visitor
 *  who stops mid-chapter rests on a composed frame. */
export const MOVE = 0.36;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** Chapter index and local progress at hero progress p. The last chapter holds to the end. */
export function chapterAt(p: number): { i: number; t: number } {
  const u = clamp01(p) * CHAPTERS;
  const i = Math.min(CHAPTERS - 1, Math.floor(u));
  return { i, t: Math.min(1, u - i) };
}

/** Hero progress where chapter i begins (and where a chapter button scrolls to: a little in). */
export const chapterStart = (i: number) => i / CHAPTERS;
export const chapterLanding = (i: number) => (i + 0.3) / CHAPTERS;

/** Where the hero rests on chapter i when it steps a chapter at a gesture (motion/dusk-steps.ts):
 *  just after the camera's last glide in that chapter has landed, so every stage is a composed
 *  frame, and still clear of the next chapter. The first rests at the top. `ats` are the
 *  camera's keyframes (hero progress, ascending). */
export function chapterRest(i: number, ats: readonly number[]): number {
  if (i <= 0) return 0;
  const start = chapterStart(i);
  const next = chapterStart(i + 1);
  const last = Math.max(start, ...ats.filter((a) => a >= start && a < next));
  return Math.min(next - 0.04 / CHAPTERS, last + (MOVE + 0.06) / CHAPTERS);
}

export type Pose = { s: number; x: number; y: number; rx: number; ry: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpPose = (a: Pose, b: Pose, t: number): Pose => ({
  s: lerp(a.s, b.s, t),
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  rx: lerp(a.rx, b.rx, t),
  ry: lerp(a.ry, b.ry, t),
});

/** Keyframe blending: with keyframes at `ats` (ascending, the first at 0), the pose at p is the
 *  blend from the keyframe before to the one just passed, eased over MOVE of a chapter. */
export function blendAt(p: number, ats: readonly number[]): { k: number; t: number } {
  let k = 0;
  for (let i = 1; i < ats.length; i++) if (p >= ats[i]) k = i;
  if (k === 0) return { k: 0, t: 1 };
  const span = MOVE / CHAPTERS;
  return { k, t: smooth((p - ats[k]) / span) };
}

/** The window as laid out in the plate (before the camera): its offset and size, in plate px. */
export type WinBox = { left: number; top: number; w: number; h: number };

/** The rest pose: the window leaning back, its height filling the plate from where it stands. */
export function restPose(plate: Size, win: WinBox, lean: { rx: number; ry: number }): Pose {
  const s = Math.max(1, (plate.h * 1.06 - win.top) / win.h);
  return { s, x: 0, y: 0, ...lean };
}

/** The pose that shows the whole window, flat, within a margin, its centre a little above the
 *  plate's (at `centre` of the height), so the sunrise shows under it. */
export function allPose(plate: Size, win: WinBox, marginFrac = 0.04, centre = 0.4): Pose {
  const m = plate.w * marginFrac;
  const s = Math.min((plate.w - 2 * m) / win.w, (plate.h - 2 * m) / win.h);
  return {
    s,
    x: (plate.w - win.w * s) / 2 - win.left,
    y: plate.h * centre - (win.h * s) / 2 - win.top,
    rx: 0,
    ry: 0,
  };
}

/** The pose that frames rect r (in window px) in the plate: centred, within a margin, never
 *  closer than maxScale. The sky may show past the window's edge: it is a window, after all. */
export function framePose(
  r: Rect,
  plate: Size,
  win: WinBox,
  maxScale = 2.1,
  marginFrac = 0.07,
): Pose {
  const m = Math.max(16, plate.w * marginFrac);
  const s = Math.min((plate.w - 2 * m) / r.w, (plate.h - 2 * m) / r.h, maxScale);
  const x = plate.w / 2 - win.left - (r.x + r.w / 2) * s;
  const y = plate.h / 2 - win.top - (r.y + r.h / 2) * s;
  return { s, x, y, rx: 0, ry: 0 };
}

/** The union of rects. */
export function union(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rs.map((r) => r.x + r.w)) - x,
    h: Math.max(...rs.map((r) => r.y + r.h)) - y,
  };
}

/** The day, 0 (night) → 1 (sunrise), from hero progress: night lingers over the first chapters,
 *  the light comes fast at the end, as it does. */
export const dayAt = (p: number) => {
  const u = clamp01(p);
  return u * u * (3 - 2 * u) * 0.85 + u * 0.15;
};

/** How much the sun lights the window's rim (0 → 1): nothing until the sky warms. */
export const sunAt = (day: number) => smooth((day - 0.55) / 0.45);

/** The sky: one full-plate pass. Night to sunrise by `uDay`, drifting cloud by `uTime`, a tiny
 *  parallax by `uOff` (the camera's move, so the sky sits behind the window in depth). */
export const SKY_VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
export const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uDay;
uniform vec2 uOff;
uniform float uSeed;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
// The sky's colors across the morning: four stops each, night, blue hour, rose, gold.
vec3 stops(float d, vec3 a, vec3 b, vec3 c, vec3 e){
  float t = d * 3.;
  return t < 1. ? mix(a, b, t) : t < 2. ? mix(b, c, t - 1.) : mix(c, e, clamp(t - 2., 0., 1.));
}
vec3 zenith(float d){ return stops(d, vec3(.03,.035,.1), vec3(.06,.07,.2), vec3(.13,.11,.30), vec3(.30,.33,.55)); }
vec3 horizon(float d){ return stops(d, vec3(.11,.12,.3), vec3(.27,.18,.48), vec3(.74,.31,.42), vec3(1.,.74,.44)); }

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 q = vec2((uv.x - .5) * asp, uv.y - .5) + uOff;
  float d = uDay;
  float hz = .2;
  float h = uv.y - hz;
  vec3 zen = zenith(d), hor = horizon(d);
  vec3 col = mix(hor, zen, pow(smoothstep(-.04, .78, h), .75));
  // Under the horizon the land is dark, with a soft haze on the line itself; it takes a little of
  // the sky's color as the sun comes up.
  col = mix(col * mix(.22, .42, d), col, smoothstep(-.1, .015, h));
  col += hor * exp(-abs(h) * 14.) * .1;
  // The sun, from well under the horizon to just over it; its glow warms the horizon first. It
  // never burns out: the bloom is wide and low, the disc small, and the brightest point sits on
  // the horizon line, under the window.
  vec2 sunP = vec2((.66 - .5) * asp, hz - .3 + d * .3 - .5);
  float dist = length((q - sunP) * vec2(1., 1.25));
  float up = smoothstep(.5, .85, d);
  vec3 sunTint = vec3(1., .82, .6);
  col += hor * exp(-abs(h) * 7.) * (.18 + .3 * smoothstep(.2, .9, d));
  col += sunTint * exp(-dist * 5.) * (.14 + .3 * d) * smoothstep(.15, .7, d);
  col += sunTint * smoothstep(.055, .03, dist) * up * .55;
  col += sunTint * exp(-dist * 16.) * up * .3;
  // Cloud: a band near the horizon, warped so it drifts; lit from the sun's side.
  float s = uTime * .018 + uSeed;
  vec2 w = vec2(fbm(q * 1.3 + vec2(s, -s * .5)), fbm(q * 1.3 + vec2(-s * .7, s * .3) + 5.2));
  float c = fbm(q * vec2(1.5, 3.1) + w * 1.5 + vec2(s * .7, 0.));
  c = smoothstep(.44, .8, c) * smoothstep(.6, .08, abs(h - .13));
  float lit = exp(-length(q - sunP) * 2.2);
  vec3 cloud = mix(mix(zen * 1.3, hor * 1.15, .5), sunTint, lit * d * .9);
  col = mix(col, cloud, c * (.55 + .3 * d));
  // Stars, in the dark, high in the sky, until the light takes them.
  vec2 sp = q * 110.;
  vec2 cell = floor(sp);
  float star = step(.994, hash(cell + uSeed));
  float sd = length(fract(sp) - .5);
  float tw = .55 + .45 * sin(uTime * 1.7 + hash(cell + 2.) * 6.28);
  col += vec3(.9, .93, 1.) * star * smoothstep(.3, .04, sd) * tw * smoothstep(.1, .5, h) * (1. - smoothstep(.12, .42, d)) * (1. - c);
  // A soft vignette, so the plate reads as a window onto the sky; a gentle roll-off at the top
  // of the range, so the sunrise glows instead of clipping; fine grain, so it never bands.
  col *= 1. - .5 * pow(length(uv - vec2(.5, .45)), 2.2);
  col = col / (1. + col * .35);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 50.) - .5) * .03;
  gl_FragColor = vec4(pow(max(col, 0.), vec3(.92)), 1.);
}`;

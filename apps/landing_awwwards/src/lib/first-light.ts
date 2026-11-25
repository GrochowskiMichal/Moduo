// The home hero's picture, "First light" (components/home/Scene.astro, motion/first-light.ts):
// an office high over Osaka at golden hour, a looping clip of it (public/hero/osaka-office.mp4,
// Mike's; its sun pulses and its rays turn). On the desk, in front of the window, stands one glass
// stroke of the mark, a solid with depth. The sun shines into it and comes out of its foot split
// into a spectrum, which falls over the desk onto the app's window, whose frame takes the colors
// in. The glass follows the clip's sun (SUN_TRACK): where it is, and how strongly it shines.
//
// The stroke is the mark, folded: its three strokes stand one behind the other. Glass follows the
// mark's own rule by parity: where an odd number of strokes overlap the glass splits the light
// into colors; where exactly two overlap (the mark's windows) the second undoes the first and the
// light passes whole. So the hero opens the stroke into the mark on scroll (the brand's reveal,
// "separation reveals"), the rainbow gives way to white light through the windows, the stone
// fills with light to Paper, and the scene below grows on from there.
//
// Plain data and GLSL, no DOM. The clip's frame is the world: the mark is placed on its desk in
// frame pixels (PLACES), and the page lays the clip out like `object-fit: cover` (cover()), so
// the glass stands on the same spot of the desk at any size. The shader works in mark units (the
// mark's 1000 box, lib/stroke.ts) and reads the current frame through the placement.
import sun from "../data/first-light-sun.json";
import { STROKE, STROKE_H } from "./stroke";

/** The mark's artwork in its 1000 box. */
export const MARK_BOX = {
  x: STROKE.x0 - STROKE.offset,
  y: STROKE.top,
  w: 2 * STROKE.offset + STROKE.w,
  h: STROKE_H,
};

/** The clip's frame: its size, and where the sun (on average) and the desk's back edge are in it
 *  (measured, scripts/first-light-video.ts). `file` names the clip, its 720p copy and its first
 *  frame. Since 30 October the clip is the drawn sunset: the sun low on the horizon at the
 *  right, the desk a strip along the foot of the frame (y 900), which on its own would sit
 *  under Home on every screen; so each placement lifts the frame (`dy`, cropping its top) until
 *  the desk's back edge lands where the golden-hour clip's did, and the glass stands on it. */
export const PHOTO = {
  file: "osaka-office",
  w: 1920,
  h: 1080,
  sun: [1470, 490] as const,
  desk: 900,
} as const;

/** The clip's sun, ten times a second: its centre (frame px) and how strongly it shines (1 on
 *  average). */
export const SUN_TRACK = sun as { fps: number; x: number[]; y: number[]; power: number[] };

/** The sun at time t (seconds into the clip, looping): its centre and power, interpolated. */
export function sunAt(t: number): { x: number; y: number; power: number } {
  const n = SUN_TRACK.power.length;
  const f = (((t * SUN_TRACK.fps) % n) + n) % n;
  const i = Math.floor(f);
  const j = (i + 1) % n;
  const u = f - i;
  const at = (a: number[]) => a[i] + (a[j] - a[i]) * u;
  return { x: at(SUN_TRACK.x), y: at(SUN_TRACK.y), power: at(SUN_TRACK.power) };
}

/** The glass's depth: how far its back face stands behind the front, in mark units, along the
 *  view's depth direction: up and to the right, so the glass shows its right side and top and its
 *  face turns to the left, toward the middle of the screen and the mockup. Folded it is one slab;
 *  open, the mark is deeper. */
export const DEPTH = { dir: [0.78, -0.62] as const, folded: 46, open: 72 };

/**
 * Where the mark's box stands in the photo (photo px: its top-left and width), and how the photo
 * is cropped (`object-position`, 0 to 1), for wide screens and phones. `stop` is where the
 * mockup's top edge sits in a typical layout (frame px), for the stills; live, it is measured.
 * Wide: on the desk right of the middle, the sun just above its left side, as in Mike's picture.
 * Phones: the part of the frame a phone shows (the sun at its right, the towers behind), the glass
 * on the desk's far edge left of the sun, its foot on the desk just above Home.
 */
export type Place = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly fx: number;
  readonly fy: number;
  /** How far the frame is lifted, as a share of the layer's height (its top is cropped). */
  readonly dy: number;
  readonly stop: number;
};
export const PLACES = {
  // Wide: the frame lifted 18.5 % (the desk's back edge, 900, lands where 700 did), the glass on
  // the desk right of the middle, the sun just above it. Narrow: lifted the same 18.5 %, so on a
  // phone (390 × 844, zoomed 1.045) the desk's back edge lands 50 px above Home and the glass,
  // on the desk's far edge left of the sun, stands with its foot in view; the sun sits just under
  // the words. (At 7 %, the desk and the foot were under Home: the glass hung over the city.)
  wide: { x: 1365, y: 620, w: 400, fx: 0.5, fy: 0.5, dy: 0.185, stop: 864 },
  narrow: { x: 1154, y: 696, w: 300, fx: 0.74, fy: 0, dy: 0.185, stop: 960 },
} as const satisfies Record<string, Place>;

/** Where the phone placement applies: a phone held upright (a phone on its side takes the wide
 *  one). The page's CSS uses the same query. */
export const NARROW = "(max-width: 900px) and (orientation: portrait)";

/**
 * The photo laid out like `object-fit: cover` in a box of w × h CSS px, then scaled by `zoom`
 * about the point the crop is anchored to (fx, fy) and lifted by `dy` of the box's height (the
 * page's CSS does the same to the still and the clip: `scale` with that transform-origin, then
 * `translate`): its scale (CSS px per photo px) and where its top-left lands; and from that,
 * where the mark's box lands (CSS px) and its scale (CSS px per mark unit).
 */
export function cover(w: number, h: number, place: Place, zoom = 1) {
  const s = Math.max(w / PHOTO.w, h / PHOTO.h) * zoom;
  const ox = (w - PHOTO.w * s) * place.fx;
  const oy = (h - PHOTO.h * s) * place.fy - place.dy * h;
  const k = (place.w * s) / MARK_BOX.w;
  const box = { x: ox + place.x * s, y: oy + place.y * s, w: place.w * s, h: MARK_BOX.h * k };
  return { s, ox, oy, box, k };
}

/** Photo px of a point in mark units. */
export const toPhoto = (place: Place, u: number, v: number): [number, number] => {
  const kp = place.w / MARK_BOX.w;
  return [place.x + (u - MARK_BOX.x) * kp, place.y + (v - MARK_BOX.y) * kp];
};
/** Mark units of a point in photo px. */
export const fromPhoto = (place: Place, x: number, y: number): [number, number] => {
  const kp = place.w / MARK_BOX.w;
  return [MARK_BOX.x + (x - place.x) / kp, MARK_BOX.y + (y - place.y) / kp];
};

/** The two windows (left: L ∩ M, right: M ∩ R) as quads, corners in order, in mark units. */
export const WINDOWS: [number, number][][] = [
  [
    [334.25, 500.0],
    [334.25, 636.8],
    [471.51, 500.0],
    [471.51, 363.2],
  ],
  [
    [528.49, 500.0],
    [528.49, 636.8],
    [665.76, 500.0],
    [665.76, 363.2],
  ],
];

/**
 * The spectrum leaves the stroke's foot and falls toward you over the desk, at the centre of the
 * mockup (the driver aims it there; `dir` is the aim on a laptop, down and to the left, about the
 * stroke's own 45°), and the mockup's frame takes it in. `spread` is the half angle, in radians.
 */
export const FAN = {
  apex: [376, 768] as const,
  dir: [-0.685, 0.728] as [number, number],
  spread: 0.3,
};

/** How far the pointer turns the spectrum (radians either way), and how far it drifts at rest. */
export const FAN_TURN = { pointer: 0.11, idle: 0.025 };

/** How far the pointer turns the glass (radians, its depth's direction) and scales its depth, and
 *  how much it breathes at rest, so its volume reads as you move. */
export const GLASS_TURN = { pointer: 0.1, depth: 0.08, idle: 0.02 };

/**
 * Where the spectrum crosses the horizontal line y (mark units): its red edge and violet edge,
 * aimed along `dir`, turned by `turn` radians (the pointer and the idle drift turn it).
 */
export function fanAt(
  y: number,
  turn = 0,
  dir: readonly [number, number] = FAN.dir,
): { red: number; violet: number } {
  const [ax, ay] = FAN.apex;
  const [dx, dy] = dir;
  // The shader measures each ray's angle from the base direction as atan(cross, dot); a ray turned
  // by θ (y down) reads as -θ, so red (-spread) is the base turned by +spread.
  const edge = (theta: number) => {
    const vx = dx * Math.cos(theta) - dy * Math.sin(theta);
    const vy = dx * Math.sin(theta) + dy * Math.cos(theta);
    return ax + ((y - ay) * vx) / vy;
  };
  return { red: edge(turn + FAN.spread), violet: edge(turn - FAN.spread) };
}

export const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** The live picture: the photograph, the glass and the light. */
export const MAIN = /* glsl */ `
precision highp float;
uniform vec2 uRes;      // canvas px
uniform float uScale;   // canvas px per CSS px
uniform vec3 uMark;     // CSS px of mark unit (0, 0), and CSS px per unit
uniform float uTime;
uniform sampler2D uPhoto;
uniform vec3 uPlace;    // the mark's box in the photo: its left, top (photo px), photo px per unit
uniform vec2 uSun;      // the sun, mark units (it moves with the clip)
uniform float uPower;   // how strongly the sun shines now (1 on average)
uniform vec2 uDepth;    // the glass's back face, offset from the front, mark units
uniform float uDesk;    // the desk's back edge, mark units
uniform float uTurn;    // radians the spectrum is turned (the pointer, the idle drift)
uniform vec2 uFanDir;   // where the spectrum is aimed: the mockup's centre
uniform float uStop;    // the mockup's top edge, mark units: it takes the light in there
uniform float uExpo;    // 0..1: the room out of the dark
uniform float uPart;    // 0: one stroke (the mark folded), 1: the mark
uniform float uReach;   // 0..1: how far the spectrum has travelled from the foot
uniform float uOut;     // 0..1: the light goes out
uniform float uPaper;   // 0..1: the stone fills with light to Paper
uniform float uPoster;  // 1: a still (no screen-space effects, no grain)

const vec3 GOLD = vec3(1.0, 0.56, 0.2);
const vec3 CORE = vec3(1.0, 0.88, 0.66);

// ── The mark: three strokes, each a parallelogram with vertical sides and 44.9° edges, rounded
// by 44 units. They stand part offsets apart (0: one behind another, 1: the mark). The sides
// don't slide as one: the left leads and the right follows, and each lifts a little on the way
// and settles (LIFT), so the opening reads as two moves, not a slide. At 0 and 1 they stand
// exactly where the mark's rule puts them. ──
const float LIFT = 16.0;
vec2 offL(float part) {
  float p = smoothstep(0.0, 0.84, part);
  return vec2(-194.24 * p, -LIFT * sin(3.14159 * p));
}
vec2 offR(float part) {
  float p = smoothstep(0.16, 1.0, part);
  return vec2(194.24 * p, -LIFT * sin(3.14159 * p));
}
float sdPara(vec2 p, float wi, float he, float sk) {
  vec2 e = vec2(sk, he);
  p = (p.y < 0.0) ? -p : p;
  vec2 w = p - e;
  w.x -= clamp(w.x, -wi, wi);
  vec2 d = vec2(dot(w, w), -w.y);
  float s = p.x * e.y - p.y * e.x;
  p = (s < 0.0) ? -p : p;
  vec2 v = p - vec2(wi, 0.0);
  v -= e * clamp(dot(v, e) / dot(e, e), -1.0, 1.0);
  d = min(d, vec2(dot(v, v), wi * he - abs(s)));
  return sqrt(d.x) * sign(-d.y);
}
float sdStroke(vec2 p) {
  return sdPara(p.yx - vec2(500.0), 103.059, 121.755, -121.328) - 44.0;
}
float xr(float a, float b) { return max(min(a, b), -max(a, b)); }
float layersSolid(vec2 p, float part) {
  float l = sdStroke(p - offL(part));
  float m = sdStroke(p);
  float r = sdStroke(p - offR(part));
  return xr(xr(l, r), m);
}
// By parity: solid where an odd number of strokes overlap, a window where exactly two do.
void layers(vec2 p, float part, out float solid, out float win) {
  float l = sdStroke(p - offL(part));
  float m = sdStroke(p);
  float r = sdStroke(p - offR(part));
  solid = xr(xr(l, r), m);
  win = max(min(min(l, m), r), -solid);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

// The photograph at a point in mark units, in linear light.
vec3 photo(vec2 m) {
  vec2 px = uPlace.xy + (m - vec2(${MARK_BOX.x.toFixed(3)}, ${MARK_BOX.y.toFixed(3)})) * uPlace.z;
  vec3 c = texture2D(uPhoto, px / vec2(${PHOTO.w.toFixed(1)}, ${PHOTO.h.toFixed(1)})).rgb;
  return pow(c, vec3(2.2));
}

vec3 spectrum(float x) {
  x = clamp(x, 0.0, 1.0);
  return vec3(
    smoothstep(0.55, 0.0, x) + smoothstep(0.82, 1.0, x) * 0.45,
    smoothstep(0.0, 0.38, x) * smoothstep(0.86, 0.45, x),
    smoothstep(0.42, 0.8, x)
  );
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 m = (css - uMark.xy) / uMark.z;
  float pxu = 1.0 / (uMark.z * uScale);
  float aa = pxu * 1.25;
  float t = uTime;
  float part = uPart;
  vec3 bg = photo(m);
  float L = length(m - uSun);
  vec3 col = bg;
  float onDesk = smoothstep(uDesk - 6.0, uDesk + 30.0, m.y);

  // ── The glass: a solid. Its front face is the mark's rule (layers); its back face stands uDepth
  // behind it, and the slices between are its walls: the sides and the tops, and the tunnels of
  // the windows when it is open. ──
  float solid = 1000.0;
  float win = 1000.0;
  float back = 1000.0;
  float hitF = 1.0;
  if (m.x > -220.0 && m.x < 1120.0 && m.y > 80.0 && m.y < 860.0) {
    layers(m, part, solid, win);
    // The swept solid's distance (its outline): the deepest slice, found coarsely and refined, so
    // the outline is smooth rather than stepped. And the wall seen here: the first slice the view
    // enters (bisected), whose edge is the wall's surface.
    float best = 1.0;
    float entry = 2.0;
    for (int i = 1; i <= 28; i++) {
      float f = float(i) / 28.0;
      float bs = layersSolid(m - uDepth * f, part);
      if (bs < back) {
        back = bs;
        best = f;
      }
      if (bs < 0.0 && entry > 1.5) entry = f;
    }
    float lo = max(best - 1.0 / 28.0, 0.0);
    float hi = min(best + 1.0 / 28.0, 1.0);
    for (int k = 0; k < 5; k++) {
      float t1 = lo + (hi - lo) / 3.0;
      float t2 = hi - (hi - lo) / 3.0;
      if (layersSolid(m - uDepth * t1, part) < layersSolid(m - uDepth * t2, part)) hi = t2;
      else lo = t1;
    }
    back = min(back, layersSolid(m - uDepth * (0.5 * (lo + hi)), part));
    if (entry < 1.5) {
      float a0 = entry - 1.0 / 28.0;
      float a1 = entry;
      for (int k = 0; k < 6; k++) {
        float mid = 0.5 * (a0 + a1);
        if (layersSolid(m - uDepth * mid, part) < 0.0) a1 = mid;
        else a0 = mid;
      }
      hitF = a1;
    } else hitF = best;
  }
  float inS = 1.0 - smoothstep(-aa, aa, solid);
  float inW = 1.0 - smoothstep(-aa, aa, win);
  float wall = (1.0 - inS) * (1.0 - smoothstep(-aa, aa, back));
  vec2 axis = normalize(vec2(1.0, -0.9965));
  float along = clamp(dot(m - vec2(390.0, 720.0), axis) / 560.0, 0.0, 1.0);
  float power = uPower;
  vec2 e = vec2(1.5, 0.0);
  float tmp;
  if (wall > 0.001) {
    // A wall: thin glass seen edge on, catching the sun where it faces it, brighter toward the
    // front, with a bright line where the back face ends.
    // its normal: the outward normal of the nearest stroke's edge (each stroke's field is smooth;
    // the mark's own field folds where two edges cross), turned to face out of the glass
    vec2 q = m - uDepth * min(hitF + 0.01, 1.0);
    vec2 oL = offL(part);
    vec2 oR = offR(part);
    float dl = sdStroke(q - oL);
    float dm = sdStroke(q);
    float dr = sdStroke(q - oR);
    vec2 at = q;
    float dk = dm;
    if (abs(dl) < abs(dk)) {
      dk = dl;
      at = q - oL;
    }
    if (abs(dr) < abs(dk)) {
      dk = dr;
      at = q - oR;
    }
    vec2 g = vec2(sdStroke(at + e.xy) - sdStroke(at - e.xy), sdStroke(at + e.yx) - sdStroke(at - e.yx));
    vec2 wn = normalize(g + 0.00001) * sign(layersSolid(q, part) * dk + 0.00001);
    float wf = clamp(dot(wn, normalize(uSun - m)), 0.0, 1.0);
    // Glass, seen through: the room behind it, a little dimmer on the outer sides, almost clear in
    // the windows' tunnels (they are holes through the glass), lit where they face the sun. The
    // wall is brighter at its front edge than at the back, and reflects the room it faces (the sky
    // over the top, the towers at the side), so the depth reads.
    vec3 behind = photo(m + vec2(-14.0, 8.0));
    vec3 wallCol = mix(behind * 0.38 * vec3(1.0, 0.93, 0.84) + vec3(0.004, 0.004, 0.005), behind * 0.95, inW);
    wallCol *= mix(1.12, 0.72, hitF);
    wallCol += photo(m + wn * 80.0) * 0.14 * (0.35 + 0.65 * wf) * (1.0 - inW);
    float sheen = pow(wf, 1.6) * (0.3 + 0.7 * (1.0 - hitF)) * power;
    wallCol += mix(GOLD, CORE, 0.45) * sheen * mix(0.55, 0.08, inW);
    // the sides away from the sun glow with the light that came through the glass to them
    float through = (1.0 - wf) * (0.35 + 0.65 * hitF) * power;
    wallCol += mix(GOLD, CORE, 0.3) * through * mix(0.16, 0.03, inW);
    float backEdge = exp(-abs(back) / (1.6 * pxu + 0.8));
    wallCol += CORE * backEdge * (0.45 + 0.7 * wf) * power * mix(0.8, 0.4, inW);
    col = mix(col, wallCol, wall);
  }
  if (solid < 40.0) {
    // The front face: dark glass, what is behind it refracted and dimmed, split a little by channel.
    vec3 inside = photo(m + vec2(-30.0, 16.0)) * vec3(0.03, 0.033, 0.045);
    inside.r += photo(m + vec2(-44.0, 24.0)).r * 0.02;
    inside.b += photo(m + vec2(-16.0, 8.0)).b * 0.028;
    inside *= 0.7 + 0.6 * (1.0 - exp(min(solid, 0.0) / 30.0));
    inside += vec3(0.004, 0.004, 0.006) * (1.0 - along);
    // the rim: crisp, white gold where it faces the sun, spectral where it turns away
    float s1;
    float s2;
    float s3;
    float s4;
    layers(m + e.xy, part, s1, tmp);
    layers(m - e.xy, part, s2, tmp);
    layers(m + e.yx, part, s3, tmp);
    layers(m - e.yx, part, s4, tmp);
    vec2 nrm = normalize(vec2(s1 - s2, s3 - s4) + 0.00001);
    vec2 toSun = normalize(uSun - m);
    float facing = clamp(dot(nrm, toSun), 0.0, 1.0);
    float edge = exp(min(solid, 0.0) / 3.0);
    float edgeWide = exp(min(solid, 0.0) / 14.0);
    float hue = fract(dot(m, vec2(0.0016, 0.0011)) + t * 0.02);
    // the rim: crisp, white gold where it faces the sun, spectral where it turns away (held a
    // third under its first strength, 30 October: it read as neon against the soft room)
    vec3 rim = mix(CORE * 1.3, spectrum(hue) * 1.1, 0.55 * (1.0 - facing)) * (edge * (0.3 + 1.2 * facing * power) + edgeWide * 0.05);
    // a bevel just inside the edge, where the face turns into the wall
    float bevel = exp(-abs(solid + 5.0) / 2.5) * (0.15 + 0.6 * facing) * power;
    // The light that comes in through the side facing the sun: it scatters
    // into the smoky glass and disperses across its thickness, warm where it enters, cooler deeper
    // in. How deep this point lies behind that side: walked out toward the sun to the edge.
    float dIn = 0.0;
    if (solid < 0.0) {
      for (int k = 0; k < 6; k++) {
        float sd = layersSolid(m + toSun * dIn, part);
        if (sd > -0.5) break;
        dIn += max(-sd, 2.0);
      }
    }
    vec3 inner = mix(mix(CORE, GOLD, 0.35), spectrum(clamp(dIn / 160.0, 0.0, 1.0)), 0.3 * smoothstep(10.0, 80.0, dIn)) * exp(-dIn / 50.0) * 0.22 * power * (1.0 - 0.5 * part);
    // the light the stroke carries, running down it from the sunlit cap to the foot
    float line = exp(-abs(dot(m - vec2(500.0, 500.0), vec2(0.7071, 0.7071)) + 40.0) / 9.0);
    vec3 carried = mix(CORE, spectrum(0.15 + along * 0.6), 0.25) * line * (0.25 + 0.9 * (1.0 - along)) * 0.7 * power;
    vec3 glass = inside + inner + rim + CORE * bevel * 0.5 + carried * (1.0 - part) + CORE * smoothstep(0.0, 1.0, along) * 0.012;
    col = mix(col, glass, inS);
  }
  // Its reflection on the satin desk, under its feet, fading down; the lit rim reflects too.
  if (m.y > 773.0 && m.y < 980.0 && solid > 0.0 && wall < 0.5) {
    vec2 mr = vec2(m.x, 2.0 * 773.0 - m.y);
    float rs;
    float rw;
    layers(mr, part, rs, rw);
    float refl = (1.0 - smoothstep(-aa, aa, rs)) * exp(-(m.y - 773.0) / 60.0);
    float redge = exp(min(rs, 0.0) / 4.0) * (1.0 - smoothstep(-aa, aa, rs));
    col = mix(col, col * 0.62, refl * 0.4);
    col += CORE * redge * exp(-(m.y - 773.0) / 40.0) * 0.12 * (1.0 - uPaper);
  }
  // ── Its shadow on the desk: away from the sun, toward you, soft and long, and the contact
  // under its foot. The spectrum falls inside it, as it does under a prism. ──
  vec2 F = vec2(${FAN.apex[0].toFixed(1)}, ${FAN.apex[1].toFixed(1)});
  if (onDesk > 0.001 && m.y > 700.0 && m.y < 1100.0) {
    vec2 sdir = normalize(F - uSun);
    vec2 rel = m - F;
    float tt = clamp(dot(rel, sdir), 0.0, 230.0);
    float dsh = length(rel - sdir * tt);
    float wsh = 30.0 + tt * 0.42;
    float shade = exp(-dsh * dsh / (2.0 * wsh * wsh)) * (1.0 - tt / 230.0);
    float contact = exp(-dot(rel, rel) / 1800.0);
    col *= 1.0 - (0.28 * shade + 0.3 * contact) * onDesk * (1.0 - inS) * (1.0 - wall) * (1.0 - uPaper);
  }
  // Where exactly two strokes overlap, the second undoes the first: the window is clear, and the
  // room behind shows through it as it is (where its tunnel's walls don't).
  float lit = 1.0 - uPaper;
  vec3 through = bg + CORE * 0.05 * exp(-L / 700.0) * lit * power;
  col = mix(col, through, inW * (1.0 - wall));


  // ── The spectrum: out of the foot, falling over the desk toward you. As the mark opens the
  // colors draw together and whiten (the second stroke undoing the first), and the white light
  // comes out of the windows instead. ──
  vec2 v = m - F;
  float dist = length(v);
  vec2 dirB = uFanDir;
  vec2 dir0 = vec2(dirB.x * cos(uTurn) - dirB.y * sin(uTurn), dirB.x * sin(uTurn) + dirB.y * cos(uTurn));
  float ang = atan(v.x * dir0.y - v.y * dir0.x, dot(v, dir0));
  float gone = smoothstep(0.2, 0.85, part);
  float sp = ${FAN.spread.toFixed(3)} * (1.0 - 0.6 * gone);
  float x = (ang + sp) / (2.0 * sp);
  float fan = smoothstep(-0.14, 0.1, x) * smoothstep(1.14, 0.9, x);
  fan *= 0.75 + 0.25 * fbm3(vec2(x * 9.0, dist * 0.01 - t * 0.08));
  float reach = uReach * 900.0;
  float run = smoothstep(10.0, 60.0, dist) * (1.0 - smoothstep(reach - 120.0, reach, dist));
  // The mockup takes the light in at its top edge: none of it goes on past.
  float before = 1.0 - smoothstep(uStop - 3.0, uStop, m.y);
  run *= before;
  float shimmer = 0.88 + 0.12 * sin(t * 0.9 + x * 6.0) * sin(t * 0.37 + dist * 0.02);
  vec3 rainbow = mix(mix(spectrum(x), vec3(0.5), 0.12), CORE, gone) * fan * run * (1.0 - gone) * shimmer * power * power;
  col += rainbow * (0.05 + 0.55 * onDesk) * exp(-dist / 520.0) * 1.35;
  col += CORE * exp(-dist / 26.0) * 0.8 * (1.0 - gone) * smoothstep(0.0, 0.2, uReach);

  // ── The mark (part 1): two white shafts from its windows, toward the mockup, as the spectrum
  // went before the mark opened ──
  if (part > 0.01) {
    vec2 VR = vec2(500.0, 500.0) - uFanDir * 2600.0;
    vec2 dR = m - VR;
    float LR = length(dR);
    vec2 n = dR / LR;
    float acc = 0.0;
    for (int i = 0; i < 16; i++) {
      float r = 2340.0 + 520.0 * (float(i) + 0.5) / 16.0;
      if (r > LR) break;
      float s5;
      float w5;
      layers(VR + n * r, part, s5, w5);
      acc += 1.0 - smoothstep(-30.0, 24.0, w5);
    }
    acc *= 32.5 / 150.0;
    col += mix(GOLD, CORE, 0.5) * acc * exp(-max(0.0, LR - 3000.0) / 700.0) * 0.18 * smoothstep(0.3, 0.9, part) * lit * (0.4 + onDesk) * before;
  }

  // Dust turning in the light.
  vec2 dc = css / 6.0 + vec2(t * 0.12, -t * 0.06);
  vec2 di = floor(dc);
  vec2 dp = vec2(hash(di), hash(di + 3.1)) * 0.8 + 0.1;
  float mote = smoothstep(0.14, 0.0, length(fract(dc) - dp)) * step(0.9, hash(di + 9.7));
  mote *= 0.5 + 0.5 * sin(t * 1.7 + hash(di) * 30.0);
  col += CORE * mote * fan * run * exp(-dist / 400.0) * (1.0 - gone) * 0.4 * (1.0 - uPoster);

  // ── Grade: the room comes out of the dark (the page dims the words' side and the header's band) ──
  col *= uExpo * (1.0 - uOut);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // On the way out, the stone fills with light from the windows outward, until the mark is
  // Paper on Canvas, as the scene below draws it.
  float soak = 1.0 - smoothstep(uPaper * 340.0 - 70.0, uPaper * 340.0, max(win, 0.0));
  col = mix(col, vec3(0.98), inS * soak * step(0.001, uPaper));
  // while it fills, a soft light stands around it in the dark room, and settles
  col += vec3(0.98) * exp(-max(solid, 0.0) / 60.0) * sin(3.14159 * uPaper) * 0.2 * (1.0 - inS);
  col += (hash(gl_FragCoord.xy + fract(t * 0.5) * 91.0) - 0.5) * (2.0 / 255.0) * (1.0 - uPoster);
  gl_FragColor = vec4(col, 1.0);
}
`;

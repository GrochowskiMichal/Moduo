// The login page's specimen (components/login/Specimen.astro, motion/pages/login.ts): Moduo's mark
// as a solid one stroke-corner deep, turning in front of a camera and read out as a grid of type.
// Plain math, no DOM, so it is tested on its own: a signed distance field of the mark (built once
// from its raster), a pose, and one orthographic ray per grid cell that says whether it meets the
// face, a side wall or nothing, and how much light that surface catches. The driver turns that
// into glyphs.

/** A signed distance field: distance in field pixels to the outline, negative inside. */
export type Field = { w: number; h: number; d: Float32Array };

/** What a cell's ray met. */
export const EMPTY = 0;
export const FACE = 1;
export const SIDE = 2;

const INF = 1e20;

// Felzenszwalb and Huttenlocher's exact squared distance transform, one line at a time.
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}

/** The field of a raster mask (1 = inside). The outline sits between pixel centers. */
export function distanceField(inside: Uint8Array, w: number, h: number): Field {
  const toIn = new Float64Array(w * h);
  const toOut = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    toIn[i] = inside[i] ? 0 : INF;
    toOut[i] = inside[i] ? INF : 0;
  }
  edt2d(toIn, w, h);
  edt2d(toOut, w, h);
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    d[i] = inside[i] ? -(Math.sqrt(toOut[i]) - 0.5) : Math.sqrt(toIn[i]) - 0.5;
  return { w, h, d };
}

/** The field at (x, y) in field pixels, bilinear; beyond the edge, the edge plus the way out. */
export function sample(F: Field, x: number, y: number): number {
  const mx = F.w - 1;
  const my = F.h - 1;
  let extra = 0;
  if (x < 0 || y < 0 || x > mx || y > my) {
    const cx = x < 0 ? 0 : x > mx ? mx : x;
    const cy = y < 0 ? 0 : y > my ? my : y;
    extra = Math.hypot(x - cx, y - cy);
    x = cx;
    y = cy;
  }
  const x0 = Math.min(Math.floor(x), mx - 1);
  const y0 = Math.min(Math.floor(y), my - 1);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * F.w + x0;
  const d = F.d;
  const top = d[i] + (d[i + 1] - d[i]) * fx;
  const bot = d[i + F.w] + (d[i + F.w + 1] - d[i + F.w]) * fx;
  return top + (bot - top) * fy + extra;
}

/** Turned about the vertical axis (yaw), then tipped toward you (pitch), in radians. */
export type Pose = { yaw: number; pitch: number };

/** The rotation that takes the solid's own axes to the screen's (y down, z toward you). */
export function rotation({ yaw, pitch }: Pose) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Ry(yaw) · Rx(pitch), row by row.
  return [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp];
}

/** The grid the solid is read into: cell size and where the field's center sits, in CSS px. */
export type Grid = {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Screen position of the field's center. */
  ox: number;
  oy: number;
  /** Screen pixels per field pixel. */
  scale: number;
};

/** Light from the upper left, a little in front. */
const LIGHT = (() => {
  const l = [-0.36, -0.5, 0.79];
  const n = Math.hypot(l[0], l[1], l[2]);
  return l.map((c) => c / n);
})();

/**
 * One ray per cell, straight into the screen. `lum` gets 0 to 1 (how much light the surface the
 * ray met sends back), `kind` gets EMPTY, FACE or SIDE.
 */
export function cast(
  F: Field,
  depth: number,
  pose: Pose,
  g: Grid,
  lum: Float32Array,
  kind: Uint8Array,
) {
  const R = rotation(pose);
  const hw = F.w / 2;
  const hh = F.h / 2;
  // Pixel i's center is field coordinate i, so the field's center is half a pixel in.
  const cu = (F.w - 1) / 2;
  const cv = (F.h - 1) / 2;
  const hd = depth / 2;
  // The ray's direction in the solid's axes: the screen's -z, carried back by the transpose.
  const d0 = -R[6];
  const d1 = -R[7];
  const d2 = -R[8];
  const uvSpeed = Math.hypot(d0, d1);
  // The face's normal faces you; on the screen it is the solid's z axis, signed against the ray.
  const nf = d2 > 0 ? -1 : 1;
  const faceLight = nf * (R[2] * LIGHT[0] + R[5] * LIGHT[1] + R[8] * LIGHT[2]);
  const faceView = nf * R[8];
  const faceLum = Math.min(1, 0.16 + 0.46 * Math.max(0, faceLight) + 0.46 * Math.max(0, faceView));

  for (let j = 0; j < g.rows; j++) {
    const y = ((j + 0.5) * g.cellH - g.oy) / g.scale;
    for (let i = 0; i < g.cols; i++) {
      const k = j * g.cols + i;
      const x = ((i + 0.5) * g.cellW - g.ox) / g.scale;
      // The ray's foot in the solid's axes (the transpose of R applied to (x, y, 0)).
      const o0 = R[0] * x + R[3] * y;
      const o1 = R[1] * x + R[4] * y;
      const o2 = R[2] * x + R[5] * y;
      // Where the ray is inside the slab and inside the field's box.
      let lo = -INF;
      let hi = INF;
      let face = false;
      if (Math.abs(d2) > 1e-9) {
        const a = (-hd - o2) / d2;
        const b = (hd - o2) / d2;
        lo = Math.min(a, b);
        hi = Math.max(a, b);
        face = true;
      } else if (Math.abs(o2) > hd) {
        kind[k] = EMPTY;
        continue;
      }
      if (Math.abs(d0) > 1e-9) {
        const a = (-hw - o0) / d0;
        const b = (hw - o0) / d0;
        const l = Math.min(a, b);
        if (l > lo) {
          lo = l;
          face = false;
        }
        hi = Math.min(hi, Math.max(a, b));
      } else if (Math.abs(o0) > hw) {
        kind[k] = EMPTY;
        continue;
      }
      if (Math.abs(d1) > 1e-9) {
        const a = (-hh - o1) / d1;
        const b = (hh - o1) / d1;
        const l = Math.min(a, b);
        if (l > lo) {
          lo = l;
          face = false;
        }
        hi = Math.min(hi, Math.max(a, b));
      } else if (Math.abs(o1) > hh) {
        kind[k] = EMPTY;
        continue;
      }
      if (!(lo < hi)) {
        kind[k] = EMPTY;
        continue;
      }
      let t = lo;
      let u = o0 + t * d0 + cu;
      let v = o1 + t * d1 + cv;
      let s = sample(F, u, v);
      if (face && s < 0) {
        // The surface has a grain that turns with it, and its outline is a touch darker, so
        // the face reads as a material and its edge holds, as the wings do in a specimen.
        kind[k] = FACE;
        lum[k] = faceLum * grain(u, v) * (0.82 + 0.18 * Math.min(1, -s / 5));
        continue;
      }
      // Through the slab to the first wall, in steps no longer than the way to the outline.
      kind[k] = EMPTY;
      if (uvSpeed < 1e-6) continue;
      for (let step = 0; step < 160; step++) {
        t += Math.max(s, 0.35) / uvSpeed;
        if (t > hi) break;
        u = o0 + t * d0 + cu;
        v = o1 + t * d1 + cv;
        s = sample(F, u, v);
        if (s < 0) {
          // The wall's normal is the field's gradient, turned onto the screen.
          let gx = sample(F, u + 1, v) - sample(F, u - 1, v);
          let gy = sample(F, u, v + 1) - sample(F, u, v - 1);
          const gl = Math.hypot(gx, gy) || 1;
          gx /= gl;
          gy /= gl;
          const nx = gx * R[0] + gy * R[1];
          const ny = gx * R[3] + gy * R[4];
          const nz = gx * R[6] + gy * R[7];
          const lit = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
          kind[k] = SIDE;
          lum[k] = Math.min(1, 0.08 + 0.44 * Math.max(0, lit) + 0.16 * Math.abs(nz)) * grain(u, v);
          break;
        }
      }
    }
  }
}

/** The mark's tight box in its 1000-unit artwork (lib/brand.ts MARK.tight). */
export const MARK_BOX = { x: 140, y: 228, w: 720, h: 544 } as const;

/** Where in a cycle the spin starts (the last 22%, five seconds of 24); the rest is a sway this
 *  far either side of the front (radians, 18°). */
export const SPIN_AT = 0.78;
const SWAY = 0.32;

/**
 * Where a cycle (u from 0 to 1, then the next) turns the mark: most of it a slow sway that keeps
 * the face toward you and shows its depth, then one full spin, eased at both ends. So nearly
 * every frame reads as the mark, and edge on (a thin slab) and the mirrored back only fly by.
 * The yaw is a whole turn at every u = k and k + 0.5.
 */
export function turn(u: number) {
  const k = Math.floor(u);
  const p = u - k;
  const s = Math.min(1, Math.max(0, (p - SPIN_AT) / (1 - SPIN_AT)));
  const spin = s * s * s * (s * (s * 6 - 15) + 10);
  return 2 * Math.PI * (k + spin) + SWAY * Math.sin(2 * Math.PI * p);
}

/** The u where the mark next faces you square on, the least turn away: where a valid address
 *  pulls it. */
export function frontOf(u: number) {
  const a = Math.floor(u * 2) / 2;
  const b = a + 0.5;
  const ya = turn(a);
  const yb = turn(b);
  // The same front either way (both in the sway): the nearer in time.
  if (Math.abs(ya - yb) < 1e-6) return u - a <= b - u ? a : b;
  const y = turn(u);
  return Math.abs(ya - y) <= Math.abs(yb - y) ? a : b;
}

/** Smooth value noise on the integer lattice, 0 to 1. */
function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** The solid's grain at a point of its surface (field px), 0.7 to 1: two octaves of noise. */
export function grain(u: number, v: number) {
  return 0.7 + 0.3 * (0.65 * vnoise(u / 16, v / 16) + 0.35 * vnoise(u / 6 + 31, v / 6 + 17));
}

/** A small stable hash of two integers, 0 to 1. */
export function hash(a: number, b = 0) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The footage's clock: frames per second, seconds per cycle (sway and spin), frames per cycle. */
export const FPS = 30;
export const TURN_S = 24;
export const FRAMES = FPS * TURN_S;
/** Frames a cell keeps its glyph before it may draw a new one. */
export const HOLD = 12;
/** Light above which a cell is a lit box with a letter cut out of it; below, a small mark. */
export const THR = 0.57;

export type Readout = {
  /** What the mark is doing. */
  phase: "sway" | "spin" | "drag" | "locked";
  /** Where the cycles are: the whole part counts them, the fraction is the frame of this one. */
  at: number;
  thr: number;
  /** Share of drawn cells that changed this frame, 0 to 1. */
  move: number;
  cols: number;
  rows: number;
  yaw: number;
  pitch: number;
};

const pad = (n: number, w: number) => String(Math.max(0, Math.round(n))).padStart(w, "0");
// Whole degrees first, so a turn a hair short of 360 reads 000, not 360.
const deg = (r: number) => ((Math.round((r * 180) / Math.PI) % 360) + 360) % 360;

/** The instrument's lines, the same on the server's first paint and every frame after. */
export function readout(r: Readout) {
  const at = ((r.at % 1) + 1) % 1;
  const pitch = (r.pitch * 180) / Math.PI;
  return {
    cycle: `CYCLE ${pad(Math.floor(r.at) + 1, 3)}`,
    what: r.phase.toUpperCase(),
    frame: `F ${pad(Math.floor(at * FRAMES), 4)}/${pad(FRAMES, 4)}  ${(at * TURN_S).toFixed(2).padStart(5, "0")}S`,
    thr: `THR ${r.thr.toFixed(2)}  MOVE ${pad(r.move * 100, 2)}%  HOLD ${HOLD}`,
    grid: `GRID ${r.cols}×${r.rows}`,
    pose: `YAW ${pad(deg(r.yaw), 3)}°  PITCH ${pad(Math.abs(pitch), 2)}°`,
  };
}

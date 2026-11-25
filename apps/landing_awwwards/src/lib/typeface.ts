// Oudom outlines, read from the two masters (src/data/typeface/*.json, written by
// scripts/typeface-data.mjs). Every weight between Light and Bold is a straight mix of the two, so a
// glyph at any weight is one lerp away: t = 0 is Light 300, t = 1 is Bold 700. Used at build time
// for the type page's drawings and in the browser by its inspector and its 3D hero.

export type Glyph = {
  /** Unicode code points. */
  u: number[];
  /** Advance width, [Light, Bold]. */
  w: [number, number];
  /** Contours: per point, type (0 off-curve, 1 line, 2 curve, +4 smooth), xL, yL, xB, yB. */
  c: number[][];
  /** Components: base glyph, offset in Light, offset in Bold. */
  k?: [string, number, number, number, number][];
};

export type Metrics = {
  upm: number;
  asc: number;
  desc: number;
  xh: number;
  cap: number;
  lineAsc: number;
  lineDesc: number;
};

export type FontData = {
  family: string;
  version: string;
  weights: [number, number];
  metrics: Metrics;
  glyphs: Record<string, Glyph>;
  groups?: Record<string, string[]>;
  kern?: Record<string, Record<string, [number, number]>>;
};

export type Pt = { x: number; y: number; on: boolean; smooth: boolean; line: boolean };
/** A contour at one weight, and which glyph it came from (the base of a component, or the glyph). */
export type Contour = { pts: Pt[]; from: string };

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** The mix for a CSS weight (300 to 700). */
export const mixOf = (weight: number, [lo, hi]: [number, number] = [300, 700]) =>
  clamp((weight - lo) / (hi - lo));

export const advance = (g: Glyph, t: number) => lerp(g.w[0], g.w[1], t);

function contourAt(flat: number[], t: number, dx: number, dy: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < flat.length; i += 5) {
    const type = flat[i] & 3;
    pts.push({
      x: lerp(flat[i + 1], flat[i + 3], t) + dx,
      y: lerp(flat[i + 2], flat[i + 4], t) + dy,
      on: type !== 0,
      smooth: (flat[i] & 4) !== 0,
      line: type === 1,
    });
  }
  return pts;
}

/** A glyph's contours at mix t, components resolved in place (each keeps the name it came from). */
export function outlines(font: FontData, name: string, t: number, dx = 0, dy = 0): Contour[] {
  const g = font.glyphs[name];
  if (!g) return [];
  const own = g.c.map((flat) => ({ pts: contourAt(flat, t, dx, dy), from: name }));
  const parts = (g.k ?? []).flatMap(([base, xL, yL, xB, yB]) =>
    outlines(font, base, t, dx + lerp(xL, xB, t), dy + lerp(yL, yB, t)),
  );
  return [...own, ...parts];
}

/** Walk a contour's segments: each is a line or a cubic, from the previous on-curve point. */
export function segments(
  pts: Pt[],
): ({ kind: "L"; to: Pt } | { kind: "C"; c1: Pt; c2: Pt; to: Pt })[] {
  const out: ({ kind: "L"; to: Pt } | { kind: "C"; c1: Pt; c2: Pt; to: Pt })[] = [];
  const n = pts.length;
  let i = 1;
  // The extractor starts every contour on an on-curve point.
  while (i <= n) {
    const p = pts[i % n];
    if (p.on) {
      out.push({ kind: "L", to: p });
      i += 1;
    } else {
      const c1 = p;
      const c2 = pts[(i + 1) % n];
      const to = pts[(i + 2) % n];
      out.push({ kind: "C", c1, c2, to });
      i += 3;
    }
  }
  return out;
}

const f = (v: number) => Math.round(v * 100) / 100;

/** SVG path data. Font units are y-up; the path is y-down, scaled, with the baseline origin at (ox, oy). */
export function pathD(contours: Contour[] | Pt[][], scale = 1, ox = 0, oy = 0): string {
  const X = (p: Pt) => f(ox + p.x * scale);
  const Y = (p: Pt) => f(oy - p.y * scale);
  let d = "";
  for (const c of contours) {
    const pts = Array.isArray(c) ? c : c.pts;
    if (!pts.length) continue;
    d += `M${X(pts[0])} ${Y(pts[0])}`;
    for (const s of segments(pts)) {
      d +=
        s.kind === "L"
          ? `L${X(s.to)} ${Y(s.to)}`
          : `C${X(s.c1)} ${Y(s.c1)} ${X(s.c2)} ${Y(s.c2)} ${X(s.to)} ${Y(s.to)}`;
    }
    d += "Z";
  }
  return d;
}

/** A contour as a polyline: every cubic in `steps` straight pieces, lines kept whole. */
export function flatten(pts: Pt[], steps = 8): [number, number][] {
  const out: [number, number][] = [[pts[0].x, pts[0].y]];
  let prev = pts[0];
  for (const s of segments(pts)) {
    if (s.kind === "L") out.push([s.to.x, s.to.y]);
    else {
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u * u;
        const d = u ** 3;
        out.push([
          a * prev.x + b * s.c1.x + c * s.c2.x + d * s.to.x,
          a * prev.y + b * s.c1.y + c * s.c2.y + d * s.to.y,
        ]);
      }
    }
    prev = s.to;
  }
  out.pop(); // the last point closes onto the first
  return out;
}

/** Signed area of a polyline (positive is counter-clockwise, y-up). */
export function area(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  return a / 2;
}

export function inside([x, y]: [number, number], poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Contours grouped into strokes: an outer contour with the counters inside it. Oudom never unions
 * its parts, so each outer contour is one stroke of the drawing (a stem, an arch, a bowl...).
 * Returns indices into `contours`.
 */
export function strokes(contours: Contour[]): { outer: number; holes: number[] }[] {
  const polys = contours.map((c) => flatten(c.pts, 6));
  const areas = polys.map(area);
  const groups: { outer: number; holes: number[] }[] = [];
  const holeOf = new Map<number, number>();
  polys.forEach((poly, i) => {
    if (areas[i] >= 0) return;
    // A clockwise contour inside a counter-clockwise one is its counter.
    const host = polys.findIndex(
      (p, j) =>
        j !== i &&
        areas[j] > 0 &&
        Math.abs(areas[j]) > Math.abs(areas[i]) &&
        inside(poly[0], p) &&
        contours[j].from === contours[i].from,
    );
    if (host >= 0) holeOf.set(i, host);
  });
  polys.forEach((_, i) => {
    if (holeOf.has(i)) return;
    groups.push({
      outer: i,
      holes: [...holeOf.entries()].filter(([, h]) => h === i).map(([k]) => k),
    });
  });
  return groups;
}

// ── Characters and kerning ───────────────────────────────────────────────────

const cmaps = new WeakMap<FontData, Map<number, string>>();
export function glyphName(font: FontData, ch: string): string | undefined {
  let map = cmaps.get(font);
  if (!map) {
    map = new Map();
    for (const [name, g] of Object.entries(font.glyphs))
      for (const u of g.u) if (!map.has(u)) map.set(u, name);
    cmaps.set(font, map);
  }
  return map.get(ch.codePointAt(0) ?? 0);
}

const groupMaps = new WeakMap<FontData, { k1: Map<string, string>; k2: Map<string, string> }>();
/** Kerning between two glyphs at mix t, with the UFO's precedence: pair, then groups. */
export function kerning(font: FontData, left: string, right: string, t: number): number {
  if (!font.kern || !font.groups) return 0;
  let gm = groupMaps.get(font);
  if (!gm) {
    gm = { k1: new Map(), k2: new Map() };
    for (const [g, names] of Object.entries(font.groups)) {
      const side = g.startsWith("public.kern1.")
        ? gm.k1
        : g.startsWith("public.kern2.")
          ? gm.k2
          : null;
      if (side) for (const n of names) side.set(n, g);
    }
    groupMaps.set(font, gm);
  }
  const g1 = gm.k1.get(left);
  const g2 = gm.k2.get(right);
  const v =
    font.kern[left]?.[right] ??
    (g2 && font.kern[left]?.[g2]) ??
    (g1 && font.kern[g1]?.[right]) ??
    (g1 && g2 && font.kern[g1]?.[g2]);
  return v ? lerp(v[0], v[1], t) : 0;
}

export type Placed = { name: string; char: string; x: number; w: number };

/** Sets a line: glyph names with their x (font units) at mix t, kerned. `alt` picks alternates, e.g. "ss01". */
export function layout(
  font: FontData,
  text: string,
  t: number,
  alt: string[] = [],
): { glyphs: Placed[]; width: number } {
  const glyphs: Placed[] = [];
  let x = 0;
  let prev: string | undefined;
  for (const ch of text) {
    let name = glyphName(font, ch) ?? glyphName(font, "?")!;
    for (const a of alt) if (font.glyphs[`${name}.${a}`]) name = `${name}.${a}`;
    if (prev) x += kerning(font, prev, name, t);
    const w = advance(font.glyphs[name], t);
    glyphs.push({ name, char: ch, x, w });
    x += w;
    prev = name;
  }
  return { glyphs, width: x };
}

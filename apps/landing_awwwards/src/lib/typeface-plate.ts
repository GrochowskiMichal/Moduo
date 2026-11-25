// Build time only: the footer's wordmark plate, "moduo" set in Oudom Bold and drawn the way a
// type designer proofs it: metric lines, the outline of each letter, and, when a letter is
// pointed at, how it was built: each of its strokes on its own (they overlap; nothing is unioned
// in Oudom), the two edges each stroke was cut from (build.json, written by the generator's
// construct.py: the edges run on a little past the cuts), the cuts, a round's boxes, and every
// point with its handles. The coordinates live in the plate's own box (the footer's viewBox),
// with the baseline where the drawn wordmark had it.
import build from "../data/typeface/build.json";
import {
  type Contour,
  type FontData,
  layout,
  outlines,
  type Pt,
  segments,
  strokes,
} from "./typeface";

export const PLATE = { x: 1020, y: 214, w: 1880, h: 562, base: 661.1, xh: 243.82 };

const f = (v: number) => Math.round(v * 100) / 100;

/** One contour's construction, as construct.py writes it (one master). */
type Seg = [string, ...number[]];
type Build = {
  /** The contour's bounds, to pair it with the font's contour. */
  b: [number, number, number, number];
  /** The part it is: stem, hook, bowl, ring, counter, cshape, bar, diag... */
  k?: string;
  /** A band's two edges, a little past the cuts, and its cuts as the corners of each cap. */
  o?: Seg[];
  i?: Seg[];
  s?: [number, number][] | null;
  e?: [number, number][] | null;
  /** A round's box, its counter's box, and the counter's extremes (R T L B) as they lean. */
  box?: [number, number][];
  ibox?: [number, number][];
  ext?: [number, number][];
};
const BUILD = build as unknown as { glyphs: Record<string, { L: Build[]; B: Build[] }> };

export type PlatePart = {
  kind: string;
  /** The stroke's own outline (with its counter, for a round). */
  d: string;
  /** The edges it was cut from, running on past the cuts. */
  edges: string;
  /** The cuts, drawn through the stroke and a little beyond. */
  cuts: string;
  /** A round's boxes, centre and the lean of its counter. */
  box: string;
};

export type PlateLetter = {
  ch: string;
  group: "mod" | "duo" | "both";
  hit: { x: number; w: number };
  /** All the letter's strokes in one path, filled solid (same-way contours union). */
  glyph: string;
  parts: PlatePart[];
  handles: string;
  corners: string;
  smooth: { x: number; y: number }[];
  offs: { x: number; y: number }[];
};

export function wordPlate(font: FontData, word = "moduo", t = 1, track = -15) {
  const S = PLATE.xh / font.metrics.xh;
  const line = layout(font, word, t);
  const width = (line.width + track * (line.glyphs.length - 1)) * S;
  const x0 = PLATE.x + PLATE.w / 2 - width / 2;
  const X = (x: number) => f(x0 + x * S);
  const Y = (y: number) => f(PLATE.base - y * S);
  const groups: PlateLetter["group"][] = ["mod", "mod", "both", "duo", "duo"];
  // The plate is set at one master or the other: a cut is exact on a master, not between them.
  const master = t < 0.5 ? "L" : "B";

  const contourD = (pts: Pt[]) => {
    let d = `M${X(pts[0].x)} ${Y(pts[0].y)}`;
    for (const s of segments(pts))
      d +=
        s.kind === "L"
          ? `L${X(s.to.x)} ${Y(s.to.y)}`
          : `C${X(s.c1.x)} ${Y(s.c1.y)} ${X(s.c2.x)} ${Y(s.c2.y)} ${X(s.to.x)} ${Y(s.to.y)}`;
    return `${d}Z`;
  };
  // A chain of the generator's segments (glyph units, the pen at dx) as a path.
  const chainD = (ch: Seg[], dx: number) => {
    let d = "";
    ch.forEach((s, i) => {
      const n = s.slice(1) as number[];
      if (i === 0) d += `M${X(n[0] + dx)} ${Y(n[1])}`;
      d +=
        s[0] === "L"
          ? `L${X(n[2] + dx)} ${Y(n[3])}`
          : `C${X(n[2] + dx)} ${Y(n[3])} ${X(n[4] + dx)} ${Y(n[5])} ${X(n[6] + dx)} ${Y(n[7])}`;
    });
    return d;
  };
  // A cut: the line through its cap's two corners, half the cap again past each.
  const cutD = ([a, b]: [number, number][], dx: number) => {
    const ax = a[0] + (a[0] - b[0]) * 0.5;
    const ay = a[1] + (a[1] - b[1]) * 0.5;
    const bx = b[0] + (b[0] - a[0]) * 0.5;
    const by = b[1] + (b[1] - a[1]) * 0.5;
    return `M${X(ax + dx)} ${Y(ay)}L${X(bx + dx)} ${Y(by)}`;
  };
  const rectD = ([a, b]: [number, number][], dx: number) =>
    `M${X(a[0] + dx)} ${Y(a[1])}H${X(b[0] + dx)}V${Y(b[1])}H${X(a[0] + dx)}Z`;

  const letters: PlateLetter[] = line.glyphs.map((g, i) => {
    const pen = g.x + track * i;
    const cs = outlines(font, g.name, t, pen, 0);
    const built = BUILD.glyphs[g.name]?.[master] ?? [];
    // The font's contours and the generator's come in the same order; the bounds say so.
    const buildOf = (c: Contour, k: number): Build | undefined => {
      const xs = c.pts.filter((p) => p.on).map((p) => p.x - pen);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const near = (b: Build) => Math.abs(b.b[0] - lo) < 2 && Math.abs(b.b[2] - hi) < 2;
      const at = built[k];
      if (at && near(at)) return at;
      const found = built.find(near);
      if (!found) console.warn(`typeface-plate: no construction for ${g.name} contour ${k}`);
      return found;
    };

    let glyph = "";
    let handles = "";
    let corners = "";
    const smooth: { x: number; y: number }[] = [];
    const offs: { x: number; y: number }[] = [];
    for (const c of cs) {
      const pts = c.pts;
      glyph += contourD(pts);
      let prev: Pt = pts[0];
      for (const s of segments(pts)) {
        if (s.kind === "C") {
          handles += `M${X(prev.x)} ${Y(prev.y)}L${X(s.c1.x)} ${Y(s.c1.y)}M${X(s.to.x)} ${Y(s.to.y)}L${X(s.c2.x)} ${Y(s.c2.y)}`;
          offs.push({ x: X(s.c1.x), y: Y(s.c1.y) }, { x: X(s.c2.x), y: Y(s.c2.y) });
        }
        prev = s.to;
      }
      for (const p of pts) {
        if (!p.on) continue;
        if (p.smooth) smooth.push({ x: X(p.x), y: Y(p.y) });
        else corners += `M${f(X(p.x) - 4.5)} ${f(Y(p.y) - 4.5)}h9v9h-9z`;
      }
    }

    // Each stroke on its own: an outer contour with its counters, and how it was cut.
    const parts: PlatePart[] = strokes(cs).map((s) => {
      const b = buildOf(cs[s.outer], s.outer);
      const d = [cs[s.outer], ...s.holes.map((h) => cs[h])].map((c) => contourD(c.pts)).join("");
      let edges = "";
      let cuts = "";
      let box = "";
      if (b?.o && b.i) {
        edges = chainD(b.o, pen) + chainD(b.i, pen);
        if (b.s) cuts += cutD(b.s, pen);
        if (b.e) cuts += cutD(b.e, pen);
      }
      if (b?.box && b.ibox && b.ext) {
        const [R, T, L, B] = b.ext;
        const cx = (b.box[0][0] + b.box[1][0]) / 2 + pen;
        const cy = (b.box[0][1] + b.box[1][1]) / 2;
        box =
          rectD(b.box, pen) +
          rectD(b.ibox, pen) +
          `M${X(T[0] + pen)} ${Y(T[1])}L${X(B[0] + pen)} ${Y(B[1])}` +
          `M${X(L[0] + pen)} ${Y(L[1])}L${X(R[0] + pen)} ${Y(R[1])}` +
          `M${f(X(cx) - 8)} ${Y(cy)}h16M${X(cx)} ${f(Y(cy) - 8)}v16`;
      }
      return { kind: b?.k ?? "part", d, edges, cuts, box };
    });

    const next = i < line.glyphs.length - 1 ? line.glyphs[i + 1].x + track * (i + 1) : pen + g.w;
    return {
      ch: g.char,
      group: groups[i] ?? "duo",
      hit: { x: X(pen) - 4, w: f((next - pen) * S + 8) },
      glyph,
      parts,
      handles,
      corners,
      smooth,
      offs,
    };
  });

  const m = font.metrics;
  // The first stem's width, measured at the m's left stem.
  const m0 = outlines(font, line.glyphs[0].name, t, 0, 0)[0].pts;
  const stemL = Math.min(...m0.map((p) => p.x));
  const stemR = Math.max(...m0.filter((p) => p.y < 300).map((p) => p.x));
  const end = (i: number) => line.glyphs[i].x + track * i + line.glyphs[i].w;
  const start = (i: number) => line.glyphs[i].x + track * i;
  return {
    S,
    x0: f(x0),
    // The rounds reach past the x-height and the baseline by the overshoot (12 units in Bold).
    lines: { asc: Y(m.asc), xh: Y(m.xh), base: f(PLATE.base), osTop: Y(m.xh + 12), osBot: Y(-12) },
    asc: m.asc,
    xh: m.xh,
    stem: { x0: X(stemL), x1: X(stemR), units: Math.round(stemR - stemL) },
    brackets: { mod: [X(start(0) + 30), X(end(2) - 30)], duo: [X(start(2) + 30), X(end(4) - 30)] },
    // The drawing's box: the word, with room above and below for its brackets.
    view: {
      x: f(x0 - 12),
      y: f(Y(m.asc) - 96),
      w: f(width + 24),
      h: f(PLATE.base + 104 - (Y(m.asc) - 96)),
    },
    letters,
  };
}

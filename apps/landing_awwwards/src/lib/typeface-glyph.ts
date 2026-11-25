// One glyph as a type designer proofs it, for the type page's last beat: its strokes filled,
// their outlines over them (nothing in Oudom is unioned, so the joins show), the handles that
// bend each curve, and every point (square at a corner, round where the curve runs smooth). In
// the plate's own units: the glyph's advance centred on x = 0, the baseline at y = 0, y down.
// Built at build time for the still plate and in the browser for every glyph after it, so both
// look the same.
import { advance, type FontData, outlines, pathD, segments, strokes } from "./typeface";

/** The plate's box: as wide as the widest glyph wants, from over the ascender to under the descender. */
export const PLATE = { w: 1400, top: 900, bot: 330 };

const f = (v: number) => Math.round(v * 10) / 10;

export function glyphParts(font: FontData, name: string, t: number) {
  const g = font.glyphs[name];
  const adv = advance(g, t);
  const ox = -adv / 2;
  const cs = outlines(font, name, t, ox, 0);
  const groups = strokes(cs);
  const fill = groups.map((s) => pathD([cs[s.outer], ...s.holes.map((h) => cs[h])])).join("");
  const edge = pathD(cs);
  let handles = "";
  let offs = "";
  let corners = "";
  let smooths = "";
  for (const c of cs) {
    let prev = c.pts[0];
    for (const s of segments(c.pts)) {
      if (s.kind === "C") {
        handles += `M${f(prev.x)} ${f(-prev.y)}L${f(s.c1.x)} ${f(-s.c1.y)}M${f(s.to.x)} ${f(-s.to.y)}L${f(s.c2.x)} ${f(-s.c2.y)}`;
        offs += dot(s.c1.x, -s.c1.y, 6) + dot(s.c2.x, -s.c2.y, 6);
      }
      prev = s.to;
    }
    for (const p of c.pts) {
      if (!p.on) continue;
      if (p.smooth) smooths += dot(p.x, -p.y, 8);
      else corners += `M${f(p.x - 7)} ${f(-p.y - 7)}h14v14h-14Z`;
    }
  }
  return { fill, edge, handles, offs, ons: corners + smooths, adv, ox, strokes: groups.length };
}

/** A circle as path data, so a glyph's every point is one path. */
const dot = (x: number, y: number, r: number) =>
  `M${f(x - r)} ${f(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** Every character the set shows, in order of code point: signs, figures, letters, accents,
 *  arrows. Spaces, the soft hyphen and the combining marks have nothing to show on their own. */
export function setChars(font: FontData) {
  const name = new Map<number, string>();
  for (const [n, g] of Object.entries(font.glyphs))
    for (const u of g.u) if (!name.has(u)) name.set(u, n);
  return [...name.keys()]
    .filter((u) => u > 0x20 && u !== 0xa0 && u !== 0xad && !(u >= 0x300 && u < 0x370))
    .sort((a, b) => a - b)
    .map((u) => ({ ch: String.fromCodePoint(u), u, name: name.get(u)! }));
}

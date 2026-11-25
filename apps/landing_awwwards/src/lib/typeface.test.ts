// The type page draws Oudom from its own outlines. The two masters must stay point-compatible
// (every weight is a mix of them), the mix must land on the masters at its ends, kerning must
// follow the UFO's precedence, and the strokes of a letter must group as the page assumes.
import { describe, expect, it } from "@rstest/core";

import font from "../data/typeface/font.json";
import {
  advance,
  area,
  flatten,
  type FontData,
  glyphName,
  kerning,
  layout,
  mixOf,
  outlines,
  strokes,
} from "./typeface";

const F = font as unknown as FontData;

describe("the data", () => {
  it("keeps both masters point for point", () => {
    for (const g of Object.values(F.glyphs)) {
      for (const c of g.c) expect(c.length % 5).toBe(0);
    }
    expect(Object.keys(F.glyphs).length).toBe(466);
  });
  it("maps every letter of the site's Polish to a glyph", () => {
    for (const ch of "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ") expect(glyphName(F, ch)).toBeDefined();
  });
});

describe("mixing", () => {
  it("lands on the masters at Light and Bold", () => {
    expect(mixOf(300)).toBe(0);
    expect(mixOf(700)).toBe(1);
    expect(mixOf(500)).toBe(0.5);
    const d = F.glyphs.d;
    expect(advance(d, 0)).toBe(d.w[0]);
    expect(advance(d, 1)).toBe(d.w[1]);
  });
  it("puts components where their offsets say", () => {
    const [, acute] = outlines(F, "sacute", 0);
    const plain = outlines(F, "acutecomb", 0)[0];
    const [, xL, yL] = F.glyphs.sacute.k![1];
    expect(acute.pts[0].x - plain.pts[0].x).toBeCloseTo(xL);
    expect(acute.pts[0].y - plain.pts[0].y).toBeCloseTo(yL);
    expect(acute.from).toBe("acutecomb");
  });
});

describe("strokes", () => {
  it("keeps the o's counter inside its ring and every other contour a stroke of its own", () => {
    const o = strokes(outlines(F, "o", 0.5));
    expect(o).toHaveLength(1);
    expect(o[0].holes).toHaveLength(1);
    expect(strokes(outlines(F, "M", 0.5))).toHaveLength(4);
    expect(strokes(outlines(F, "n", 0.5))).toHaveLength(2);
  });
  it("draws outer contours counter-clockwise", () => {
    const [ring, counter] = outlines(F, "o", 0.5);
    expect(area(flatten(ring.pts))).toBeGreaterThan(0);
    expect(area(flatten(counter.pts))).toBeLessThan(0);
  });
});

describe("layout", () => {
  it("adds the advances, and kerns a pair the font kerns", () => {
    const plain = layout(F, "MO", 0.5);
    expect(plain.glyphs[1].x).toBeCloseTo(advance(F.glyphs.M, 0.5) + kerning(F, "M", "O", 0.5));
    // A pair with kerning in both masters: AV-like pairs are always kerned.
    const pairs = ["AV", "To", "Ty", "LT", "AT"].map((p) =>
      kerning(F, glyphName(F, p[0])!, glyphName(F, p[1])!, 0.5),
    );
    expect(pairs.some((v) => v < 0)).toBe(true);
  });
  it("picks a stylistic alternate when asked", () => {
    expect(layout(F, "n", 0.5, ["ss01"]).glyphs[0].name).toBe("n.ss01");
    expect(layout(F, "n", 0.5).glyphs[0].name).toBe("n");
  });
});

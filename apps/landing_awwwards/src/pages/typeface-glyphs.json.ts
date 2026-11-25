// The type page's glyphs (motion/typeface.ts fetches it as the camera comes down to the set): every
// glyph's outlines at both masters, and the set's characters in order, so the last beat can draw
// each one with its curves at any weight. The font's kerning stays out: nothing here sets a line.
import type { APIRoute } from "astro";

import font from "../data/typeface/font.json";
import type { FontData } from "../lib/typeface";
import { setChars } from "../lib/typeface-glyph";

export const GET: APIRoute = () => {
  const F = font as unknown as FontData;
  const glyphs = Object.fromEntries(
    Object.entries(F.glyphs).map(([n, g]) => [n, { w: g.w, c: g.c, ...(g.k ? { k: g.k } : {}) }]),
  );
  const chars = setChars(F).map((c) => [c.u, c.name]);
  return new Response(JSON.stringify({ glyphs, chars }), {
    headers: { "Content-Type": "application/json" },
  });
};

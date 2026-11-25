// The hero's lockup, measured from the typeface at build time (components/home/Scene.astro and
// the share card, pages/og/[slug].astro set it from these numbers): two short lines, sized so
// they are the same width, and the one word they share standing beside them at the height of
// both, its baseline on the second line's and its ascenders at the first line's.
import font from "../data/typeface/font.json";
import { type FontData, layout, mixOf } from "./typeface";

const F = font as unknown as FontData;

/** The width of `text` in ems at `weight`, with `track` em of letter-spacing after every
 *  character, as CSS adds it. */
export function emWidth(text: string, weight: number, track: number): number {
  return layout(F, text, mixOf(weight)).width / F.metrics.upm + track * [...text].length;
}

export type Lockup = {
  /** The second line's size over the first's, so both lines are one width. */
  r: number;
  /** The word's size over the first line's. */
  k: number;
  /** The lockup's width in ems of the first line: both lines, the gap, the word. */
  em: number;
};

/**
 * `first` at 1em, `second` at r em and `word` at k em, with `gap` em between the lines and the
 * word. Lines take `weight` and `track`; the word `wordWeight` and `wordTrack`; the lines' boxes
 * are `lineHeight` of their size.
 */
export function lockup(
  first: string,
  second: string,
  word: string,
  o: {
    weight?: number;
    track?: number;
    wordWeight?: number;
    wordTrack?: number;
    lineHeight?: number;
    gap?: number;
  } = {},
): Lockup {
  const {
    weight = 500,
    track = -0.035,
    wordWeight = 300,
    wordTrack = -0.045,
    lineHeight = 0.98,
    gap = 0.3,
  } = o;
  const w1 = emWidth(first, weight, track);
  const w2 = emWidth(second, weight, track);
  const r = w1 / w2;
  const { asc, lineAsc, lineDesc, upm } = F.metrics;
  // A line's baseline from the top of its box, in its own em: the half-leading, then the ascent.
  const base = (lineHeight - (lineAsc - lineDesc) / upm) / 2 + lineAsc / upm;
  // Ink tops level: the first line's ascender (base − asc from the top) and the word's (the second
  // baseline, lineHeight + base·r from the top, less asc·k).
  const k = (lineHeight + base * (r - 1)) / (asc / upm) + 1;
  const em = w1 + gap + k * emWidth(word, wordWeight, wordTrack);
  return { r, k, em };
}

/** The numbers as CSS custom properties for the lockup's element. */
export const lockupVars = ({ r, k, em }: Lockup) =>
  `--r:${r.toFixed(4)};--k:${k.toFixed(4)};--lock-em:${em.toFixed(3)}`;

// Shared label-color palette for workspace tags (cross-module: Tasks now, Mail /
// Notes later). The eight hue names map 1:1 to the [data-label="…"] tokens in
// src/styles/tokens.css (§13b); a tag stores its hue as one of these names (not a
// hex), so color stays token-routed and theme-safe. No React, no IO — testable.

export const LABEL_COLORS = [
  "blue",
  "green",
  "amber",
  "red",
  "violet",
  "teal",
  "pink",
  "gray",
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

/** Used when a tag has no stored color, or an unknown one. */
export const DEFAULT_LABEL_COLOR: LabelColor = "gray";

const LABEL_COLOR_SET = new Set<string>(LABEL_COLORS);

/** Coerce any stored value to a known hue (fallback: {@link DEFAULT_LABEL_COLOR}). */
export function normalizeLabelColor(color: string | null | undefined): LabelColor {
  return color && LABEL_COLOR_SET.has(color) ? (color as LabelColor) : DEFAULT_LABEL_COLOR;
}

/**
 * Auto-assign a hue for a new tag: the least-used color among `existing`, with
 * ties broken by palette order. Deterministic (no randomness) so the same set of
 * tags always colors the same way, and colors spread evenly as tags accumulate.
 * `gray` is reserved as a fallback and only chosen once every hue is in use.
 */
export function pickTagColor(existing: Array<{ color: string | null }>): LabelColor {
  const counts = new Map<LabelColor, number>(LABEL_COLORS.map((c) => [c, 0]));
  for (const tag of existing) {
    const c = normalizeLabelColor(tag.color);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // Prefer the colored hues; only fall back to gray when everything else is used
  // at least as much (it sorts last in LABEL_COLORS, so the tie-break handles it).
  let best: LabelColor = LABEL_COLORS[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of LABEL_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

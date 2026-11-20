// Picker-only typefaces (styles/fonts-picker.css) load on demand: when the
// person's font is one of them, or when the font picker shows its previews.
// Geist and Geist Mono are always in global.css.

import type { Font } from "./appearance";

const PICKER_FONTS: ReadonlySet<Font> = new Set<Font>(["inter", "cal", "fraunces", "serif"]);

let loading: Promise<unknown> | null = null;

/** Fetch the picker faces' CSS once (an async CSS chunk). */
export function loadPickerFonts(): Promise<unknown> {
  loading ??= import("../styles/fonts-picker.css").catch(() => {
    loading = null;
  });
  return loading;
}

/** Load the faces `font` needs, if it is not Geist / Geist Mono / Pilat. */
export function ensureFontLoaded(font: Font): void {
  if (PICKER_FONTS.has(font)) void loadPickerFonts();
}

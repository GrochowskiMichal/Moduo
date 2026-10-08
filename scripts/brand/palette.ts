/**
 * Brand colours as hex, for the files `brand:export` writes (SVG, PNG, ICO).
 * Image formats can't read CSS variables, so this is the one place brand
 * colours exist outside src/styles/tokens.css. Each value names the token or
 * brief entry it mirrors; palette.test.ts fails if a token-backed one drifts.
 * See .design/brand/BRAND_BRIEF.md §7.
 */

/** Canvas black: pure black. Mirrors `--background` (dark). */
export const CANVAS = "#000000";

/** Paper: type and the mark on black. Mirrors `--neutral-50` = oklch(0.985 0 0). */
export const PAPER = "#fafafa";

/** Ink: type and the mark on white. oklch(0.16 0 0), the email/legal light foreground. */
export const INK = "#0d0d0d";

/** Icon black: the app-icon tile only (the OS paints its own gradient on top). */
export const ICON_BLACK = "#0a0a0a";

/** Icon white: the mark on the app icon, as approved in the shipped icon. */
export const ICON_WHITE = "#ffffff";

/**
 * Hex for an achromatic oklch lightness (chroma 0), the only kind the brand
 * palette uses. For C = 0, OKLab lightness L maps to linear sRGB as L³; then
 * the sRGB transfer curve applies.
 */
export function oklchGrayToHex(lightness: number): string {
  const linear = lightness ** 3;
  const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  const byte = Math.round(Math.min(1, Math.max(0, encoded)) * 255);
  const hex = byte.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

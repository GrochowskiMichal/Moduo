/**
 * Images emails point at. The files themselves are exported into `public/email/`
 * by the brand pipeline (BRAND-1, `bun run brand:export`, brand brief §13–§14)
 * and served by the web app at app.moduo.app. This module only names them.
 *
 * "light" means "for a light background" (Ink artwork), "dark" means "for a
 * dark background" (Paper artwork). Every image is @2x, PNG (Gmail drops SVG).
 */

export const DEFAULT_EMAIL_ASSET_BASE = "https://app.moduo.app/email";

export type EmailAssets = {
  lockupLight: string;
  lockupDark: string;
  markLight: string;
  markDark: string;
};

/*
 * The export contract with BRAND-1. Outlook desktop sizes images from their
 * width/height attributes, so the files must have exactly this shape:
 *   lockup-{light,dark}@2x.png  192 × 44 px canvas (2× of 96 × 22), transparent,
 *                               artwork left-aligned and vertically centred.
 *   mark-{light,dark}@2x.png    26 × 26 px canvas (2× of 13), transparent.
 * The 96 × 22 box follows the master lockup's ratio (width ≈ 4.4 × mark height,
 * brand brief §5). If the redrawn master changes the ratio, change these
 * numbers and the export together.
 * No halo (brand decision 74a, `.design/brand/DECISIONS.md` on `t/maciej/brand-1-asset-pipeline` until it merges): the logo follows the reader's light or dark
 * mode instead. render.ts shows the light files in light mode and swaps to the
 * dark ones under `prefers-color-scheme: dark` (Apple Mail, iOS Mail) and
 * Outlook's [data-ogsc] dark mode. Apps that darken an email without saying so
 * (Gmail's app) keep the light-mode logo; that limit is accepted.
 * The 13px footer mark switches to the small-master drawing once it exists,
 * under the same file names.
 */

/** The header lockup is drawn artwork, never retyped (brand decision 18). */
export const LOCKUP_DISPLAY_WIDTH = 96;
export const LOCKUP_DISPLAY_HEIGHT = 22;
/** The mark beside the footer badge. */
export const MARK_DISPLAY_SIZE = 13;

export function emailAssets(base: string = DEFAULT_EMAIL_ASSET_BASE): EmailAssets {
  const root = base.replace(/\/+$/, "");
  return {
    lockupLight: `${root}/lockup-light@2x.png`,
    lockupDark: `${root}/lockup-dark@2x.png`,
    markLight: `${root}/mark-light@2x.png`,
    markDark: `${root}/mark-dark@2x.png`,
  };
}

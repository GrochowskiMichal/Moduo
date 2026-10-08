/**
 * Size and placement rules for the exports, in one place so the exporter and
 * the drift test use the same numbers. Rules: .design/brand/BRAND_BRIEF.md
 * §3, §6 and §13; email sizes: specs/transactional-email.md T6.
 */

import type { Master } from "./masters";

/** Browser tabs display favicons at 16 CSS px (the 32 px file is that at 2×). */
export const FAVICON_TAB_PX = 16;

/** Favicon tile corner, in the 1000-unit box: 22%, the shipped favicon's. */
export const TILE_RADIUS = 220;

/**
 * The small master is only for marks displayed under 24 px (brand decision
 * 13), measured as the mark's own box on screen in CSS pixels, so a 32 px
 * file made for a 16 px browser tab counts as 16. It applies once
 * mark-small.svg exists.
 */
export const SMALL_MARK_BELOW_PX = 24;

export function markForDisplay(displayPx: number, mark: Master, small: Master | null): Master {
  return small && displayPx < SMALL_MARK_BELOW_PX ? small : mark;
}

/** Share of the avatar's width the mark's artwork takes (brief §6). */
export const AVATAR_MARK_SHARE = 0.55;

/**
 * Email logos, @2x. This is the contract with the email kit
 * (supabase/functions/_shared/email/assets.ts, TX-1): Outlook desktop sizes
 * images from their width/height attributes, so the canvases are exact.
 * Header lockup: 96 × 22 displayed, artwork left-aligned, vertically centred.
 * Footer-badge mark: 13 × 13 displayed (the mark's whole 1000-unit box), so it
 * uses the small master once that exists.
 * If a redrawn lockup changes its ratio, change these and assets.ts together.
 */
export const EMAIL_LOCKUP_CANVAS = { width: 192, height: 44 } as const;
export const EMAIL_MARK_SIZE = 26;

/**
 * No halo (brand decision 74a): the email shows the Ink ("light") or Paper
 * ("dark") file to match the reader's light or dark mode instead.
 */

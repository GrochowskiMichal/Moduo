/**
 * Size and placement rules for the exports, in one place so the exporter and
 * the drift test use the same numbers. Rules: .design/brand/BRAND_BRIEF.md
 * §3, §6 and §13; email sizes: specs/transactional-email.md T6.
 */

import type { Master } from "./masters";

/** Favicon tile corner, in the 1000-unit box: 22%, the shipped favicon's. */
export const TILE_RADIUS = 220;

/**
 * Tiles this size or smaller use the small master once it exists. The mark
 * fills ~72% of its box, so a 32 px tile draws it ~23 px wide: the brief's
 * "24 px and below".
 */
export const SMALL_TILE_MAX_PX = 32;

export function markForTile(px: number, mark: Master, small: Master | null): Master {
  return small && px <= SMALL_TILE_MAX_PX ? small : mark;
}

/** Share of the avatar's width the mark's artwork takes (brief §6). */
export const AVATAR_MARK_SHARE = 0.55;

/**
 * Email logos, @2x. This is the contract with the email kit
 * (supabase/functions/_shared/email/assets.ts, TX-1): Outlook desktop sizes
 * images from their width/height attributes, so the canvases are exact.
 * Header lockup: 96 × 22 displayed, artwork left-aligned, vertically centred.
 * Footer-badge mark: 13 × 13 displayed (the mark's whole 1000-unit box).
 * If a redrawn lockup changes its ratio, change these and assets.ts together.
 */
export const EMAIL_LOCKUP_CANVAS = { width: 192, height: 44 } as const;
export const EMAIL_MARK_SIZE = 26;

/**
 * A Paper halo around the Ink ("light") email logos, in @2x pixels, so they
 * survive mail apps that darken emails on their own (Gmail, Outlook on
 * phones). 0 = off: brand decision 25 bans outlines and glows, so this
 * waits for Maciej's call.
 */
export const EMAIL_LIGHT_HALO_PX = 0;

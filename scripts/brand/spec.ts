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

/** Email header logos at 2×: lockup ≈ 96 px displayed, mark 36 px displayed. */
export const EMAIL_LOCKUP_WIDTH = 192;
export const EMAIL_MARK_WIDTH = 72;

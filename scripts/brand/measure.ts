/**
 * Geometry measured from the rendered mark, shared by the exporter and the
 * drift test so both compute the same avatar scale. Bounding boxes come from
 * resvg's geometry pass (no rasterising), so they're stable across platforms.
 */

import { Resvg } from "@resvg/resvg-js";

import { artworkSvg } from "./compose";
import type { Master } from "./masters";

/** Share of its own box width the master's artwork fills (the mark: ~0.72). */
export function artworkShare(m: Master): number {
  const box = new Resvg(artworkSvg(m, "#000000"), { font: { loadSystemFonts: false } }).getBBox();
  if (!box) throw new Error(`brand/masters/${m.name} renders empty.`);
  return box.width / m.viewBox[2];
}

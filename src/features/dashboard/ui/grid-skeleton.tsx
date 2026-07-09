import type { CSSProperties } from "react";

/** The default composition's footprints, reused as loading placeholders. */
const SKELETON_CELLS: CSSProperties[] = [
  { gridColumn: "1 / span 4", gridRow: "1 / span 4" },
  { gridColumn: "5 / span 4", gridRow: "1 / span 2" },
  { gridColumn: "5 / span 2", gridRow: "3 / span 2" },
  { gridColumn: "7 / span 2", gridRow: "3 / span 2" },
];

/**
 * The loading state (spec §States): token-tinted skeleton cells in the 8×4 grid
 * while the layout resolves from cache/cloud, so Home never flashes the default
 * before swapping to the user's real composition. Static (no shimmer) — it shows
 * only for the brief load window.
 */
export function GridSkeleton() {
  return (
    <div className="grid min-h-0 w-full flex-1 grid-cols-8 grid-rows-4 gap-3" aria-hidden>
      {SKELETON_CELLS.map((style, i) => (
        <div key={i} style={style} className="rounded-lg border border-border bg-muted/40" />
      ))}
    </div>
  );
}

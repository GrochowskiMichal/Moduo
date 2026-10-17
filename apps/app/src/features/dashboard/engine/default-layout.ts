// The curated first-run page (spec decision 13, AC6). A brand-new user — no cloud
// row and no local cache — lands on this instead of an empty grid, so Home
// demonstrates the idea immediately: their calendar, their tasks, a place to
// capture a thought, and the time.
//
// Deterministic (fixed ids, no randomness/clock) so the seed is stable and
// round-trips through `sanitizeLayout` unchanged. Widget `config` is left empty
// here; the registry (DB-5) hydrates each type's real default config at render.
// The four tiles perfectly tile the 8×4 — no gaps, no overlaps.

import type { DashboardLayout } from "./types";

/** A fresh default layout: Tasks L · Calendar M · Quick capture S · Clock S. */
export function createDefaultLayout(): DashboardLayout {
  return {
    version: 1,
    pages: [
      {
        id: "home",
        widgets: [
          // Left half, full height — the day's work.
          { id: "w-tasks", type: "tasks", size: "L", x: 0, y: 0, config: {} },
          // Top-right — what's on today.
          { id: "w-calendar", type: "calendar", size: "M", x: 4, y: 0, config: {} },
          // Bottom-right-left — jot something into the spine.
          { id: "w-quick-capture", type: "quick-capture", size: "S", x: 4, y: 2, config: {} },
          // Bottom-right-right — the time.
          { id: "w-clock", type: "clock", size: "S", x: 6, y: 2, config: {} },
        ],
      },
    ],
  };
}

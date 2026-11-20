// The last known shape of the week (CALR-3, AC4): how many all-day rows the
// lane drew and how many rows each Plan group showed. Loading draws its
// skeletons in this shape, so the grid doesn't move when the data lands.
// Device-local per person and workspace, like the view state: a shape is a
// paint hint, not a preference worth syncing.

import { ALL_DAY_MAX_ROWS, layoutAllDayLane } from "./allday-lane";
import type { EventChip } from "./events";

export type LoadShape = {
  /** Rows the collapsed all-day lane drew (0 = no lane). */
  allDayRows: number;
  /** Rows per Plan group, in order. */
  planGroups: number[];
};

/** Before anything is known: one all-day row; Plan groups 2/5/1/3. */
export const DEFAULT_LOAD_SHAPE: LoadShape = { allDayRows: 1, planGroups: [2, 5, 1, 3] };

/** The collapsed lane's most: two bar rows plus "+N more". */
const MAX_LANE_ROWS = ALL_DAY_MAX_ROWS + 1;
/** Plan shows six rows a group before Show more. */
const MAX_GROUP_ROWS = 6;
const MAX_GROUPS = 4;

function clampInt(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(Math.max(Math.round(v), 0), max);
}

export function sanitizeLoadShape(raw: unknown): LoadShape {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_LOAD_SHAPE, planGroups: [...DEFAULT_LOAD_SHAPE.planGroups] };
  }
  const o = raw as { allDayRows?: unknown; planGroups?: unknown };
  const allDayRows = clampInt(o.allDayRows, MAX_LANE_ROWS) ?? DEFAULT_LOAD_SHAPE.allDayRows;
  const planGroups = Array.isArray(o.planGroups)
    ? o.planGroups.slice(0, MAX_GROUPS).map((n) => clampInt(n, MAX_GROUP_ROWS) ?? 0)
    : [...DEFAULT_LOAD_SHAPE.planGroups];
  return { allDayRows, planGroups };
}

function shapeKey(userId: string, workspaceId: string): string {
  return `moduo:calendar:load-shape:${userId}:${workspaceId}`;
}

export function readLoadShape(userId: string | null, workspaceId: string | null): LoadShape {
  if (typeof window === "undefined" || !userId || !workspaceId) return sanitizeLoadShape(null);
  try {
    const raw = window.localStorage.getItem(shapeKey(userId, workspaceId));
    return sanitizeLoadShape(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeLoadShape(null);
  }
}

/** Merge part of a shape into what's remembered (the lane and Plan write separately). */
export function writeLoadShape(
  userId: string | null,
  workspaceId: string | null,
  part: Partial<LoadShape>,
): void {
  if (typeof window === "undefined" || !userId || !workspaceId) return;
  const next = sanitizeLoadShape({ ...readLoadShape(userId, workspaceId), ...part });
  try {
    window.localStorage.setItem(shapeKey(userId, workspaceId), JSON.stringify(next));
  } catch {
    /* quota or storage disabled — a paint hint, non-fatal */
  }
}

/** Rows the collapsed all-day lane draws for this data (what the skeleton must match). */
export function allDayRowsOf(
  dayKeys: readonly string[],
  allDayByDay: ReadonlyMap<string, readonly EventChip[]>,
): number {
  return layoutAllDayLane(dayKeys, allDayByDay, { expanded: false }).rows;
}

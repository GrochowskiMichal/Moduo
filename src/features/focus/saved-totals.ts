// The total each task's focus time was last saved with, shared by every tab on
// this device (TV-F1). The Tasks sink still writes an absolute total built from
// its own bundle, so a tab whose bundle is older than another tab's last save
// would overwrite that save with a smaller number. The sink builds on whichever
// is fresher: its bundle row, or the last save recorded here.
// TV-D3's time entries (`tasks_op_track_time`) remove the need for this.

/** One map per person (erased with their focus record on account deletion). */
export const FOCUS_SAVED_TOTALS_PREFIX = "moduo:tasks:focus:saved:";

const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SavedFocusTotal {
  total: number;
  /** The saved row's `updatedAt`, as ms. */
  at: number;
}

type SavedTotals = Record<string, SavedFocusTotal>;

function isSavedTotal(value: unknown): value is SavedFocusTotal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Number.isFinite(v.total) && Number.isFinite(v.at);
}

function readAll(userId: string): SavedTotals {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`${FOCUS_SAVED_TOTALS_PREFIX}${userId}`) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isSavedTotal(v)));
  } catch {
    return {};
  }
}

export function readSavedFocusTotal(userId: string, taskId: string): SavedFocusTotal | null {
  return readAll(userId)[taskId] ?? null;
}

/** Record a confirmed save (a later one wins); keeps the newest 200 for 30 days. */
export function writeSavedFocusTotal(
  userId: string,
  taskId: string,
  total: number,
  at: number,
): void {
  if (!Number.isFinite(total) || !Number.isFinite(at)) return;
  const all = readAll(userId);
  const prev = all[taskId];
  if (prev && prev.at > at) return;
  all[taskId] = { total, at };
  const cutoff = Date.now() - MAX_AGE_MS;
  const kept = Object.entries(all)
    .filter(([, v]) => v.at >= cutoff)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(
      `${FOCUS_SAVED_TOTALS_PREFIX}${userId}`,
      JSON.stringify(Object.fromEntries(kept)),
    );
  } catch {
    /* quota exceeded or storage disabled — the next save just rebuilds from the bundle */
  }
}

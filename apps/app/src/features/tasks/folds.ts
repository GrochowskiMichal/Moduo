// What a person folded in a List or a Board (TV-U8): each group's or
// column's fold choice per workspace, place and grouping, following the
// person to every device through their synced preferences
// (`preferences.tasksFolds`; TV-U10 and TV-U11 kept them per device).
//
// A fold shows at once (the List and the Board hold their own state); the
// preferences are written a moment later, all the folds changed meanwhile in
// one write, so folding several groups costs one sync, not one each.

import {
  currentPreferences,
  TASKS_FOLDS_KEEP,
  type TasksFoldEntry,
  updatePreferences,
} from "../../lib/preferences";

/** Where a List's folds live: `<workspace>:<place>:<group by>`. */
export function listFoldKey(workspaceId: string, place: string, groupBy: string): string {
  return `${workspaceId}:${place}:${groupBy}`;
}

/** Where a Board's folds live: `<workspace>:<place>:board:<group by>`. */
export function boardFoldKey(workspaceId: string, place: string, groupBy: string): string {
  return `${workspaceId}:${place}:board:${groupBy}`;
}

/** Folds not written yet, per key. */
const pending = new Map<string, Record<string, boolean>>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** How long folds wait before they're written (one write for a burst). */
export const FOLDS_WRITE_DELAY_MS = 800;

/** The fold choices for one List or Board (the newest, written or not). */
export function readFolds(key: string | null): Record<string, boolean> {
  if (!key) return {};
  const saved = currentPreferences().tasksFolds[key]?.folds ?? {};
  const waiting = pending.get(key);
  return waiting ? { ...saved, ...waiting } : { ...saved };
}

/** Remember one fold choice; written with the others a moment later. */
export function writeFold(key: string | null, id: string, folded: boolean): void {
  if (!key || !id) return;
  pending.set(key, { ...pending.get(key), [id]: folded });
  if (timer) return;
  timer = setTimeout(flushFolds, FOLDS_WRITE_DELAY_MS);
}

/** Write the waiting folds now (also on the timer). */
export function flushFolds(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (pending.size === 0) return;
  const at = new Date().toISOString();
  const next: Record<string, TasksFoldEntry> = { ...currentPreferences().tasksFolds };
  for (const [key, folds] of pending) {
    // A changed fold moves to the end: the newest are the ones kept.
    const kept = { ...next[key]?.folds };
    for (const id of Object.keys(folds)) delete kept[id];
    next[key] = { at, folds: { ...kept, ...folds } };
  }
  pending.clear();
  // The newest views keep theirs (the preferences keep at most this many).
  const kept = Object.entries(next)
    .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
    .slice(0, TASKS_FOLDS_KEEP);
  updatePreferences({ tasksFolds: Object.fromEntries(kept) });
}

/** Tests: forget every fold, waiting or written. */
export function resetFoldsForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending.clear();
  if (Object.keys(currentPreferences().tasksFolds).length > 0)
    updatePreferences({ tasksFolds: {} });
}

if (typeof window !== "undefined") {
  // A tab closing mid-burst still keeps what was folded.
  window.addEventListener("pagehide", flushFolds);
}

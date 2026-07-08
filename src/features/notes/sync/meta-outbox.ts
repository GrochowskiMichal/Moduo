/**
 * Offline intent-op queue for note METADATA mutations (Wave-3 NO-2, AC6).
 *
 * Doc edits ride the CRDT outbox; creates/renames/moves/… are RPCs, so a
 * desktop session with no network queues the intent and replays FIFO on
 * reconnect. Pure classification here; the runner lives in engine-v2.ts.
 */

import type { MetaOutboxEntry } from "./idb";

/** True when an error smells like "no network", not "the server said no".
 * supabase-js surfaces fetch failures as TypeError('Failed to fetch') (and
 * friends across webviews). */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /failed to fetch|network\s?error|load failed|fetch failed|networkerror|timed?\s?out|ERR_INTERNET|ERR_NETWORK/i.test(
    msg,
  );
}

/** A replayed CREATE that hits the primary key means an earlier attempt
 * actually landed — that's success, not failure. */
export function isDuplicateKeyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /duplicate key|already exists|23505/i.test(msg);
}

export type ReplayDecision = "applied" | "retry-later" | "drop";

/** Decide what a replay attempt's outcome means for the queue entry. */
export function replayDecision(entry: MetaOutboxEntry, error: unknown | null): ReplayDecision {
  if (error == null) return "applied";
  if (isNetworkError(error)) return "retry-later";
  if (entry.kind === "create" && isDuplicateKeyError(error)) return "applied";
  // A validation/permission error will never succeed on retry — drop it so
  // one poison entry can't wedge the queue forever.
  return "drop";
}

/** FIFO order for replay: strictly by queue time, then insertion key. */
export function replayOrder(entries: MetaOutboxEntry[]): MetaOutboxEntry[] {
  return [...entries].sort((a, b) => a.queuedAt - b.queuedAt || (a.key ?? 0) - (b.key ?? 0));
}

/**
 * Offline intent-op queue for note METADATA mutations (Wave-3 NO-2, AC6).
 *
 * Doc edits ride the CRDT outbox; creates/renames/moves/… are RPCs, so a
 * desktop session with no network queues the intent and replays FIFO on
 * reconnect. Pure classification here; the runner lives in engine-v2.ts.
 */

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { isNetworkError as isSharedNetworkError } from "../../../lib/sync/network";
import type { MetaOutboxEntry } from "./idb";

/** Words Notes also reads as "no network" beyond the shared check: a timeout
 * keeps a queued op for later rather than dropping it. */
const NOTES_NETWORK_WORDS = /network\s?error|timed?\s?out|ERR_INTERNET|ERR_NETWORK/i;

/** True when an error smells like "no network", not "the server said no":
 * the sync kernel's check (supabase-js's fetch failures across engines, and a
 * browser that says it's offline), plus Notes' own words. */
export function isNetworkError(e: unknown): boolean {
  if (isSharedNetworkError(e)) return true;
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return NOTES_NETWORK_WORDS.test(msg);
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

/** Dispatch one queued (or live) meta intent to its runtime op. Every op is
 * idempotent server-side (create dedupes on the PK; file/favorite are
 * set-to-value), so a replay after a lost response never doubles anything. */
export function callMetaOp(
  rt: Pick<ModuoRuntime, "notesV2">,
  kind: MetaOutboxEntry["kind"],
  args: any,
): Promise<unknown> {
  switch (kind) {
    case "create":
      return rt.notesV2.create(args);
    case "rename":
      return rt.notesV2.rename(args);
    case "move":
      return rt.notesV2.move(args);
    case "setMeta":
      return rt.notesV2.setMeta(args);
    case "duplicate":
      return rt.notesV2.duplicate(args);
    case "archive":
      return rt.notesV2.archive(args);
    case "unarchive":
      return rt.notesV2.unarchive(args);
    case "trash":
      return rt.notesV2.trash(args);
    case "restore":
      return rt.notesV2.restore(args);
    case "file":
      return rt.notesV2.fileNote(args);
    case "setFavorite":
      return rt.notesV2.setFavorite(args);
  }
}

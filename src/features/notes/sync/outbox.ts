/**
 * Pure doc-outbox planning (Wave-3 NO-2, AC6).
 *
 * The queue lives in IndexedDB (idb.ts); these functions decide WHAT gets
 * pushed and what gets acked. Idempotence contract: an entry's
 * (clientSeq, updateB64) never changes once queued, so replaying the same
 * batch after a failed/duplicated push is server-deduped by the
 * (note_id, client_id, client_seq) unique key — content can never double.
 */

import type { DocOutboxEntry, NoteSyncState } from "./idb";

export const PUSH_BATCH_MAX = 64;

/** The batch to push: oldest first, capped. Deterministic for a given queue —
 * two identical calls produce byte-identical payloads (replay safety). */
export function planPushBatch(
  entries: DocOutboxEntry[],
  max: number = PUSH_BATCH_MAX,
): DocOutboxEntry[] {
  return [...entries].sort((a, b) => a.clientSeq - b.clientSeq).slice(0, max);
}

/** The RPC payload for a planned batch. */
export function toPushPayload(
  batch: DocOutboxEntry[],
): Array<{ clientSeq: number; updateB64: string }> {
  return batch.map((e) => ({ clientSeq: e.clientSeq, updateB64: e.updateB64 }));
}

/** IDB keys to delete once the server acked a batch (both fresh inserts and
 * server-side duplicates count as acked — the content is durably there). */
export function ackedKeys(batch: DocOutboxEntry[]): number[] {
  return batch.map((e) => e.key).filter((k): k is number => typeof k === "number");
}

/** Assign the next client_seq and return the advanced state. Monotonic per
 * note per client — never reused, never rewound, even across reloads
 * (the state persists in IDB). */
export function assignSeq(state: NoteSyncState): { seq: number; next: NoteSyncState } {
  const seq = state.nextClientSeq;
  return { seq, next: { ...state, nextClientSeq: seq + 1 } };
}

export function emptyNoteState(noteId: string): NoteSyncState {
  return { noteId, lastPulledUpdateId: 0, nextClientSeq: 1, updatesSinceCompact: 0 };
}

/** Advance the pull cursor. Only PULLED updates move it — a push response's
 * global max id may cover other clients' updates we haven't applied yet, so
 * it must never fast-forward the cursor (that would silently skip them). */
export function advanceCursor(state: NoteSyncState, pulledIds: number[]): NoteSyncState {
  if (pulledIds.length === 0) return state;
  const max = Math.max(...pulledIds);
  return {
    ...state,
    lastPulledUpdateId: Math.max(state.lastPulledUpdateId, max),
    updatesSinceCompact: state.updatesSinceCompact + pulledIds.length,
  };
}

/** How many log rows since the last compaction triggers a snapshot fold. */
export const COMPACT_AFTER_UPDATES = 40;

export function shouldCompact(state: NoteSyncState): boolean {
  return state.updatesSinceCompact >= COMPACT_AFTER_UPDATES;
}

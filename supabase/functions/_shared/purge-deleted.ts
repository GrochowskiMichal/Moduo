/**
 * The daily trash purge behind the purge-deleted Edge Function (AT-1,
 * specs/attachments.md §6; shared with tasks-v2 TV-U6).
 *
 * In order, each step in rounds until nothing is left or the round cap is hit:
 *   1. attachments  files trashed more than 30 days ago, uploads abandoned for
 *                   24 h, failed uploads, files of deleted workspaces and files
 *                   whose task is gone: the objects are removed through the
 *                   Storage API first (SQL can't delete Storage objects), then
 *                   the rows. A failed Storage call stops the run with the rows
 *                   still in place, so tomorrow's run retries them.
 *   2. orphans      objects no row names any more, older than a day (an
 *                   account deletion that cascaded the rows, a lost begin).
 *   3. tasks        tasks and buckets trashed more than 30 days ago (SQL
 *                   tasks__purge_expired; a task waits for its file rows).
 *                   `deleted_at` is the server's (trash_stamp_deleted_at), never
 *                   the device's: any timestamp a job acts on must be server-stamped.
 *   4. notes        notes trashed more than 30 days ago, in every workspace (SQL
 *                   notes__purge_expired, NS-4: live sub-notes keep their access),
 *                   and live-viewer rows older than 10 minutes. A workspace whose
 *                   purge is refused is skipped and counted in notesFailed.
 *   5. compaction   notes only agents write, which no client ever opens to fold
 *                   (NS-10): at most 50 notes with more than 200 log rows,
 *                   quiet for 10 minutes and open in no tab
 *                   (notes__compact_candidates). Each one's snapshot and log are
 *                   merged by compactFromLog (the notes-doc bundle; it only
 *                   merges, the bodies stay the client's) and swapped in by
 *                   notes__compact under the client fold's version CAS. A
 *                   refusal (the note moved or was opened) skips it; a failure
 *                   is counted and never fails the run.
 *   6. pools        storage_usage recounted from the rows, so a missed delta
 *                   never outlives a day.
 * A dry run only counts (SQL purge__preview) and changes nothing.
 *
 * Plain TypeScript with an injected client (no Deno globals, no URL imports), so
 * purge-deleted.test.ts can run it. The real supabase-js client satisfies PurgeDb.
 */

import { ATTACHMENTS_BUCKET } from "./contracts/attachments.ts";

export type PurgeDbError = { message: string; code?: string };

export interface PurgeDb {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: PurgeDbError | null }>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: PurgeDbError | null }>;
    };
  };
}

/** Snapshot plus log in, one merged snapshot out (base64). */
export type CompactDoc = (input: { snapshotB64: string | null; updatesB64: string[] }) =>
  string | PromiseLike<string>;

export type PurgeOptions = {
  dryRun?: boolean;
  /** Rows per round (default 500). */
  batch?: number;
  /** Rounds per step before the run stops; the next day picks up the rest (default 20). */
  maxRounds?: number;
  /** The merge (default: the notes-doc bundle's compactFromLog). */
  compact?: CompactDoc;
};

export type PurgeCounts = {
  /** Attachment rows deleted (their objects first). */
  attachments: number;
  /** Objects removed for those rows (originals + previews). */
  objects: number;
  /** Objects no row named. */
  orphanObjects: number;
  tasks: number;
  buckets: number;
  notes: number;
  /** note_live_viewers rows older than 10 minutes. */
  noteViewers: number;
  /** Workspaces whose notes purge was refused this run (retried tomorrow). */
  notesFailed: number;
  /** Notes whose log was folded into their snapshot. */
  notesCompacted: number;
  /** Notes whose fold was refused (written to or opened meanwhile); tomorrow's run retries. */
  notesCompactSkipped: number;
  /** Compaction failures (the pick, or one note's load, merge or fold). */
  notesCompactFailed: number;
  /** Pools whose recount changed them. */
  poolsRecounted: number;
};

export type PurgeResult =
  | { dryRun: true; preview: Record<string, number> }
  | ({ dryRun: false } & PurgeCounts);

/** Storage removes at most this many paths per request. */
const REMOVE_CHUNK = 100;

type Candidate = { id: string; object_path: string; preview_path: string | null };

export class PurgeError extends Error {
  readonly step: "preview" | "attachments" | "orphans" | "tasks" | "notes" | "pools";
  readonly partial: PurgeCounts;
  constructor(step: PurgeError["step"], message: string, partial: PurgeCounts) {
    super(`${step}: ${message}`);
    this.name = "PurgeError";
    this.step = step;
    this.partial = partial;
  }
}

export async function purgeDeleted(db: PurgeDb, options: PurgeOptions = {}): Promise<PurgeResult> {
  const batch = Math.max(1, options.batch ?? 500);
  const maxRounds = Math.max(1, options.maxRounds ?? 20);
  const counts: PurgeCounts = {
    attachments: 0,
    objects: 0,
    orphanObjects: 0,
    tasks: 0,
    buckets: 0,
    notes: 0,
    noteViewers: 0,
    notesFailed: 0,
    notesCompacted: 0,
    notesCompactSkipped: 0,
    notesCompactFailed: 0,
    poolsRecounted: 0,
  };

  const call: Call = async (step, fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new PurgeError(step, `${fn}: ${error.message}`, counts);
    return data;
  };
  const bucket = db.storage.from(ATTACHMENTS_BUCKET);
  const remove = async (step: PurgeError["step"], paths: string[]) => {
    for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
      const { error } = await bucket.remove(paths.slice(i, i + REMOVE_CHUNK));
      if (error) throw new PurgeError(step, `storage remove: ${error.message}`, counts);
    }
  };

  if (options.dryRun) {
    const preview = (await call("preview", "purge__preview")) as Record<string, number> | null;
    return { dryRun: true, preview: preview ?? {} };
  }

  // 1. Attachments: objects, then rows.
  for (let round = 0; round < maxRounds; round++) {
    const rows = ((await call("attachments", "attachments__purge_candidates", {
      p_limit: batch,
    })) ?? []) as Candidate[];
    if (rows.length === 0) break;
    const paths = rows.flatMap((r) => (r.preview_path ? [r.object_path, r.preview_path] : [r.object_path]));
    await remove("attachments", paths);
    counts.objects += paths.length;
    const deleted = Number(
      await call("attachments", "attachments__purge_rows", { p_ids: rows.map((r) => r.id) }),
    );
    counts.attachments += deleted;
    // A short page is the last one; a page where nothing could go (all restored
    // meanwhile) would only repeat.
    if (rows.length < batch || deleted === 0) break;
  }

  // 2. Orphaned objects.
  for (let round = 0; round < maxRounds; round++) {
    const rows = ((await call("orphans", "attachments__orphan_objects", { p_limit: batch })) ??
      []) as { name: string }[];
    if (rows.length === 0) break;
    await remove(
      "orphans",
      rows.map((r) => r.name),
    );
    counts.orphanObjects += rows.length;
    if (rows.length < batch) break;
  }

  // 3. Tasks and buckets.
  await purgeTasks(call, counts, batch, maxRounds);

  // 4. Notes (and stale live viewers).
  await purgeNotes(call, counts, batch, maxRounds);

  // 5. Compaction of notes nobody opens.
  await compactNotes(db, counts, options.compact ?? compactFromBundle);

  // 6. Pools.
  counts.poolsRecounted = Number(await call("pools", "storage_usage__reconcile"));

  return { dryRun: false, ...counts };
}

type Call = (step: PurgeError["step"], fn: string, args?: Record<string, unknown>) => Promise<unknown>;

async function purgeTasks(call: Call, counts: PurgeCounts, batch: number, maxRounds: number) {
  for (let round = 0; round < maxRounds; round++) {
    const result = ((await call("tasks", "tasks__purge_expired", { p_limit: batch })) ?? {}) as {
      tasks?: number;
      buckets?: number;
    };
    const tasks = Number(result.tasks ?? 0);
    const buckets = Number(result.buckets ?? 0);
    counts.tasks += tasks;
    counts.buckets += buckets;
    if (tasks < batch && buckets < batch) break;
  }
}

async function purgeNotes(call: Call, counts: PurgeCounts, batch: number, maxRounds: number) {
  for (let round = 0; round < maxRounds; round++) {
    const result = ((await call("notes", "notes__purge_expired", { p_limit: batch })) ?? {}) as {
      notes?: number;
      viewers?: number;
      failed?: number;
      picked?: number;
    };
    const notes = Number(result.notes ?? 0);
    counts.notes += notes;
    counts.noteViewers += Number(result.viewers ?? 0);
    counts.notesFailed += Number(result.failed ?? 0);
    // A refused workspace purges nothing but was still taken: stop on what the
    // round took, not on what it purged.
    if (Number(result.picked ?? notes) < batch) break;
  }
}

/** Notes picked per night. */
const COMPACT_LIMIT = 50;

type CompactSource = {
  doc_state: string | null;
  doc_version: number;
  updates: { id: number; update_b64: string }[];
};

async function compactFromBundle(input: { snapshotB64: string | null; updatesB64: string[] }) {
  const { compactFromLog } = await import("./notes-doc/notes-doc.bundle.js");
  return compactFromLog(input) as string;
}

/** Never throws: compaction is upkeep, and one bad note mustn't cost the recount. */
async function compactNotes(db: PurgeDb, counts: PurgeCounts, compact: CompactDoc) {
  const picked = await db.rpc("notes__compact_candidates", { p_limit: COMPACT_LIMIT });
  if (picked.error) {
    counts.notesCompactFailed += 1;
    console.error(JSON.stringify({ notes_compact_pick: picked.error.message }));
    return;
  }
  for (const id of (picked.data ?? []) as string[]) {
    try {
      const loaded = await db.rpc("notes__compact_source", { p_note: id });
      if (loaded.error) throw new Error(loaded.error.message);
      const source = loaded.data as CompactSource | null;
      // Gone since the pick, or nothing to fold.
      if (!source || source.updates.length === 0) continue;
      const snapshot = await compact({
        snapshotB64: source.doc_state,
        updatesB64: source.updates.map((u) => u.update_b64),
      });
      const folded = await db.rpc("notes__compact", {
        p_note: id,
        p_snapshot_b64: snapshot,
        p_upto_id: source.updates[source.updates.length - 1]!.id,
        p_expected_version: source.doc_version,
      });
      if (folded.error) throw new Error(folded.error.message);
      if ((folded.data as { refused?: boolean } | null)?.refused) counts.notesCompactSkipped += 1;
      else counts.notesCompacted += 1;
    } catch (err) {
      counts.notesCompactFailed += 1;
      console.error(JSON.stringify({ notes_compact_failed: id, message: String((err as Error)?.message ?? err) }));
    }
  }
}

/** Compare a presented secret with the configured one without an early exit
 *  on the first differing character. */
export function secretMatches(presented: string, expected: string): boolean {
  if (!expected) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}

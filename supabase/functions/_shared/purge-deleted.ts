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
 *   4. pools        storage_usage recounted from the rows, so a missed delta
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

export type PurgeOptions = {
  dryRun?: boolean;
  /** Rows per round (default 500). */
  batch?: number;
  /** Rounds per step before the run stops; the next day picks up the rest (default 20). */
  maxRounds?: number;
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
  readonly step: "preview" | "attachments" | "orphans" | "tasks" | "pools";
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
    poolsRecounted: 0,
  };

  const call = async (step: PurgeError["step"], fn: string, args?: Record<string, unknown>) => {
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

  // 4. Pools.
  counts.poolsRecounted = Number(await call("pools", "storage_usage__reconcile"));

  return { dryRun: false, ...counts };
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

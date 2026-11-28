// Spike: a custom Supabase sync collection for `tasks`, wrapped in SQLite
// persistence (OPFS + wa-sqlite on web). Nothing in apps/app/src imports it.
//
// Sync run: open the Realtime channel first and buffer, read rows paged at
// 1000 ordered by (updated_at, id) since a watermark held in the persisted
// collection metadata, write each page in one begin/write/commit, flush the
// buffer deduped, markReady, then apply live events only when newer. A soft
// delete (deleted_at set) is a delete in the collection.

import { type TaskRow, taskRowSchema } from "@contracts/rows";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/db";

export const PAGE = 1000;
/** Same slack as the app's delta cursor: re-read the last five minutes. */
const SLACK_MS = 5 * 60_000;
const WATERMARK = "watermark";

type Watermark = { at: string; id: string };

export type SyncTimings = {
  hydrated?: number;
  subscribed?: number;
  firstPage?: number;
  ready?: number;
  caughtUp?: number;
  pages: number;
  rows: number;
  liveApplied: number;
  liveSkipped: number;
  resumedFrom?: string;
};

export type WriteUpsert = (row: TaskRow) => void;

export async function openTasksCollection(opts: {
  supabase: SupabaseClient;
  workspaceId: string;
  t0: number;
  persist: boolean;
}) {
  const { supabase, workspaceId, t0 } = opts;
  const timings: SyncTimings = { pages: 0, rows: 0, liveApplied: 0, liveSkipped: 0 };
  const now = () => Math.round(performance.now() - t0);

  // writeUpsert: the server's row back into the synced layer (mutations call it).
  let direct: WriteUpsert = () => {
    throw new Error("sync not started");
  };

  const sync = {
    rowUpdateMode: "full" as const,
    sync: ({ begin, write, commit, markReady, markError, collection, metadata }: any) => {
      let buffering = true;
      const buffer: TaskRow[] = [];
      let stopped = false;

      const newer = (row: TaskRow) => {
        const have = collection.get(row.id) as TaskRow | undefined;
        return !have || have.updated_at < row.updated_at;
      };
      /** One row into an open transaction, honouring soft deletes. */
      const put = (row: TaskRow) => {
        const have = collection.has(row.id);
        if (row.deleted_at) {
          if (have) write({ type: "delete", key: row.id });
          return;
        }
        write({ type: have ? "update" : "insert", value: row });
      };
      const applyLive = (rows: TaskRow[]) => {
        const fresh = rows.filter((r) => {
          const ok = newer(r);
          if (ok) timings.liveApplied++;
          else timings.liveSkipped++;
          return ok;
        });
        if (!fresh.length) return;
        begin();
        for (const r of fresh) put(r);
        commit();
      };
      direct = (row) => {
        if (!newer(row)) return;
        begin();
        put(row);
        commit();
      };

      const channel = supabase
        .channel(`spike-tasks:${workspaceId}:${Math.random().toString(36).slice(2, 7)}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
            filter: `workspace_id=eq.${workspaceId}`,
          },
          (payload: any) => {
            const parsed = taskRowSchema.safeParse(payload.new ?? payload.old);
            if (!parsed.success) return;
            if (buffering) buffer.push(parsed.data);
            else applyLive([parsed.data]);
          },
        );

      const run = async () => {
        const hydrating = metadata?.persistence?.hydrateBaseline();
        await new Promise<void>((resolve, reject) => {
          channel.subscribe((status: string, err?: Error) => {
            if (status === "SUBSCRIBED") resolve();
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
              reject(err ?? new Error(status));
          });
        });
        timings.subscribed = now();
        // The persisted rows into the collection before reading it (the
        // wrapper's adapter capability; a custom source must call it).
        // (Started above, alongside the subscribe.)
        await hydrating;
        timings.hydrated = now();

        const stored = metadata?.collection.get(WATERMARK) as Watermark | undefined;
        const warm = !!stored && collection.size > 0;
        // A usable recovered snapshot: show it now, catch up behind it.
        if (warm) {
          timings.ready = now();
          markReady();
        }
        timings.resumedFrom = stored?.at;
        let cursor: Watermark = stored
          ? { at: new Date(Date.parse(stored.at) - SLACK_MS).toISOString(), id: "" }
          : { at: "1970-01-01T00:00:00Z", id: "" };

        for (;;) {
          if (stopped) return;
          let q = supabase
            .from("tasks")
            .select("*")
            .eq("workspace_id", workspaceId)
            .or(
              `updated_at.gt.${cursor.at},and(updated_at.eq.${cursor.at},id.gt.${cursor.id || "00000000-0000-0000-0000-000000000000"})`,
            )
            .order("updated_at")
            .order("id")
            .limit(PAGE);
          // A cold copy has nothing to delete.
          if (!warm) q = q.is("deleted_at", null);
          const { data, error } = await q;
          if (error) throw error;
          const rows = (data ?? []).map((r) => taskRowSchema.parse(r));
          if (rows.length) {
            begin();
            for (const r of rows) if (newer(r)) put(r);
            const last = rows[rows.length - 1] as TaskRow;
            cursor = { at: last.updated_at, id: last.id };
            metadata?.collection.set(WATERMARK, cursor);
            commit();
            timings.pages++;
            timings.rows += rows.length;
            if (timings.pages === 1) timings.firstPage = now();
          }
          if (rows.length < PAGE) break;
        }

        // Flush what arrived while reading, newest per id only.
        const latest = new Map<string, TaskRow>();
        for (const r of buffer) {
          const prev = latest.get(r.id);
          if (!prev || prev.updated_at < r.updated_at) latest.set(r.id, r);
        }
        buffer.length = 0;
        buffering = false;
        applyLive([...latest.values()]);
        timings.caughtUp = now();
        if (!warm) {
          timings.ready = now();
          markReady();
        }
      };

      run().catch((e) => {
        console.error("[spike sync]", e);
        if (collection.status === "loading") markError(e);
      });

      return () => {
        stopped = true;
        void supabase.removeChannel(channel);
      };
    },
  };

  const base = {
    id: `tasks:${workspaceId}`,
    getKey: (t: TaskRow) => t.id,
    sync,
  };

  const database = opts.persist
    ? await openBrowserWASQLiteOPFSDatabase({ databaseName: "spike-tasks.sqlite" })
    : null;
  const collection = database
    ? createCollection(
        persistedCollectionOptions<TaskRow, string>({
          ...base,
          persistence: createBrowserWASQLitePersistence({ database }),
          schemaVersion: 1,
        }),
      )
    : createCollection<TaskRow, string>(base);

  return {
    collection,
    timings,
    writeUpsert: (row: TaskRow) => direct(row),
    close: async () => {
      await collection.cleanup();
      await database?.close?.();
    },
  };
}

export type TasksHandle = Awaited<ReturnType<typeof openTasksCollection>>;

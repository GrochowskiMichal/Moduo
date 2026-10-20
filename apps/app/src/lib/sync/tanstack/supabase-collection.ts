// The kernel as a TanStack DB collection (TS-2, specs/tanstack-spine.md). An
// in-memory collection whose `sync` drives one kernel `SyncedCollection` and
// mirrors its held rows through begin/write/commit. No persistence plugin: the
// kernel's IndexedDB device copy stays the copy, and the store that owns the
// kernel keeps writing it (`onChange` says when).
//
// One run, in order:
//   1. **Realtime opens first** and buffers: an event during the first read
//      would otherwise land before (and lose to) that read's older row.
//   2. **Seed** from the device copy and `markReady` at once: the list paints
//      from the device before the network answers.
//   3. **Catch up** with the kernel delta (keyset pages from the lookback, page
//      cap) once Realtime is subscribed. Rows land by the kernel's rule.
//   4. **Flush** the buffer, newest per id, by the "live" rule (strictly newer;
//      an equal stamp is your own echo). Later events land the same way.
//
// Landing, delete marks, soft deletes and the cursor are the kernel's
// (`landing.ts`, `delta.ts`, `collection.ts`): this file only diffs the
// kernel's rows against what it wrote and writes the difference.

import type {
  ChangeMessageOrDeleteKeyMessage,
  CollectionConfig,
  UpdateMutationFnParams,
} from "@tanstack/db";
import type { CollectionCopy, SyncedCollection } from "../kernel/collection";
import type { LandingRow } from "../kernel/landing";

/** What Realtime sends: rows (a soft delete carries `deletedAt`) and hard-deleted ids. */
export type LiveHandlers<R> = {
  rows: (rows: R[]) => void;
  deleted: (ids: string[]) => void;
};

/** An open Realtime subscription: `ready` resolves once the channel is subscribed. */
export type LiveSubscription = { ready: Promise<void>; close: () => void };

/** One update as TS-3c sends it: the row's id and only the fields the edit changed. */
export type ChangedFields = { id: string; changes: Record<string, unknown> };

type CommonOptions<R extends LandingRow & object> = {
  id: string;
  /** The kernel collection (owned by the store, which also persists its copy). */
  kernel: SyncedCollection<R>;
  /**
   * How long the first read waits for Realtime to subscribe (default 5 s).
   * Past it, or if subscribing fails, the read runs anyway: events from before
   * the join may be missed until the next catch-up, but the rows never wait on
   * a WebSocket.
   */
  liveReadyTimeoutMs?: number;
  /** A read error that means this person lost access: the rows go. */
  isAccessLoss?: (error: unknown) => boolean;
  /** The held rows changed (the store schedules its device-copy write). */
  onChange?: () => void;
  /** An error after the collection was ready (a failed catch-up). */
  onError?: (error: unknown) => void;
  /**
   * TS-3c's mutation hook: send only the changed fields, answer with the
   * server's rows, which land before the optimistic state drops.
   */
  sendChanges?: (changes: ChangedFields[]) => Promise<R[]>;
};

export type SupabaseCollectionOptions<R extends LandingRow & object> = CommonOptions<R> &
  (
    | {
        /**
         * The owner reads, lands and seeds the kernel itself (TS-3a's Tasks
         * store, whose phases and access checks span tables) and calls
         * `utils.sync` after each change: the collection only mirrors the
         * kernel. It never reads, never opens Realtime, and is ready at once
         * with what the kernel holds.
         */
        ownerDriven: true;
        seed?: never;
        subscribe?: never;
      }
    | {
        ownerDriven?: false;
        /** The kernel's device copy for this person and workspace (null: none yet). */
        seed: () => Promise<CollectionCopy | null>;
        /** Open Realtime for the table; called before the first read. */
        subscribe: (handlers: LiveHandlers<R>) => LiveSubscription;
      }
  );

export type SupabaseCollectionUtils<R> = {
  /** An op's answer (or a re-read row) into the collection by the "answer" rule. */
  landServerRow: (row: R) => void;
  /** The store changed the kernel itself (an access check forgot rows): mirror it. */
  sync: (ids?: Iterable<string>) => void;
  /** Read changes again (reconnect, a failed catch-up); one at a time. */
  catchUp: () => Promise<void>;
  /** Access is gone: every row goes, from the kernel and the collection, with the cursor. */
  loseAccess: () => void;
};

/** Only the fields an update changed, per row (what TS-3c sends). */
export function changedFields<R extends object>(
  params: UpdateMutationFnParams<R, string>,
): ChangedFields[] {
  return params.transaction.mutations
    .filter((m) => m.type === "update" && Object.keys(m.changes ?? {}).length > 0)
    .map((m) => ({ id: String(m.key), changes: m.changes as Record<string, unknown> }));
}

/** Realtime's join, bounded: a failed or slow join never holds the first read back. */
async function waitForLive(ready: Promise<void>, ms: number): Promise<"joined" | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    ready.then(
      () => "joined" as const,
      () => "joined" as const,
    ),
    new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), ms);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

export function supabaseCollectionOptions<R extends LandingRow & object>(
  opts: SupabaseCollectionOptions<R>,
): CollectionConfig<R, string> & { utils: SupabaseCollectionUtils<R> } {
  const { kernel } = opts;
  // Set while a sync run is live (null after cleanup).
  let run: {
    diff: (ids?: Iterable<string>) => void;
    clear: () => void;
    catchUp: () => Promise<void>;
  } | null = null;

  // Bumped by each access loss: a read that began before one must not land.
  let losses = 0;
  const emptyKernel = () => {
    // Delete marks keep a read already on its way from bringing rows back;
    // no cursor: a later re-share reads the live rows whole.
    kernel.forget([...kernel.rows.keys()]);
    kernel.cursor = null;
  };

  const utils: SupabaseCollectionUtils<R> = {
    landServerRow(row) {
      kernel.applyRows([row], "answer");
      run?.diff([row.id]);
    },
    sync(ids) {
      run?.diff(ids);
    },
    catchUp() {
      return run?.catchUp() ?? Promise.resolve();
    },
    loseAccess() {
      losses += 1;
      emptyKernel();
      // No live run: the store still rewrites its copy without the rows.
      if (run) run.clear();
      else opts.onChange?.();
    },
  };

  const config: CollectionConfig<R, string> & { utils: SupabaseCollectionUtils<R> } = {
    id: opts.id,
    getKey: (row) => row.id,
    utils,
    sync: {
      rowUpdateMode: "full",
      sync: ({ begin, write, commit, markReady, markError, truncate }) => {
        let stopped = false;
        let ready = false;
        let buffering = true;
        // Held in arrival order: a delete then a re-insert of one id stays inserted.
        const buffer: Array<{ rows: R[]; deleted: string[] }> = [];
        // What this run wrote, by reference: a kernel row that is the same object is unchanged.
        const written = new Map<string, R>();

        const markReadyOnce = () => {
          if (ready || stopped) return;
          ready = true;
          markReady();
        };

        /** Write the kernel's difference; true when anything changed. */
        const mirror = (ids?: Iterable<string>): boolean => {
          if (stopped) return false;
          const keys = ids ? new Set(ids) : new Set([...kernel.rows.keys(), ...written.keys()]);
          const messages: ChangeMessageOrDeleteKeyMessage<R, string>[] = [];
          for (const id of keys) {
            const now = kernel.rows.get(id);
            const was = written.get(id);
            if (now === was) continue;
            if (!now) {
              messages.push({ type: "delete", key: id });
              written.delete(id);
            } else {
              messages.push({ type: was ? "update" : "insert", value: now });
              written.set(id, now);
            }
          }
          if (messages.length === 0) return false;
          begin();
          for (const m of messages) write(m);
          commit();
          return true;
        };
        const diff = (ids?: Iterable<string>) => {
          if (mirror(ids)) opts.onChange?.();
        };
        const clear = () => {
          if (stopped) return;
          written.clear();
          begin();
          truncate({ markReady: false });
          commit();
          opts.onChange?.();
        };

        // Live rows land by the kernel's "live" rule in arrival order: the newest per id wins.
        if (opts.ownerDriven) {
          run = { diff, clear, catchUp: () => Promise.resolve() };
          mirror();
          markReadyOnce();
          return () => {
            stopped = true;
            run = null;
          };
        }
        if (!opts.subscribe || !opts.seed)
          throw new Error(`${config.id}: seed and subscribe are required`);
        const subscribe = opts.subscribe;
        const seed = opts.seed;

        const landLive = (rows: R[], deleted: string[]) => {
          kernel.applyRows(rows, "live");
          kernel.forget(deleted);
          diff([...rows.map((r) => r.id), ...deleted]);
        };
        const flush = () => {
          buffering = false;
          for (const event of buffer.splice(0)) landLive(event.rows, event.deleted);
        };

        const live = subscribe({
          rows: (rows) => {
            if (stopped) return;
            if (buffering) buffer.push({ rows, deleted: [] });
            else landLive(rows, []);
          },
          deleted: (ids) => {
            if (stopped) return;
            if (buffering) buffer.push({ rows: [], deleted: ids });
            else landLive([], ids);
          },
        });

        const fail = (error: unknown) => {
          if (stopped) return;
          if (!ready) markError(error);
          else opts.onError?.(error);
        };

        let reading: Promise<void> | null = null;
        const catchUp = (): Promise<void> => {
          reading ??= (async () => {
            const lossesBefore = losses;
            // Settles the read either way: access lost meanwhile drops what it
            // landed; otherwise pages already landed show (and the cursor saves).
            const settle = () => {
              if (stopped) return;
              if (losses !== lossesBefore) {
                emptyKernel();
                clear();
                return;
              }
              mirror();
              opts.onChange?.();
            };
            try {
              await kernel.readChanges(Date.now());
              settle();
              // A first read that failed earlier left `error`: a good one makes it ready
              // (the first run's start path does that itself, after the flush).
              if (!buffering) markReadyOnce();
            } catch (error) {
              settle();
              if (stopped) return;
              if (opts.isAccessLoss?.(error)) utils.loseAccess();
              else throw error;
            } finally {
              reading = null;
            }
          })();
          return reading;
        };
        run = { diff, clear, catchUp };

        const start = async () => {
          const lossesBefore = losses;
          // A device copy that can't be read is no copy: the server answers.
          const copy = await seed().catch(() => null);
          if (stopped) return;
          // Access lost while the copy was read: its rows are not this person's any more.
          if (copy && losses === lossesBefore) {
            kernel.restore(copy);
            mirror();
            markReadyOnce();
          }
          const joined = await waitForLive(live.ready, opts.liveReadyTimeoutMs ?? 5_000);
          if (stopped) return;
          // A join that comes after the read: read again to cover the gap between them.
          if (joined === "late") {
            live.ready.then(
              () => {
                if (!stopped) void catchUp().catch((e) => opts.onError?.(e));
              },
              () => undefined,
            );
          }
          try {
            await catchUp();
          } finally {
            // Even a failed catch-up stops buffering: live events keep landing.
            if (!stopped) flush();
          }
          markReadyOnce();
        };
        start().catch(fail);

        return () => {
          stopped = true;
          run = null;
          live.close();
        };
      },
    },
  };

  if (opts.sendChanges) {
    const send = opts.sendChanges;
    config.onUpdate = async (params) => {
      const changes = changedFields(params);
      const rows = await send(changes);
      const answered = new Set(rows.map((r) => r.id));
      for (const row of rows) kernel.applyRows([row], "answer");
      // A row the answer left out keeps the edit (its stamp stays, so the echo still lands).
      for (const c of changes) if (!answered.has(c.id)) kernel.patch(c.id, c.changes);
      utils.sync([...changes.map((c) => c.id), ...answered]);
    };
  }
  return config;
}

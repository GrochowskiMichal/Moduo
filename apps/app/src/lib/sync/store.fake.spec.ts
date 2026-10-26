// The shared store's test kit: a fake server that answers `syncRead` like
// PostgREST does, and a store wired to it (store.test.ts, store.order.test.ts; `.spec` keeps it out of the test run).
// Each test file mocks Realtime and the toasts itself.

import { rs } from "@rstest/core";

import type { Task, TaskQueueEntry } from "../../features/tasks/model";
import type { ModuoRuntime } from "../runtime.types";
import { memoryCache } from "./cache";
import { WorkspaceStore } from "./store";
import type {
  AccessChange,
  SyncAccessResult,
  SyncReadInput,
  SyncReadResult,
  SyncTableName,
} from "./types";

export const WS = "ws-1";
export const ME = "u-me";

export const at = (minute: number) =>
  `2026-10-11T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;

export function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    workspaceId: WS,
    number: null,
    creatorId: ME,
    creatorUnknown: false,
    assigneeId: ME,
    bucketId: "inbox",
    parentId: null,
    title: id,
    description: "",
    dueDate: null,
    dueOn: null,
    dueTime: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    statusId: null,
    statusCategory: "todo",
    completedAt: null,
    completedBy: null,
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id,
    createdAt: at(0),
    updatedAt: at(1),
    deletedAt: null,
    ...over,
  };
}

export type ServerRow = { id: string; updatedAt?: string; deletedAt?: string | null };

/** A server that answers `syncRead` like PostgREST does, and records each read. */
export function fakeServer() {
  const tables: Partial<Record<SyncTableName, ServerRow[]>> = { tasks: [] };
  /** Hard deletes' tombstones (TV-D11b): id and when. */
  const graves: Partial<Record<SyncTableName, { id: string; at: string }[]>> = {};
  /** Tables this database can only read whole (before TV-D11b's migration). */
  const wholeOnly = new Set<SyncTableName>();
  /** The grant feed (TV-D11b). */
  const feed: AccessChange[] = [];
  /** Holds the first load's second part (Done, Won't do, Backlog) until released. */
  let restGate: Promise<void> | null = null;
  const reads: SyncReadInput[] = [];
  const created: Task[] = [];
  const statusCalls: { taskId: string; status: string }[] = [];
  let offline = false;
  /** A read refused by the server (not the network), when set. */
  let refuse: string | null = null;
  const offlineError = () => new TypeError("Failed to fetch");
  const isOpen = (t: Task) => t.statusCategory === "todo" || t.statusCategory === "in_progress";

  const syncRead = rs.fn(async (input: SyncReadInput): Promise<SyncReadResult<unknown>> => {
    if (input.part === "rest" && restGate) await restGate;
    if (offline) throw offlineError();
    if (refuse) throw new Error(refuse);
    reads.push(input);
    const all = (tables[input.table] ?? []) as ServerRow[];
    const stamps = (rows: ServerRow[]) =>
      rows.map((r) => r.updatedAt).filter((s): s is string => !!s);
    let rows: ServerRow[];
    if (input.since && wholeOnly.has(input.table)) {
      const live = all.filter((r) => !r.deletedAt);
      return {
        rows: live,
        deleted: [],
        maxUpdatedAt: stamps(live).sort().pop() ?? null,
        truncated: null,
        whole: true,
      };
    }
    if (input.ids) {
      const wanted = new Set(input.ids);
      rows = all.filter((r) => wanted.has(r.id) && !r.deletedAt);
    } else if (input.since) {
      rows = all.filter((r) => (r.updatedAt ?? "") >= (input.since as string));
    } else {
      rows = all.filter((r) => !r.deletedAt);
      if (input.table === "tasks" && input.part) {
        rows = rows.filter((r) => isOpen(r as Task) === (input.part === "open"));
      }
    }
    const buried =
      input.since && !input.ids
        ? (graves[input.table] ?? []).filter((g) => g.at >= (input.since as string))
        : [];
    const maxUpdatedAt = [...stamps(rows), ...buried.map((g) => g.at)].sort().pop() ?? null;
    return {
      rows: rows.filter((r) => !r.deletedAt),
      deleted: [...rows.filter((r) => r.deletedAt).map((r) => r.id), ...buried.map((g) => g.id)],
      maxUpdatedAt,
      truncated: null,
    };
  });

  const syncAccessChanges = rs.fn(
    async ({ since }: { since: string | null }): Promise<SyncAccessResult> => {
      if (offline) throw offlineError();
      const sorted = [...feed].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
      if (since === null) {
        return { changes: [], maxChangedAt: sorted.at(-1)?.changedAt ?? null, supported: true };
      }
      const changes = sorted.filter((c) => c.changedAt >= since);
      return { changes, maxChangedAt: changes.at(-1)?.changedAt ?? null, supported: true };
    },
  );
  /** Every live task whose title has every word (the server's `tasks_search`). */
  const searchTasks = rs.fn(async ({ query }: { query: string }) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ids = ((tables.tasks ?? []) as Task[])
      .filter((t) => !t.deletedAt && words.every((w) => t.title.toLowerCase().includes(w)))
      .map((t) => t.id);
    return { ids, supported: true };
  });

  const runtime = {
    tasks: {
      syncRead,
      syncAccessChanges,
      searchTasks,
      list: rs.fn(),
      listQueue: rs.fn(),
      syncIds: rs.fn(async ({ table }: { table: SyncTableName }) => ({
        ids: ((tables[table] ?? []) as ServerRow[]).filter((r) => !r.deletedAt).map((r) => r.id),
        complete: true,
      })),
      createTask: rs.fn(async (t: Task) => {
        if (offline) throw offlineError();
        const existing = (tables.tasks as Task[]).find((x) => x.id === t.id);
        if (existing) return existing; // the op is idempotent on a resent id
        const saved = { ...t, updatedAt: at(30) };
        (tables.tasks as Task[]).push(saved);
        created.push(saved);
        return saved;
      }),
      upsertTask: rs.fn(),
      opSetStatus: rs.fn(async ({ taskId, status }: { taskId: string; status: string }) => {
        if (offline) throw offlineError();
        const rows = tables.tasks as Task[];
        const index = rows.findIndex((x) => x.id === taskId);
        if (index === -1) throw new Error("No such task.");
        statusCalls.push({ taskId, status });
        rows[index] = {
          ...rows[index]!,
          status: status === "done" ? "done" : "todo",
          statusCategory: status === "done" ? "done" : "todo",
          updatedAt: at(31 + statusCalls.length),
        };
        return rows[index]!;
      }),
      opQueueAdd: rs.fn(async (): Promise<TaskQueueEntry[]> => []),
      seedInbox: rs.fn(async (workspaceId: string) => {
        const inbox = {
          id: "inbox-mine",
          workspaceId,
          ownerId: ME,
          name: "Inbox",
          isSystem: true,
          group: null,
          position: "a0",
          createdAt: at(40),
          updatedAt: at(40),
          deletedAt: null,
        };
        tables.buckets = [...(tables.buckets ?? []), inbox];
        return inbox;
      }),
    },
  } as unknown as ModuoRuntime;

  return {
    runtime,
    tables,
    graves,
    wholeOnly,
    feed,
    syncAccessChanges,
    searchTasks,
    reads,
    created,
    statusCalls,
    syncRead,
    goOffline: () => {
      offline = true;
    },
    goOnline: () => {
      offline = false;
    },
    refuseReads: (message: string | null) => {
      refuse = message;
    },
    /** Hold the closed tasks' read; call the answer to let it through. */
    holdRest: () => {
      let release = () => {};
      restGate = new Promise<void>((resolve) => {
        release = () => {
          restGate = null;
          resolve();
        };
      });
      return release;
    },
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function settled(store: WorkspaceStore) {
  await store.whenLoaded();
  for (let i = 0; i < 20; i += 1) await tick();
}

export function makeStore(server: ReturnType<typeof fakeServer>, cache = memoryCache()) {
  const store = new WorkspaceStore(server.runtime, ME, WS, {
    cache,
    timing: { persistMs: 0, throttleMs: 0, retryMs: 60_000 },
  });
  const release = store.acquire();
  return { store, cache, release };
}

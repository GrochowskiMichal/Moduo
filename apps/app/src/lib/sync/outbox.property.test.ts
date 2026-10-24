// The sync outbox's whole contract, as a property (HV-17, AC24). A reference
// model of what the person did is run against the real store, the device
// copy and a fake server, over random sequences of: captures, check-offs,
// due-date edits, offline/online flips, failed reads, a device copy that
// won't decode, Realtime echoes, sign-out, a session that merely failed to
// load, and another person signing in on the device. `fc.scheduler()` holds
// every server op and lets them land in any order, so a queued op races the
// live ones. After every step:
//
//   I1 no outbox entry is lost: each one ever seen waiting is still waiting
//      (in the store or the device copy, under its person) or was sent;
//   I2 no queued op is overtaken: per task, what the server applied is how
//      the person's check-offs start, in the order they made them (nothing is
//      refused here, so nothing may be skipped);
//   I3 no failed read wipes the copy: rows shown before it are shown after;
//   I4 derived fields are fresh: a task that shows a due date shows its day;
//   I5 while a write is on its way, the task shows the newest one made.
//
// At the end everything is let through: the server holds the last check-off
// for each task and every capture exactly once. The preference domains'
// failed-read contract is in ../prefs-sync.property.test.ts. Seeds are fixed;
// set FC_SEED / FC_RUNS to explore.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import fc from "fast-check";

import type { Task } from "../../features/tasks/model";
import type { TasksLiveEvent } from "../../features/tasks/realtime";

// The socket is faked: each person's store gets its listener here.
const live = rs.hoisted(() => ({
  listeners: new Map<string, (e: TasksLiveEvent) => void>(),
}));
rs.mock("../../features/tasks/realtime", () => ({
  listenTasksLive: (_ws: string, me: string, fn: (e: TasksLiveEvent) => void) => {
    live.listeners.set(me, fn);
    return () => {
      if (live.listeners.get(me) === fn) live.listeners.delete(me);
    };
  },
}));
rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import { planTaskWrite, type WritePlanContext } from "../../features/tasks/write-plan";
import type { ModuoRuntime } from "../runtime.types";
import { localDayOf } from "../task-rows";
import { CACHE_VERSION, cacheKey, memoryCache } from "./cache";
import {
  attachSyncUser,
  type OutboxEntry,
  setStoreOptionsForTests,
  wipeSyncCopies,
  type WorkspaceStore,
  workspaceStore,
} from "./store";
import type { SyncReadInput, SyncReadResult } from "./types";

const SEED = Number(process.env.FC_SEED ?? 1709);
const RUNS = Number(process.env.FC_RUNS ?? 200);

/** MOD-569 is open: see `Real.atRisk`. */
const ALLOW_MOD_569 = false;
/** MOD-587 is open: see `checkOff`. */
const ALLOW_LIVE_RACE = false;

const WS = "ws-1";
const A = "u-a";
const B = "u-b";
const INITIAL = ["t0", "t1", "t2"];

/** Server stamps, one second apart, in PostgREST's shape. */
const stampOf = (n: number) =>
  new Date(Date.UTC(2026, 9, 11, 10, 0, 0) + n * 1000)
    .toISOString()
    .replace(/\.(\d{3})Z$/, ".$1000+00:00");

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    workspaceId: WS,
    number: null,
    creatorId: A,
    creatorUnknown: false,
    assigneeId: A,
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
    createdAt: stampOf(0),
    updatedAt: stampOf(1),
    deletedAt: null,
    ...over,
  };
}

const offlineError = () => new TypeError("Failed to fetch");

const statusFields = (status: "done" | "todo"): Partial<Task> => ({
  status,
  statusCategory: status,
});

/**
 * The server: rows and the order it applied each task's status ops in. Every
 * op waits on the scheduler and is applied only when it is let through (the
 * request arrives), so any two that are on their way at once may land in
 * either order, as on a real network.
 */
function fakeServer(s: fc.Scheduler) {
  const tasks = new Map<string, Task>(
    INITIAL.map((id, i) => [id, task(id, { updatedAt: stampOf(i + 1) })]),
  );
  const applied = new Map<string, string[]>();
  const created: string[] = [];
  let clock = 100;
  let offline = false;
  let refuseReads = false;
  const stamp = () => stampOf((clock += 1));

  const arrive = async (label: string) => {
    await s.schedule(Promise.resolve(label), label);
    if (offline) throw offlineError();
  };

  const syncRead = async (input: SyncReadInput): Promise<SyncReadResult<unknown>> => {
    if (offline) throw offlineError();
    if (refuseReads) throw new Error("The server refused the read.");
    if (input.table !== "tasks") {
      return { rows: [], deleted: [], maxUpdatedAt: null, truncated: null };
    }
    let rows = [...tasks.values()];
    if (input.ids) {
      const wanted = new Set(input.ids);
      rows = rows.filter((r) => wanted.has(r.id));
    } else if (input.since) {
      rows = rows.filter((r) => r.updatedAt >= (input.since as string));
    } else if (input.part) {
      const open = (r: Task) => r.statusCategory === "todo" || r.statusCategory === "in_progress";
      rows = rows.filter((r) => open(r) === (input.part === "open"));
    }
    return {
      rows,
      deleted: [],
      maxUpdatedAt:
        rows
          .map((r) => r.updatedAt)
          .sort()
          .pop() ?? null,
      truncated: null,
    };
  };

  const runtime = {
    tasks: {
      syncRead,
      syncAccessChanges: async () => {
        if (offline) throw offlineError();
        return { changes: [], maxChangedAt: null, supported: true };
      },
      syncIds: async () => {
        if (offline) throw offlineError();
        return { ids: [...tasks.keys()], complete: true };
      },
      searchTasks: async () => ({ ids: [], supported: true }),
      list: async () => {
        throw new Error("not used");
      },
      listQueue: async () => [],
      upsertTask: async () => {
        throw new Error("not used");
      },
      createTask: async (t: Task) => {
        await arrive(`create ${t.id}`);
        const existing = tasks.get(t.id);
        if (existing) return existing; // idempotent on a resent id
        const saved = { ...t, updatedAt: stamp() };
        tasks.set(t.id, saved);
        created.push(t.id);
        return saved;
      },
      opSetStatus: async ({ taskId, status }: { taskId: string; status: string }) => {
        await arrive(`status ${taskId} ${status}`);
        const row = tasks.get(taskId);
        if (!row) throw new Error("No such task.");
        const category: "done" | "todo" = status === "done" ? "done" : "todo";
        const saved: Task = {
          ...row,
          status: category,
          statusCategory: category,
          updatedAt: stamp(),
        };
        tasks.set(taskId, saved);
        applied.set(taskId, [...(applied.get(taskId) ?? []), category]);
        return saved;
      },
      opQueueAdd: async () => [],
    },
  } as unknown as ModuoRuntime;

  /** A field edit (`patchTask`'s field op): the server stores the columns it's sent. */
  const updateTask = async (taskId: string, columns: Record<string, unknown>) => {
    await arrive(`edit ${taskId}`);
    const row = tasks.get(taskId);
    if (!row) throw new Error("No such task.");
    const saved: Task = {
      ...row,
      ...("due_date" in columns ? { dueDate: columns.due_date as string | null } : {}),
      ...("due_on" in columns ? { dueOn: columns.due_on as string | null } : {}),
      updatedAt: stamp(),
    };
    tasks.set(taskId, saved);
    return saved;
  };

  return {
    runtime,
    tasks,
    applied,
    created,
    updateTask,
    setOffline: (v: boolean) => {
      offline = v;
    },
    setRefuseReads: (v: boolean) => {
      refuseReads = v;
    },
  };
}

type Server = ReturnType<typeof fakeServer>;
type Person = typeof A | typeof B;

/** What the person did, and what the app should be showing. */
type Model = {
  /** Who the app is signed in as (null: signed out, or a session that failed to load). */
  signedIn: Person | null;
  offline: boolean;
  tasks: string[];
  /** A's check-offs per task, in the order A made them. */
  intents: Map<string, ("done" | "todo")[]>;
  captures: string[];
  nextCapture: number;
};

type Real = {
  s: fc.Scheduler;
  server: Server;
  cache: ReturnType<typeof memoryCache>;
  /** The running store for whoever is signed in. */
  store: WorkspaceStore | null;
  release: (() => void) | null;
  /** Every store A ever had (each remembers what it sent). */
  aStores: WorkspaceStore[];
  /** Every outbox entry ever seen waiting for A. */
  seen: Map<string, OutboxEntry>;
  /** The running store's live writes (not in the outbox) still on their way, per task. */
  inFlight: Map<string, number>;
  /** The last check-off made through the running store, per task. */
  madeHere: Map<string, "done" | "todo">;
  /** The running store's live captures still on their way. */
  liveCaptures: Map<string, number>;
  /**
   * Tasks whose live write was still on its way when its store stopped.
   * KNOWN GAP (MOD-569): if that request then fails on the network, the store
   * that stopped queues it in an outbox nobody keeps, and it is lost. Only
   * for these tasks the end-state checks allow a lost write. Fixing MOD-569
   * means setting ALLOW_MOD_569 to false.
   */
  atRisk: Set<string>;
  /** Live check-offs still unanswered per task, from any store (MOD-587). */
  liveAll: Map<string, number>;
  /** Tasks where two live check-offs raced (MOD-587): their order isn't checked. */
  raced: Set<string>;
  /** Every promise a command left running (their rejections are expected). */
  running: Promise<unknown>[];
};

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 12; i += 1) await tick();
}

function openStore(r: Real, person: Person) {
  const store = workspaceStore(r.server.runtime, person, WS);
  r.store = store;
  r.release = store.acquire();
  if (person === A && !r.aStores.includes(store)) r.aStores.push(store);
}

function closeStore(r: Real) {
  r.release?.();
  r.release = null;
  r.store = null;
  if (ALLOW_MOD_569) {
    for (const map of [r.inFlight, r.liveCaptures]) {
      for (const [id, n] of map) if (n > 0) r.atRisk.add(id);
    }
  }
  // A write the stopped store had on its way isn't the next store's to show.
  r.inFlight = new Map();
  r.liveCaptures = new Map();
  r.madeHere = new Map();
}

/** Note every entry now waiting in A's store. */
function noteWaiting(r: Real, m: Model) {
  if (m.signedIn !== A || !r.store) return;
  for (const e of r.store.waitingEntries()) r.seen.set(e.id, e);
}

const taskOf = (store: WorkspaceStore, id: string) =>
  store.getSnapshot().bundle.tasks.find((t) => t.id === id);

const entryTask = (e: OutboxEntry) => (e.kind === "create" ? e.task.id : e.taskId);

function track(
  r: Real,
  taskId: string | null,
  p: Promise<unknown>,
  kind: "check-off" | "capture" = "check-off",
) {
  const inFlight = kind === "capture" ? r.liveCaptures : r.inFlight;
  if (taskId) inFlight.set(taskId, (inFlight.get(taskId) ?? 0) + 1);
  const done = p.then(
    () => {},
    () => {},
  );
  r.running.push(
    done.then(() => {
      if (taskId) inFlight.set(taskId, (inFlight.get(taskId) ?? 1) - 1);
    }),
  );
}

/** A's check-off, as every surface sends it (`store.sendStatus`). */
function checkOff(m: Model, r: Real, id: string, status: "done" | "todo") {
  const store = r.store!;
  // KNOWN GAP (MOD-587): nothing orders a check-off behind an older live one
  // still on its way. Sent live it races it; queued, the flush can send it
  // first, or the live one fails on the network and is queued behind it.
  if (ALLOW_LIVE_RACE && (r.liveAll.get(id) ?? 0) > 0) r.raced.add(id);
  m.intents.set(id, [...(m.intents.get(id) ?? []), status]);
  r.madeHere.set(id, status);
  r.liveAll.set(id, (r.liveAll.get(id) ?? 0) + 1);
  const sent = store.sendStatus({ taskId: id, status, fields: statusFields(status) });
  track(r, id, sent);
  r.running.push(
    sent
      .catch(() => {})
      .then(() => {
        r.liveAll.set(id, (r.liveAll.get(id) ?? 1) - 1);
      }),
  );
}

/** Collapse repeats: a resend of a status the server already applied changes nothing. */
function collapsed<T>(xs: readonly T[]): T[] {
  return xs.filter((x, i) => i === 0 || xs[i - 1] !== x);
}

/** Whether `sub` is `all` with some items left out, in the same order. */
function isSubsequence<T>(sub: readonly T[], all: readonly T[]): boolean {
  let i = 0;
  for (const x of all) if (i < sub.length && sub[i] === x) i += 1;
  return i === sub.length;
}

/** Whether `head` is how `all` starts. */
function isPrefix<T>(head: readonly T[], all: readonly T[]): boolean {
  return head.length <= all.length && head.every((x, i) => all[i] === x);
}

async function checkInvariants(m: Model, r: Real) {
  noteWaiting(r, m);
  // I1: every entry seen waiting is still waiting (in a store or A's device
  // copy) or one of A's stores sent it.
  const copy = r.cache.records.get(cacheKey(A, WS));
  const inCopy = new Set(
    (Array.isArray(copy?.outbox) ? (copy.outbox as { id?: unknown }[]) : [])
      .map((e) => e?.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const inStore = new Set(
    m.signedIn === A && r.store ? r.store.waitingEntries().map((e) => e.id) : [],
  );
  const handled = new Set(r.aStores.flatMap((st) => st.handledEntryIds()));
  for (const [id, entry] of r.seen) {
    if (inStore.has(id) || inCopy.has(id) || handled.has(id)) continue;
    throw new Error(`I1: outbox entry ${id} (${entry.kind} ${entryTask(entry)}) was lost`);
  }

  // I2: per task, the server applied A's check-offs in the order A made them.
  for (const [taskId, done] of r.server.applied) {
    if (r.raced.has(taskId)) continue;
    const made = collapsed(m.intents.get(taskId) ?? []);
    // MOD-569: a lost write leaves a gap, but what did land stays in order.
    const inOrder = r.atRisk.has(taskId) ? isSubsequence : isPrefix;
    if (!inOrder(collapsed(done), made)) {
      throw new Error(
        `I2: ${taskId} applied [${done.join(", ")}] but A made [${(m.intents.get(taskId) ?? []).join(", ")}]`,
      );
    }
  }

  if (m.signedIn !== A || !r.store) return;
  const snap = r.store.getSnapshot();
  for (const t of snap.bundle.tasks) {
    // I4: a shown due date shows its own day.
    if (t.dueDate && t.dueOn !== localDayOf(t.dueDate)) {
      throw new Error(`I4: ${t.id} shows due ${t.dueDate} but day ${t.dueOn}`);
    }
  }
  // I5: while a check-off for a task is on its way (live from this store, or
  // waiting in its outbox), the task shows the newest one: made here, or
  // else the newest the outbox took on from the device copy.
  const newestWaiting = new Map<string, string>();
  for (const e of r.store.waitingEntries()) {
    if (e.kind === "status") newestWaiting.set(e.taskId, String(e.fields.statusCategory));
  }
  const busy = new Set([
    ...newestWaiting.keys(),
    ...[...r.inFlight].filter(([, n]) => n > 0).map(([id]) => id),
  ]);
  for (const taskId of busy) {
    const last = r.madeHere.get(taskId) ?? newestWaiting.get(taskId);
    if (!last) continue;
    const shown = taskOf(r.store, taskId);
    if (shown && shown.statusCategory !== last) {
      throw new Error(`I5: ${taskId} shows ${shown.statusCategory} while ${last} is on its way`);
    }
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

type Cmd = fc.AsyncCommand<Model, Real>;

const signedInA = (m: Model) => m.signedIn === A;

class Capture implements Cmd {
  check = signedInA;
  async run(m: Model, r: Real) {
    const id = `c${m.nextCapture}`;
    m.nextCapture += 1;
    m.tasks.push(id);
    m.captures.push(id);
    // Shown under a `tmp-` id while it saves (sent under its own id), as the
    // capture shell does.
    track(r, id, r.store!.sendCreate(task(`tmp-${id}`, { title: `capture ${id}` })), "capture");
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => "Capture";
}

class CheckOff implements Cmd {
  constructor(
    readonly pick: number,
    readonly status: "done" | "todo",
  ) {}
  check = signedInA;
  async run(m: Model, r: Real) {
    const id = m.tasks[this.pick % m.tasks.length]!;
    // A capture still saving shows only as `tmp-…`: the app says "still
    // saving" and sends nothing (`applyOp`, `planTaskWrite`).
    if (!taskOf(r.store!, id)) {
      await checkInvariants(m, r);
      return;
    }
    checkOff(m, r, id, this.status);
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `CheckOff(${this.pick}, ${this.status})`;
}

/** One task's due date, through the same plan every edit path uses (`planTaskWrite`). */
class EditDue implements Cmd {
  constructor(
    readonly pick: number,
    readonly due: Date,
  ) {}
  // Offline, other edits say "Offline" (only captures and check-offs wait).
  check = (m: Model) => signedInA(m) && !m.offline;
  async run(m: Model, r: Real) {
    const store = r.store!;
    const id = m.tasks[this.pick % m.tasks.length]!;
    const before = taskOf(store, id);
    if (before && !before.id.startsWith("tmp-") && !store.hasOutboxEntries(id)) {
      const ctx: WritePlanContext = {
        userId: A,
        canEdit: true,
        archivedTaskIds: new Set<string>(),
        bucketsById: new Map(),
        statuses: [],
        subtasksByParent: new Map(),
        queueRows: [],
        myQueueEntries: [],
        now: new Date(Date.UTC(2026, 9, 23, 12)),
        zone: "UTC",
      };
      const plan = planTaskWrite(before, { dueDate: this.due.toISOString() }, ctx);
      if (plan.kind === "write") {
        const write = store.begin(plan.overlay);
        track(
          r,
          null,
          r.server.updateTask(id, plan.columns as Record<string, unknown>).then(
            (saved) => write.settle({ tasks: [saved] }),
            (e: unknown) => {
              write.fail();
              throw e;
            },
          ),
        );
      }
    }
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `EditDue(${this.pick}, ${this.due.toISOString()})`;
}

class GoOffline implements Cmd {
  check = (m: Model) => !m.offline;
  async run(m: Model, r: Real) {
    m.offline = true;
    r.server.setOffline(true);
    r.store?.wentOffline();
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => "GoOffline";
}

class GoOnline implements Cmd {
  check = (m: Model) => m.offline;
  async run(m: Model, r: Real) {
    m.offline = false;
    r.server.setOffline(false);
    if (r.store) track(r, null, r.store.syncNow());
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => "GoOnline";
}

/** Let one server op through (the scheduler picks which). */
class Deliver implements Cmd {
  check = () => true;
  async run(m: Model, r: Real) {
    if (r.s.count() > 0) await r.s.waitNext(1);
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => "Deliver";
}

/** A read the server refuses (not the network): what's shown stays. */
class FailedRead implements Cmd {
  check = (m: Model) => m.signedIn !== null && !m.offline;
  async run(m: Model, r: Real) {
    const store = r.store!;
    const before = store.getSnapshot().bundle.tasks.map((t) => t.id);
    r.server.setRefuseReads(true);
    await store.syncNow();
    await settle();
    r.server.setRefuseReads(false);
    const after = new Set(store.getSnapshot().bundle.tasks.map((t) => t.id));
    const gone = before.filter((id) => !after.has(id));
    if (gone.length > 0) throw new Error(`I3: a failed read took ${gone.join(", ")} away`);
    await checkInvariants(m, r);
  }
  toString = () => "FailedRead";
}

/**
 * A's device copy won't decode as written: junk entries in its outbox, an
 * outbox that isn't a list, or an older build's version. What really waited
 * there must still go.
 */
class CorruptCopy implements Cmd {
  constructor(readonly how: "junk" | "not-a-list" | "old-build") {}
  check = () => true;
  async run(m: Model, r: Real) {
    const key = cacheKey(A, WS);
    const stored = r.cache.records.get(key);
    if (stored) {
      const outbox = Array.isArray(stored.outbox) ? stored.outbox : [];
      if (this.how === "junk") {
        r.cache.records.set(key, {
          ...stored,
          outbox: [null, 7, { kind: "status" }, { id: 42 }, ...outbox] as unknown as OutboxEntry[],
        });
      } else if (this.how === "not-a-list" && outbox.length === 0) {
        r.cache.records.set(key, { ...stored, outbox: "garbage" as unknown as OutboxEntry[] });
      } else if (this.how === "old-build") {
        r.cache.records.set(key, { ...stored, v: CACHE_VERSION - 1 });
      }
    }
    // Another tab's write (or a restart) reads it back.
    r.store?.persistNow();
    await r.store?.whenPersisted();
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `CorruptCopy(${this.how})`;
}

/** A Realtime echo of the server's row lands while A's writes may be on their way. */
class LiveEcho implements Cmd {
  constructor(readonly pick: number) {}
  check = (m: Model) => m.signedIn !== null;
  async run(m: Model, r: Real) {
    const id = m.tasks[this.pick % m.tasks.length]!;
    const row = r.server.tasks.get(id);
    const listener = m.signedIn ? live.listeners.get(m.signedIn) : undefined;
    if (row && listener)
      listener({ type: "change", change: { table: "tasks", kind: "upsert", row } });
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `LiveEcho(${this.pick})`;
}

/**
 * A check-off made just before the session ends, before its device copy is
 * written (auth-js signs out on its own the moment a refresh token dies).
 */
function rushedCheckOff(m: Model, r: Real) {
  const store = r.store;
  if (m.signedIn !== A || !store || !taskOf(store, INITIAL[0]!)) return;
  const status =
    store.getSnapshot().bundle.tasks.find((t) => t.id === INITIAL[0])?.statusCategory === "done"
      ? "todo"
      : "done";
  checkOff(m, r, INITIAL[0]!, status);
}

/** SIGNED_OUT (by the person, or auth-js on its own when a refresh token dies). */
class SignOut implements Cmd {
  constructor(readonly rushed = false) {}
  check = (m: Model) => m.signedIn !== null;
  async run(m: Model, r: Real) {
    if (this.rushed) rushedCheckOff(m, r);
    noteWaiting(r, m);
    closeStore(r);
    m.signedIn = null;
    await wipeSyncCopies();
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `SignOut(${this.rushed ? "rushed" : ""})`;
}

/** A null session that isn't a sign-out (an expired token offline). */
class SessionLost implements Cmd {
  constructor(readonly rushed = false) {}
  check = (m: Model) => m.signedIn !== null;
  async run(m: Model, r: Real) {
    if (this.rushed) rushedCheckOff(m, r);
    noteWaiting(r, m);
    closeStore(r);
    m.signedIn = null;
    await attachSyncUser(null);
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `SessionLost(${this.rushed ? "rushed" : ""})`;
}

class SignIn implements Cmd {
  constructor(readonly person: Person) {}
  check = (m: Model) => m.signedIn !== this.person;
  async run(m: Model, r: Real) {
    noteWaiting(r, m);
    closeStore(r);
    await attachSyncUser(this.person);
    m.signedIn = this.person;
    openStore(r, this.person);
    await settle();
    await checkInvariants(m, r);
  }
  toString = () => `SignIn(${this.person === A ? "A" : "B"})`;
}

const commandArbs = [
  fc.constant(new Capture()),
  fc
    // A few tasks, so check-offs pile up on the same one.
    .tuple(fc.nat(3), fc.constantFrom("done" as const, "todo" as const))
    .map(([pick, status]) => new CheckOff(pick, status)),
  fc
    .tuple(
      fc.nat(9),
      // Around midnight in most zones, where a UTC slice and the local day differ.
      fc.integer({ min: 0, max: 47 }).map((h) => new Date(Date.UTC(2026, 9, 24, h, 30))),
    )
    .map(([pick, due]) => new EditDue(pick, due)),
  fc.constant(new GoOffline()),
  fc.constant(new GoOnline()),
  fc.constant(new Deliver()),
  fc.constant(new Deliver()),
  fc.constant(new FailedRead()),
  fc
    .constantFrom("junk" as const, "not-a-list" as const, "old-build" as const)
    .map((how) => new CorruptCopy(how)),
  fc.nat(3).map((pick) => new LiveEcho(pick)),
  fc.boolean().map((rushed) => new SignOut(rushed)),
  fc.boolean().map((rushed) => new SessionLost(rushed)),
  fc.constantFrom(A, B).map((p) => new SignIn(p)),
];

/** Let everything through, back online and signed in as A, until nothing moves. */
async function drain(m: Model, r: Real) {
  m.offline = false;
  r.server.setOffline(false);
  if (m.signedIn !== A) await new SignIn(A).run(m, r);
  else track(r, null, r.store!.syncNow());
  // One cue (the sign-in, the network back) sends everything that waits.
  await settle();
  while (r.s.count() > 0) {
    await r.s.waitNext(1);
    await settle();
  }
  expect(r.store!.waitingEntries().map((e) => `${e.kind} ${entryTask(e)}`)).toEqual([]);
  for (let round = 0; round < 50; round += 1) {
    while (r.s.count() > 0) {
      await r.s.waitNext(1);
      await settle();
    }
    await r.store!.syncNow();
    await r.store!.flush();
    await settle();
    noteWaiting(r, m);
    if (r.s.count() === 0 && r.store!.waitingEntries().length === 0) break;
  }
  await Promise.all(r.running);
  await checkInvariants(m, r);
  expect(r.store!.waitingEntries()).toEqual([]);
  // Every capture is on the server, once.
  for (const id of m.captures) {
    const times = r.server.created.filter((c) => c === id).length;
    if (r.atRisk.has(id)) expect(times).toBeLessThanOrEqual(1);
    else expect(`${id} created ${times}×`).toBe(`${id} created 1×`);
  }
  // Each task ends at the last check-off made.
  for (const [taskId, intents] of m.intents) {
    if (r.atRisk.has(taskId) || r.raced.has(taskId)) continue;
    expect(`${taskId}: ${r.server.tasks.get(taskId)?.statusCategory}`).toBe(
      `${taskId}: ${intents.at(-1)}`,
    );
  }
  // And the device shows what the server holds.
  for (const [taskId, row] of r.server.tasks) {
    const shown = taskOf(r.store!, taskId);
    expect(`${taskId}: ${shown?.statusCategory} ${shown?.dueOn}`).toBe(
      `${taskId}: ${row.statusCategory} ${row.dueOn}`,
    );
  }
}

/** One run: A signs in, the commands run against the model, then everything drains. */
async function runScenario(s: fc.Scheduler, cmds: Iterable<Cmd>) {
  const cache = memoryCache();
  setStoreOptionsForTests({
    cache,
    timing: { persistMs: 0, throttleMs: 0, retryMs: 600_000 },
  });
  const m: Model = {
    signedIn: null,
    offline: false,
    tasks: [...INITIAL],
    intents: new Map(),
    captures: [],
    nextCapture: 0,
  };
  const r: Real = {
    s,
    server: fakeServer(s),
    cache,
    store: null,
    release: null,
    aStores: [],
    seen: new Map(),
    inFlight: new Map(),
    madeHere: new Map(),
    liveCaptures: new Map(),
    atRisk: new Set(),
    liveAll: new Map(),
    raced: new Set(),
    running: [],
  };
  try {
    await new SignIn(A).run(m, r);
    await fc.asyncModelRun(() => ({ model: m, real: r }), cmds);
    await drain(m, r);
  } finally {
    closeStore(r);
    // Let anything still held go (into a store that's gone) and stop every store.
    while (s.count() > 0) await s.waitNext(1);
    await wipeSyncCopies({ keepWaiting: false });
    setStoreOptionsForTests({});
  }
}

const options = { seed: SEED, endOnFailure: true, includeErrorInReport: true };

describe("sync outbox: model-based property (HV-17)", () => {
  beforeEach(() => {
    live.listeners.clear();
  });

  it("never loses, reorders or wipes a waiting write, and shows fresh fields", async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.commands(commandArbs, { maxCommands: 30 }), runScenario),
      { ...options, numRuns: RUNS },
    );
  }, 110_000);

  // The #509 race, every way it can land: a check-off waits offline, the
  // network comes back and the flush sends it, and the person changes it
  // again before that answer is in.
  it("a check-off made while an older one is on its way never lands first", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.constantFrom("done" as const, "todo" as const),
        (s, first) =>
          runScenario(s, [
            new GoOffline(),
            new CheckOff(0, first),
            new GoOnline(),
            new CheckOff(0, first === "done" ? "todo" : "done"),
            new Deliver(),
            new CheckOff(0, first),
            new Deliver(),
          ]),
      ),
      { ...options, numRuns: 40 },
    );
  }, 60_000);

  // Offline: several check-offs of one task, and a capture with its own, go
  // out in the order they were made once the network is back.
  it("what waited offline goes out in the order it was made", async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), (s) =>
        runScenario(s, [
          new GoOffline(),
          new CheckOff(0, "done"),
          new Capture(),
          new CheckOff(0, "todo"),
          new CheckOff(3, "done"),
          new CheckOff(0, "done"),
          new GoOnline(),
          new Deliver(),
          new Deliver(),
        ]),
      ),
      { ...options, numRuns: 30 },
    );
  }, 60_000);

  // The network drops while writes are on their way: a queued one the flush
  // is sending and a live one both come back to the outbox, in order.
  it("a write the network drops on the way waits and goes again", async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), (s) =>
        runScenario(s, [
          new GoOffline(),
          new CheckOff(0, "done"),
          new GoOnline(),
          new CheckOff(1, "done"),
          new GoOffline(),
          new Deliver(),
          new Deliver(),
          new GoOnline(),
          new Deliver(),
        ]),
      ),
      { ...options, numRuns: 30 },
    );
  }, 60_000);
});

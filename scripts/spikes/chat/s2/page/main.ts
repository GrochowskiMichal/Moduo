// The spike page: served at http://spike.local/ by Playwright's router, so
// IndexedDB has a real origin. `?mode=cold` runs the cold open as the page's
// first act (the timing starts with this module); everything else is called
// by the driver through `window.spike`.

import { ChatStoreSketch, type SyncIdsAnswer } from "./chat-store";
import { DeviceCopy, type Layout } from "./device-copy";
import { type ChatRow, makeRows } from "./fixture";

const t0 = performance.now();
const params = new URLSearchParams(location.search);

type Win = Window & { spike: typeof api; __result?: unknown; __held?: unknown };
const win = window as unknown as Win;

/** Resolves after the frame that shows the current DOM was produced. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });
  });
}

function render(rows: readonly ChatRow[]): void {
  const list = document.getElementById("stream") as HTMLElement;
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const head = document.createElement("div");
    head.className = "head";
    head.textContent = `${(r.authorId ?? "?").slice(0, 2).toUpperCase()} · ${r.createdAt.slice(11, 16)}`;
    const body = document.createElement("div");
    body.textContent = r.body;
    row.append(head, body);
    frag.append(row);
  }
  list.replaceChildren(frag);
}

/** FCP: the first frame with text, i.e. the rows (the page has none before). */
function firstContentfulPaint(): Promise<number | null> {
  return new Promise((resolve) => {
    const seen = performance.getEntriesByName("first-contentful-paint")[0];
    if (seen) return resolve(seen.startTime);
    const po = new PerformanceObserver((list) => {
      const e = list.getEntriesByName("first-contentful-paint")[0];
      if (e) {
        po.disconnect();
        resolve(e.startTime);
      }
    });
    po.observe({ type: "paint", buffered: true });
    setTimeout(() => resolve(null), 2000);
  });
}

/** The longest gap in a MessageChannel ping loop while `work` runs (main-thread blocking). */
async function maxGapWhile(work: Promise<unknown>): Promise<number> {
  let last = performance.now();
  let max = 0;
  let running = true;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
    if (running) ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
  await work;
  running = false;
  return max;
}

const copies = new Map<string, DeviceCopy>();
async function copyOf(db: string, layout: Layout): Promise<DeviceCopy> {
  const key = `${db}/${layout}`;
  let c = copies.get(key);
  if (!c) {
    c = await DeviceCopy.open(db, layout);
    copies.set(key, c);
  }
  return c;
}

type Conv = { id: string; count: number; seed: number };

const api = {
  /** Fill a device copy, `batch` rows per transaction. */
  async seed(o: {
    db: string;
    layout: Layout;
    ws: string;
    convs: Conv[];
    batch: number;
    startAt: number;
  }) {
    // A retried seed starts over.
    await new Promise<void>((resolve) => {
      const d = indexedDB.deleteDatabase(o.db);
      d.onsuccess = d.onerror = d.onblocked = () => resolve();
    });
    const copy = await copyOf(o.db, o.layout);
    const t = performance.now();
    const sync: number[] = [];
    for (const c of o.convs) {
      const rows = makeRows({
        workspaceId: o.ws,
        channelId: c.id,
        count: c.count,
        startAt: o.startAt,
        seed: c.seed,
      });
      for (let i = 0; i < rows.length; i += o.batch) {
        const w = copy.put(rows.slice(i, i + o.batch));
        sync.push(w.syncMs);
        await w.done;
      }
    }
    return { ms: performance.now() - t, batches: sync.length, total: await copy.count() };
  },

  /** The cold open: device → newest n → DOM → painted. */
  async coldOpen(o: {
    db: string;
    layout: Layout;
    ws: string;
    conv: string;
    n: number;
    method: "cursor" | "advance";
  }) {
    const tStart = performance.now();
    const copy = await DeviceCopy.open(o.db, o.layout);
    const tOpen = performance.now();
    const meta = await copy.getMeta(`p:${o.ws}`);
    const tMeta = performance.now();
    const rows = await copy.newest(o.ws, o.conv, o.n, o.method);
    const tRead = performance.now();
    render(rows);
    const tRender = performance.now();
    await afterPaint();
    const tPaint = performance.now();
    const fcp = await firstContentfulPaint();
    copy.db.close();
    return {
      rows: rows.length,
      newestFirst: rows.at(-1)?.at === undefined ? null : rows.at(-1)?.at,
      hadMeta: meta !== null,
      moduleStart: t0,
      openMs: tOpen - tStart,
      metaMs: tMeta - tOpen,
      readMs: tRead - tMeta,
      renderMs: tRender - tRead,
      paintMs: tPaint - tRender,
      /** Script start → painted (what the store controls). */
      totalMs: tPaint - t0,
      /** Navigation start → the rows' first paint (FCP). */
      navToFcpMs: fcp,
      navToPaintedMs: tPaint,
    };
  },

  /** Tasks' pattern: the whole workspace as one record (a SyncCache write and read). */
  async wholeRecordWrite(o: {
    db: string;
    ws: string;
    conv: string;
    count: number;
    startAt: number;
  }) {
    const rows = makeRows({
      workspaceId: o.ws,
      channelId: o.conv,
      count: o.count,
      startAt: o.startAt,
      seed: 9,
    });
    const db = await openWhole(o.db);
    const t = performance.now();
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put(
      { v: 1, tables: { messages: { rows, cursor: null } } },
      `p:${o.ws}`,
    );
    const syncMs = performance.now() - t;
    const gap = await maxGapWhile(
      new Promise<void>((r) => {
        tx.oncomplete = () => r();
      }),
    );
    db.close();
    return { syncMs, wallMs: performance.now() - t, maxGapMs: gap };
  },

  async wholeRecordColdOpen(o: { db: string; ws: string; n: number }) {
    const tStart = performance.now();
    const db = await openWhole(o.db);
    const tx = db.transaction("workspaces", "readonly");
    const rec = await new Promise<{ tables: { messages: { rows: ChatRow[] } } }>((resolve) => {
      const g = tx.objectStore("workspaces").get(`p:${o.ws}`);
      g.onsuccess = () => resolve(g.result);
    });
    const tRead = performance.now();
    const rows = rec.tables.messages.rows.slice(-o.n);
    render(rows);
    await afterPaint();
    const tPaint = performance.now();
    db.close();
    return {
      rows: rows.length,
      readMs: tRead - tStart,
      totalMs: tPaint - t0,
      navToPaintedMs: tPaint,
    };
  },

  /**
   * 500 new rows in one transaction, `runs` times. syncMs is the main
   * thread's share (the put loop); maxGapMs the longest the thread was
   * blocked while the transaction committed.
   */
  async write500(o: {
    db: string;
    layout: Layout;
    ws: string;
    conv: string;
    runs: number;
    cap?: number;
    startAt: number;
  }) {
    const copy = await copyOf(o.db, o.layout);
    const out: { syncMs: number; wallMs: number; maxGapMs: number }[] = [];
    for (let i = 0; i < o.runs; i += 1) {
      const rows = makeRows({
        workspaceId: o.ws,
        channelId: o.conv,
        count: 500,
        startAt: o.startAt + i * 500 * 97_000_000,
        seed: seedOf(o.conv, i),
      });
      const t = performance.now();
      const w = copy.put(rows, o.cap);
      const gap = await maxGapWhile(w.done);
      out.push({ syncMs: w.syncMs, wallMs: performance.now() - t, maxGapMs: gap });
    }
    return { runs: out, count: await copy.count(o.ws, o.conv) };
  },

  /** The same 500 rows handed to a worker that writes them (main thread: postMessage). */
  async write500Worker(o: {
    db: string;
    layout: Layout;
    ws: string;
    conv: string;
    runs: number;
    startAt: number;
  }) {
    const worker = new Worker("/worker.js", { type: "module" });
    await call(worker, { op: "open", db: o.db, layout: o.layout });
    const out: { syncMs: number; wallMs: number; maxGapMs: number; workerMs: number }[] = [];
    for (let i = 0; i < o.runs; i += 1) {
      const rows = makeRows({
        workspaceId: o.ws,
        channelId: o.conv,
        count: 500,
        startAt: o.startAt + i * 500 * 97_000_000,
        seed: seedOf(o.conv, 100 + i),
      });
      const t = performance.now();
      const p = call(worker, { op: "put", rows });
      const syncMs = performance.now() - t;
      let workerMs = 0;
      const gap = await maxGapWhile(
        p.then((r) => {
          workerMs = (r as { ms: number }).ms;
        }),
      );
      out.push({ syncMs, wallMs: performance.now() - t, maxGapMs: gap, workerMs });
    }
    worker.terminate();
    return { runs: out };
  },

  /** Load the newest n of a conversation into the memory store and keep it. */
  async heapFillFromDevice(o: { db: string; layout: Layout; ws: string; conv: string; n: number }) {
    const copy = await copyOf(o.db, o.layout);
    const store = new ChatStoreSketch(o.ws, "p", copy);
    const rows = await copy.newest(o.ws, o.conv, o.n, "advance");
    store.load(o.conv, rows);
    win.__held = store;
    return { held: store.byId.size };
  },

  /** n rows made in memory with a fixed body length (the worst case: 8,000 characters). */
  heapFillMade(o: { ws: string; conv: string; n: number; bodyChars: number }) {
    const store = new ChatStoreSketch(o.ws, "p", null);
    store.load(
      o.conv,
      makeRows({
        workspaceId: o.ws,
        channelId: o.conv,
        count: o.n,
        startAt: 1.7e15,
        bodyChars: o.bodyChars,
      }),
    );
    win.__held = store;
    return { held: store.byId.size };
  },

  release() {
    win.__held = undefined;
    for (const c of copies.values()) c.db.close();
    copies.clear();
  },

  async estimate() {
    return navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  },

  // ── Bar 5: losing access ─────────────────────────────────────────────────

  async accessSetup(o: {
    db: string;
    ws: string;
    person: string;
    byConv: Record<string, ChatRow[]>;
  }) {
    const copy = await copyOf(o.db, "compound");
    const store = new ChatStoreSketch(o.ws, o.person, copy);
    for (const [conv, rows] of Object.entries(o.byConv)) {
      await copy.put(rows, 500).done;
      await store.open(conv, 1500);
      await store.touch(conv);
    }
    win.__held = store;
    return api.accessState(o.ws, Object.keys(o.byConv));
  },

  async accessReconcile(answer: SyncIdsAnswer) {
    const store = win.__held as ChatStoreSketch;
    return store.reconcile(answer);
  },

  async accessApply(rows: ChatRow[]) {
    const store = win.__held as ChatStoreSketch;
    return store.apply(rows);
  },

  async accessState(ws: string, convs: string[]) {
    const store = win.__held as ChatStoreSketch;
    const copy = store.copy as DeviceCopy;
    const meta = await copy.getMeta(store.metaKey);
    const out: Record<string, { memory: number; device: number; inMeta: boolean }> = {};
    for (const conv of convs) {
      out[conv] = {
        memory: store.windows.get(conv)?.rows.length ?? 0,
        device: await copy.count(ws, conv),
        inMeta: !!meta?.conversations[conv],
      };
    }
    return { conversations: out, accessSince: meta?.accessSince ?? null };
  },

  async accessHas(ids: string[]) {
    const store = win.__held as ChatStoreSketch;
    const copy = store.copy as DeviceCopy;
    const out: Record<string, { memory: boolean; device: boolean }> = {};
    for (const id of ids) out[id] = { memory: store.byId.has(id), device: await copy.has(id) };
    return out;
  },
};

/** A distinct fixture seed per conversation and run: ids must never repeat (byId is unique). */
function seedOf(conv: string, i: number): number {
  let h = 2166136261;
  for (const ch of conv) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 8) % 1_000_000) * 1000 + 100_000 + i;
}

function openWhole(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspaces");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let callId = 0;
function call(worker: Worker, msg: Record<string, unknown>): Promise<unknown> {
  const id = ++callId;
  return new Promise((resolve) => {
    const on = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      worker.removeEventListener("message", on);
      resolve(e.data);
    };
    worker.addEventListener("message", on);
    worker.postMessage({ ...msg, id });
  });
}

export type SpikeApi = typeof api;
win.spike = api;

if (params.get("mode") === "cold") {
  const o = {
    db: params.get("db") as string,
    layout: (params.get("layout") ?? "compound") as Layout,
    ws: params.get("ws") as string,
    conv: params.get("conv") as string,
    n: Number(params.get("n") ?? 50),
    method: (params.get("method") ?? "advance") as "cursor" | "advance",
  };
  // `preopen`: another database of the origin is opened and read first, as
  // Tasks' moduo-sync is at boot; the chat database's open is then timed alone.
  const preopen = params.get("preopen");
  const before = preopen
    ? openWhole(preopen).then(
        (db) =>
          new Promise<number>((resolve) => {
            const g = db
              .transaction("workspaces", "readonly")
              .objectStore("workspaces")
              .get(`p:${o.ws}`);
            g.onsuccess = g.onerror = () => resolve(performance.now() - t0);
          }),
      )
    : Promise.resolve(null);
  const run = before.then((preopenMs) =>
    (params.get("whole")
      ? api.wholeRecordColdOpen({ db: o.db, ws: o.ws, n: o.n })
      : api.coldOpen(o)
    ).then((r) => ({ ...r, preopenMs })),
  );
  run.then(
    (r) => {
      win.__result = r;
    },
    (e) => {
      win.__result = { error: String(e) };
    },
  );
}

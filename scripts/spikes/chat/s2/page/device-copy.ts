// The chat store's device copy, as spike 2 proved it: raw IndexedDB (no
// library), its own database, one record per message.
//
// Layouts measured:
//   compound  the key is [workspaceId, channelId, at, id] (`at` = created_at in
//             microseconds): a conversation is one key range, newest first by
//             walking it backwards; dropping a conversation or evicting its
//             oldest rows is one range delete. A `byId` index finds a row by
//             id (echo skip, moved ids). The chosen layout.
//   byId      the key is the id, a `byConv` index carries the order. Range
//             deletes become a cursor walk deleting row by row.
// Plus `meta`: one record per person and workspace (conversations with their
// last-opened time, the delta cursor, the access check's stamp, the outbox).

import type { ChatRow } from "./fixture";

export type Layout = "compound" | "byId";

export type ConversationMeta = { openedAt: number; newestAt: number };

export type MetaRecord = {
  key: string;
  conversations: Record<string, ConversationMeta>;
  cursor: string | null;
  accessSince: string | null;
  outbox: unknown[];
};

const MESSAGES = "messages";
const META = "meta";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(`${tx.error?.name}: ${tx.error?.message}`));
    tx.onabort = () => reject(new Error(`aborted: ${tx.error?.name} ${tx.error?.message ?? ""}`));
  });
}

export class DeviceCopy {
  private constructor(
    readonly db: IDBDatabase,
    readonly layout: Layout,
  ) {}

  static open(name: string, layout: Layout): Promise<DeviceCopy> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (layout === "compound") {
          const s = db.createObjectStore(MESSAGES, {
            keyPath: ["workspaceId", "channelId", "at", "id"],
          });
          s.createIndex("byId", "id", { unique: true });
        } else {
          const s = db.createObjectStore(MESSAGES, { keyPath: "id" });
          s.createIndex("byConv", ["workspaceId", "channelId", "at", "id"]);
        }
        db.createObjectStore(META, { keyPath: "key" });
      };
      r.onsuccess = () => resolve(new DeviceCopy(r.result, layout));
      r.onerror = () => reject(r.error);
    });
  }

  /** Every key of one conversation, oldest to newest. */
  static range(ws: string, conv: string): IDBKeyRange {
    return IDBKeyRange.bound([ws, conv], [ws, conv, []]);
  }

  private source(tx: IDBTransaction): IDBObjectStore | IDBIndex {
    const s = tx.objectStore(MESSAGES);
    return this.layout === "compound" ? s : s.index("byConv");
  }

  /**
   * The newest `n` of a conversation, oldest first.
   *   cursor   walk the range backwards, n steps (n request events)
   *   advance  a key cursor jumps n-1 back, then one getAll over the rest (2 requests)
   */
  async newest(
    ws: string,
    conv: string,
    n: number,
    method: "cursor" | "advance",
  ): Promise<ChatRow[]> {
    const tx = this.db.transaction(MESSAGES, "readonly");
    const src = this.source(tx);
    const range = DeviceCopy.range(ws, conv);
    if (method === "cursor") {
      const rows: ChatRow[] = [];
      await new Promise<void>((resolve, reject) => {
        const c = src.openCursor(range, "prev");
        c.onerror = () => reject(c.error);
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur || rows.length >= n) return resolve();
          rows.push(cur.value as ChatRow);
          cur.continue();
        };
      });
      return rows.reverse();
    }
    const lower = await new Promise<IDBValidKey | null>((resolve, reject) => {
      const c = src.openKeyCursor(range, "prev");
      let moved = false;
      c.onerror = () => reject(c.error);
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return resolve(null);
        if (!moved && n > 1) {
          moved = true;
          cur.advance(n - 1);
          return;
        }
        resolve(cur.key);
      };
    });
    const from = lower ?? [ws, conv];
    return (await req(src.getAll(IDBKeyRange.bound(from, [ws, conv, []])))) as ChatRow[];
  }

  /**
   * Write rows in one transaction; with `cap`, each touched conversation keeps
   * only its newest `cap` rows (the eviction rides the same transaction).
   * `syncMs` is the main thread's share: the put calls (each structured-clones
   * its row) and the eviction's request setup. The commit runs off the thread.
   */
  put(rows: readonly ChatRow[], cap?: number): { syncMs: number; done: Promise<void> } {
    const t0 = performance.now();
    const tx = this.db.transaction(MESSAGES, "readwrite");
    const store = tx.objectStore(MESSAGES);
    const touched = new Set<string>();
    for (const row of rows) {
      touched.add(`${row.workspaceId}\u0000${row.channelId}`);
      if (this.layout === "compound" && row.movedAt) {
        // A moved row's key changed with its conversation: drop the old key
        // first, or the unique byId index refuses the put and the whole
        // transaction aborts. Only a move changes channel_id, so only moved
        // rows pay for the lookup.
        const key = [row.workspaceId, row.channelId, row.at, row.id];
        const old = store.index("byId").getKey(row.id);
        old.onsuccess = () => {
          if (old.result !== undefined && indexedDB.cmp(old.result, key) !== 0) {
            store.delete(old.result);
          }
          store.put(row);
        };
        continue;
      }
      store.put(row);
    }
    if (cap !== undefined) {
      for (const t of touched) {
        const [ws, conv] = t.split("\u0000");
        this.evict(tx, ws, conv, cap);
      }
    }
    const syncMs = performance.now() - t0;
    return { syncMs, done: done(tx) };
  }

  /** Delete everything older than the newest `cap` rows of one conversation. */
  private evict(tx: IDBTransaction, ws: string, conv: string, cap: number): void {
    const range = DeviceCopy.range(ws, conv);
    const store = tx.objectStore(MESSAGES);
    if (this.layout === "compound") {
      const c = store.openKeyCursor(range, "prev");
      let moved = false;
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        if (!moved) {
          moved = true;
          cur.advance(cap);
          return;
        }
        store.delete(IDBKeyRange.bound([ws, conv], cur.primaryKey));
      };
      return;
    }
    const c = store.index("byConv").openCursor(range, "prev");
    let seen = 0;
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return;
      seen += 1;
      if (seen > cap) cur.delete();
      cur.continue();
    };
  }

  /** Drop one conversation from the device (lost access, eviction by LRU). */
  async dropConversation(ws: string, conv: string): Promise<void> {
    const tx = this.db.transaction([MESSAGES, META], "readwrite");
    const store = tx.objectStore(MESSAGES);
    const range = DeviceCopy.range(ws, conv);
    if (this.layout === "compound") {
      store.delete(range);
    } else {
      const c = store.index("byConv").openCursor(range);
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        cur.delete();
        cur.continue();
      };
    }
    await done(tx);
  }

  /** Drop rows by id wherever they sit (moved away, purged). */
  async dropIds(ids: readonly string[]): Promise<number> {
    const tx = this.db.transaction(MESSAGES, "readwrite");
    const store = tx.objectStore(MESSAGES);
    let dropped = 0;
    for (const id of ids) {
      if (this.layout === "byId") {
        store.delete(id);
        dropped += 1;
        continue;
      }
      const k = store.index("byId").getKey(id);
      k.onsuccess = () => {
        if (k.result === undefined) return;
        store.delete(k.result);
        dropped += 1;
      };
    }
    await done(tx);
    return dropped;
  }

  async count(ws?: string, conv?: string): Promise<number> {
    const tx = this.db.transaction(MESSAGES, "readonly");
    const src = this.source(tx);
    if (ws && conv) return req(src.count(DeviceCopy.range(ws, conv)));
    return req(tx.objectStore(MESSAGES).count());
  }

  async idsOf(ws: string, conv: string): Promise<string[]> {
    const tx = this.db.transaction(MESSAGES, "readonly");
    const rows = (await req(this.source(tx).getAll(DeviceCopy.range(ws, conv)))) as ChatRow[];
    return rows.map((r) => r.id);
  }

  async has(id: string): Promise<boolean> {
    const tx = this.db.transaction(MESSAGES, "readonly");
    const store = tx.objectStore(MESSAGES);
    if (this.layout === "byId") return (await req(store.getKey(id))) !== undefined;
    return (await req(store.index("byId").getKey(id))) !== undefined;
  }

  async getMeta(key: string): Promise<MetaRecord | null> {
    const tx = this.db.transaction(META, "readonly");
    return ((await req(tx.objectStore(META).get(key))) as MetaRecord | undefined) ?? null;
  }

  async putMeta(meta: MetaRecord): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put(meta);
    await done(tx);
  }
}

// Chat's device copy (CV-3, spike 2's shape): IndexedDB `moduo-chat`, one row
// per message and one `meta` record per person and workspace.
//
//   messages  key [owner, conversation, at, id]  (owner = `<person>:<workspace>`,
//             at = the created stamp as a fixed-width sortable string), with a
//             unique `byId` index on [owner, id]: a moved row's old key is
//             deleted before its new one is put, or the whole transaction aborts.
//   meta      key owner: the conversations the copy holds, the delta cursor,
//             the access check's mark, the outbox, drafts, and the sidebar
//             (conversations, memberships, people, counts) so a cold open paints.
//
// Rows are keyed by person as well as workspace (Tasks' copy does the same):
// one browser never shows a person another's rows. On sign-out, and when
// someone else signs in, a person's copy is cut down to its outbox
// (`keepOnlyWaiting`): the rows, drafts and sidebar go, the waiting sends stay
// under their key until that person signs in here again. Only server rows are kept
// (an unsent message lives in the outbox, in meta); the newest `keep` per
// conversation, evicted in the same transaction that writes them, at most
// 200 rows a transaction. Every failure reads as "no copy": the server keeps
// the truth. Where IndexedDB is missing (tests, a locked-down browser) the
// memory copy stands in, and the store opens from the server.

import { idbDone, idbOpener, idbRequest } from "../../../lib/sync/kernel/idb";
import type {
  ChatChannel,
  ChatKey,
  ChatMember,
  ChatMessage,
  ChatPerson,
  ChatUnread,
} from "../model";
import { compareRows, sortableAt } from "./keys";

/** Bumped when the stored shape changes: an older copy's rows go (its outbox is kept). */
// 2: rows carry decision_at / decision_by (CV-14).
export const CHAT_COPY_VERSION = 2;

/** A message sent while offline or not yet confirmed (CH64). */
export type ChatOutboxEntry = {
  id: string;
  channelId: string;
  body: string;
  replyToId: string | null;
  /** When it was written (the row's time until the server stamps it). */
  createdAt: string;
  /** The server refused it: "Not sent · Retry" until retried or discarded. */
  failed?: string;
  /** Deleted while it was being sent: hidden, and deleted on the server once it lands there. */
  deleted?: boolean;
  /** Edited after a send of it started: these words show, go with any resend, and
   *  are edited onto the server row once it lands with other words. */
  edited?: string;
  /** CV-9: how many files were uploading under its id when it was sent: it waits for them. */
  files?: number;
  /** CV-9: a message of files only whose files all stopped: Retry can't send it. */
  dead?: boolean;
};

export type ChatHeldConversation = { openedAt: number; edge?: ChatKey | null };

export type ChatMeta = {
  v: number;
  savedAt: number;
  /** Every conversation the copy holds rows for: the access check covers exactly these. */
  /** `edge`: the newest message of the run that reaches the newest page (a newer
   *  page that starts after it leaves a gap). Rows that land while the
   *  conversation isn't open don't move it. */
  conversations: Record<string, ChatHeldConversation>;
  /** The newest server `updated_at` a delta has read. */
  cursor: string | null;
  /** When the access check last ran (the server's clock). */
  accessSince: string | null;
  outbox: ChatOutboxEntry[];
  /** `<conversation>:<chain root or "">` → the unsent text (#28). */
  drafts: Record<string, string>;
  channels: ChatChannel[];
  mine: ChatMember[];
  people: ChatPerson[];
  unread: ChatUnread[];
};

export function emptyMeta(): ChatMeta {
  return {
    v: CHAT_COPY_VERSION,
    savedAt: 0,
    conversations: {},
    cursor: null,
    accessSince: null,
    outbox: [],
    drafts: {},
    channels: [],
    mine: [],
    people: [],
    unread: [],
  };
}

// The owner key is every sync copy's record key (`<person>:<workspace>`).
export { isOwnedBy as isOwnerOf, ownerKey } from "../../../lib/sync/kernel/registry";

/** Waiting sends, stored ones first, each id once (a sign-out keeps them). */
function mergeWaiting(
  stored: readonly ChatOutboxEntry[] | undefined,
  inMemory: readonly ChatOutboxEntry[],
  handled: ReadonlySet<string> = new Set(),
): ChatOutboxEntry[] {
  const out: ChatOutboxEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...(Array.isArray(stored) ? stored : []), ...inMemory]) {
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) continue;
    seen.add(entry.id);
    // Sent or discarded by a store whose last write may not have landed.
    if (handled.has(entry.id)) continue;
    out.push(entry);
  }
  return out;
}

/**
 * The meta a copy cut down to its outbox keeps: an older version stamp makes
 * the next store that opens it take the outbox and read everything else again.
 */
function waitingOnlyMeta(outbox: ChatOutboxEntry[]): ChatMeta {
  return { ...emptyMeta(), v: 0, savedAt: Date.now(), outbox };
}

export interface ChatDeviceCopy {
  readMeta(owner: string): Promise<ChatMeta | null>;
  /** Read and write the meta record in one step (two tabs can't drop each other's outbox). */
  updateMeta(owner: string, next: (stored: ChatMeta | null) => ChatMeta): Promise<void>;
  /** A conversation's newest rows, oldest first. */
  newest(owner: string, channelId: string, limit: number): Promise<ChatMessage[]>;
  /** Upsert rows by id; keep only the newest `keep` of each conversation touched.
   *  `stop`: checked before each transaction (a sign-out mid-write writes no more). */
  put(
    owner: string,
    rows: readonly ChatMessage[],
    keep: number,
    stop?: () => boolean,
  ): Promise<void>;
  removeIds(owner: string, ids: readonly string[]): Promise<void>;
  removeConversations(owner: string, channelIds: readonly string[]): Promise<void>;
  /** Every owner the copy holds anything for (meta or rows). */
  owners(): Promise<string[]>;
  /**
   * Cut one owner's copy down to its outbox (what it stored plus `inMemory`):
   * its rows, drafts and sidebar go. Answers how many sends stayed.
   */
  keepOnlyWaiting(
    owner: string,
    inMemory: readonly ChatOutboxEntry[],
    handled?: ReadonlySet<string>,
  ): Promise<number>;
  /** Everything goes (account deletion). */
  clear(): Promise<void>;
  /** The copies whose owner matches go (another person signed in, a workspace left). */
  deleteWhere(match: (owner: string) => boolean): Promise<void>;
}

/** Strip what only this tab knows: the copy holds server rows. */
function serverRow(row: ChatMessage): ChatMessage {
  const { sendState: _s, sendError: _e, sendRetry: _r, pending: _p, failed: _f, ...rest } = row;
  return rest;
}

const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);

/** The copy as a Map, for tests and where there is no IndexedDB. */
export function memoryChatCopy(): ChatDeviceCopy & {
  rows: Map<string, Map<string, ChatMessage>>;
  metas: Map<string, ChatMeta>;
  transactions: number[];
} {
  const rows = new Map<string, Map<string, ChatMessage>>();
  const metas = new Map<string, ChatMeta>();
  const transactions: number[] = [];
  const of = (owner: string) => {
    let m = rows.get(owner);
    if (!m) {
      m = new Map();
      rows.set(owner, m);
    }
    return m;
  };
  return {
    rows,
    metas,
    transactions,
    async readMeta(owner) {
      const hit = metas.get(owner);
      return hit ? clone(hit) : null;
    },
    async updateMeta(owner, next) {
      const stored = metas.get(owner);
      metas.set(owner, clone(next(stored ? clone(stored) : null)));
    },
    async newest(owner, channelId, limit) {
      const list = [...of(owner).values()].filter((r) => r.channelId === channelId);
      list.sort(compareRows);
      return clone(list.slice(Math.max(0, list.length - limit)));
    },
    async put(owner, list, keep, stop) {
      const held = of(owner);
      for (let i = 0; i < list.length; i += CHUNK) {
        if (stop?.()) return;
        const chunk = list.slice(i, i + CHUNK);
        transactions.push(chunk.length);
        const touched = new Set<string>();
        for (const row of chunk) {
          held.set(row.id, clone(serverRow(row)));
          touched.add(row.channelId);
        }
        for (const channelId of touched) {
          const inConv = [...held.values()].filter((r) => r.channelId === channelId);
          if (inConv.length <= keep) continue;
          inConv.sort(compareRows);
          for (const r of inConv.slice(0, inConv.length - keep)) held.delete(r.id);
        }
      }
    },
    async removeIds(owner, ids) {
      const held = of(owner);
      for (const id of ids) held.delete(id);
    },
    async removeConversations(owner, channelIds) {
      const drop = new Set(channelIds);
      const held = of(owner);
      for (const [id, r] of held) if (drop.has(r.channelId)) held.delete(id);
    },
    async owners() {
      return [
        ...new Set([...metas.keys(), ...[...rows].filter(([, m]) => m.size > 0).map(([o]) => o)]),
      ];
    },
    async keepOnlyWaiting(owner, inMemory, handled) {
      const outbox = mergeWaiting(metas.get(owner)?.outbox, inMemory, handled);
      rows.delete(owner);
      metas.set(owner, clone(waitingOnlyMeta(outbox)));
      return outbox.length;
    },
    async clear() {
      rows.clear();
      metas.clear();
    },
    async deleteWhere(match) {
      for (const owner of [...rows.keys()]) if (match(owner)) rows.delete(owner);
      for (const owner of [...metas.keys()]) if (match(owner)) metas.delete(owner);
    },
  };
}

/** At most this many rows in one IndexedDB transaction (spike 2: ≤ 8 ms of main thread). */
const CHUNK = 200;
const DB_NAME = "moduo-chat";
const MESSAGES = "messages";
const META = "meta";
/** Above every sortable stamp: a conversation's whole key range. */
const TOP = "￿";

type Stored = { k: [string, string, string, string]; i: [string, string]; row: ChatMessage };

const done = (tx: IDBTransaction) => idbDone(tx, "The chat copy's transaction");
const request = idbRequest;

const conversationRange = (owner: string, channelId: string) =>
  IDBKeyRange.bound([owner, channelId], [owner, channelId, TOP]);

/** The copy in IndexedDB. */
export function idbChatCopy(factory: IDBFactory): ChatDeviceCopy {
  // A database left without one of its stores is reopened one version up (kernel).
  const db = idbOpener(factory, {
    name: DB_NAME,
    stores: {
      [MESSAGES]: (d) =>
        d.createObjectStore(MESSAGES, { keyPath: "k" }).createIndex("byId", "i", { unique: true }),
      [META]: (d) => d.createObjectStore(META),
    },
  });
  const open = () => db.open();

  /** Evict all but the newest `keep` of one conversation, inside `store`'s transaction. */
  const evict = (store: IDBObjectStore, owner: string, channelId: string, keep: number) => {
    let seen = 0;
    const cursor = store.openKeyCursor(conversationRange(owner, channelId), "prev");
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      seen += 1;
      if (seen > keep) store.delete(c.primaryKey);
      c.continue();
    };
  };

  return {
    async readMeta(owner) {
      try {
        const d = await open();
        const value = await request(d.transaction(META).objectStore(META).get(owner));
        return value && typeof value === "object" ? (value as ChatMeta) : null;
      } catch {
        return null;
      }
    },
    async updateMeta(owner, next) {
      try {
        const d = await open();
        const tx = d.transaction(META, "readwrite");
        const store = tx.objectStore(META);
        const get = store.get(owner);
        get.onsuccess = () => {
          store.put(next((get.result as ChatMeta | undefined) ?? null), owner);
        };
        await done(tx);
      } catch {
        // A full or blocked disk: the copy is a convenience.
      }
    },
    async newest(owner, channelId, limit) {
      try {
        const d = await open();
        const store = d.transaction(MESSAGES).objectStore(MESSAGES);
        const out: ChatMessage[] = [];
        await new Promise<void>((resolve, reject) => {
          const cursor = store.openCursor(conversationRange(owner, channelId), "prev");
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c || out.length >= limit) return resolve();
            out.push((c.value as Stored).row);
            c.continue();
          };
          cursor.onerror = () => reject(cursor.error);
        });
        return out.reverse();
      } catch {
        return [];
      }
    },
    async put(owner, list, keep, stop) {
      try {
        const d = await open();
        for (let i = 0; i < list.length; i += CHUNK) {
          if (stop?.()) return;
          const chunk = list.slice(i, i + CHUNK);
          const tx = d.transaction(MESSAGES, "readwrite");
          const store = tx.objectStore(MESSAGES);
          const byId = store.index("byId");
          const touched = new Set<string>(chunk.map((r) => r.channelId));
          let left = chunk.length;
          for (const raw of chunk) {
            const row = serverRow(raw);
            const k: Stored["k"] = [owner, row.channelId, sortableAt(row.createdAt), row.id];
            // A row moved to another conversation keeps its id under a new key.
            const old = byId.getKey([owner, row.id]);
            old.onsuccess = () => {
              const prior = old.result as Stored["k"] | undefined;
              if (prior && (prior[1] !== k[1] || prior[2] !== k[2])) store.delete(prior);
              store.put({ k, i: [owner, row.id], row } satisfies Stored);
              left -= 1;
              // Callbacks run in request order: the last one places the
              // eviction after every put, so it sees this chunk's rows.
              if (left === 0) for (const c of touched) evict(store, owner, c, keep);
            };
          }
          await done(tx);
        }
      } catch {
        // The copy is a convenience.
      }
    },
    async removeIds(owner, ids) {
      try {
        const d = await open();
        const tx = d.transaction(MESSAGES, "readwrite");
        const store = tx.objectStore(MESSAGES);
        const byId = store.index("byId");
        for (const id of ids) {
          const key = byId.getKey([owner, id]);
          key.onsuccess = () => {
            if (key.result) store.delete(key.result);
          };
        }
        await done(tx);
      } catch {
        // Nothing to drop.
      }
    },
    async removeConversations(owner, channelIds) {
      try {
        const d = await open();
        const tx = d.transaction(MESSAGES, "readwrite");
        const store = tx.objectStore(MESSAGES);
        for (const channelId of channelIds) store.delete(conversationRange(owner, channelId));
        await done(tx);
      } catch {
        // Nothing to drop.
      }
    },
    async owners() {
      try {
        const d = await open();
        const tx = d.transaction([MESSAGES, META], "readonly");
        const finished = done(tx);
        const owners = new Set<string>();
        // Both requests go out in this turn: an older WebKit may commit a
        // transaction that waits on a promise between them.
        const metaKeys = tx.objectStore(META).getAllKeys();
        metaKeys.onsuccess = () => {
          for (const key of metaKeys.result) if (typeof key === "string") owners.add(key);
        };
        await new Promise<void>((resolve, reject) => {
          const cursor = tx.objectStore(MESSAGES).openKeyCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c) return resolve();
            const owner = (c.primaryKey as Stored["k"])[0];
            if (typeof owner !== "string") return c.continue();
            owners.add(owner);
            // On to the next owner's first row.
            c.continue([owner, TOP]);
          };
          cursor.onerror = () => reject(cursor.error);
        });
        await finished;
        return [...owners];
      } catch {
        return [];
      }
    },
    async keepOnlyWaiting(owner, inMemory, handled) {
      try {
        const d = await open();
        const tx = d.transaction([MESSAGES, META], "readwrite");
        const meta = tx.objectStore(META);
        let kept = 0;
        const get = meta.get(owner);
        get.onsuccess = () => {
          const outbox = mergeWaiting(
            (get.result as ChatMeta | undefined)?.outbox,
            inMemory,
            handled,
          );
          kept = outbox.length;
          meta.put(waitingOnlyMeta(outbox), owner);
        };
        tx.objectStore(MESSAGES).delete(IDBKeyRange.bound([owner], [owner, TOP]));
        await done(tx);
        return kept;
      } catch {
        // Couldn't cut it down: say nothing stayed, so the caller deletes it.
        return 0;
      }
    },
    async clear() {
      try {
        const d = await open();
        const tx = d.transaction([MESSAGES, META], "readwrite");
        tx.objectStore(MESSAGES).clear();
        tx.objectStore(META).clear();
        await done(tx);
      } catch {
        // Nothing to wipe.
      }
    },
    async deleteWhere(match) {
      try {
        const d = await open();
        const tx = d.transaction([MESSAGES, META], "readwrite");
        const meta = tx.objectStore(META);
        const keys = meta.getAllKeys();
        keys.onsuccess = () => {
          for (const key of keys.result) {
            if (typeof key !== "string" || match(key)) meta.delete(key);
          }
        };
        const cursor = tx.objectStore(MESSAGES).openKeyCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          const owner = (c.primaryKey as Stored["k"])[0];
          if (typeof owner !== "string" || match(owner))
            tx.objectStore(MESSAGES).delete(c.primaryKey);
          c.continue();
        };
        await done(tx);
      } catch {
        // Nothing to wipe.
      }
    },
  };
}

let shared: ChatDeviceCopy | null = null;
let override: ChatDeviceCopy | null = null;

/** The app's chat copy: IndexedDB where there is one, else a copy that lives as long as the page. */
export function chatDeviceCopy(): ChatDeviceCopy {
  if (override) return override;
  if (!shared) {
    shared = typeof indexedDB === "undefined" ? memoryChatCopy() : idbChatCopy(indexedDB);
  }
  return shared;
}

/** Tests: the copy every store gets. */
export function setChatDeviceCopyForTests(copy: ChatDeviceCopy | null): void {
  override = copy;
}

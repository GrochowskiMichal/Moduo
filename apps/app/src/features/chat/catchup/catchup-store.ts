// Catch up's list (specs/chat-v2.md §9, CV-11): your open items in this
// workspace as the server answers them (`chat_catchup_open`: showing now, in
// conversations you can still read), with the messages they name. One per
// chat store. It reads only while someone watches it (the Catch up view, and
// CV-22's widget through `useCatchup`); your Catch up rows moving on the
// server (Realtime, through the chat store) re-read it once a burst settles.
// Done, Undo and Later hide or bring back items at once, then the server's
// answer settles the list.

import { useEffect, useSyncExternalStore } from "react";
import type { ChatCatchupItem, ChatMessage, ChatRuntime } from "../model";
import type { ChatStore, ChatWriteResult } from "../store/store";

export type CatchupStatus = "idle" | "loading" | "ready" | "error";

export type CatchupSnapshot = {
  status: CatchupStatus;
  /** Open items showing now, newest first (`at`). */
  items: readonly ChatCatchupItem[];
  /** The messages items name, by id (what you can read of them). */
  messages: Readonly<Record<string, ChatMessage>>;
  error: string | null;
};

export const EMPTY_CATCHUP: CatchupSnapshot = {
  status: "idle",
  items: [],
  messages: {},
  error: null,
};

/** How long a burst of row changes settles before the list re-reads. */
export const CATCHUP_SETTLE_MS = 400;
/** The ops take up to 1,000 ids at a time. */
const OP_MAX = 1000;

const OFFLINE = "You're offline.";

function writeResult(error: { code: string | null; message: string } | null): ChatWriteResult {
  if (!error) return { ok: true };
  return { ok: false, offline: error.code === null, message: error.message };
}

export class CatchupStore {
  private readonly transport: ChatRuntime;
  readonly workspaceId: string;
  private readonly rowById: (id: string) => ChatMessage | undefined;
  private readonly settleMs: number;

  private status: CatchupStatus = "idle";
  private error: string | null = null;
  private items: ChatCatchupItem[] = [];
  private messages: Record<string, ChatMessage> = {};
  /** Hidden at once (Done, Later) until the server's list agrees. */
  private hidden = new Set<string>();

  private watchers = 0;
  private stale = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;
  private again = false;
  private listeners = new Set<() => void>();
  private snap: CatchupSnapshot = EMPTY_CATCHUP;

  constructor(
    transport: ChatRuntime,
    workspaceId: string,
    opts: { rowById?: (id: string) => ChatMessage | undefined; settleMs?: number } = {},
  ) {
    this.transport = transport;
    this.workspaceId = workspaceId;
    this.rowById = opts.rowById ?? (() => undefined);
    this.settleMs = opts.settleMs ?? CATCHUP_SETTLE_MS;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): CatchupSnapshot => this.snap;

  private notify(): void {
    const items = this.hidden.size ? this.items.filter((i) => !this.hidden.has(i.id)) : this.items;
    this.snap = { status: this.status, items, messages: this.messages, error: this.error };
    for (const fn of this.listeners) fn();
  }

  /** Read while watched: returns the release. */
  watch(): () => void {
    this.watchers += 1;
    if (this.stale || this.status === "idle") void this.load();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers -= 1;
    };
  }

  /** Your rows moved on the server: re-read once the burst settles (or later, when watched). */
  changed(): void {
    this.stale = true;
    if (this.watchers === 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load();
    }, this.settleMs);
  }

  /**
   * A read that starts after this call: one already in flight may have
   * started before a write it must see, so it reads once more after it.
   */
  private async loadFresh(): Promise<void> {
    if (this.loading) {
      this.again = true;
      await this.loading;
      // The read `again` asked for started as the old one settled.
      if (this.loading) {
        await this.loading;
        return;
      }
    }
    await this.load();
  }

  /** Read the list (one read at a time; a change meanwhile reads again). */
  load(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = this.read().finally(() => {
      this.loading = null;
      if (this.again) {
        this.again = false;
        void this.load();
      }
    });
    return this.loading;
  }

  private async read(): Promise<void> {
    this.stale = false;
    if (this.status !== "ready") {
      this.status = "loading";
      this.notify();
    }
    const res = await this.transport.catchupOpen(this.workspaceId);
    if (res.error) {
      this.stale = true;
      // A failed re-read keeps what's shown; only a first read shows the error.
      if (this.status !== "ready") {
        this.status = "error";
        this.error = res.error.code === null ? OFFLINE : res.error.message;
      }
      this.notify();
      return;
    }
    const items = res.data;
    const ids = new Set(items.map((i) => i.id));
    // What the server no longer lists is no longer hidden either.
    for (const id of this.hidden) if (!ids.has(id)) this.hidden.delete(id);

    // Messages: the chat store's fresh copy first, then the ones we hold, then the server.
    const next: Record<string, ChatMessage> = {};
    const missing: string[] = [];
    for (const item of items) {
      const id = item.messageId;
      if (!id || next[id]) continue;
      const row = this.rowById(id) ?? this.messages[id];
      if (row) next[id] = row;
      else missing.push(id);
    }
    if (missing.length > 0) {
      const got = await this.transport.messages(missing);
      if (!got.error) for (const m of got.data) next[m.id] = m;
    }
    this.items = items;
    this.messages = next;
    this.status = "ready";
    this.error = null;
    this.notify();
  }

  /** Done (Space, "Done all in this conversation"): hidden at once; returns what the server closed. */
  async done(ids: readonly string[]): Promise<ChatWriteResult> {
    if (ids.length === 0) return { ok: true };
    for (const id of ids) this.hidden.add(id);
    this.notify();
    for (let i = 0; i < ids.length; i += OP_MAX) {
      const res = await this.transport.catchupDone(ids.slice(i, i + OP_MAX));
      if (res.error) {
        for (const id of ids) this.hidden.delete(id);
        this.notify();
        // Earlier batches may have closed: the list says which.
        if (i > 0) void this.load();
        return writeResult(res.error);
      }
    }
    void this.load();
    return { ok: true };
  }

  /** Undo Done. */
  async reopen(ids: readonly string[]): Promise<ChatWriteResult> {
    if (ids.length === 0) return { ok: true };
    for (let i = 0; i < ids.length; i += OP_MAX) {
      const res = await this.transport.catchupReopen(ids.slice(i, i + OP_MAX));
      if (res.error) return writeResult(res.error);
    }
    for (const id of ids) this.hidden.delete(id);
    await this.loadFresh();
    return { ok: true };
  }

  /**
   * Later / Remind me: a message's items (or a conversation's, for `/remind`,
   * or Catch up's items by id) come back at `at`. `hide` names the items to
   * hide at once (the selected one in Catch up).
   */
  async remind(
    target: { messageId: string } | { channelId: string } | { itemIds: readonly string[] },
    at: string | null,
    hide: readonly string[] = [],
  ): Promise<ChatWriteResult> {
    for (const id of hide) this.hidden.add(id);
    if (hide.length) this.notify();
    const res = await this.transport.remind({
      messageId: "messageId" in target ? target.messageId : null,
      channelId: "channelId" in target ? target.channelId : null,
      itemIds: "itemIds" in target ? target.itemIds : null,
      at,
    });
    if (res.error) {
      for (const id of hide) this.hidden.delete(id);
      if (hide.length) this.notify();
      return writeResult(res.error);
    }
    // Un-hide only after a read that started after the write (one in flight
    // may still list the item and would flash it back).
    if (this.watchers > 0) await this.loadFresh();
    else this.stale = true;
    // Shown again if the server still lists it (it put off something else,
    // e.g. the chain had moved on): never hidden for the rest of the session.
    for (const id of hide) this.hidden.delete(id);
    if (hide.length) this.notify();
    return { ok: true };
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

// ── One per chat store ─────────────────────────────────────────────────────

const stores = new WeakMap<ChatStore, CatchupStore>();

/** The Catch up list of a chat store's workspace (made once, fed by its Realtime rows). */
export function catchupStoreFor(store: ChatStore): CatchupStore {
  let found = stores.get(store);
  if (!found) {
    const made = new CatchupStore(store.transport, store.workspaceId, {
      rowById: (id) => store.rowById(id),
    });
    store.onCatchupChange(() => made.changed());
    stores.set(store, made);
    found = made;
  }
  return found;
}

/**
 * Catch up's open items, read while mounted. The Catch up view and CV-22's
 * Catch up widget read through this.
 */
export function useCatchup(store: ChatStore | null): {
  catchup: CatchupStore | null;
  snapshot: CatchupSnapshot;
} {
  const catchup = store ? catchupStoreFor(store) : null;
  useEffect(() => catchup?.watch(), [catchup]);
  const snapshot = useSyncExternalStore(
    catchup?.subscribe ?? noopSubscribe,
    catchup?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  return { catchup, snapshot };
}

const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_CATCHUP;

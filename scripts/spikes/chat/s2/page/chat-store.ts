// The memory half of the chat store, as much as spike 2 needs to prove it:
// windows of messages per conversation (≤ 1,500 each), rows applied from a
// delta or a Realtime event (newer server stamp wins, a move re-files the
// row, a `moved_out` line drops the ids it names), and the access check's
// reconciliation, which drops what you can no longer read from memory and
// from the device copy in one pass.

import type { DeviceCopy, MetaRecord } from "./device-copy";
import { type ChatRow, micros } from "./fixture";

/** What `chat_sync_ids` answers (grouped by kind). */
export type SyncIdsAnswer = {
  conversations: string[];
  members: string[];
  movedAway: { id: string; conversationId: string }[];
  checkedAt: string;
};

export type ReconcileResult = {
  droppedConversations: string[];
  droppedIds: string[];
  ms: number;
};

type Window = { rows: ChatRow[]; byId: Map<string, ChatRow> };

function order(a: ChatRow, b: ChatRow): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class ChatStoreSketch {
  readonly windows = new Map<string, Window>();
  /** Every row in memory by id (echo skip, re-filing, moved ids). */
  readonly byId = new Map<string, ChatRow>();

  constructor(
    readonly workspaceId: string,
    readonly personId: string,
    readonly copy: DeviceCopy | null,
    readonly memoryCap = 1500,
    readonly deviceCap = 500,
  ) {}

  get metaKey(): string {
    return `${this.personId}:${this.workspaceId}`;
  }

  private async meta(): Promise<MetaRecord> {
    return (
      (await this.copy?.getMeta(this.metaKey)) ?? {
        key: this.metaKey,
        conversations: {},
        cursor: null,
        accessSince: null,
        outbox: [],
      }
    );
  }

  /** Open a conversation from the device copy (the cold open). */
  async open(conv: string, n = 50): Promise<ChatRow[]> {
    const rows = this.copy ? await this.copy.newest(this.workspaceId, conv, n, "advance") : [];
    this.load(conv, rows);
    return rows;
  }

  /** Put rows into a conversation's window (oldest first), trimming the far end. */
  load(conv: string, rows: readonly ChatRow[]): void {
    let w = this.windows.get(conv);
    if (!w) {
      w = { rows: [], byId: new Map() };
      this.windows.set(conv, w);
    }
    for (const row of rows) {
      const held = w.byId.get(row.id);
      if (held) w.rows[w.rows.indexOf(held)] = row;
      else w.rows.push(row);
      w.byId.set(row.id, row);
      this.byId.set(row.id, row);
    }
    w.rows.sort(order);
    while (w.rows.length > this.memoryCap) {
      const gone = w.rows.shift() as ChatRow;
      w.byId.delete(gone.id);
      this.byId.delete(gone.id);
    }
  }

  private forget(id: string): void {
    const held = this.byId.get(id);
    if (!held) return;
    this.byId.delete(id);
    const w = this.windows.get(held.channelId);
    if (!w) return;
    w.byId.delete(id);
    const i = w.rows.indexOf(held);
    if (i >= 0) w.rows.splice(i, 1);
  }

  /**
   * Rows from a delta read or a Realtime event, applied from the payload with
   * no request. A row lands only if its server stamp is newer than what's
   * held (an equal stamp is your own echo).
   */
  async apply(
    rows: readonly ChatRow[],
  ): Promise<{ applied: number; skipped: number; dropped: string[] }> {
    let applied = 0;
    let skipped = 0;
    const dropped: string[] = [];
    const toDevice: ChatRow[] = [];
    for (const row of rows) {
      const held = this.byId.get(row.id);
      if (held && micros(held.updatedAt) >= micros(row.updatedAt)) {
        skipped += 1;
        continue;
      }
      if (held && held.channelId !== row.channelId) this.forget(row.id);
      if (this.windows.has(row.channelId)) this.load(row.channelId, [row]);
      toDevice.push(row);
      applied += 1;
      // The fast path for a move you can't follow: the source's line names the ids.
      if (row.kind === "event" && row.event?.type === "moved_out") {
        for (const id of row.event.ids) {
          const moved = this.byId.get(id);
          if (
            moved &&
            moved.channelId === row.channelId &&
            micros(moved.updatedAt) < micros(row.updatedAt)
          ) {
            this.forget(id);
            dropped.push(id);
          }
        }
      }
    }
    if (this.copy) {
      if (dropped.length > 0) await this.copy.dropIds(dropped);
      if (toDevice.length > 0) await this.copy.put(toDevice, this.deviceCap).done;
    }
    return { applied, skipped, dropped };
  }

  /**
   * The access check's answer against everything held: a conversation you
   * can no longer read leaves memory and the device copy (one range delete),
   * and so do the ids moved where you can't follow. Rows that arrived after
   * the check started are kept (the answer may predate them).
   */
  async reconcile(answer: SyncIdsAnswer): Promise<ReconcileResult> {
    const t0 = performance.now();
    const readable = new Set(answer.conversations);
    const meta = await this.meta();
    const held = new Set([...this.windows.keys(), ...Object.keys(meta.conversations)]);
    const droppedConversations: string[] = [];
    for (const conv of held) {
      if (readable.has(conv)) continue;
      const w = this.windows.get(conv);
      if (w) for (const id of w.byId.keys()) this.byId.delete(id);
      this.windows.delete(conv);
      delete meta.conversations[conv];
      await this.copy?.dropConversation(this.workspaceId, conv);
      droppedConversations.push(conv);
    }
    const droppedIds: string[] = [];
    for (const { id, conversationId } of answer.movedAway) {
      const row = this.byId.get(id);
      if (row && row.channelId !== conversationId) continue; // re-filed since
      this.forget(id);
      droppedIds.push(id);
    }
    if (droppedIds.length > 0) await this.copy?.dropIds(droppedIds);
    meta.accessSince = answer.checkedAt;
    await this.copy?.putMeta(meta);
    return { droppedConversations, droppedIds, ms: performance.now() - t0 };
  }

  /** Remember a conversation as held on the device (the LRU's clock). */
  async touch(conv: string, at = Date.now()): Promise<void> {
    const meta = await this.meta();
    const w = this.windows.get(conv);
    meta.conversations[conv] = { openedAt: at, newestAt: w?.rows.at(-1)?.at ?? 0 };
    await this.copy?.putMeta(meta);
  }
}

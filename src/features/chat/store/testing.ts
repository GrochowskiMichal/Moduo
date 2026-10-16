// Tests only: an in-memory chat server behind the store's transport, with the
// rules the store relies on (read rules per conversation, server stamps,
// keyset pages, deltas by `updated_at`, the access check, resends by id) and a
// switch for the network. Not imported by the app.

import { timestampMicros } from "../../tasks/live";
import type {
  ChatCatchupItem,
  ChatChannel,
  ChatError,
  ChatKey,
  ChatMember,
  ChatMessage,
  ChatMoveAnswer,
  ChatResult,
  ChatRuntime,
  ChatSyncRow,
  ChatUnread,
} from "../model";
import type { ChatLiveEvent, ChatLiveSource } from "../realtime";
import { compareKeys, keyOf } from "./keys";

const us = (stamp: string) => timestampMicros(stamp) ?? 0;

export const WS = "00000000-0000-4000-8000-0000000000ff";
export const ME = "00000000-0000-4000-8000-000000000001";
export const YOU = "00000000-0000-4000-8000-000000000002";

const NETWORK: ChatError = { code: null, message: "TypeError: Failed to fetch" };

/** A server stamp from microseconds since the epoch, as PostgREST spells it. */
export function stampOf(us: number): string {
  const ms = Math.floor(us / 1000);
  const frac = String(us % 1000).padStart(3, "0");
  return new Date(ms).toISOString().replace(/Z$/, `${frac}+00:00`);
}

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function channel(id: string, extra: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id,
    workspaceId: WS,
    kind: "channel",
    name: id.slice(-4),
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: ME,
    createdAt: stampOf(1_700_000_000_000_000),
    updatedAt: stampOf(1_700_000_000_000_000),
    archivedAt: null,
    lastMessageAt: null,
    isDefault: false,
    ...extra,
  };
}

export function member(channelId: string, extra: Partial<ChatMember> = {}): ChatMember {
  return {
    channelId,
    userId: ME,
    workspaceId: WS,
    notifyLevel: "mentions",
    starred: false,
    lastReadAt: stampOf(1_700_000_000_000_000),
    lastReadId: null,
    joinedAt: stampOf(1_700_000_000_000_000),
    ...extra,
  };
}

export function message(
  id: string,
  channelId: string,
  at: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    workspaceId: WS,
    channelId,
    parentId: null,
    replyToId: null,
    kind: "message",
    event: null,
    formatVersion: 2,
    authorId: YOU,
    authorKind: "user",
    authorLabel: null,
    body: `body ${id}`,
    mentionedUserIds: [],
    mentionedTeamIds: [],
    mentionsEveryone: false,
    reactions: {},
    replyCount: 0,
    lastReplyAt: null,
    replyUserIds: [],
    wrappedAt: null,
    wrappedBy: null,
    settledId: null,
    reopenedAt: null,
    reopenedBy: null,
    pinnedAt: null,
    pinnedBy: null,
    editedAt: null,
    deletedAt: null,
    clientId: null,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

type Pending = { resolve: () => void; promise: Promise<void> };

export class FakeChatServer {
  /** Microseconds; every write moves it on. */
  clock = 1_760_000_000_000_000;
  rows = new Map<string, ChatMessage>();
  channels = new Map<string, ChatChannel>();
  /** Conversations I may read (the read rule). */
  readable = new Set<string>();
  /** My live memberships. */
  memberOf = new Map<string, ChatMember>();
  movedAway: { id: string; source: string; at: string }[] = [];
  counts: ChatUnread[] = [];
  enabled = true;
  /** The network is gone: every request fails as a lost fetch. */
  offline = false;
  /** The next answer of these ops is lost after the server applied it. */
  loseAnswer = new Set<string>();
  /** Ops the server refuses, with its error. */
  refuse = new Map<string, ChatError>();
  /** Every request, by name. */
  calls: string[] = [];
  /** A request held until released (the device copy shows first). */
  hold: Map<string, Pending> = new Map();
  marks: { channelId: string; messageId: string }[] = [];
  /** Chains I stopped following. */
  muted = new Set<string>();
  /** People a move would newly reach (non-zero: the first call answers "confirm"). */
  moveNewly = 0;
  /** My open Catch up items (CV-11), as `chat_catchup_open` answers them. */
  catchup: ChatCatchupItem[] = [];
  /** Items Done closed (Undo reopens them). */
  catchupDone = new Map<string, ChatCatchupItem>();
  /** Every Later / Remind me asked for. */
  reminds: {
    messageId: string | null;
    channelId: string | null;
    itemIds?: string[];
    at: string | null;
  }[] = [];

  now(): string {
    this.clock += 1000;
    return stampOf(this.clock);
  }

  addChannel(
    id: string,
    opts: { member?: boolean; readable?: boolean } & Partial<ChatChannel> = {},
  ) {
    const { member: isMember = true, readable = true, ...extra } = opts;
    this.channels.set(id, channel(id, extra));
    if (readable) this.readable.add(id);
    if (isMember) this.memberOf.set(id, member(id));
  }

  /** A message someone else posts now (or at a given stamp). */
  post(id: string, channelId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const at = extra.createdAt ?? this.now();
    const row = message(id, channelId, at, { updatedAt: at, ...extra });
    this.rows.set(id, row);
    return row;
  }

  /** Change a row: its stamp moves. */
  change(id: string, patch: Partial<ChatMessage>): ChatMessage {
    const prev = this.rows.get(id);
    if (!prev) throw new Error(`no row ${id}`);
    const row = { ...prev, ...patch, updatedAt: this.now() };
    this.rows.set(id, row);
    return row;
  }

  /** Every row I may read in these conversations: what a full read returns. */
  fullRead(channelIds: readonly string[]): ChatMessage[] {
    const keep = new Set(channelIds);
    return [...this.rows.values()]
      .filter((r) => keep.has(r.channelId) && this.readable.has(r.channelId))
      .sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  }

  holdNext(name: string): () => void {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.hold.set(name, { resolve, promise });
    return resolve;
  }

  private async gate<T>(name: string, run: () => ChatResult<T>): Promise<ChatResult<T>> {
    this.calls.push(name);
    const held = this.hold.get(name);
    if (held) {
      this.hold.delete(name);
      await held.promise;
    }
    await Promise.resolve();
    if (this.offline) return { data: null, error: NETWORK };
    const refused = this.refuse.get(name);
    if (refused) return { data: null, error: refused };
    const out = run();
    if (this.loseAnswer.delete(name)) return { data: null, error: NETWORK };
    return out;
  }

  private async thrown<T>(name: string, run: () => T): Promise<T> {
    this.calls.push(name);
    const held = this.hold.get(name);
    if (held) {
      this.hold.delete(name);
      await held.promise;
    }
    await Promise.resolve();
    if (this.offline) throw new Error(NETWORK.message);
    return run();
  }

  private readableRows(channelId: string): ChatMessage[] {
    if (!this.readable.has(channelId)) return [];
    return [...this.rows.values()]
      .filter((r) => r.channelId === channelId)
      .sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  }

  private mine(
    id: string,
    patch: (row: ChatMessage) => Partial<ChatMessage>,
  ): ChatResult<ChatMessage> {
    const row = this.rows.get(id);
    if (!row || !this.readable.has(row.channelId)) {
      return { data: null, error: { code: "P0002", message: "That message no longer exists." } };
    }
    return { data: this.change(id, patch(row)), error: null };
  }

  transport(): ChatRuntime {
    const ok = <T>(data: T): ChatResult<T> => ({ data, error: null });
    const t: Partial<ChatRuntime> = {
      page: ({ channelId, before, after, limit }) =>
        this.gate("page", () => {
          const all = this.readableRows(channelId);
          if (after) {
            return ok(
              all.filter((r) => compareKeys(keyOf(r), after as ChatKey) > 0).slice(0, limit),
            );
          }
          const upTo = before ? all.filter((r) => compareKeys(keyOf(r), before) < 0) : all;
          return ok(upTo.slice(Math.max(0, upTo.length - limit)));
        }),
      chain: (rootId) =>
        this.gate("chain", () =>
          ok(
            [...this.rows.values()]
              .filter(
                (r) => (r.id === rootId || r.parentId === rootId) && this.readable.has(r.channelId),
              )
              .sort((a, b) => compareKeys(keyOf(a), keyOf(b))),
          ),
        ),
      message: (id) =>
        this.gate("message", () => {
          const row = this.rows.get(id);
          return ok(row && this.readable.has(row.channelId) ? row : null);
        }),
      delta: ({ since, after, limit, channelIds }) =>
        this.gate("delta", () => {
          const rows = [...this.rows.values()]
            .filter((r) => this.readable.has(r.channelId) && us(r.updatedAt) >= us(since))
            .filter((r) => !channelIds || channelIds.includes(r.channelId))
            .filter(
              (r) =>
                !after ||
                us(r.updatedAt) > us(after.updatedAt) ||
                (us(r.updatedAt) === us(after.updatedAt) && r.id > after.id),
            )
            .sort((a, b) => us(a.updatedAt) - us(b.updatedAt) || (a.id < b.id ? -1 : 1));
          return ok(rows.slice(0, limit));
        }),
      syncIds: (_ws, since) =>
        this.gate("syncIds", () => {
          const at = this.now();
          const out: ChatSyncRow[] = [];
          for (const id of this.readable)
            out.push({ kind: "conversation", id, conversationId: id, checkedAt: at });
          for (const id of this.memberOf.keys()) {
            if (this.readable.has(id))
              out.push({ kind: "member", id, conversationId: id, checkedAt: at });
          }
          for (const m of this.movedAway) {
            if (since && us(m.at) < us(since)) continue;
            const row = this.rows.get(m.id);
            if (!row || !this.readable.has(row.channelId)) {
              out.push({ kind: "moved_away", id: m.id, conversationId: m.source, checkedAt: at });
            }
          }
          out.push({ kind: "checked", id: null, conversationId: null, checkedAt: at });
          return ok(out);
        }),
      people: () => this.gate("people", () => ok([])),
      counts: () => this.gate("counts", () => ok(this.counts)),
      send: ({ id, channelId, body, replyToId }) =>
        this.gate("send", () => {
          const held = this.rows.get(id);
          if (held) {
            return held.authorId === ME && held.channelId === channelId
              ? ok(held)
              : {
                  data: null,
                  error: { code: "22023", message: "That message id is already used." },
                };
          }
          if (!this.readable.has(channelId)) {
            return { data: null, error: { code: "42501", message: "You can't post here." } };
          }
          const quoted = replyToId ? this.rows.get(replyToId) : undefined;
          return ok(
            this.post(id, channelId, {
              authorId: ME,
              body,
              replyToId: replyToId ?? null,
              parentId: quoted ? (quoted.parentId ?? quoted.id) : null,
            }),
          );
        }),
      edit: ({ id, body }) =>
        this.gate("edit", () => this.mine(id, () => ({ body, editedAt: this.now() }))),
      remove: (id) =>
        this.gate("remove", () =>
          this.mine(id, () => ({ body: "", deletedAt: this.now(), reactions: {} })),
        ),
      react: ({ id, key, on }) =>
        this.gate("react", () =>
          this.mine(id, (row) => {
            const users = (row.reactions[key] ?? []).filter((u) => u !== ME);
            const reactions = { ...row.reactions };
            if (on) reactions[key] = [...users, ME];
            else if (users.length) reactions[key] = users;
            else delete reactions[key];
            return { reactions };
          }),
        ),
      pin: ({ id, pinned }) =>
        this.gate("pin", () =>
          this.mine(id, () => ({
            pinnedAt: pinned ? this.now() : null,
            pinnedBy: pinned ? ME : null,
          })),
        ),
      wrapUp: ({ rootId, settledId }) =>
        this.gate("wrapUp", () =>
          this.mine(rootId, () => ({
            wrappedAt: this.now(),
            wrappedBy: ME,
            settledId,
            reopenedAt: null,
            reopenedBy: null,
          })),
        ),
      reopen: (rootId) =>
        this.gate("reopen", () =>
          this.mine(rootId, () => ({
            wrappedAt: null,
            wrappedBy: null,
            settledId: null,
            reopenedAt: this.now(),
            reopenedBy: ME,
          })),
        ),
      attachToChain: ({ messageId, replyToId }) =>
        this.gate("attachToChain", () => {
          const target = this.rows.get(replyToId);
          const root = target?.parentId ?? replyToId;
          const old = this.rows.get(messageId)?.parentId ?? null;
          const res = this.mine(messageId, () => ({ parentId: root, replyToId }));
          const recount = (id: string | null) => {
            if (!id || !this.rows.has(id)) return;
            const n = [...this.rows.values()].filter(
              (r) => r.parentId === id && !r.deletedAt,
            ).length;
            this.change(id, { replyCount: n });
          };
          recount(old);
          recount(root);
          return res;
        }),
      moveMessages: ({ ids, targetId, confirm }) =>
        this.gate("moveMessages", (): ChatResult<ChatMoveAnswer> => {
          const first = this.rows.get(ids[0] ?? "");
          if (!first || !this.readable.has(first.channelId) || !this.readable.has(targetId)) {
            return {
              data: null,
              error: { code: "P0002", message: "That message no longer exists." },
            };
          }
          if (this.moveNewly > 0 && !confirm) {
            return ok<ChatMoveAnswer>({ status: "confirm", newly: this.moveNewly });
          }
          const from = first.channelId;
          const all = [...this.rows.values()]
            .filter((r) => ids.includes(r.id) || (r.parentId !== null && ids.includes(r.parentId)))
            .map((r) => r.id);
          for (const id of all)
            this.change(id, { channelId: targetId, pinnedAt: null, pinnedBy: null });
          return ok<ChatMoveAnswer>({ status: "moved", ids: all, from, to: targetId });
        }),
      chainRead: () => this.gate("chainRead", () => ok(null)),
      messages: (ids) =>
        this.gate("messages", () =>
          ok(
            ids
              .map((id) => this.rows.get(id))
              .filter((r): r is ChatMessage => !!r && this.readable.has(r.channelId)),
          ),
        ),
      catchupOpen: () =>
        this.gate("catchupOpen", () =>
          ok(this.catchup.filter((i) => this.readable.has(i.channelId))),
        ),
      catchupDone: (ids) =>
        this.gate("catchupDone", () => {
          const gone = this.catchup.filter((i) => ids.includes(i.id));
          for (const i of gone) this.catchupDone.set(i.id, i);
          this.catchup = this.catchup.filter((i) => !ids.includes(i.id));
          return ok(gone.length);
        }),
      catchupReopen: (ids) =>
        this.gate("catchupReopen", () => {
          const back = ids
            .map((id) => this.catchupDone.get(id))
            .filter((i): i is ChatCatchupItem => !!i);
          for (const i of back) this.catchupDone.delete(i.id);
          this.catchup = [...this.catchup, ...back];
          return ok(back.length);
        }),
      remind: ({ messageId, channelId, itemIds, at }) =>
        this.gate("remind", () => {
          this.reminds.push({
            messageId: messageId ?? null,
            channelId: channelId ?? null,
            ...(itemIds ? { itemIds: [...itemIds] } : {}),
            at,
          });
          const hide = (i: ChatCatchupItem) =>
            at !== null &&
            (itemIds
              ? itemIds.includes(i.id)
              : messageId
                ? i.messageId === messageId
                : i.channelId === channelId);
          const n = this.catchup.filter(hide).length;
          this.catchup = this.catchup.filter((i) => !hide(i));
          return ok(Math.max(1, n));
        }),
      chains: (channelId) =>
        this.gate("chains", () =>
          ok(
            this.readableRows(channelId)
              .filter((r) => !r.parentId && r.replyCount > 0 && !r.deletedAt)
              .sort((a, b) => (b.lastReplyAt ?? "").localeCompare(a.lastReplyAt ?? "")),
          ),
        ),
      chainFollowing: (rootId) => this.thrown("chainFollowing", () => !this.muted.has(rootId)),
      followChain: (rootId, following) =>
        this.gate("followChain", () => {
          if (following) this.muted.delete(rootId);
          else this.muted.add(rootId);
          return ok(null);
        }),
      markRead: (args) =>
        this.gate("markRead", () => {
          this.marks.push(args);
          return ok(null);
        }),
      markUnread: () => this.gate("markUnread", () => ok(null)),
      typing: async () => {},
      isEnabled: () => this.thrown("isEnabled", () => this.enabled),
      bootstrap: () => this.thrown("bootstrap", () => undefined),
      listChannels: () =>
        this.thrown("listChannels", () =>
          [...this.channels.values()].filter((c) => this.readable.has(c.id)),
        ),
      listMyMemberships: () =>
        this.thrown("listMyMemberships", () =>
          [...this.memberOf.values()].filter((m) => this.readable.has(m.channelId)),
        ),
    };
    return t as ChatRuntime;
  }
}

/** A live source the test drives. */
export function fakeLive(): ChatLiveSource & {
  emit: (event: ChatLiveEvent) => void;
  open: boolean;
} {
  let sink: ((e: ChatLiveEvent) => void) | null = null;
  const source = ((_scope, s) => {
    sink = s;
    source.open = true;
    return () => {
      sink = null;
      source.open = false;
    };
  }) as ChatLiveSource & { emit: (event: ChatLiveEvent) => void; open: boolean };
  source.open = false;
  source.emit = (event) => sink?.(event);
  return source;
}

/** Let queued promises and zero-delay timers run. */
export async function settle(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
}

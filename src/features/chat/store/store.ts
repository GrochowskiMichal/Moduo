// The chat store (CV-3, spec #2, round-3 §1.2 and §2.7, CV-0 spikes 2 and 3):
// one copy of a workspace's chat per person, on the shared pattern Tasks'
// store set (`src/lib/sync/store.ts`).
//
// How the copy stays right:
//   - **Opens from the device.** The sidebar (conversations, memberships,
//     people, counts) and each conversation's newest 51 messages come from
//     IndexedDB (`device-copy.ts`) at once; then the server is asked.
//   - **Keyset pages** on (created_at, id), 51 at a time (the stream draws 50
//     and needs one past the edge); a jump loads [target − 100, target + 100].
//     A newest page that doesn't reach what the device held is a gap: the
//     window starts again at the page.
//   - **Then only what changed.** A delta reads rows whose server `updated_at`
//     moved since the cursor (soft deletes included), five minutes early so a
//     late commit is never missed, paged under (updated_at, id). It runs when
//     Realtime (re)joins, on focus, when the network is back and every minute
//     and a half while visible: never per message.
//   - **Realtime on top** (`realtime.ts`, one adapter): a row from the event
//     lands only if its server stamp is newer, with zero requests per incoming
//     message; an equal stamp is your own echo and changes nothing. A hard
//     delete carries only the id: one you don't hold is ignored.
//   - **Losing access sends no event** (`access.ts`): `chat_sync_ids` runs on
//     the first load, on rejoin, on focus, every 10 minutes and when one of
//     your memberships changes, and what you can no longer read leaves memory
//     and the device. It sees only the conversations the store holds, so every
//     conversation the store keeps rows for is registered in the copy's meta;
//     rows for conversations it doesn't hold are never kept.
//
// Writes: a send gets a client-minted id and goes into the outbox (kept with
// the copy), visible at once; the outbox is sent in order, each under its own
// id, so a retry never makes a second message. A lost network leaves it
// "Waiting to send"; a refusal turns it into "Not sent · Retry", never a
// silently vanished message. Edits, deletes, reactions and pins lay an
// overlay over the server's row until the answer comes back; a refusal drops
// only that overlay (one write rolls back); offline they say "Offline".
// The read mark is the last message that was on screen, never "now", and it
// moves forward only.

import { currentPreferences } from "../../../lib/preferences";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { browserOffline } from "../../../lib/sync/network";
import { timestampMicros } from "../../tasks/live";
import type { ChatFileGate } from "../files/gate";
import type {
  ChatBodyFormat,
  ChatChannel,
  ChatDeletedChannel,
  ChatError,
  ChatKey,
  ChatLink,
  ChatMember,
  ChatMessage,
  ChatMoveAnswer,
  ChatNotifyLevel,
  ChatPerson,
  ChatResult,
  ChatRuntime,
  ChatUnread,
} from "../model";
import type { ChatLiveEvent, ChatLiveSource } from "../realtime";
import { planAccess } from "./access";
import {
  CHAT_COPY_VERSION,
  type ChatDeviceCopy,
  type ChatHeldConversation,
  type ChatMeta,
  type ChatOutboxEntry,
  chatDeviceCopy,
  emptyMeta,
  isOwnerOf,
  ownerKey,
} from "./device-copy";
import { compareKeys, compareRows, isNewerRow, keyOf, laterStamp, stampMinus } from "./keys";
import { classifyChatError, newMessageId } from "./outbox";

// ── Shapes ──────────────────────────────────────────────────────────────────

export type ChatStatus = "idle" | "loading" | "ready" | "error";

/** One conversation's stream as the screen draws it. */
export type ChatWindow = {
  /** Oldest first: server rows (with your writes on top), then your unsent sends. */
  rows: ChatMessage[];
  hasOlder: boolean;
  /** A jump window that doesn't reach the newest message (the jump bar). */
  hasNewer: boolean;
  loading: boolean;
  /** The server answered this session (rows from the device show before it does). */
  loaded: boolean;
  /** Where "New" sits: your read mark when the conversation opened. It never jumps. */
  newAfter: ChatKey | null;
  /** The message a jump landed on. */
  target: string | null;
};

/** A chain: its root and replies, oldest first. */
export type ChatChain = {
  root: ChatMessage | null;
  replies: ChatMessage[];
  loading: boolean;
  loaded: boolean;
};

export type ChatSnapshot = {
  status: ChatStatus;
  error: string | null;
  /** Showing the device copy: the server hasn't answered yet this session. */
  fromDevice: boolean;
  /** No network: "You're offline · reading from this device". */
  offline: boolean;
  /**
   * The workspace's plan doesn't include chat (CH4a, spec §1): every
   * conversation stays readable and searchable, writing waits for the plan.
   */
  paused: boolean;
  channels: Record<string, ChatChannel>;
  mine: Record<string, ChatMember>;
  people: Record<string, ChatPerson>;
  /** The badge slice: per-conversation counts, moved by the store as rows arrive. */
  unread: Record<string, ChatUnread>;
  windows: Record<string, ChatWindow>;
  chains: Record<string, ChatChain>;
  /** Sends not confirmed yet (waiting or failed). */
  waiting: number;
};

export type ChatWriteResult = { ok: true } | { ok: false; offline: boolean; message: string };

export const EMPTY_CHAT_SNAPSHOT: ChatSnapshot = {
  status: "idle",
  error: null,
  fromDevice: false,
  offline: false,
  paused: false,
  channels: {},
  mine: {},
  people: {},
  unread: {},
  windows: {},
  chains: {},
  waiting: 0,
};

type Conv = {
  /** Server rows held in memory, by id. */
  rows: Map<string, ChatMessage>;
  /** The window's oldest edge (a server row's key); null: nothing paged yet. */
  lo: ChatKey | null;
  hasOlder: boolean;
  /** A jump window's newest edge; null: the window reaches the newest message. */
  hi: ChatKey | null;
  loading: boolean;
  loaded: boolean;
  newAfter: ChatKey | null;
  target: string | null;
};

type Overlay = { op: number; id: string; apply: (row: ChatMessage) => ChatMessage };

// ── Timing and sizes ────────────────────────────────────────────────────────

export type ChatStoreTiming = {
  /** A delta read starts this far before its cursor (a late commit is still read). */
  lagMs: number;
  /** The device copy is written this long after the last change. */
  persistMs: number;
  /** The read mark is sent this long after it last moved. */
  markReadMs: number;
  /** The access check runs at least this often. */
  accessCheckMs: number;
  /** While visible, gaps are filled this often (events can be lost with the socket up). */
  gapFillMs: number;
  /** Coming back to the window reads at most this often. */
  focusThrottleMs: number;
  /** While offline, the server is tried again this often. */
  retryMs: number;
  /** Joins that arrive together (four sources at once) fill one gap. */
  joinDebounceMs: number;
};

export const DEFAULT_CHAT_TIMING: ChatStoreTiming = {
  lagMs: 5 * 60_000,
  persistMs: 800,
  markReadMs: 600,
  accessCheckMs: 10 * 60_000,
  gapFillMs: 90_000,
  focusThrottleMs: 5_000,
  retryMs: 20_000,
  joinDebounceMs: 250,
};

/** CV-9: why a message of files only whose files all stopped isn't sent. */
export const FILES_ALL_STOPPED = "its files didn't upload";

/** The stream's page: it draws 50 and needs one past the edge. */
export const PAGE = 51;
/** A jump loads this many on each side of its target (+1 to know there's more). */
export const JUMP_SPAN = 100;
/** Messages kept on the device per conversation (spike 2: ≤ ~500). */
export const DEVICE_KEEP = 500;
/** A conversation that isn't open keeps at most this many in memory (≤ ~1,500 in all). */
export const MEMORY_KEEP = PAGE;
/** PostgREST answers at most 1,000 rows: a delta reads in pages of this. */
export const DELTA_LIMIT = 1000;
/** A delta further behind than this many pages stops; open windows read their newest page again. */
export const DELTA_MAX_PAGES = 20;
/** At most this many conversations named in a delta (the request's URL); more: the workspace. */
export const DELTA_SCOPE_MAX = 100;

export type ChatStoreOptions = {
  copy?: ChatDeviceCopy;
  live?: ChatLiveSource;
  timing?: Partial<ChatStoreTiming>;
  /** Rows per delta page (tests page with fewer). */
  deltaLimit?: number;
  /** CV-9: whether a message's files are up (a send with files waits for them). */
  files?: ChatFileGate;
  /**
   * CV-21: whether replies to posts made through this key of yours reach you
   * (Settings' "Replies to posts by <key>"; on when unset).
   */
  keyRepliesOn?: (keyId: string) => boolean;
};

let nextOp = 1;

const ZERO = (channelId: string): ChatUnread => ({
  channelId,
  unread: 0,
  mentions: 0,
  addressed: 0,
  catchup: 0,
});

const micros = (at: string | null | undefined) => timestampMicros(at) ?? 0;

/**
 * A line that takes ids away from the conversation it's in: a live moved_out
 * line (CV-16), or a moved_in line its Undo deleted (the messages went back).
 */
const isMoveLine = (row: ChatMessage) =>
  row.kind === "event" &&
  Array.isArray(row.event?.ids) &&
  ((row.event?.type === "moved_out" && !row.deletedAt) ||
    (row.event?.type === "moved_in" && !!row.deletedAt));

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ── The store ───────────────────────────────────────────────────────────────

export class ChatStore {
  readonly userId: string;
  readonly workspaceId: string;
  readonly owner: string;
  readonly transport: ChatRuntime;
  private readonly copy: ChatDeviceCopy;
  private readonly live: ChatLiveSource | null;
  private readonly timing: ChatStoreTiming;
  private readonly deltaLimit: number;
  private readonly files: ChatFileGate | null;
  private readonly keyRepliesOn: (keyId: string) => boolean;
  private stopFiles: (() => void) | null = null;

  private status: ChatStatus = "idle";
  private error: string | null = null;
  private fromDevice = false;
  private offline = browserOffline();
  private paused = false;

  private channels = new Map<string, ChatChannel>();
  private mine = new Map<string, ChatMember>();
  private people = new Map<string, ChatPerson>();
  private unread = new Map<string, ChatUnread>();

  private convs = new Map<string, Conv>();
  /** Which conversation holds a message id. */
  private where = new Map<string, string>();
  /** When a row last landed (`seq`): a reconcile never drops a row that arrived after its read began. */
  private landedAt = new Map<string, number>();
  private seq = 0;
  private overlays: Overlay[] = [];
  private outbox: ChatOutboxEntry[] = [];
  /** Outbox ids this tab sent or discarded (another tab's waiting sends are kept). */
  private handled = new Set<string>();
  private inFlight: string | null = null;
  /** Waiting sends read from the device at start: another tab may send or discard them. */
  private adopted = new Set<string>();
  private draining: Promise<void> | null = null;
  private drainAgain = false;
  private chainState = new Map<string, { loading: boolean; loaded: boolean }>();
  /** Conversations the device copy holds rows for (meta.conversations). */
  private held: Record<string, ChatHeldConversation> = {};
  private cursor: string | null = null;
  private accessSince: string | null = null;
  private drafts: Record<string, string> = {};
  private openId: string | null = null;

  private dirtyRows = new Map<string, ChatMessage>();
  private goneIds = new Set<string>();
  private goneConvs = new Set<string>();
  /** Conversations this tab dropped this session (another tab's meta doesn't bring them back). */
  private droppedConvs = new Set<string>();
  /** Draft keys this tab cleared this session. */
  private clearedDrafts = new Set<string>();
  private metaDirty = false;
  /** Channels you deleted here: your own row's access stamp mustn't bring one back. */
  private deletedHere = new Set<string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persisting: Promise<void> = Promise.resolve();

  private marks = new Map<string, string>();
  private markTimer: ReturnType<typeof setTimeout> | null = null;
  private countsTimer: ReturnType<typeof setTimeout> | null = null;

  private refs = 0;
  private running = false;
  private disposed = false;
  /** Disposed without persisting (sign-out, another person): the copy is being wiped. */
  private wiped = false;
  private booting: Promise<void> | null = null;
  private stopLive: (() => void) | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private accessTimer: ReturnType<typeof setInterval> | null = null;
  private gapTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private accessRunning: Promise<void> | null = null;
  private accessAgain = false;
  private lastFocusSync = 0;

  private listeners = new Set<() => void>();
  private catchupListeners = new Set<() => void>();
  private snap: ChatSnapshot | null = null;
  private windowCache = new Map<string, ChatWindow>();
  private chainCache = new Map<string, ChatChain>();

  constructor(
    transport: ChatRuntime,
    userId: string,
    workspaceId: string,
    opts: ChatStoreOptions = {},
  ) {
    this.transport = transport;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.owner = ownerKey(userId, workspaceId);
    this.copy = opts.copy ?? chatDeviceCopy();
    this.live = opts.live ?? null;
    this.timing = { ...DEFAULT_CHAT_TIMING, ...opts.timing };
    this.deltaLimit = opts.deltaLimit ?? DELTA_LIMIT;
    this.files = opts.files ?? null;
    this.keyRepliesOn =
      opts.keyRepliesOn ?? ((keyId) => currentPreferences().chatKeyReplies[keyId] ?? true);
  }

  // ── Readers ───────────────────────────────────────────────────────────────

  /** Your Catch up rows changed on the server (Realtime): Catch up's list re-reads (CV-11). */
  onCatchupChange(fn: () => void): () => void {
    this.catchupListeners.add(fn);
    return () => {
      this.catchupListeners.delete(fn);
    };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): ChatSnapshot => {
    this.snap ??= this.buildSnapshot();
    return this.snap;
  };

  private notify(): void {
    this.snap = null;
    for (const fn of this.listeners) fn();
  }

  private touch(channelId: string): void {
    this.windowCache.delete(channelId);
    this.chainCache.clear();
  }

  private buildSnapshot(): ChatSnapshot {
    const windows: Record<string, ChatWindow> = {};
    for (const id of this.convs.keys()) {
      let view = this.windowCache.get(id);
      if (!view) {
        view = this.windowView(id);
        this.windowCache.set(id, view);
      }
      windows[id] = view;
    }
    const chains: Record<string, ChatChain> = {};
    for (const root of this.chainState.keys()) {
      let view = this.chainCache.get(root);
      if (!view) {
        view = this.chainView(root);
        this.chainCache.set(root, view);
      }
      chains[root] = view;
    }
    return {
      status: this.status,
      error: this.error,
      fromDevice: this.fromDevice,
      offline: this.offline,
      paused: this.paused,
      channels: Object.fromEntries(this.channels),
      mine: Object.fromEntries(this.mine),
      people: Object.fromEntries(this.people),
      unread: Object.fromEntries(this.unread),
      windows,
      chains,
      waiting: this.outbox.filter((e) => !e.deleted).length,
    };
  }

  private shown(row: ChatMessage): ChatMessage {
    let out = row;
    for (const o of this.overlays) if (o.id === row.id) out = o.apply(out);
    return out;
  }

  private windowView(channelId: string): ChatWindow {
    const conv = this.convs.get(channelId);
    if (!conv) {
      return {
        rows: [],
        hasOlder: false,
        hasNewer: false,
        loading: false,
        loaded: false,
        newAfter: null,
        target: null,
      };
    }
    const rows: ChatMessage[] = [];
    for (const row of conv.rows.values()) {
      const key = keyOf(row);
      // A window that reaches the start draws every row (one moved in from before it too).
      if (conv.lo && conv.hasOlder && compareKeys(key, conv.lo) < 0) continue;
      if (conv.hi && compareKeys(key, conv.hi) > 0) continue;
      rows.push(this.shown(row));
    }
    rows.sort(compareRows);
    if (!conv.hi) {
      for (const entry of this.outbox) {
        if (entry.channelId === channelId && !entry.deleted && !conv.rows.has(entry.id)) {
          rows.push(this.unsentRow(entry));
        }
      }
    }
    return {
      rows,
      hasOlder: conv.hasOlder,
      hasNewer: conv.hi !== null,
      loading: conv.loading,
      loaded: conv.loaded,
      newAfter: conv.newAfter,
      target: conv.target,
    };
  }

  private chainView(rootId: string): ChatChain {
    const state = this.chainState.get(rootId) ?? { loading: false, loaded: false };
    const root = this.rowById(rootId);
    const replies: ChatMessage[] = [];
    const channelId = root?.channelId ?? null;
    const conv = channelId ? this.convs.get(channelId) : undefined;
    if (conv) {
      for (const row of conv.rows.values()) {
        if (row.parentId === rootId) replies.push(this.shown(row));
      }
    }
    replies.sort(compareRows);
    for (const entry of this.outbox) {
      if (
        !entry.deleted &&
        entry.replyToId &&
        this.rootOf(entry.replyToId) === rootId &&
        !this.where.has(entry.id)
      ) {
        replies.push(this.unsentRow(entry));
      }
    }
    return { root: root ? this.shown(root) : null, replies, ...state };
  }

  private unsentRow(entry: ChatOutboxEntry): ChatMessage {
    const sendState = entry.failed
      ? "failed"
      : this.offline && this.inFlight !== entry.id
        ? "waiting"
        : "sending";
    return {
      id: entry.id,
      workspaceId: this.workspaceId,
      channelId: entry.channelId,
      parentId: entry.replyToId ? this.rootOf(entry.replyToId) : null,
      replyToId: entry.replyToId,
      kind: "message",
      event: null,
      formatVersion: 2,
      authorId: this.userId,
      authorKind: "user",
      authorLabel: null,
      body: entry.body,
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
      decisionAt: null,
      decisionBy: null,
      editedAt: null,
      deletedAt: null,
      clientId: null,
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
      fileCount: entry.files ?? 0,
      sendState,
      ...(entry.failed ? { sendError: entry.failed } : {}),
      ...(entry.dead ? { sendRetry: false as const } : {}),
    };
  }

  /** A message the store holds (server rows only). */
  rowById(id: string): ChatMessage | undefined {
    const channelId = this.where.get(id);
    return channelId ? this.convs.get(channelId)?.rows.get(id) : undefined;
  }

  private rootOf(replyToId: string): string {
    return this.rowById(replyToId)?.parentId ?? replyToId;
  }

  /** The unsent text of a conversation (or one of its chains), kept with the copy (#28). */
  draft(channelId: string, chainId: string | null = null): string {
    return this.drafts[`${channelId}:${chainId ?? ""}`] ?? "";
  }

  setDraft(channelId: string, chainId: string | null, text: string): void {
    const key = `${channelId}:${chainId ?? ""}`;
    if ((this.drafts[key] ?? "") === text) return;
    if (text) {
      this.drafts[key] = text;
      this.clearedDrafts.delete(key);
    } else {
      delete this.drafts[key];
      this.clearedDrafts.add(key);
    }
    this.metaDirty = true;
    this.schedulePersist();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Hold the store while mounted; the last release stops its sockets (the copy stays). */
  acquire(): () => void {
    this.refs += 1;
    if (this.refs === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs -= 1;
      if (this.refs <= 0) this.stop();
    };
  }

  /** The first load is done (or settled on error / offline). */
  ready(): Promise<void> {
    return this.booting ?? Promise.resolve();
  }

  private start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.onFocus);
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    // CV-9: a send waiting on its files goes once they're up.
    // Only while such a send waits, and never past the offline backoff: the
    // queue repaints many times a second while anything uploads.
    this.stopFiles =
      this.files?.subscribe(() => {
        if (this.offline || !this.outbox.some((e) => e.files && !e.failed)) return;
        void this.drain();
      }) ?? null;
    this.booting = this.boot();
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stopLive?.();
    this.stopLive = null;
    this.stopFiles?.();
    this.stopFiles = null;
    for (const t of [this.joinTimer, this.retryTimer, this.countsTimer]) if (t) clearTimeout(t);
    for (const t of [this.accessTimer, this.gapTimer]) if (t) clearInterval(t);
    this.joinTimer = this.retryTimer = this.countsTimer = null;
    this.accessTimer = this.gapTimer = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", this.onFocus);
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    void this.flushMarks();
    void this.persistNow();
  }

  /** Stop for good. `persist: false` (another person, sign-out) writes nothing more. */
  dispose(opts: { persist: boolean }): void {
    if (!opts.persist) {
      // Nothing more reaches the device, not even a write already on its way.
      this.wiped = true;
      this.dirtyRows.clear();
      this.goneIds.clear();
      this.goneConvs.clear();
      this.metaDirty = false;
      this.marks.clear();
    }
    this.stop();
    this.disposed = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.markTimer) clearTimeout(this.markTimer);
    this.listeners.clear();
    this.catchupListeners.clear();
  }

  private async boot(): Promise<void> {
    if (this.status === "idle") {
      this.status = "loading";
      await this.hydrate();
      this.notify();
    }
    let enabled: boolean;
    try {
      enabled = await this.transport.isEnabled(this.workspaceId);
    } catch (e) {
      this.failedBoot(e);
      return;
    }
    if (!this.running) return;
    // A paused plan still reads (CH4a): the conversations load, only writing waits.
    this.paused = !enabled;
    const sidebar = await this.readSidebar({ bootstrap: enabled });
    if (sidebar.error) {
      this.failedBoot(new Error(sidebar.error.message), sidebar.error);
      return;
    }
    await Promise.all([this.readCounts(), this.checkAccess()]);
    if (!this.running) return;
    this.status = "ready";
    this.error = null;
    this.fromDevice = false;
    this.wentOnline();
    this.notify();
    this.startLive();
    void this.drain();
    this.metaDirty = true;
    this.schedulePersist();
  }

  private failedBoot(e: unknown, error?: ChatError): void {
    const network =
      classifyChatError(error ?? { code: null, message: errorText(e, "") }) === "network";
    if (network) {
      this.goOffline();
      // The device copy keeps showing; try again when the network is back.
      this.status = this.channels.size > 0 ? "ready" : "error";
      this.error =
        this.channels.size > 0 ? null : "You're offline · Chat will load when you're back.";
    } else {
      this.status = "error";
      this.error = errorText(e, "Chat couldn't load.");
    }
    this.booting = null;
    this.notify();
  }

  private async hydrate(): Promise<void> {
    const meta = await this.copy.readMeta(this.owner);
    if (!meta) return;
    if (meta.v !== CHAT_COPY_VERSION) {
      // An older shape: its rows go, its waiting sends stay.
      this.outbox = Array.isArray(meta.outbox) ? meta.outbox : [];
      for (const e of this.outbox) this.adopted.add(e.id);
      await this.copy.deleteWhere((o) => o === this.owner);
      this.metaDirty = true;
      return;
    }
    for (const c of meta.channels) this.channels.set(c.id, c);
    for (const m of meta.mine) this.mine.set(m.channelId, m);
    for (const p of meta.people) this.people.set(p.userId, p);
    for (const u of meta.unread) this.unread.set(u.channelId, u);
    this.held = { ...meta.conversations };
    this.cursor = meta.cursor;
    this.accessSince = meta.accessSince;
    this.drafts = { ...meta.drafts };
    this.outbox = [...meta.outbox];
    for (const e of this.outbox) this.adopted.add(e.id);
    if (this.channels.size > 0) {
      this.status = "ready";
      this.fromDevice = true;
    }
  }

  private startLive(): void {
    if (!this.live || this.stopLive || !this.running) return;
    this.stopLive = this.live({ workspaceId: this.workspaceId, userId: this.userId }, this.onLive);
    this.accessTimer = setInterval(() => void this.checkAccess(), this.timing.accessCheckMs);
    this.gapTimer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void this.sync("interval");
      }
    }, this.timing.gapFillMs);
  }

  private onFocus = () => {
    if (!this.running || this.status !== "ready") return;
    const now = Date.now();
    if (now - this.lastFocusSync < this.timing.focusThrottleMs) return;
    this.lastFocusSync = now;
    void this.sync("focus");
  };

  private onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") this.onFocus();
  };

  private onOnline = () => {
    this.wentOnline();
    this.notify();
    if (!this.running) return;
    if (this.status !== "ready" || !this.stopLive) {
      this.booting = this.boot();
      return;
    }
    void this.sync("online");
    void this.drain();
    void this.flushMarks();
  };

  private onOffline = () => {
    this.goOffline();
    this.notify();
  };

  private goOffline(): void {
    this.offline = true;
    if (this.retryTimer || !this.running) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!browserOffline()) this.onOnline();
      else this.goOffline();
    }, this.timing.retryMs);
  }

  private wentOnline(): void {
    if (!this.offline) return;
    this.offline = false;
    for (const id of this.convs.keys()) this.touch(id);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** Note a failed request: the network → offline; anything else is the server's answer. */
  private noteError(error: ChatError): void {
    if (classifyChatError(error) === "network") this.goOffline();
  }

  // ── Server reads ──────────────────────────────────────────────────────────

  private async readSidebar(
    opts: { bootstrap?: boolean } = {},
  ): Promise<{ error: ChatError | null }> {
    try {
      let channels = await this.transport.listChannels(this.workspaceId);
      // The server puts everyone in General; ask it to make one only when none is held.
      if (opts.bootstrap && !channels.some((c) => c.isDefault)) {
        await this.transport.bootstrap(this.workspaceId);
        channels = await this.transport.listChannels(this.workspaceId);
      }
      const [mine, people] = await Promise.all([
        this.transport.listMyMemberships(this.workspaceId, this.userId),
        this.transport.people(this.workspaceId),
      ]);
      this.channels = new Map(channels.map((c) => [c.id, c]));
      this.mine = new Map(mine.map((m) => [m.channelId, m]));
      if (people.data) this.people = new Map(people.data.map((p) => [p.userId, p]));
      this.metaDirty = true;
      this.schedulePersist();
      return { error: null };
    } catch (e) {
      const error = { code: null, message: errorText(e, "Chat couldn't load.") };
      this.noteError(error);
      return { error };
    }
  }

  /** Whether the plan includes chat now (a plan can lapse or come back mid-session). */
  private async readPlan(): Promise<void> {
    try {
      const enabled = await this.transport.isEnabled(this.workspaceId);
      if (this.paused === !enabled) return;
      this.paused = !enabled;
      this.notify();
    } catch {
      // Unknown: keep what we had.
    }
  }

  private async readCounts(): Promise<void> {
    const res = await this.transport.counts(this.workspaceId);
    if (res.error) {
      this.noteError(res.error);
      return;
    }
    this.unread = new Map(res.data.map((u) => [u.channelId, u]));
    this.metaDirty = true;
    this.schedulePersist();
    this.notify();
  }

  private countsSoon(): void {
    if (this.countsTimer) clearTimeout(this.countsTimer);
    this.countsTimer = setTimeout(() => {
      this.countsTimer = null;
      void this.readCounts();
    }, 400);
  }

  /**
   * Fill gaps: the delta, then the counts; on a rejoin, the network coming
   * back or focus also the sidebar and the access check. Runs one at a time.
   */
  sync(reason: "rejoin" | "focus" | "online" | "interval" | "manual"): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    // `.finally` runs after the assignment, even when the work settles at once.
    this.syncing = this.runSync(reason).finally(() => {
      this.syncing = null;
      if (this.syncAgain && this.running) {
        this.syncAgain = false;
        void this.sync("interval");
      }
    });
    return this.syncing;
  }

  private async runSync(
    reason: "rejoin" | "focus" | "online" | "interval" | "manual",
  ): Promise<void> {
    const wasPaused = this.paused;
    if (reason !== "interval") await this.readPlan();
    if ((reason !== "interval" && reason !== "focus") || wasPaused !== this.paused) {
      // A plan that came back makes General if the workspace has none yet.
      await this.readSidebar({ bootstrap: !this.paused });
    }
    const ok = await this.runDelta();
    if (ok) await this.readCounts();
    if (reason !== "interval") await this.checkAccess();
    this.notify();
  }

  /**
   * The conversations a delta reads: those the store holds (rows of the others
   * aren't kept). A row moved away is named by the move line its held source
   * gets. Too many to list in a request: the whole workspace.
   */
  private deltaScope(): string[] | undefined {
    const ids = Object.keys(this.held);
    return ids.length > 0 && ids.length <= DELTA_SCOPE_MAX ? ids : undefined;
  }

  /** Rows changed since the cursor, five minutes early, in (updated_at, id) pages. */
  private async runDelta(): Promise<boolean> {
    if (!this.cursor) return true;
    const since = stampMinus(this.cursor, this.timing.lagMs);
    let after: { updatedAt: string; id: string } | null = null;
    let newest: string | null = this.cursor;
    for (let pages = 1; ; pages += 1) {
      const res = await this.transport.delta({
        workspaceId: this.workspaceId,
        since,
        after,
        limit: this.deltaLimit,
        channelIds: this.deltaScope(),
      });
      if (res.error) {
        this.noteError(res.error);
        return false;
      }
      this.wentOnline();
      for (const row of res.data) {
        this.landRow(row);
        newest = laterStamp(newest, row.updatedAt);
      }
      // The next read starts where this one stopped (the cursor moves only over what was read).
      this.cursor = newest;
      if (res.data.length < this.deltaLimit) break;
      const last = res.data[res.data.length - 1]!;
      after = { updatedAt: last.updatedAt, id: last.id };
      if (pages >= DELTA_MAX_PAGES) {
        // Too far behind for one read: the rest comes with the next one, and
        // what's open reads its newest page again (its window may have a gap).
        for (const [id, conv] of this.convs) {
          conv.loaded = false;
          this.touch(id);
        }
        // Pages by change time: new rows read so far may sit past rows it didn't reach.
        for (const id of Object.keys(this.held)) this.setEdge(id, null);
        if (this.openId) void this.open(this.openId);
        break;
      }
    }
    // Rows a delta brought for conversations that aren't open don't stay in memory.
    if (this.openId) this.trimOthers(this.openId);
    this.metaDirty = true;
    this.schedulePersist();
    return true;
  }

  /**
   * The access check: drop what you can no longer read, from memory and the
   * device. One at a time; a check asked for while one runs runs again after.
   */
  checkAccess(): Promise<void> {
    if (this.accessRunning) {
      this.accessAgain = true;
      return this.accessRunning;
    }
    this.accessRunning = this.runAccessCheck().finally(() => {
      this.accessRunning = null;
      if (this.accessAgain && this.running) {
        this.accessAgain = false;
        void this.checkAccess();
      }
    });
    return this.accessRunning;
  }

  private async runAccessCheck(): Promise<void> {
    // What the store held when the check began is what it judges: a
    // conversation opened while it runs waits for the next check.
    const held = new Set([...this.convs.keys(), ...Object.keys(this.held)]);
    const knownChannels = new Set(this.channels.keys());
    const knownMine = new Set(this.mine.keys());
    const res = await this.transport.syncIds(this.workspaceId, this.accessSince);
    if (res.error) {
      this.noteError(res.error);
      return;
    }
    const plan = planAccess(held, res.data);
    if (!plan) return;
    this.forgetConversations(plan.dropConversations);
    // Moved away: gone from memory and the device, held in memory or not (the
    // server names an id once, for the check after the move).
    this.forgetIds(plan.dropIds);
    // What the sidebar knew when the check began follows it (newer rows wait for the next).
    for (const id of knownChannels) if (!plan.readable.has(id)) this.channels.delete(id);
    for (const id of knownMine) {
      if (!plan.member.has(id)) {
        this.mine.delete(id);
        this.unread.delete(id);
      }
    }
    this.accessSince = plan.checkedAt;
    this.cursor ??= plan.checkedAt;
    this.metaDirty = true;
    this.schedulePersist();
    this.notify();
  }

  // ── Holding rows ──────────────────────────────────────────────────────────

  /** Whether the store holds this conversation (memory or the device's meta). */
  holds(channelId: string): boolean {
    return this.convs.has(channelId) || channelId in this.held;
  }

  private ensureConv(channelId: string): Conv {
    let conv = this.convs.get(channelId);
    if (!conv) {
      conv = {
        rows: new Map(),
        lo: null,
        hasOlder: true,
        hi: null,
        loading: false,
        loaded: false,
        newAfter: null,
        target: null,
      };
      this.convs.set(channelId, conv);
    }
    if (!(channelId in this.held)) {
      // Registered before any of its rows is written: the access check covers it.
      this.held[channelId] = { openedAt: Date.now() };
      this.metaDirty = true;
    }
    return conv;
  }

  /**
   * One server row: it lands only if newer by the server's stamp (an equal one
   * is your echo). A move re-files it; a row for a conversation the store
   * doesn't hold isn't kept; a `moved_out` line drops the ids still filed here.
   * Returns whether anything changed. Doesn't notify.
   */
  private landRow(row: ChatMessage): boolean {
    const was = this.where.get(row.id);
    const prev = was ? this.convs.get(was)?.rows.get(row.id) : undefined;
    if (prev && !isNewerRow(row, prev)) return false;
    const channelId = row.channelId;
    if (was && was !== channelId) {
      this.convs.get(was)?.rows.delete(row.id);
      this.where.delete(row.id);
      this.touch(was);
      if (!this.holds(channelId)) {
        // Moved somewhere this store doesn't hold: it leaves the device too.
        this.goneIds.add(row.id);
        this.dirtyRows.delete(row.id);
        this.schedulePersist();
        return true;
      }
    }
    if (!this.holds(channelId)) return false;
    const conv = this.ensureConv(channelId);
    conv.rows.set(row.id, row);
    this.where.set(row.id, channelId);
    this.landedAt.set(row.id, ++this.seq);
    this.dirtyRows.set(row.id, row);
    this.touch(channelId);
    // Live while the window reaches the newest message: the run goes on.
    if (conv.loaded && !conv.hi) this.advanceEdge(channelId, keyOf(row));
    // A confirmed send leaves the outbox (its echo may beat the op's answer).
    const i = this.outbox.findIndex((e) => e.id === row.id);
    if (i >= 0 && row.authorId === this.userId) {
      const [entry] = this.outbox.splice(i, 1);
      this.handled.add(row.id);
      this.adopted.delete(row.id);
      this.metaDirty = true;
      // Deleted while it was on its way: now it's on the server, delete it there.
      if (entry?.deleted && !row.deletedAt) queueMicrotask(() => void this.remove(row.id));
    }
    if (isMoveLine(row)) {
      const moved = row.event?.ids;
      const ids = Array.isArray(moved)
        ? moved.filter((v): v is string => typeof v === "string")
        : [];
      // Only a copy still filed here and older than the line: a row re-filed
      // elsewhere landed before its line, and one that came back here later
      // (a move back, a second move) was changed after it. A row only the
      // device holds is left to the sync's moved_away answer.
      const lineAt = micros(row.updatedAt);
      this.forgetIds(
        ids.filter((id) => {
          if (this.where.get(id) !== channelId) return false;
          const held = this.convs.get(channelId)?.rows.get(id);
          return !held || micros(held.updatedAt) < lineAt;
        }),
      );
    }
    this.schedulePersist();
    return true;
  }

  private forgetIds(ids: readonly string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) {
      const channelId = this.where.get(id);
      if (channelId) {
        this.convs.get(channelId)?.rows.delete(id);
        this.touch(channelId);
      }
      this.where.delete(id);
      this.landedAt.delete(id);
      this.dirtyRows.delete(id);
      this.goneIds.add(id);
    }
    this.schedulePersist();
  }

  private forgetConversations(ids: readonly string[]): void {
    if (ids.length === 0) return;
    for (const id of ids) {
      const conv = this.convs.get(id);
      if (conv) {
        for (const rowId of conv.rows.keys()) {
          this.where.delete(rowId);
          this.landedAt.delete(rowId);
          this.dirtyRows.delete(rowId);
          this.chainState.delete(rowId);
        }
      }
      this.convs.delete(id);
      this.windowCache.delete(id);
      delete this.held[id];
      this.goneConvs.add(id);
      this.droppedConvs.add(id);
      this.channels.delete(id);
      this.mine.delete(id);
      this.unread.delete(id);
      for (const key of Object.keys(this.drafts)) {
        if (key.startsWith(`${id}:`)) {
          delete this.drafts[key];
          this.clearedDrafts.add(key);
        }
      }
    }
    this.chainCache.clear();
    this.metaDirty = true;
    this.schedulePersist();
  }

  /** A read answered for [from, to): held rows in it that it didn't return are gone from here. */
  private reconcile(
    conv: Conv,
    from: ChatKey | null,
    to: ChatKey | null,
    returned: ReadonlySet<string>,
    since: number,
  ): void {
    const drop: string[] = [];
    for (const row of conv.rows.values()) {
      if (returned.has(row.id)) continue;
      if ((this.landedAt.get(row.id) ?? 0) > since) continue;
      const key = keyOf(row);
      if (from && compareKeys(key, from) < 0) continue;
      if (to && compareKeys(key, to) >= 0) continue;
      drop.push(row.id);
    }
    this.forgetIds(drop);
  }

  /** A conversation other than the open one keeps only its newest page in memory. */
  private trimOthers(openId: string): void {
    for (const [id, conv] of this.convs) {
      if (id === openId || conv.rows.size <= MEMORY_KEEP) continue;
      // Its rows are on the device (or waiting to be written, held by `dirtyRows`).
      for (const rowId of conv.rows.keys()) {
        this.where.delete(rowId);
        this.landedAt.delete(rowId);
        this.chainState.delete(rowId);
      }
      this.convs.delete(id);
      this.windowCache.delete(id);
    }
    this.chainCache.clear();
  }

  private edgeOf(channelId: string): ChatKey | null {
    return this.held[channelId]?.edge ?? null;
  }

  private setEdge(channelId: string, edge: ChatKey | null): void {
    const held = this.held[channelId];
    if (!held) return;
    const was = held.edge ?? null;
    if (was === edge || (was && edge && compareKeys(was, edge) === 0)) return;
    this.held[channelId] = { ...held, edge };
    this.metaDirty = true;
  }

  private advanceEdge(channelId: string, key: ChatKey): void {
    const edge = this.edgeOf(channelId);
    if (!edge || compareKeys(key, edge) > 0) this.setEdge(channelId, key);
  }

  private newestHeld(conv: Conv): ChatKey | null {
    let newest: ChatKey | null = null;
    for (const row of conv.rows.values()) {
      const key = keyOf(row);
      if (!newest || compareKeys(key, newest) > 0) newest = key;
    }
    return newest;
  }

  /** Your read mark in a conversation, as a stream position. */
  private markKey(channelId: string): ChatKey | null {
    const member = this.mine.get(channelId);
    if (!member) return null;
    const row = member.lastReadId ? this.rowById(member.lastReadId) : undefined;
    if (row) return keyOf(row);
    // The mark's row isn't held: its time stands in (last_read_at follows it).
    return { at: member.lastReadAt, id: member.lastReadId ?? "" };
  }

  // ── Opening conversations ─────────────────────────────────────────────────

  /** The screen went away: the next open of any conversation is a return. */
  close(): void {
    this.openId = null;
  }

  /**
   * Open a conversation: the device's newest page paints at once, then the
   * server's newest page lands. Already open this session: nothing to read
   * (Realtime and the gap fill keep it current).
   */
  async open(channelId: string): Promise<void> {
    const returning = this.openId !== channelId;
    this.openId = channelId;
    this.trimOthers(channelId);
    let conv = this.convs.get(channelId);
    if (conv?.loading) return;
    // Back to a conversation already held: the "New" pill moves to where you
    // read up to since (it never moves while you stay in it).
    if (conv?.loaded && returning) {
      conv.newAfter = this.markKey(channelId);
      this.touch(channelId);
      this.notify();
    }
    // Opened again after a jump: back to the newest messages.
    if (conv?.loaded && conv.hi) return this.jumpToLatest(channelId);
    if (conv?.loaded) return;
    conv = this.ensureConv(channelId);
    conv.loading = true;
    conv.newAfter = this.markKey(channelId);
    this.touch(channelId);
    this.notify();
    if (!conv.lo) {
      const saved = await this.copy.newest(this.owner, channelId, PAGE);
      const current = this.convs.get(channelId);
      if (!current) return;
      for (const row of saved) {
        const held = current.rows.get(row.id);
        if (held && !isNewerRow(row, held)) continue;
        if (this.where.has(row.id) && this.where.get(row.id) !== channelId) continue;
        current.rows.set(row.id, row);
        this.where.set(row.id, channelId);
      }
      // The window starts at the device's page (a stray older row from a delta isn't drawn).
      if (saved.length > 0) current.lo = keyOf(saved[0]!);
      current.newAfter = this.markKey(channelId);
      this.touch(channelId);
      this.notify();
    }
    await this.readNewest(channelId);
  }

  private async readNewest(channelId: string): Promise<ChatError | null> {
    const start = this.seq;
    const res = await this.transport.page({ channelId, limit: PAGE });
    const conv = this.convs.get(channelId);
    if (!conv) return null;
    conv.loading = false;
    if (res.error) {
      this.noteError(res.error);
      this.touch(channelId);
      this.notify();
      return res.error;
    }
    this.wentOnline();
    const page = res.data;
    const full = page.length === PAGE;
    // Where the held run that reaches the newest page ends. Not the newest row
    // held: a live row or a delta's row that landed while the conversation
    // wasn't open sits past a gap and would hide it.
    const edge = this.edgeOf(channelId);
    const pageLo = page.length > 0 ? keyOf(page[0]!) : null;
    this.reconcile(conv, full ? pageLo : null, null, new Set(page.map((r) => r.id)), start);
    for (const row of page) this.landRow(row);
    if (pageLo && full && (!edge || compareKeys(pageLo, edge) > 0)) {
      // A gap between what was held and the newest page: start again at the page.
      const older = [...conv.rows.values()].filter((r) => compareKeys(keyOf(r), pageLo) < 0);
      for (const row of older) {
        conv.rows.delete(row.id);
        this.where.delete(row.id);
        this.landedAt.delete(row.id);
      }
      conv.lo = pageLo;
      conv.hasOlder = true;
    } else if (!full) {
      conv.lo = pageLo;
      conv.hasOlder = false;
    } else {
      const held = conv.lo;
      conv.lo = held && pageLo && compareKeys(held, pageLo) < 0 ? held : pageLo;
      conv.hasOlder = true;
    }
    conv.hi = null;
    conv.loaded = true;
    const pageHi = page.length > 0 ? keyOf(page[page.length - 1]!) : null;
    if (pageHi) this.advanceEdge(channelId, pageHi);
    if (!conv.newAfter) conv.newAfter = this.markKey(channelId);
    this.touch(channelId);
    this.notify();
    return null;
  }

  /** The page before the window's oldest message. */
  async loadOlder(channelId: string): Promise<void> {
    const conv = this.convs.get(channelId);
    if (!conv || conv.loading || !conv.hasOlder || !conv.lo) return;
    const before = conv.lo;
    conv.loading = true;
    this.touch(channelId);
    this.notify();
    const start = this.seq;
    const res = await this.transport.page({ channelId, before, limit: PAGE });
    const current = this.convs.get(channelId);
    if (!current) return;
    current.loading = false;
    if (res.error) {
      this.noteError(res.error);
      this.touch(channelId);
      this.notify();
      return;
    }
    const page = res.data;
    const full = page.length === PAGE;
    const pageLo = page.length > 0 ? keyOf(page[0]!) : null;
    this.reconcile(current, full ? pageLo : null, before, new Set(page.map((r) => r.id)), start);
    for (const row of page) this.landRow(row);
    if (pageLo) current.lo = pageLo;
    current.hasOlder = full;
    this.touch(channelId);
    this.notify();
  }

  /** A jump window's next page toward the newest message. */
  async loadNewer(channelId: string): Promise<void> {
    const conv = this.convs.get(channelId);
    if (!conv || conv.loading || !conv.hi) return;
    const after = conv.hi;
    conv.loading = true;
    this.touch(channelId);
    this.notify();
    const res = await this.transport.page({ channelId, after, limit: PAGE });
    const current = this.convs.get(channelId);
    if (!current) return;
    current.loading = false;
    if (res.error) {
      this.noteError(res.error);
    } else {
      for (const row of res.data) this.landRow(row);
      const last = res.data[res.data.length - 1];
      current.hi = res.data.length === PAGE && last ? keyOf(last) : null;
      // Reached the newest message: the window is the run that ends there.
      if (!current.hi && last) this.setEdge(channelId, keyOf(last));
    }
    this.touch(channelId);
    this.notify();
  }

  /** Back to the newest message (the jump bar, or a send from a jump window). */
  async jumpToLatest(channelId: string): Promise<void> {
    const conv = this.convs.get(channelId);
    if (!conv) return this.open(channelId);
    // The jump window isn't contiguous with the newest page: the window starts
    // again at it (older pages load from there).
    conv.hi = null;
    conv.lo = null;
    conv.target = null;
    conv.loading = true;
    this.touch(channelId);
    this.notify();
    await this.readNewest(channelId);
  }

  /**
   * Land on one message (a notice, a search hit, a deep link: AC1.6): load
   * [target − 100, target + 100] around it. Resolves to where it lives (its
   * conversation and chain), or null when you can't read it.
   */
  async openAt(
    channelId: string,
    messageId: string,
  ): Promise<{ channelId: string; chainId: string | null } | null> {
    const found = await this.transport.message(messageId);
    if (found.error) {
      this.noteError(found.error);
      return null;
    }
    const target = found.data;
    if (!target) return null;
    // It may have moved: it opens where it lives now.
    const home = target.channelId || channelId;
    this.openId = home;
    this.trimOthers(home);
    const conv = this.ensureConv(home);
    conv.loading = true;
    this.touch(home);
    this.notify();
    const start = this.seq;
    const key = keyOf(target);
    const [older, newer] = await Promise.all([
      this.transport.page({ channelId: home, before: key, limit: JUMP_SPAN + 1 }),
      this.transport.page({ channelId: home, after: key, limit: JUMP_SPAN + 1 }),
    ]);
    const current = this.convs.get(home);
    if (!current) return null;
    current.loading = false;
    if (older.error || newer.error) {
      this.noteError((older.error ?? newer.error)!);
      this.touch(home);
      this.notify();
      return null;
    }
    // One extra on each side says whether there's more; it lands but isn't drawn.
    const hasOlder = older.data.length > JUMP_SPAN;
    const hasNewer = newer.data.length > JUMP_SPAN;
    const lo = older.data.length > 0 ? keyOf(older.data[hasOlder ? 1 : 0]!) : key;
    const hi = hasNewer ? keyOf(newer.data[JUMP_SPAN - 1]!) : null;
    const returned = new Set([
      target.id,
      ...older.data.map((r) => r.id),
      ...newer.data.map((r) => r.id),
    ]);
    // Held rows inside what was read that it didn't return are gone from here.
    this.reconcile(
      current,
      hasOlder ? keyOf(older.data[0]!) : null,
      hasNewer ? keyOf(newer.data[JUMP_SPAN]!) : null,
      returned,
      start,
    );
    for (const row of [...older.data, target, ...newer.data]) this.landRow(row);
    current.lo = lo;
    current.hasOlder = hasOlder;
    current.hi = hi;
    current.target = target.id;
    current.loaded = true;
    current.newAfter ??= this.markKey(home);
    this.touch(home);
    this.notify();
    return { channelId: home, chainId: target.parentId };
  }

  /** A chain: its root and every reply (v1's thread panel; v2's chain beside the stream). */
  async openChain(rootId: string): Promise<void> {
    const state = this.chainState.get(rootId);
    if (state?.loading || state?.loaded) return;
    this.chainState.set(rootId, { loading: true, loaded: false });
    this.chainCache.delete(rootId);
    this.notify();
    const res = await this.transport.chain(rootId);
    if (res.error) {
      this.noteError(res.error);
      this.chainState.set(rootId, { loading: false, loaded: true });
    } else {
      for (const row of res.data) {
        this.ensureConv(row.channelId);
        this.landRow(row);
      }
      this.chainState.set(rootId, { loading: false, loaded: true });
    }
    this.chainCache.delete(rootId);
    this.notify();
  }

  // ── Live ──────────────────────────────────────────────────────────────────

  /** What the live source tells the store: applied from the event, no request per message. */
  private onLive = (event: ChatLiveEvent): void => {
    if (!this.running) return;
    switch (event.type) {
      case "message": {
        const row = event.row;
        const isNew =
          event.insert && !this.where.has(row.id) && !this.outbox.some((e) => e.id === row.id);
        const changed = this.landRow(row);
        const counted = isNew && this.countArrival(row);
        if (changed || counted) this.notify();
        return;
      }
      case "message-gone": {
        // Only the id arrives; the device may hold it though memory doesn't.
        const shown = this.where.has(event.id);
        this.forgetIds([event.id]);
        if (shown) this.notify();
        return;
      }
      case "channel":
        this.channels.set(event.channel.id, event.channel);
        this.metaDirty = true;
        this.schedulePersist();
        this.notify();
        return;
      case "channel-gone":
        this.forgetConversations([event.id]);
        this.channels.delete(event.id);
        this.notify();
        return;
      case "member": {
        const before = this.mine.get(event.member.channelId);
        // The delete's access stamp on your own row, after this copy forgot the
        // channel: skipped once (a later restore's stamp, from anywhere, still lands).
        if (!before && this.deletedHere.delete(event.member.channelId)) return;
        this.mine.set(event.member.channelId, event.member);
        this.metaDirty = true;
        this.schedulePersist();
        this.notify();
        // Added somewhere new: the sidebar learns the conversation; who may read what changed.
        if (!before) {
          if (!this.channels.has(event.member.channelId))
            void this.readSidebar().then(() => this.notify());
          void this.checkAccess();
        }
        // Your mark moved (another tab or device): the server recounts.
        if (before && before.lastReadId !== event.member.lastReadId) this.countsSoon();
        // The conversation's readers changed (deleted, restored): check access.
        if (before && (event.member.accessAt ?? null) !== (before.accessAt ?? null))
          void this.checkAccess();
        return;
      }
      case "member-left":
        this.mine.delete(event.channelId);
        this.unread.delete(event.channelId);
        this.metaDirty = true;
        this.schedulePersist();
        this.notify();
        void this.checkAccess();
        return;
      case "catchup":
        // Your rows moved (a message wrote one, Done closed one): the counts
        // are re-read once a burst settles (CV-6b), and Catch up's list
        // (`catchup/catchup-store.ts`, CV-11) hears it.
        this.countsSoon();
        for (const fn of this.catchupListeners) fn();
        return;
      case "joined":
        if (this.joinTimer) clearTimeout(this.joinTimer);
        this.joinTimer = setTimeout(() => {
          this.joinTimer = null;
          void this.sync("rejoin");
        }, this.timing.joinDebounceMs);
        return;
      case "lost":
        return;
    }
  };

  /** Whether a message is one you wrote yourself (a post through your key isn't: it's new to you, CV-21). */
  private ownWriting(row: ChatMessage): boolean {
    return row.authorId === this.userId && row.authorKind === "user";
  }

  /** A message of yours that brings you into its chain: yours, or your key's while its replies reach you. */
  private bringsMeIn(row: ChatMessage | undefined): boolean {
    if (!row || row.authorId !== this.userId) return false;
    return row.authorKind === "user" || !row.apiKeyId || this.keyRepliesOn(row.apiKeyId);
  }

  /** A new message from someone else moves the badge slice (the server recounts at the next gap fill). */
  private countArrival(row: ChatMessage): boolean {
    if (row.kind !== "message" || row.deletedAt || this.ownWriting(row)) return false;
    const channel = this.channels.get(row.channelId);
    if (channel && micros(row.createdAt) > micros(channel.lastMessageAt)) {
      this.channels.set(row.channelId, { ...channel, lastMessageAt: row.createdAt });
    }
    const member = this.mine.get(row.channelId);
    if (!member) return channel !== undefined;
    if (micros(row.createdAt) <= micros(member.lastReadAt)) return true;
    const counts = this.unread.get(row.channelId) ?? ZERO(row.channelId);
    const mentioned = row.mentionedUserIds.includes(this.userId) || row.mentionsEveryone;
    const level: ChatNotifyLevel = member.notifyLevel;
    // Your own key's reply is new to you, never a reply addressed to you (CV-21).
    const viaMyKey = row.authorId === this.userId;
    const inMyChain =
      !viaMyKey &&
      row.parentId !== null &&
      (this.bringsMeIn(this.rowById(row.parentId)) ||
        (row.replyToId !== null && this.bringsMeIn(this.rowById(row.replyToId))));
    const addressed =
      level !== "none" && (channel?.kind === "dm" || level === "all" || mentioned || inMyChain);
    this.unread.set(row.channelId, {
      ...counts,
      unread: counts.unread + 1,
      mentions: counts.mentions + (mentioned ? 1 : 0),
      addressed: counts.addressed + (addressed ? 1 : 0),
    });
    return true;
  }

  // ── Read marks ────────────────────────────────────────────────────────────

  /**
   * The last message that was on screen: the read mark moves to it, forward
   * only, and is sent a moment later.
   */
  markSeen(channelId: string, messageId: string): void {
    const member = this.mine.get(channelId);
    const row = this.rowById(messageId);
    if (!member || !row || row.channelId !== channelId) return;
    const mark = this.markKey(channelId);
    if (mark && compareKeys(keyOf(row), mark) <= 0) return;
    this.mine.set(channelId, {
      ...member,
      lastReadId: row.id,
      lastReadAt: laterStamp(member.lastReadAt, row.createdAt) ?? row.createdAt,
    });
    const conv = this.convs.get(channelId);
    const newest = conv ? this.newestHeld(conv) : null;
    if (newest && compareKeys(keyOf(row), newest) >= 0) this.unread.set(channelId, ZERO(channelId));
    this.marks.set(channelId, row.id);
    if (this.markTimer) clearTimeout(this.markTimer);
    this.markTimer = setTimeout(() => void this.flushMarks(), this.timing.markReadMs);
    this.metaDirty = true;
    this.schedulePersist();
    this.notify();
  }

  private async flushMarks(): Promise<void> {
    if (this.markTimer) clearTimeout(this.markTimer);
    this.markTimer = null;
    const marks = [...this.marks];
    if (marks.length === 0 || this.disposed) return;
    this.marks.clear();
    let sent = false;
    for (const [channelId, messageId] of marks) {
      const res = await this.transport.markRead({ channelId, messageId });
      if (res.error) {
        // Lost: sent again when the network is back. Refused: the mark stays local.
        if (classifyChatError(res.error) === "network") {
          if (!this.marks.has(channelId)) this.marks.set(channelId, messageId);
          this.goOffline();
        }
      } else sent = true;
    }
    if (sent) this.countsSoon();
  }

  /** Mark unread from a message (it and everything after it count again). */
  async markUnread(channelId: string, messageId: string): Promise<ChatWriteResult> {
    // The browser's own flag: a failed background read doesn't refuse a write
    // (the write's own answer says whether the network is there).
    if (browserOffline()) return { ok: false, offline: true, message: "Offline" };
    const res = await this.transport.markUnread({ channelId, messageId });
    if (res.error) return this.failed(res.error);
    const conv = this.convs.get(channelId);
    const from = this.rowById(messageId);
    if (conv && from) {
      let n = 0;
      for (const row of conv.rows.values()) {
        if (this.ownWriting(row) || row.deletedAt || row.kind !== "message") continue;
        if (compareKeys(keyOf(row), keyOf(from)) >= 0) n += 1;
      }
      const counts = this.unread.get(channelId) ?? ZERO(channelId);
      this.unread.set(channelId, { ...counts, unread: n });
      this.notify();
    }
    this.countsSoon();
    return { ok: true };
  }

  // ── Sending: the outbox ───────────────────────────────────────────────────

  /**
   * Send a message: visible at once under a client-minted id, then sent in
   * order (offline it waits). Returns the id.
   */
  send(args: {
    channelId: string;
    body: string;
    replyToId?: string | null;
    format?: ChatBodyFormat;
    /** CV-9: the id its files were uploaded under (minted by the composer). */
    id?: string;
    /** CV-9: how many files go with it: it waits until they're up. */
    files?: number;
  }): string {
    const id = args.id ?? newMessageId();
    this.outbox.push({
      id,
      channelId: args.channelId,
      body: args.body,
      replyToId: args.replyToId ?? null,
      format: args.format ?? "v2",
      createdAt: new Date().toISOString(),
      ...(args.files ? { files: args.files } : {}),
    });
    const conv = this.ensureConv(args.channelId);
    if (conv.hi) void this.jumpToLatest(args.channelId);
    this.touch(args.channelId);
    this.metaDirty = true;
    this.notify();
    void this.persistNow();
    void this.drain();
    return id;
  }

  /** "Not sent · Retry": send it again under the same id. */
  retry(id: string): void {
    const entry = this.outbox.find((e) => e.id === id);
    if (!entry?.failed || entry.dead) return;
    delete entry.failed;
    if (entry.files && this.files?.state(entry.id) === "failed") {
      // A file stopped: it goes with the files that made it (and waits for
      // any still on their way).
      this.files.release(entry.id, "stopped");
    }
    this.touch(entry.channelId);
    this.metaDirty = true;
    this.notify();
    void this.persistNow();
    void this.drain();
  }

  /** Throw away an unsent message. */
  discard(id: string): void {
    if (!this.dropEntry(id)) return;
    this.files?.release(id);
    this.notify();
    void this.persistNow();
  }

  /** An outbox entry leaves (sent, discarded or gone in another tab). Doesn't notify. */
  private dropEntry(id: string): boolean {
    const i = this.outbox.findIndex((e) => e.id === id);
    if (i < 0) return false;
    const [entry] = this.outbox.splice(i, 1);
    this.handled.add(id);
    this.adopted.delete(id);
    if (entry) this.touch(entry.channelId);
    this.metaDirty = true;
    return true;
  }

  /**
   * A waiting send this tab read from the device that another tab has since
   * sent or discarded (it left the device's outbox): it isn't sent from here.
   */
  private async handledElsewhere(id: string): Promise<boolean> {
    const meta = await this.copy.readMeta(this.owner);
    if (meta?.v !== CHAT_COPY_VERSION || meta.outbox.some((e) => e.id === id)) return false;
    this.dropEntry(id);
    this.notify();
    return true;
  }

  /**
   * CV-9: are a waiting send's files up? One still uploading holds only its
   * own message (later ones go); one that stopped turns it into "Not sent"
   * (Retry sends it with the files that made it).
   */
  private filesUp(entry: ChatOutboxEntry): boolean {
    if (!entry.files || !this.files) return true;
    const state = this.files.state(entry.id);
    if (state === "failed") {
      // A message of files only whose files all stopped has nothing to send:
      // Retry would fail "empty" forever, so it says why and offers Delete only.
      const c = this.files.counts?.(entry.id);
      const none = !!c && c.moving === 0 && c.stopped >= (entry.files ?? 0);
      if (!entry.body.trim() && none) {
        entry.failed = FILES_ALL_STOPPED;
        entry.dead = true;
      } else {
        entry.failed = "A file didn't upload";
      }
      this.touch(entry.channelId);
      this.metaDirty = true;
      this.notify();
      void this.persistNow();
      return false;
    }
    return state === "ready";
  }

  /** Send what waits, in order, each under its own id. */
  drain(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return this.draining;
    }
    this.draining = this.runDrain().finally(() => {
      this.draining = null;
      if (this.drainAgain) {
        this.drainAgain = false;
        void this.drain();
      }
    });
    return this.draining;
  }

  private async runDrain(): Promise<void> {
    for (;;) {
      if (!this.running || this.disposed) return;
      const entry = this.outbox.find((e) => !e.failed && this.filesUp(e));
      if (!entry) return;
      if (browserOffline()) {
        this.goOffline();
        this.touch(entry.channelId);
        this.notify();
        return;
      }
      if (this.adopted.has(entry.id) && (await this.handledElsewhere(entry.id))) continue;
      if (!this.running || this.disposed) return;
      this.inFlight = entry.id;
      this.touch(entry.channelId);
      this.notify();
      const res = await this.transport.send({
        id: entry.id,
        channelId: entry.channelId,
        body: entry.body,
        replyToId: entry.replyToId,
        format: entry.format,
      });
      this.inFlight = null;
      if (res.error) {
        if (classifyChatError(res.error) === "network") {
          // Waiting to send: it goes by itself when the network is back.
          this.goOffline();
          for (const e of this.outbox) this.touch(e.channelId);
          this.notify();
          return;
        }
        if (entry.deleted) {
          // Refused, and you had deleted it anyway: it goes.
          this.dropEntry(entry.id);
        } else {
          entry.failed = res.error.message || "Not sent";
        }
      } else {
        this.wentOnline();
        const i = this.outbox.findIndex((e) => e.id === entry.id);
        const sent = i >= 0 ? this.outbox.splice(i, 1)[0] : undefined;
        this.handled.add(entry.id);
        this.adopted.delete(entry.id);
        this.ensureConv(res.data.channelId);
        this.landRow(res.data);
        // Deleted while it was on its way (its echo didn't come first).
        if (sent?.deleted) void this.remove(entry.id);
      }
      this.touch(entry.channelId);
      this.metaDirty = true;
      this.notify();
      void this.persistNow();
    }
  }

  // ── Writes over a row: one overlay each ───────────────────────────────────

  private failed(error: ChatError): ChatWriteResult {
    const network = classifyChatError(error) === "network";
    if (network) this.goOffline();
    this.notify();
    return { ok: false, offline: network, message: network ? "Offline" : error.message };
  }

  private async write(
    id: string,
    apply: (row: ChatMessage) => ChatMessage,
    call: () => Promise<ChatResult<ChatMessage>>,
  ): Promise<ChatWriteResult> {
    if (browserOffline()) return { ok: false, offline: true, message: "Offline" };
    const channelId = this.where.get(id);
    const op = nextOp++;
    this.overlays.push({ op, id, apply });
    if (channelId) this.touch(channelId);
    this.chainCache.clear();
    this.notify();
    const res = await call();
    // Its answer (or its refusal) replaces the overlay: only this write rolls back.
    this.overlays = this.overlays.filter((o) => o.op !== op);
    const now = this.where.get(id);
    if (now) this.touch(now);
    this.chainCache.clear();
    if (res.error) return this.failed(res.error);
    this.wentOnline();
    this.landRow(res.data);
    this.notify();
    return { ok: true };
  }

  edit(id: string, body: string, format: ChatBodyFormat = "v2"): Promise<ChatWriteResult> {
    const at = new Date().toISOString();
    return this.write(
      id,
      (row) => ({ ...row, body, editedAt: at }),
      () => this.transport.edit({ id, body, format }),
    );
  }

  remove(id: string): Promise<ChatWriteResult> {
    const entry = this.outbox.find((e) => e.id === id);
    if (entry) {
      if (this.inFlight === id) {
        // On its way: it may land on the server (even if its answer is lost),
        // so it stays out of sight and is deleted there once it does.
        entry.deleted = true;
        this.touch(entry.channelId);
        this.metaDirty = true;
        this.notify();
        void this.persistNow();
      } else {
        this.discard(id);
      }
      return Promise.resolve({ ok: true });
    }
    const at = new Date().toISOString();
    return this.write(
      id,
      (row) => ({ ...row, deletedAt: row.deletedAt ?? at, body: "", reactions: {} }),
      () => this.transport.remove(id),
    );
  }

  react(id: string, key: string, on: boolean): Promise<ChatWriteResult> {
    const me = this.userId;
    return this.write(
      id,
      (row) => {
        const users = (row.reactions[key] ?? []).filter((u) => u !== me);
        const reactions = { ...row.reactions };
        if (on) reactions[key] = [...users, me];
        else if (users.length > 0) reactions[key] = users;
        else delete reactions[key];
        return { ...row, reactions };
      },
      () => this.transport.react({ id, key, on }),
    );
  }

  pin(id: string, pinned: boolean): Promise<ChatWriteResult> {
    const at = new Date().toISOString();
    return this.write(
      id,
      (row) => ({
        ...row,
        pinnedAt: pinned ? (row.pinnedAt ?? at) : null,
        pinnedBy: pinned ? (row.pinnedBy ?? this.userId) : null,
      }),
      () => this.transport.pin({ id, pinned }),
    );
  }

  /** Wrap up a chain (CV-12): its replies leave the stream (a drawing rule on the root). */
  async wrapUp(rootId: string, settledId: string, markDecision = false): Promise<ChatWriteResult> {
    const at = new Date().toISOString();
    const res = await this.write(
      rootId,
      (row) => ({ ...row, wrappedAt: at, wrappedBy: this.userId, settledId }),
      () => this.transport.wrapUp({ rootId, settledId, markDecision }),
    );
    // "Also mark as decision" (CV-14): the settling reply changed on the server too.
    if (res.ok && markDecision) await this.readBack(settledId);
    return res;
  }

  /** Mark or unmark a message as a decision (CV-14). */
  markDecision(id: string, on: boolean): Promise<ChatWriteResult> {
    const at = new Date().toISOString();
    return this.write(
      id,
      (row) => ({
        ...row,
        decisionAt: on ? (row.decisionAt ?? at) : null,
        decisionBy: on ? (row.decisionBy ?? this.userId) : null,
      }),
      () => this.transport.markDecision({ id, on }),
    );
  }

  /**
   * Reopen a wrapped chain (also the wrap-up toast's Undo). The server's Undo
   * also takes back the decision that wrap-up made (CV-14), in the same op:
   * the settling reply is read back once it answers.
   */
  async reopen(rootId: string): Promise<ChatWriteResult> {
    const settledId = this.rowById(rootId)?.settledId ?? null;
    const res = await this.write(
      rootId,
      (row) => ({ ...row, wrappedAt: null, wrappedBy: null, settledId: null }),
      () => this.transport.reopen(rootId),
    );
    if (res.ok && settledId) await this.readBack(settledId);
    return res;
  }

  /** A row another op changed on the server lands as it is there now. */
  private async readBack(id: string): Promise<void> {
    const row = await this.transport.message(id);
    if (!row.data) return;
    this.landRow(row.data);
    this.chainCache.clear();
    this.notify();
  }

  /** "Reply to…": the message joins `replyToId`'s chain; both chains' roots read again. */
  async attachToChain(messageId: string, replyToId: string): Promise<ChatWriteResult> {
    const oldRoot = this.rowById(messageId)?.parentId ?? null;
    const res = await this.write(
      messageId,
      (row) => ({ ...row, parentId: this.rootOf(replyToId), replyToId }),
      () => this.transport.attachToChain({ messageId, replyToId }),
    );
    if (!res.ok) return res;
    const roots = [...new Set([oldRoot, this.rowById(messageId)?.parentId ?? null])].filter(
      (id): id is string => !!id,
    );
    const read = await Promise.all(roots.map((id) => this.transport.message(id)));
    for (const root of read) if (root.data) this.landRow(root.data);
    this.chainCache.clear();
    this.notify();
    return res;
  }

  /**
   * "Move to…" (CV-16). `confirm` answers the audience warning; `undo` with
   * the moved ids and the source as the target (within 10 s) is the Undo.
   * The moved rows leave this conversation at once; the delta re-files them
   * where they went (when this copy holds it).
   */
  async moveMessages(
    ids: readonly string[],
    targetId: string,
    confirm = false,
    undo = false,
  ): Promise<
    { ok: true; answer: ChatMoveAnswer } | { ok: false; offline: boolean; message: string }
  > {
    if (browserOffline()) return { ok: false, offline: true, message: "Offline" };
    const res = await this.transport.moveMessages({ ids: [...ids], targetId, confirm, undo });
    if (res.error) {
      const failed = this.failed(res.error);
      return failed.ok ? { ok: false, offline: false, message: res.error.message } : failed;
    }
    this.wentOnline();
    const answer = res.data;
    if (answer.status !== "confirm") {
      this.forgetIds(answer.ids.filter((id) => this.where.get(id) === answer.from));
      this.chainCache.clear();
      this.notify();
      void this.sync("interval");
    }
    return { ok: true, answer };
  }

  // ── Conversation ops (they throw; the screens say why) ────────────────────

  async createChannel(args: {
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
    announcement?: boolean;
    link?: ChatLink | null;
  }): Promise<ChatChannel> {
    const channel = await this.transport.createChannel({ workspaceId: this.workspaceId, ...args });
    this.channels.set(channel.id, channel);
    await this.readSidebar();
    this.notify();
    return channel;
  }

  async openDm(userIds: string[]): Promise<ChatChannel> {
    const channel = await this.transport.openDm({ workspaceId: this.workspaceId, userIds });
    this.channels.set(channel.id, channel);
    await this.readSidebar();
    this.notify();
    return channel;
  }

  async join(channelId: string): Promise<void> {
    const member = await this.transport.join(channelId);
    this.mine.set(channelId, member);
    this.metaDirty = true;
    this.notify();
    this.countsSoon();
  }

  async leave(channelId: string): Promise<void> {
    await this.transport.leave(channelId);
    this.mine.delete(channelId);
    this.unread.delete(channelId);
    this.metaDirty = true;
    this.notify();
    void this.checkAccess();
  }

  async updateChannel(channelId: string, patch: { name?: string; topic?: string }): Promise<void> {
    const channel = await this.transport.updateChannel({ channelId, ...patch });
    this.channels.set(channel.id, channel);
    this.notify();
  }

  /** Links the channel to one item, or unlinks it (CV-13). */
  async linkChannel(channelId: string, link: ChatLink | null): Promise<ChatChannel> {
    const channel = await this.transport.linkChannel({ channelId, link });
    this.channels.set(channel.id, channel);
    this.notify();
    return channel;
  }

  async archiveChannel(channelId: string, archived: boolean): Promise<void> {
    const channel = await this.transport.archiveChannel({ channelId, archived });
    this.channels.set(channel.id, channel);
    this.notify();
    this.countsSoon();
  }

  // ── Lifecycle (CV-15): every rule is the server's; these keep the copy in step ──

  async addMembers(channelId: string, userIds: string[]): Promise<number> {
    return this.transport.addMembers({ channelId, userIds });
  }

  async removeMember(channelId: string, userId: string): Promise<void> {
    await this.transport.removeMember({ channelId, userId });
  }

  async setManager(channelId: string, userId: string, on: boolean): Promise<void> {
    await this.transport.setManager({ channelId, userId, on });
  }

  async setAnnouncement(channelId: string, on: boolean): Promise<void> {
    const channel = await this.transport.setAnnouncement({ channelId, on });
    this.channels.set(channel.id, channel);
    this.notify();
  }

  async makePrivate(channelId: string): Promise<void> {
    const channel = await this.transport.makePrivate(channelId);
    this.channels.set(channel.id, channel);
    this.notify();
  }

  /** To Recently deleted: it leaves this copy at once (the server no longer lets anyone read it). */
  async deleteChannel(channelId: string): Promise<void> {
    await this.transport.deleteChannel(channelId);
    this.deletedHere.add(channelId);
    this.forgetConversations([channelId]);
    this.channels.delete(channelId);
    this.mine.delete(channelId);
    this.unread.delete(channelId);
    this.metaDirty = true;
    this.schedulePersist();
    this.notify();
  }

  async restoreChannel(channelId: string): Promise<ChatChannel> {
    const channel = await this.transport.restoreChannel(channelId);
    this.deletedHere.delete(channel.id);
    this.channels.set(channel.id, channel);
    await this.readSidebar();
    this.notify();
    void this.checkAccess();
    return channel;
  }

  recentlyDeleted(): Promise<ChatDeletedChannel[]> {
    return this.transport.recentlyDeleted(this.workspaceId);
  }

  async setPrefs(
    channelId: string,
    prefs: { notifyLevel?: ChatNotifyLevel; starred?: boolean },
  ): Promise<void> {
    const before = this.mine.get(channelId);
    if (!before) return;
    this.mine.set(channelId, { ...before, ...prefs });
    this.notify();
    try {
      const member = await this.transport.setPrefs({ channelId, ...prefs });
      this.mine.set(channelId, member);
      this.metaDirty = true;
      this.notify();
      this.countsSoon();
    } catch (e) {
      this.mine.set(channelId, before);
      this.notify();
      throw e;
    }
  }

  // ── The device copy ───────────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.disposed || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, this.timing.persistMs);
  }

  /** Write what changed: rows (≤ 200 a transaction, eviction inside), removals, meta. */
  persistNow(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.persisting = this.persisting.then(() => this.writeCopy());
    return this.persisting;
  }

  private async writeCopy(): Promise<void> {
    if (this.wiped) return;
    const rows = [...this.dirtyRows.values()].filter((r) => r.channelId in this.held);
    this.dirtyRows.clear();
    const goneConvs = [...this.goneConvs];
    this.goneConvs.clear();
    const goneIds = [...this.goneIds];
    this.goneIds.clear();
    const meta = this.metaDirty || rows.length > 0 || goneConvs.length > 0;
    this.metaDirty = false;
    // Registered first: a row is never on the device for a conversation the check can't see.
    if (meta) await this.copy.updateMeta(this.owner, (stored) => this.metaRecord(stored));
    if (goneConvs.length) await this.copy.removeConversations(this.owner, goneConvs);
    if (goneIds.length) await this.copy.removeIds(this.owner, goneIds);
    // A sign-out that landed meanwhile wipes the copy: no rows after it.
    if (rows.length && !this.wiped) {
      await this.copy.put(this.owner, rows, DEVICE_KEEP, () => this.wiped);
    }
  }

  private metaRecord(stored: ChatMeta | null): ChatMeta {
    const current = stored?.v === CHAT_COPY_VERSION ? stored : null;
    if (current) {
      // A waiting send read from the device that another tab sent or discarded
      // since: writing it back would bring it back.
      const stillThere = new Set(current.outbox.map((e) => e.id));
      for (const id of [...this.adopted]) {
        if (!stillThere.has(id) && this.inFlight !== id && this.dropEntry(id)) {
          queueMicrotask(() => this.notify());
        }
      }
    }
    const mine = new Set(this.outbox.map((e) => e.id));
    // Another tab's waiting sends stay; what this tab sent or discarded goes.
    const others = (current?.outbox ?? []).filter(
      (e) => !mine.has(e.id) && !this.handled.has(e.id),
    );
    // Another tab's conversations and drafts stay registered: the check must
    // see every conversation the copy keeps rows for. What this tab dropped goes.
    const conversations: ChatMeta["conversations"] = {};
    for (const [id, at] of Object.entries(current?.conversations ?? {})) {
      if (!this.droppedConvs.has(id)) conversations[id] = at;
    }
    Object.assign(conversations, this.held);
    const drafts: ChatMeta["drafts"] = {};
    for (const [key, text] of Object.entries(current?.drafts ?? {})) {
      if (!this.clearedDrafts.has(key)) drafts[key] = text;
    }
    Object.assign(drafts, this.drafts);
    return {
      ...emptyMeta(),
      savedAt: Date.now(),
      conversations,
      cursor: this.cursor,
      accessSince: this.accessSince,
      outbox: [...this.outbox, ...others],
      drafts,
      channels: [...this.channels.values()],
      mine: [...this.mine.values()],
      people: [...this.people.values()],
      unread: [...this.unread.values()],
    };
  }
}

// ── One store per person and workspace ──────────────────────────────────────

const registries = new WeakMap<object, Map<string, ChatStore>>();
const everyStore = new Set<ChatStore>();
let storeOptions: ChatStoreOptions = {};
let defaultLive: (() => ChatLiveSource) | null = null;

/** Tests: the options every new store gets. */
export function setChatStoreOptionsForTests(opts: ChatStoreOptions): void {
  storeOptions = opts;
}

/** The app's live source (set once by `react.ts`, which owns the socket). */
export function setDefaultChatLive(make: () => ChatLiveSource): void {
  defaultLive = make;
}

let defaultFiles: (() => ChatFileGate) | null = null;

/** The app's upload queue answers whether a message's files are up (CV-9). */
export function setDefaultChatFiles(make: () => ChatFileGate): void {
  defaultFiles = make;
}

/**
 * The chat store for a workspace, made on first use. Keyed by the runtime
 * (each test's fake gets its own) and the workspace; one made for another
 * person is thrown away.
 */
export function chatStore(runtime: ModuoRuntime, userId: string, workspaceId: string): ChatStore {
  let byWorkspace = registries.get(runtime.chat);
  if (!byWorkspace) {
    byWorkspace = new Map();
    registries.set(runtime.chat, byWorkspace);
  }
  let store = byWorkspace.get(workspaceId);
  if (store && store.userId !== userId) {
    store.dispose({ persist: false });
    everyStore.delete(store);
    store = undefined;
  }
  if (!store) {
    store = new ChatStore(runtime.chat, userId, workspaceId, {
      ...storeOptions,
      live: storeOptions.live ?? defaultLive?.() ?? undefined,
      files: storeOptions.files ?? defaultFiles?.() ?? undefined,
    });
    byWorkspace.set(workspaceId, store);
    everyStore.add(store);
  }
  return store;
}

function disposeStores(keep: (store: ChatStore) => boolean, persist: boolean): void {
  for (const store of [...everyStore]) {
    if (keep(store)) continue;
    store.dispose({ persist });
    if (registries.get(store.transport)?.get(store.workspaceId) === store) {
      registries.get(store.transport)?.delete(store.workspaceId);
    }
    everyStore.delete(store);
  }
}

const copyOf = () => storeOptions.copy ?? chatDeviceCopy();

/**
 * Who is signed in now (beside Tasks' `attachSyncUser`). Someone: stores and
 * copies of anyone else go. Nobody: the stores stop, the copy stays (a session
 * that failed to load offline comes back with its waiting sends).
 */
export function attachChatUser(userId: string | null): Promise<void> {
  if (userId === null) {
    disposeStores(() => false, true);
    return Promise.resolve();
  }
  disposeStores((store) => store.userId === userId, false);
  return copyOf().deleteWhere((owner) => !isOwnerOf(owner, userId));
}

/** Signed out, or the account was deleted: every store and the whole chat copy go. */
export function wipeChatCopies(): Promise<void> {
  disposeStores(() => false, false);
  return copyOf().clear();
}

/** The person's workspace list came back: copies of workspaces not on it go. */
export function keepChatWorkspaces(userId: string, workspaceIds: readonly string[]): Promise<void> {
  const keep = new Set(workspaceIds.map((ws) => ownerKey(userId, ws)));
  disposeStores((store) => store.userId !== userId || keep.has(store.owner), false);
  return copyOf().deleteWhere((owner) => isOwnerOf(owner, userId) && !keep.has(owner));
}

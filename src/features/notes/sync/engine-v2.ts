/**
 * Notes sync engine v2 (Wave-3 NO-2) — the offline core.
 *
 * Per open note: one Y.Doc, persisted locally by y-indexeddb (every keystroke
 * survives reload/offline), synced to Supabase via
 *   push  = notes_op_apply_updates (idempotent outbox, client_seq-deduped)
 *   pull  = snapshot + note_updates since the cursor (open/reconnect/refocus)
 *   fold  = notes_op_save_snapshot once the log grows (client-side compaction
 *           — Yjs can't merge in plpgsql).
 * Metadata mutations made offline queue in the meta-outbox and replay FIFO on
 * reconnect. Realtime broadcast plugs into this engine in NO-6; until then
 * freshness comes from refocus/reconnect pulls (the designed fallback path).
 *
 * Status contract (the quiet dot): "synced" — nothing while healthy;
 * "pending" — local edits queued/flushing; "offline" — a push/pull failed,
 * everything is saved locally and will sync.
 *
 * An honest provider (NR-3): a session is usable the moment its local cache
 * has loaded (`cacheReady`), so the editor paints and takes typing from the
 * cached doc at once. The provider reports `sync` to Lexical only after the
 * first pull has settled (Lexical's bootstrap writes an empty paragraph into a
 * doc that looks empty at sync time, so an early `sync` raced the remote
 * content), and the session counts as `synced` only once a pull succeeded.
 */

import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { tryDeriveNoteBody } from "../editor/doc-markdown";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";
import { AgentOrigin, type AgentUndo, createAgentUndo, isForeignOrigin } from "./agent-origin";
import {
  type DocOutboxEntry,
  deleteDocOutboxEntries,
  deleteMetaOutboxEntries,
  enqueueDocUpdate,
  enqueueMetaOp,
  listDocOutboxNoteIds,
  type MetaOutboxEntry,
  type NoteSyncState,
  openNotesDb,
  readDocOutbox,
  readMetaOutbox,
  readNoteState,
  writeNoteState,
} from "./idb";
import { callMetaOp, isNetworkError, replayDecision, replayOrder } from "./meta-outbox";
import {
  ackedKeys,
  advanceCursor,
  assignSeq,
  emptyNoteState,
  planPushBatch,
  shouldCompact,
  toPushPayload,
} from "./outbox";

export type NotesSyncStatusV2 = "synced" | "pending" | "offline";

const CLIENT_ID_KEY = "moduo:notes:client-id:v1";
const FLUSH_DEBOUNCE_MS = 400;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

export function getNotesClientId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    // Storage-blocked: a SESSION-scoped id, never a shared literal — a
    // constant here would make every such client dedupe against each other's
    // (client_id, client_seq) keys server-side.
    return crypto.randomUUID();
  }
}

/** Minimal provider shape for Lexical's CollaborationPlugin: awareness plus
 * inert connect/disconnect (NO-6's Realtime transport replaces the stub). */
export type NoteProviderStub = {
  awareness: Awareness;
  connect: () => void;
  disconnect: () => void;
  on: (event: string, cb: (...args: any[]) => void) => void;
  off: (event: string, cb: (...args: any[]) => void) => void;
};

type NoteSession = {
  noteId: string;
  doc: Y.Doc;
  persistence: IndexeddbPersistence;
  provider: NoteProviderStub;
  state: NoteSyncState;
  /** The local IndexedDB copy has loaded: safe to mount the editor. */
  cacheReady: Promise<void>;
  /** Cache loaded, first pull settled, first flush done. */
  booted: Promise<void>;
  /** A pull has completed against the server this session (a draft is
   * synced from the start: its local doc is the whole note). */
  synced: boolean;
  /** A push went out without bodies (before the first pull); the next flush
   * after a pull owes the server one body-only save. */
  bodyOwed: boolean;
  /** The provider has told Lexical `sync` (after the first pull settled). */
  syncReported: boolean;
  syncListeners: Set<(isSynced: boolean) => void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryMs: number;
  flushing: boolean;
  /** Set while a flush cycle re-runs because more edits arrived mid-push. */
  dirty: boolean;
  /** Fallback queue for updates IndexedDB refused to persist (private mode,
   * quota) — pushed like the durable queue, honest about volatility. */
  memOutbox: DocOutboxEntry[];
  /** Set when a pulled update failed to DECODE — the doc provably lacks
   * content the cursor moved past, so compaction must not fold/delete the
   * log this session (another client may still absorb those rows). */
  compactVeto: boolean;
  lastUsedAt: number;
  destroyed: boolean;
  /** NR-6: Undo for agent writes that reached this session's doc. */
  agentUndo: AgentUndo;
};

/** Keep at most this many idle note sessions alive (fast note switching)
 * before closing the least-recently-used — each holds a Y.Doc + an
 * IndexedDB connection for the whole workspace visit otherwise. */
const MAX_IDLE_SESSIONS = 8;

type StatusListener = (status: NotesSyncStatusV2) => void;

export class NotesSyncEngineV2 {
  private readonly clientId = getNotesClientId();
  /** Used instead of the durable clientId when IndexedDB is unavailable: the
   * seq counter can't persist there, so a reload would restart at seq 1 under
   * the SAME id and the server dedupe would silently drop the new content.
   * A volatile identity makes every such session a fresh client. */
  private readonly volatileClientId = crypto.randomUUID();
  private idbOk: boolean | null = null;
  private readonly sessions = new Map<string, NoteSession>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: NotesSyncStatusV2 = "synced";
  private destroyed = false;
  private detachWindow: (() => void) | null = null;
  private replayingMeta = false;
  /** Lazy drafts (NR-2): notes that exist only on this device until their
   * first character. Their sessions don't pull (there is nothing on the
   * server), and their edits stay out of the push outbox, so an untouched
   * draft leaves no queued update behind and a typed one never pushes ahead
   * of its create. */
  private readonly drafts = new Set<string>();
  /** Promoted drafts whose create hasn't landed yet: their edits are queued
   * durably (so nothing typed is lost if the page closes) but not pushed until
   * `releasePush`, so a push can never reach the server before its create. */
  private readonly held = new Set<string>();

  constructor(
    private readonly runtime: ModuoRuntime | null,
    private readonly workspaceId: string,
    /** Called after a reconnect replay/pull so the meta layer can refresh. */
    private readonly onRemoteMetaChange?: () => void,
  ) {
    if (typeof window !== "undefined") {
      const wake = () => {
        if (document.visibilityState !== "visible") return;
        void this.wake();
      };
      const online = () => void this.wake();
      window.addEventListener("online", online);
      document.addEventListener("visibilitychange", wake);
      this.detachWindow = () => {
        window.removeEventListener("online", online);
        document.removeEventListener("visibilitychange", wake);
      };
    }
    // Reload with a non-empty outbox → resume pushing without waiting for the
    // notes to be reopened.
    void this.flushOrphanedOutbox();
  }

  // ── status ──────────────────────────────────────────────────────────────────

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: NotesSyncStatusV2) {
    if (this.status === status) return;
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  private async resolveClientId(): Promise<string> {
    if (this.idbOk === null) {
      this.idbOk = Boolean(await openNotesDb());
    }
    return this.idbOk ? this.clientId : this.volatileClientId;
  }

  /** Anything still queued anywhere (durable OR memory)? */
  private async hasQueuedUpdates(): Promise<boolean> {
    for (const s of this.sessions.values()) {
      if (s.memOutbox.length > 0) return true;
    }
    const ids = await listDocOutboxNoteIds(this.workspaceId);
    return ids.length > 0;
  }

  // ── sessions ────────────────────────────────────────────────────────────────

  getOrCreateSession(noteId: string): NoteSession {
    let s = this.sessions.get(noteId);
    if (s) {
      s.lastUsedAt = Date.now();
      return s;
    }
    const doc = new Y.Doc();
    // Pre-register the typed root BEFORE any update applies (the known
    // text-loss footgun — see the legacy engine + runtime applyCrdtUpdates).
    doc.get("root-v2", Y.XmlElement);
    const persistence = new IndexeddbPersistence(
      `moduo:notes-v2:doc:${this.workspaceId}:${noteId}`,
      doc,
    );
    const awareness = new Awareness(doc);
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    const syncListeners = new Set<(isSynced: boolean) => void>();
    const provider: NoteProviderStub = {
      awareness,
      connect: () => {},
      disconnect: () => {},
      on: (event, cb) => {
        if (event === "sync") {
          // Honest: `sync` fires once the first pull has settled, never
          // before (a late subscriber hears it straight away).
          syncListeners.add(cb);
          if (s?.syncReported) queueMicrotask(() => cb(true));
          return;
        }
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      },
      off: (event, cb) => {
        if (event === "sync") syncListeners.delete(cb);
        else listeners.get(event)?.delete(cb);
      },
    };

    s = {
      noteId,
      doc,
      persistence,
      provider,
      state: emptyNoteState(noteId),
      cacheReady: Promise.resolve(),
      booted: Promise.resolve(),
      synced: false,
      bodyOwed: false,
      syncReported: false,
      syncListeners,
      flushTimer: null,
      retryTimer: null,
      retryMs: RETRY_BASE_MS,
      flushing: false,
      dirty: false,
      memOutbox: [],
      compactVeto: false,
      lastUsedAt: Date.now(),
      destroyed: false,
      agentUndo: createAgentUndo(doc),
    };
    this.sessions.set(noteId, s);
    this.evictIdleSessions(noteId);
    let markCacheReady: () => void = () => {};
    s.cacheReady = new Promise<void>((resolve) => {
      markCacheReady = resolve;
    });
    s.booted = this.boot(s, markCacheReady);

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (s!.destroyed) return;
      // Ignore what we applied ourselves: remote pulls, the local IDB cache
      // replaying at boot, agent writes (already stored server-side), and
      // awareness/bootstrap application.
      if (isForeignOrigin(origin, persistence)) return;
      // A draft's edits live in the doc (and its local cache) only; promoting
      // it queues the whole state as one update.
      if (this.drafts.has(noteId)) return;
      void this.enqueueLocalUpdate(s!, update);
    });

    return s;
  }

  private async boot(s: NoteSession, markCacheReady: () => void): Promise<void> {
    try {
      s.state = (await readNoteState(s.noteId)) ?? emptyNoteState(s.noteId);
      await s.persistence.whenSynced;
    } catch {
      // cache-less boot is fine
    } finally {
      markCacheReady();
    }
    if (this.drafts.has(s.noteId)) {
      // Nothing on the server yet: the local doc is the whole truth.
      s.synced = true;
      this.reportSync(s);
      return;
    }
    await this.pull(s);
    // Reported even when the pull failed (offline): the editor must still be
    // able to bootstrap an empty doc to type into. `synced` stays false.
    this.reportSync(s);
    await this.flush(s);
  }

  /** Tell Lexical the doc is as complete as it is going to get for now. */
  private reportSync(s: NoteSession) {
    if (s.syncReported || s.destroyed) return;
    s.syncReported = true;
    for (const cb of s.syncListeners) cb(true);
  }

  /** Pull the snapshot + log since our cursor and merge into the live doc.
   * Always safe: Yjs application is idempotent and order-independent. */
  private async pull(s: NoteSession): Promise<number> {
    if (!this.runtime || s.destroyed) return 0;
    try {
      const res = await this.runtime.notesV2.pullDoc({
        workspaceId: this.workspaceId,
        noteId: s.noteId,
        sinceUpdateId: s.state.lastPulledUpdateId,
      });
      if (res.snapshotB64) {
        try {
          Y.applyUpdate(s.doc, decodeBase64ToUint8(res.snapshotB64), "remote");
        } catch (e) {
          console.warn("[notes-sync] bad remote snapshot ignored", e);
        }
      }
      const ids: number[] = [];
      for (const u of res.updates) {
        // Own echoes apply too — Yjs makes it a no-op when the doc already
        // has them, and a cache-evicted client NEEDS them (skipping by
        // clientId lost history whenever local persistence didn't survive).
        try {
          // Agent rows get an agent origin: that is what the session's Undo
          // tracks (NR-6). Everything else is plain remote.
          const origin = u.origin === "agent" ? new AgentOrigin(u.actorKeyId, null) : "remote";
          Y.applyUpdate(s.doc, decodeBase64ToUint8(u.updateB64), origin);
          ids.push(u.id);
        } catch (e) {
          // The cursor still advances (or we'd re-pull a poison row forever),
          // but the doc provably lacks this content now — compaction must not
          // fold/delete the log this session.
          console.warn("[notes-sync] bad remote update ignored", e);
          s.compactVeto = true;
          ids.push(u.id);
        }
      }
      s.state = advanceCursor(s.state, ids);
      await writeNoteState(s.state);
      s.synced = true;
      this.recoveredFromOffline(s);
      if (s.bodyOwed) this.scheduleFlush(s, 0);
      return ids.length;
    } catch (e) {
      if (isNetworkError(e)) this.setStatus("offline");
      else console.warn("[notes-sync] pull failed", e);
      return 0;
    }
  }

  private async enqueueLocalUpdate(s: NoteSession, update: Uint8Array): Promise<void> {
    const { seq, next } = assignSeq(s.state);
    s.state = next;
    s.lastUsedAt = Date.now();
    // Counter FIRST, entry second — a crash between them leaves a harmless
    // seq gap. The reverse order could reuse a committed seq with different
    // content on reload; the server's dedupe would then silently drop it.
    await writeNoteState(s.state);
    const persisted = await enqueueDocUpdate({
      workspaceId: this.workspaceId,
      noteId: s.noteId,
      clientSeq: seq,
      updateB64: encodeUint8ToBase64(update),
      queuedAt: Date.now(),
    });
    if (!persisted) {
      // IndexedDB refused (private mode / quota): queue in memory so the
      // content still pushes — durable server-side even if not locally.
      s.memOutbox.push({
        workspaceId: this.workspaceId,
        noteId: s.noteId,
        clientSeq: seq,
        updateB64: encodeUint8ToBase64(update),
        queuedAt: Date.now(),
      });
    }
    this.setStatus("pending");
    this.scheduleFlush(s);
  }

  private scheduleFlush(s: NoteSession, delay = FLUSH_DEBOUNCE_MS) {
    if (s.flushTimer) clearTimeout(s.flushTimer);
    s.flushTimer = setTimeout(() => {
      s.flushTimer = null;
      void this.flush(s);
    }, delay);
  }

  private async flush(s: NoteSession): Promise<void> {
    if (!this.runtime || s.destroyed) return;
    if (this.drafts.has(s.noteId) || this.held.has(s.noteId)) return;
    if (s.flushing) {
      s.dirty = true;
      return;
    }
    s.flushing = true;
    try {
      const clientId = await this.resolveClientId();
      let pushed = false;
      for (;;) {
        const durable = await readDocOutbox(s.noteId);
        const queue = [...durable, ...s.memOutbox];
        if (queue.length === 0) {
          // Pushes before the first pull went out bodiless: now that the doc
          // is complete, write its body once (an update-free save).
          if (s.bodyOwed && s.synced) {
            const owed = tryDeriveNoteBody(s.doc);
            if (owed) {
              await this.runtime.notesV2.pushUpdates({
                workspaceId: this.workspaceId,
                noteId: s.noteId,
                clientId,
                updates: [],
                bodyText: owed.text,
                bodyMd: owed.md,
              });
              s.bodyOwed = false;
              pushed = true;
            }
          }
          break;
        }
        pushed = true;
        const batch = planPushBatch(queue);
        // Before the first pull lands, the doc may lack other devices' edits:
        // push the update alone (null bodies keep the server's last ones),
        // or search, export and MCP would hold a stale body.
        const body = s.synced ? tryDeriveNoteBody(s.doc) : null;
        if (!body) s.bodyOwed = true;
        else s.bodyOwed = false;
        const res = await this.runtime.notesV2.pushUpdates({
          workspaceId: this.workspaceId,
          noteId: s.noteId,
          clientId,
          updates: toPushPayload(batch),
          bodyText: body?.text ?? null,
          bodyMd: body?.md ?? null,
        });
        await deleteDocOutboxEntries(ackedKeys(batch));
        const ackedSeqs = new Set(batch.map((e) => e.clientSeq));
        s.memOutbox = s.memOutbox.filter((e) => !ackedSeqs.has(e.clientSeq));
        s.state = {
          ...s.state,
          updatesSinceCompact: s.state.updatesSinceCompact + res.inserted,
        };
        await writeNoteState(s.state);
      }
      // Only a push that reached the server proves we're back online; an
      // empty flush after a failed pull must not clear the offline dot.
      if (pushed) this.recoveredFromOffline(s);
      if (shouldCompact(s.state)) await this.compact(s);
      if (s.dirty) {
        s.dirty = false;
        this.scheduleFlush(s, 0);
      } else if (this.status === "pending") {
        if (!(await this.hasQueuedUpdates())) this.setStatus("synced");
      }
    } catch (e) {
      if (isNetworkError(e)) {
        this.setStatus("offline");
        this.scheduleRetry(s);
      } else {
        // A server-side rejection (permissions, trashed note) won't heal by
        // retrying blindly; surface in console, keep the queue (the data is
        // safe locally) and retry on the next wake.
        console.warn("[notes-sync] push rejected", e);
        this.setStatus("offline");
      }
    } finally {
      s.flushing = false;
    }
  }

  private scheduleRetry(s: NoteSession) {
    if (s.retryTimer || s.destroyed) return;
    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;
      s.retryMs = Math.min(s.retryMs * 2, RETRY_MAX_MS);
      void this.flush(s);
    }, s.retryMs);
  }

  private recoveredFromOffline(s: NoteSession) {
    s.retryMs = RETRY_BASE_MS;
    if (s.retryTimer) {
      clearTimeout(s.retryTimer);
      s.retryTimer = null;
    }
    if (this.status === "offline") this.setStatus("synced");
  }

  /** Fold the update log into the snapshot. Pull first so the fold covers
   * everything up to the cursor (our own unpulled pushes fold next cycle).
   * Vetoed for the session once any pulled update failed to decode — folding
   * then would DELETE log rows this doc never absorbed (global data loss;
   * another client may still read them fine). */
  private async compact(s: NoteSession): Promise<void> {
    if (!this.runtime || s.destroyed) return;
    if (s.compactVeto) return;
    try {
      await this.pull(s);
      if (s.compactVeto) return; // the pull we just did may have tripped it
      const snapshot = encodeUint8ToBase64(Y.encodeStateAsUpdate(s.doc));
      const body = tryDeriveNoteBody(s.doc);
      await this.runtime.notesV2.saveSnapshot({
        workspaceId: this.workspaceId,
        noteId: s.noteId,
        snapshotB64: snapshot,
        uptoUpdateId: s.state.lastPulledUpdateId,
        bodyText: body?.text ?? null,
        bodyMd: body?.md ?? null,
      });
      s.state = { ...s.state, updatesSinceCompact: 0 };
      await writeNoteState(s.state);
    } catch (e) {
      // Compaction is an optimization — a failure must never lose edits.
      console.warn("[notes-sync] compaction skipped", e);
    }
  }

  // ── public surface ──────────────────────────────────────────────────────────

  /** providerFactory for Lexical's CollaborationPlugin. */
  providerFactory = (noteId: string, yjsDocMap: Map<string, Y.Doc>): any => {
    const session = this.getOrCreateSession(noteId);
    yjsDocMap.set(noteId, session.doc);
    return session.provider;
  };

  /** Close least-recently-used idle sessions past the cap — each holds a
   * Y.Doc + a y-indexeddb connection otherwise for the whole visit. */
  private evictIdleSessions(currentNoteId: string) {
    if (this.sessions.size <= MAX_IDLE_SESSIONS) return;
    const idle = [...this.sessions.values()]
      .filter(
        (s) =>
          s.noteId !== currentNoteId &&
          !this.drafts.has(s.noteId) &&
          !this.held.has(s.noteId) &&
          !s.flushing &&
          s.memOutbox.length === 0 &&
          s.flushTimer === null &&
          s.retryTimer === null,
      )
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    while (this.sessions.size > MAX_IDLE_SESSIONS && idle.length > 0) {
      const victim = idle.shift()!;
      void this.closeNote(victim.noteId);
    }
  }

  /** Has this note pulled from the server at least once this session? A
   * cached doc renders and edits before that; it just isn't "synced". */
  isSynced(noteId: string): boolean {
    return this.sessions.get(noteId)?.synced ?? false;
  }

  async flushNote(noteId: string): Promise<void> {
    const s = this.sessions.get(noteId);
    if (s) {
      if (s.flushTimer) {
        clearTimeout(s.flushTimer);
        s.flushTimer = null;
      }
      await this.flush(s);
    }
  }

  /** Open a session for a lazy draft (NR-2): a client-minted id with no
   * server row yet. Boots from the local cache only and never pushes until
   * `promoteDraft`. */
  openDraft(noteId: string): NoteSession {
    this.drafts.add(noteId);
    return this.getOrCreateSession(noteId);
  }

  isDraft(noteId: string): boolean {
    return this.drafts.has(noteId);
  }

  /** The draft got its first character: it stops being a draft (every edit
   * from here on is queued durably, starting with the whole doc so far) but
   * stays HELD — nothing pushes until `releasePush`, after its create. */
  async promoteDraft(noteId: string): Promise<void> {
    if (!this.drafts.delete(noteId)) return;
    this.held.add(noteId);
    const s = this.sessions.get(noteId);
    if (!s || s.destroyed) return;
    await s.booted.catch(() => {});
    await this.enqueueLocalUpdate(s, Y.encodeStateAsUpdate(s.doc));
  }

  /** The server refused a promoted draft's create: drop what it queued (it
   * can never be accepted) and make it a draft again, so later keystrokes
   * stay local too. The text stays in the open doc until the page closes. */
  async revertToDraft(noteId: string): Promise<void> {
    if (!this.held.delete(noteId)) return;
    this.drafts.add(noteId);
    const s = this.sessions.get(noteId);
    if (s) s.memOutbox = [];
    const queued = await readDocOutbox(noteId).catch(() => []);
    const keys = queued.map((e) => e.key).filter((k): k is number => typeof k === "number");
    if (keys.length > 0) await deleteDocOutboxEntries(keys).catch(() => {});
    if (this.status === "pending" && !(await this.hasQueuedUpdates())) this.setStatus("synced");
  }

  /** The note's create landed (or is queued ahead in the FIFO meta-outbox):
   * push what the held note queued. */
  releasePush(noteId: string): void {
    if (!this.held.delete(noteId)) return;
    const s = this.sessions.get(noteId);
    if (s && !s.destroyed) this.scheduleFlush(s, 0);
  }

  /** Drop an untouched draft without a trace: no push, no server call, and
   * its local document cache is deleted. */
  async discardDraft(noteId: string): Promise<void> {
    if (!this.drafts.delete(noteId)) return;
    const s = this.sessions.get(noteId);
    if (!s) return;
    s.destroyed = true;
    if (s.retryTimer) clearTimeout(s.retryTimer);
    if (s.flushTimer) clearTimeout(s.flushTimer);
    this.sessions.delete(noteId);
    s.provider.awareness.destroy();
    s.agentUndo.destroy();
    await s.persistence.clearData().catch(() => {});
    s.doc.destroy();
  }

  /** Undo for agent writes on an open note (null when it isn't open). */
  agentUndo(noteId: string): AgentUndo | null {
    return this.sessions.get(noteId)?.agentUndo ?? null;
  }

  async pullNote(noteId: string): Promise<void> {
    const s = this.sessions.get(noteId);
    if (s) await this.pull(s);
  }

  async closeNote(noteId: string): Promise<void> {
    const s = this.sessions.get(noteId);
    if (!s) return;
    await this.flushNote(noteId).catch(() => {});
    s.destroyed = true;
    if (s.retryTimer) clearTimeout(s.retryTimer);
    if (s.flushTimer) clearTimeout(s.flushTimer);
    s.provider.awareness.destroy();
    s.agentUndo.destroy();
    await s.persistence.destroy().catch(() => {});
    s.doc.destroy();
    this.sessions.delete(noteId);
  }

  /** Run a metadata intent op with offline queueing: online → straight
   * through; network-dead → queue + resolve (the caller applied it
   * optimistically); server rejection → rethrow (honest toast). */
  async runMetaOp(
    kind: MetaOutboxEntry["kind"],
    args: Record<string, unknown>,
  ): Promise<"applied" | "queued"> {
    if (!this.runtime) throw new Error("Runtime unavailable.");
    try {
      await this.callMetaOp(kind, args);
      return "applied";
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      await enqueueMetaOp({
        workspaceId: this.workspaceId,
        kind,
        args,
        queuedAt: Date.now(),
      });
      this.setStatus("offline");
      return "queued";
    }
  }

  private callMetaOp(kind: MetaOutboxEntry["kind"], args: any): Promise<unknown> {
    return callMetaOp(this.runtime!, kind, args);
  }

  /** Reconnect/refocus pass: replay queued meta ops FIFO, flush every queued
   * doc outbox, pull open sessions. */
  async wake(): Promise<void> {
    if (this.destroyed) return;
    await this.replayMetaOutbox();
    const queuedNoteIds = await listDocOutboxNoteIds(this.workspaceId);
    const flushes: Promise<void>[] = [];
    for (const id of queuedNoteIds) {
      const s = this.sessions.get(id);
      if (s) flushes.push(this.flush(s));
    }
    for (const s of this.sessions.values()) {
      if (s.memOutbox.length > 0 && !queuedNoteIds.includes(s.noteId)) {
        flushes.push(this.flush(s));
      }
    }
    // Orphaned queues (note not open this session) push via a headless flush.
    for (const id of queuedNoteIds) {
      if (!this.sessions.has(id)) flushes.push(this.flushHeadless(id));
    }
    await Promise.all(flushes);
    for (const s of this.sessions.values()) {
      if (!this.drafts.has(s.noteId)) void this.pull(s);
    }
    // A meta-only recovery (nothing doc-queued, replay drained) must also
    // clear the offline dot — flush() only heals it when it had work to push.
    if (this.status === "offline") {
      const metaLeft = await readMetaOutbox(this.workspaceId);
      if (metaLeft.length === 0 && !(await this.hasQueuedUpdates())) {
        this.setStatus("synced");
      }
    }
  }

  private async flushOrphanedOutbox(): Promise<void> {
    if (!this.runtime) return;
    const ids = await listDocOutboxNoteIds(this.workspaceId);
    for (const id of ids) {
      if (!this.sessions.has(id)) void this.flushHeadless(id);
    }
  }

  /** Push a note's queued updates without materializing a full session — the
   * updates are self-contained CRDT deltas; no doc needed. Derived body is
   * skipped (the next real open refreshes it). */
  private async flushHeadless(noteId: string): Promise<void> {
    if (!this.runtime) return;
    try {
      const clientId = await this.resolveClientId();
      for (;;) {
        const queue = await readDocOutbox(noteId);
        if (queue.length === 0) break;
        const batch = planPushBatch(queue);
        await this.runtime.notesV2.pushUpdates({
          workspaceId: this.workspaceId,
          noteId,
          clientId,
          updates: toPushPayload(batch),
        });
        await deleteDocOutboxEntries(ackedKeys(batch));
      }
    } catch (e) {
      if (!isNetworkError(e)) console.warn("[notes-sync] headless push rejected", e);
    }
  }

  private async replayMetaOutbox(): Promise<void> {
    if (!this.runtime || this.replayingMeta) return;
    this.replayingMeta = true;
    let replayedAny = false;
    try {
      const entries = replayOrder(await readMetaOutbox(this.workspaceId));
      for (const entry of entries) {
        let error: unknown = null;
        try {
          await this.callMetaOp(entry.kind, entry.args);
        } catch (e) {
          error = e;
        }
        const decision = replayDecision(entry, error);
        if (decision === "retry-later") break; // still offline — keep FIFO intact
        if (typeof entry.key === "number") await deleteMetaOutboxEntries([entry.key]);
        if (decision === "applied") replayedAny = true;
        if (decision === "drop") console.warn("[notes-sync] dropped queued op", entry.kind, error);
      }
    } finally {
      this.replayingMeta = false;
    }
    if (replayedAny) this.onRemoteMetaChange?.();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.detachWindow?.();
    // A draft nobody typed into dies with the page that opened it.
    await Promise.all([...this.drafts].map((id) => this.discardDraft(id)));
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.closeNote(id)));
    this.statusListeners.clear();
  }
}

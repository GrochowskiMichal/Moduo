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
 */

import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";
import { deriveBody } from "./doc-text";
import {
  deleteDocOutboxEntries,
  deleteMetaOutboxEntries,
  enqueueDocUpdate,
  enqueueMetaOp,
  listDocOutboxNoteIds,
  readDocOutbox,
  readNoteState,
  writeNoteState,
  type MetaOutboxEntry,
  type NoteSyncState,
  readMetaOutbox,
} from "./idb";
import {
  ackedKeys,
  advanceCursor,
  assignSeq,
  emptyNoteState,
  planPushBatch,
  shouldCompact,
  toPushPayload,
} from "./outbox";
import { isNetworkError, replayDecision, replayOrder } from "./meta-outbox";

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
    return "ephemeral";
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
  booted: Promise<void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryMs: number;
  flushing: boolean;
  /** Set while a flush cycle re-runs because more edits arrived mid-push. */
  dirty: boolean;
  destroyed: boolean;
};

type StatusListener = (status: NotesSyncStatusV2) => void;

export class NotesSyncEngineV2 {
  private readonly clientId = getNotesClientId();
  private readonly sessions = new Map<string, NoteSession>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: NotesSyncStatusV2 = "synced";
  private destroyed = false;
  private detachWindow: (() => void) | null = null;
  private replayingMeta = false;

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

  // ── sessions ────────────────────────────────────────────────────────────────

  getOrCreateSession(noteId: string): NoteSession {
    let s = this.sessions.get(noteId);
    if (s) return s;
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
    const provider: NoteProviderStub = {
      awareness,
      connect: () => {},
      disconnect: () => {},
      on: (event, cb) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
        // Lexical waits for a sync event before treating the doc as ready.
        if (event === "sync") queueMicrotask(() => cb(true));
      },
      off: (event, cb) => listeners.get(event)?.delete(cb),
    };

    s = {
      noteId,
      doc,
      persistence,
      provider,
      state: emptyNoteState(noteId),
      booted: Promise.resolve(),
      flushTimer: null,
      retryTimer: null,
      retryMs: RETRY_BASE_MS,
      flushing: false,
      dirty: false,
      destroyed: false,
    };
    this.sessions.set(noteId, s);
    s.booted = this.boot(s);

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (s!.destroyed) return;
      // Ignore what we applied ourselves: remote pulls, the local IDB cache
      // replaying at boot, and awareness/bootstrap application.
      if (origin === "remote" || origin === persistence) return;
      void this.enqueueLocalUpdate(s!, update);
    });

    return s;
  }

  private async boot(s: NoteSession): Promise<void> {
    try {
      s.state = (await readNoteState(s.noteId)) ?? emptyNoteState(s.noteId);
      await s.persistence.whenSynced;
    } catch {
      // cache-less boot is fine
    }
    await this.pull(s);
    await this.flush(s);
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
        if (u.clientId === this.clientId) {
          // Our own echo — the content is already in the doc; only the cursor
          // needs to advance past it.
          ids.push(u.id);
          continue;
        }
        try {
          Y.applyUpdate(s.doc, decodeBase64ToUint8(u.updateB64), "remote");
          ids.push(u.id);
        } catch (e) {
          console.warn("[notes-sync] bad remote update ignored", e);
          ids.push(u.id);
        }
      }
      s.state = advanceCursor(s.state, ids);
      await writeNoteState(s.state);
      this.recoveredFromOffline(s);
      return ids.length;
    } catch (e) {
      if (isNetworkError(e)) this.setStatus("offline");
      return 0;
    }
  }

  private async enqueueLocalUpdate(s: NoteSession, update: Uint8Array): Promise<void> {
    const { seq, next } = assignSeq(s.state);
    s.state = next;
    await Promise.all([
      writeNoteState(s.state),
      enqueueDocUpdate({
        workspaceId: this.workspaceId,
        noteId: s.noteId,
        clientSeq: seq,
        updateB64: encodeUint8ToBase64(update),
        queuedAt: Date.now(),
      }),
    ]);
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
    if (s.flushing) {
      s.dirty = true;
      return;
    }
    s.flushing = true;
    try {
      for (;;) {
        const queue = await readDocOutbox(s.noteId);
        if (queue.length === 0) break;
        const batch = planPushBatch(queue);
        const body = deriveBody(s.doc);
        const res = await this.runtime.notesV2.pushUpdates({
          workspaceId: this.workspaceId,
          noteId: s.noteId,
          clientId: this.clientId,
          updates: toPushPayload(batch),
          bodyText: body.text,
          bodyMd: body.md,
        });
        await deleteDocOutboxEntries(ackedKeys(batch));
        s.state = {
          ...s.state,
          updatesSinceCompact: s.state.updatesSinceCompact + res.inserted,
        };
        await writeNoteState(s.state);
      }
      this.recoveredFromOffline(s);
      if (shouldCompact(s.state)) await this.compact(s);
      if (s.dirty) {
        s.dirty = false;
        this.scheduleFlush(s, 0);
      } else if (this.status === "pending") {
        const anyQueued = await listDocOutboxNoteIds(this.workspaceId);
        if (anyQueued.length === 0) this.setStatus("synced");
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
   * everything up to the cursor (our own unpulled pushes fold next cycle). */
  private async compact(s: NoteSession): Promise<void> {
    if (!this.runtime || s.destroyed) return;
    try {
      await this.pull(s);
      const snapshot = encodeUint8ToBase64(Y.encodeStateAsUpdate(s.doc));
      const body = deriveBody(s.doc);
      await this.runtime.notesV2.saveSnapshot({
        workspaceId: this.workspaceId,
        noteId: s.noteId,
        snapshotB64: snapshot,
        uptoUpdateId: s.state.lastPulledUpdateId,
        bodyText: body.text,
        bodyMd: body.md,
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
    await s.persistence.destroy().catch(() => {});
    s.doc.destroy();
    this.sessions.delete(noteId);
  }

  /** Run a metadata intent op with offline queueing: online → straight
   * through; network-dead → queue + resolve (the caller applied it
   * optimistically); server rejection → rethrow (honest toast). */
  async runMetaOp(kind: MetaOutboxEntry["kind"], args: Record<string, unknown>): Promise<"applied" | "queued"> {
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
    const rt = this.runtime!;
    switch (kind) {
      case "create":
        return rt.notesV2.create(args);
      case "rename":
        return rt.notesV2.rename(args);
      case "move":
        return rt.notesV2.move(args);
      case "setMeta":
        return rt.notesV2.setMeta(args);
      case "duplicate":
        return rt.notesV2.duplicate(args);
      case "archive":
        return rt.notesV2.archive(args);
      case "unarchive":
        return rt.notesV2.unarchive(args);
      case "trash":
        return rt.notesV2.trash(args);
      case "restore":
        return rt.notesV2.restore(args);
    }
  }

  /** Reconnect/refocus pass: replay queued meta ops FIFO, flush every queued
   * doc outbox, pull open sessions. */
  async wake(): Promise<void> {
    if (this.destroyed) return;
    await this.replayMetaOutbox();
    const queuedNoteIds = await listDocOutboxNoteIds(this.workspaceId);
    for (const id of queuedNoteIds) {
      const s = this.sessions.get(id);
      if (s) void this.flush(s);
    }
    // Orphaned queues (note not open this session) push via a headless session.
    for (const id of queuedNoteIds) {
      if (!this.sessions.has(id)) void this.flushHeadless(id);
    }
    for (const s of this.sessions.values()) void this.pull(s);
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
      for (;;) {
        const queue = await readDocOutbox(noteId);
        if (queue.length === 0) break;
        const batch = planPushBatch(queue);
        await this.runtime.notesV2.pushUpdates({
          workspaceId: this.workspaceId,
          noteId,
          clientId: this.clientId,
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
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.closeNote(id)));
    this.statusListeners.clear();
  }
}

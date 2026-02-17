import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Provider } from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { notesLocalDB } from "../db/local-db";
import type { NotesSyncStatus, SyncCursor, SyncUpdate } from "../types";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";

const RECONCILE_INTERVAL_MS = 20_000;
const FLUSH_DEBOUNCE_MS = 700;
const MAX_PUSH_BATCH_SIZE = 16;
const COMPACTION_THRESHOLD = 200;

type StatusListener = (status: NotesSyncStatus) => void;

type RemotePullRow = {
  id: number;
  note_id: string;
  client_id: string;
  client_seq: number;
  update_b64: string;
  created_at: string;
};

type RemoteDocSnapshot = {
  snapshot_b64: string;
  last_compacted_update_id: number;
};

type NoteSession = {
  noteId: string;
  doc: Y.Doc;
  provider: NotesRealtimeProvider;
  persistence: IndexeddbPersistence;
  realtimeChannel: RealtimeChannel | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  reconcileTimer: ReturnType<typeof setInterval> | null;
  destroyDocListener: () => void;
  destroyed: boolean;
};

class NotesRealtimeProvider implements Provider {
  awareness: Provider["awareness"];
  private rawAwareness: Awareness;
  private listeners = {
    reload: new Set<(doc: Y.Doc) => void>(),
    status: new Set<(arg: { status: string }) => void>(),
    sync: new Set<(isSynced: boolean) => void>(),
    update: new Set<(arg: unknown) => void>(),
  };

  constructor(private readonly doc: Y.Doc) {
    this.rawAwareness = new Awareness(doc);
    this.awareness = {
      getLocalState: () => this.rawAwareness.getLocalState() as any,
      getStates: () => this.rawAwareness.getStates() as any,
      off: (type: "update", cb: () => void) => this.rawAwareness.off(type, cb as any),
      on: (type: "update", cb: () => void) => this.rawAwareness.on(type, cb as any),
      setLocalState: (state) => this.rawAwareness.setLocalState(state as any),
      setLocalStateField: (field, value) => this.rawAwareness.setLocalStateField(field, value),
    };
  }

  connect(): void {
    this.emit("status", { status: "connected" });
    this.emit("sync", true);
  }

  disconnect(): void {
    this.emit("status", { status: "disconnected" });
    this.rawAwareness.setLocalState(null);
  }

  on(type: "reload", cb: (doc: Y.Doc) => void): void;
  on(type: "status", cb: (arg: { status: string }) => void): void;
  on(type: "sync", cb: (isSynced: boolean) => void): void;
  on(type: "update", cb: (arg: unknown) => void): void;
  on(type: keyof NotesRealtimeProvider["listeners"], cb: any): void {
    this.listeners[type].add(cb);
  }

  off(type: "reload", cb: (doc: Y.Doc) => void): void;
  off(type: "status", cb: (arg: { status: string }) => void): void;
  off(type: "sync", cb: (isSynced: boolean) => void): void;
  off(type: "update", cb: (arg: unknown) => void): void;
  off(type: keyof NotesRealtimeProvider["listeners"], cb: any): void {
    this.listeners[type].delete(cb);
  }

  emit(type: "reload", payload: Y.Doc): void;
  emit(type: "status", payload: { status: string }): void;
  emit(type: "sync", payload: boolean): void;
  emit(type: "update", payload: unknown): void;
  emit(type: keyof NotesRealtimeProvider["listeners"], payload: unknown): void {
    for (const listener of this.listeners[type]) {
      listener(payload as never);
    }
  }
}

function emptyCursor(noteId: string): SyncCursor {
  return {
    noteId,
    lastPulledUpdateId: 0,
    clientSeq: 0,
    lastCompactedUpdateId: 0,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class NotesSyncEngine {
  private readonly clientId = safeId();
  private readonly sessions = new Map<string, NoteSession>();
  private readonly statusListeners = new Set<StatusListener>();
  private isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  private destroyed = false;
  private handleOnline?: () => void;
  private handleOffline?: () => void;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly ownerId: string
  ) {
    if (typeof window !== "undefined") {
      this.handleOnline = () => {
        this.isOnline = true;
        this.broadcastStatus("syncing");
        for (const session of this.sessions.values()) {
          void this.flushAndPull(session);
        }
      };
      this.handleOffline = () => {
        this.isOnline = false;
        this.broadcastStatus("offline");
      };
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private broadcastStatus(status: NotesSyncStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private persistenceKey(noteId: string): string {
    return `moduo-note-v2-${this.ownerId}-${noteId}`;
  }

  async ensureCursor(noteId: string): Promise<SyncCursor> {
    const existing = await notesLocalDB.syncCursors.get(noteId);
    if (existing) return existing;
    const created = emptyCursor(noteId);
    await notesLocalDB.syncCursors.put(created);
    return created;
  }

  private async saveCursor(cursor: SyncCursor): Promise<void> {
    await notesLocalDB.syncCursors.put(cursor);
  }

  providerFactory = (noteId: string, yjsDocMap: Map<string, Y.Doc>): Provider => {
    const existing = this.sessions.get(noteId);
    if (existing && !existing.destroyed) {
      yjsDocMap.set(noteId, existing.doc);
      return existing.provider;
    }

    let doc = yjsDocMap.get(noteId);
    if (!doc) {
      doc = new Y.Doc();
      yjsDocMap.set(noteId, doc);
    }

    const provider = new NotesRealtimeProvider(doc);
    const persistence = new IndexeddbPersistence(this.persistenceKey(noteId), doc);

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "bootstrap" || origin === "pull") return;
      void this.enqueueLocalUpdate(noteId, update);
    };

    doc.on("update", onUpdate);

    const session: NoteSession = {
      noteId,
      doc,
      provider,
      persistence,
      realtimeChannel: null,
      flushTimer: null,
      reconcileTimer: null,
      destroyDocListener: () => doc.off("update", onUpdate),
      destroyed: false,
    };

    session.reconcileTimer = setInterval(() => {
      if (this.isOnline && !session.destroyed) {
        void this.flushAndPull(session);
      }
    }, RECONCILE_INTERVAL_MS);

    this.sessions.set(noteId, session);
    provider.connect();

    void this.bootstrapSession(session);

    return provider;
  };

  private async bootstrapSession(session: NoteSession): Promise<void> {
    if (this.destroyed || session.destroyed) return;

    this.broadcastStatus(this.isOnline ? "syncing" : "offline");

    try {
      await session.persistence.whenSynced;

      const { data: snapshot } = await this.supabase
        .from("note_documents")
        .select("snapshot_b64,last_compacted_update_id")
        .eq("note_id", session.noteId)
        .eq("owner_id", this.ownerId)
        .maybeSingle<RemoteDocSnapshot>();

      const cursor = await this.ensureCursor(session.noteId);

      if (snapshot?.snapshot_b64) {
        Y.applyUpdate(session.doc, decodeBase64ToUint8(snapshot.snapshot_b64), "bootstrap");
        cursor.lastCompactedUpdateId = Math.max(
          cursor.lastCompactedUpdateId,
          Number(snapshot.last_compacted_update_id || 0)
        );
        cursor.lastPulledUpdateId = Math.max(
          cursor.lastPulledUpdateId,
          Number(snapshot.last_compacted_update_id || 0)
        );
        await this.saveCursor(cursor);
      }

      session.realtimeChannel = this.supabase
        .channel(`notes-updates-${session.noteId}-${this.clientId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "note_updates",
            filter: `note_id=eq.${session.noteId}`,
          },
          (payload) => {
            void this.handleRealtimeUpdate(session, payload.new as RemotePullRow);
          }
        )
        .subscribe();

      if (this.isOnline) {
        await this.flushAndPull(session);
      }
    } catch {
      this.broadcastStatus("error");
    }
  }

  private async handleRealtimeUpdate(session: NoteSession, update: RemotePullRow): Promise<void> {
    if (session.destroyed) return;

    const cursor = await this.ensureCursor(session.noteId);
    cursor.lastPulledUpdateId = Math.max(cursor.lastPulledUpdateId, Number(update.id));
    await this.saveCursor(cursor);

    if (update.client_id === this.clientId) return;

    try {
      Y.applyUpdate(session.doc, decodeBase64ToUint8(update.update_b64), "remote");
      this.broadcastStatus(this.isOnline ? "synced" : "offline");
    } catch {
      this.broadcastStatus("error");
    }
  }

  private scheduleFlush(session: NoteSession): void {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = setTimeout(() => {
      void this.flushAndPull(session);
    }, FLUSH_DEBOUNCE_MS);
  }

  private async enqueueLocalUpdate(noteId: string, update: Uint8Array): Promise<void> {
    const cursor = await this.ensureCursor(noteId);
    const nextSeq = cursor.clientSeq + 1;
    cursor.clientSeq = nextSeq;
    await this.saveCursor(cursor);

    await notesLocalDB.outbox.put({
      id: `${this.clientId}:${noteId}:${nextSeq}`,
      noteId,
      ownerId: this.ownerId,
      clientId: this.clientId,
      clientSeq: nextSeq,
      updateB64: encodeUint8ToBase64(update),
      createdAt: nowIso(),
    });

    const session = this.sessions.get(noteId);
    if (session && !session.destroyed) {
      this.broadcastStatus(this.isOnline ? "syncing" : "offline");
      this.scheduleFlush(session);
    }
  }

  private async flushOutbox(session: NoteSession): Promise<void> {
    const pending = await notesLocalDB.outbox.where("noteId").equals(session.noteId).sortBy("clientSeq");
    if (pending.length === 0) return;

    const batch = pending.slice(0, MAX_PUSH_BATCH_SIZE);

    const { data, error } = await this.supabase.rpc("note_push_updates", {
      p_note_id: session.noteId,
      p_client_id: this.clientId,
      p_updates: batch.map((entry) => ({ client_seq: entry.clientSeq, update_b64: entry.updateB64 })),
    });

    if (error) throw error;

    await notesLocalDB.outbox.bulkDelete(batch.map((entry) => entry.id));

    const row = Array.isArray(data) ? data[0] : null;
    if (row && typeof row.last_update_id === "number") {
      const cursor = await this.ensureCursor(session.noteId);
      cursor.lastPulledUpdateId = Math.max(cursor.lastPulledUpdateId, row.last_update_id);
      await this.saveCursor(cursor);
    }

    if (pending.length > MAX_PUSH_BATCH_SIZE) {
      await this.flushOutbox(session);
    }
  }

  private async pullUpdates(session: NoteSession): Promise<SyncUpdate[]> {
    const cursor = await this.ensureCursor(session.noteId);

    const { data, error } = await this.supabase.rpc("note_pull_updates", {
      p_note_id: session.noteId,
      p_after_id: cursor.lastPulledUpdateId,
      p_limit: 500,
    });

    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []) as RemotePullRow[];
    if (rows.length === 0) return [];

    for (const row of rows) {
      cursor.lastPulledUpdateId = Math.max(cursor.lastPulledUpdateId, Number(row.id));
      if (row.client_id !== this.clientId) {
        Y.applyUpdate(session.doc, decodeBase64ToUint8(row.update_b64), "pull");
      }
    }

    await this.saveCursor(cursor);

    return rows.map((row) => ({
      id: row.id,
      noteId: row.note_id,
      clientId: row.client_id,
      clientSeq: row.client_seq,
      updateB64: row.update_b64,
      createdAt: row.created_at,
    }));
  }

  private async maybeCompact(session: NoteSession): Promise<void> {
    const cursor = await this.ensureCursor(session.noteId);
    const pending = cursor.lastPulledUpdateId - cursor.lastCompactedUpdateId;
    if (pending < COMPACTION_THRESHOLD) return;

    const snapshotB64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(session.doc));

    const { error } = await this.supabase.from("note_documents").upsert(
      {
        note_id: session.noteId,
        owner_id: this.ownerId,
        snapshot_b64: snapshotB64,
        last_compacted_update_id: cursor.lastPulledUpdateId,
      },
      { onConflict: "note_id" }
    );

    if (error) throw error;

    cursor.lastCompactedUpdateId = cursor.lastPulledUpdateId;
    await this.saveCursor(cursor);
  }

  async flushAndPull(session: NoteSession): Promise<void> {
    if (this.destroyed || session.destroyed || !this.isOnline) {
      this.broadcastStatus("offline");
      return;
    }

    this.broadcastStatus("syncing");

    try {
      await this.flushOutbox(session);
      await this.pullUpdates(session);
      await this.maybeCompact(session);
      this.broadcastStatus("synced");
    } catch {
      this.broadcastStatus("error");
    }
  }

  closeNote(noteId: string): void {
    const session = this.sessions.get(noteId);
    if (!session) return;

    session.destroyed = true;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.reconcileTimer) clearInterval(session.reconcileTimer);
    session.destroyDocListener();
    session.provider.disconnect();

    if (session.realtimeChannel) {
      void this.supabase.removeChannel(session.realtimeChannel);
    }

    session.persistence.destroy();
    this.sessions.delete(noteId);
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof window !== "undefined") {
      if (this.handleOnline) window.removeEventListener("online", this.handleOnline);
      if (this.handleOffline) window.removeEventListener("offline", this.handleOffline);
    }
    for (const noteId of [...this.sessions.keys()]) {
      this.closeNote(noteId);
    }
  }
}

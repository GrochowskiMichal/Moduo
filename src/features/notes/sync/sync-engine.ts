import type { Provider } from "@lexical/yjs";
import { Awareness } from "y-protocols/awareness";

import * as Y from "yjs";
import { runtime, type ModuoRuntime } from "../../../lib/runtime";
import type { NotesSyncStatus } from "../types";
import { decodeBase64ToUint8, encodeUint8ToBase64 } from "../utils/base64";

type StatusListener = (status: NotesSyncStatus) => void;

type NoteSession = {
  doc: Y.Doc;
  provider: NotesRealtimeProvider;
  persistence: RedbPersistence;
};

const NOTES_DRAFT_NAMESPACE = "notes:crdt-draft:v1";

class NotesRealtimeProvider implements Provider {
  awareness: Provider["awareness"];
  private rawAwareness: Awareness;
  private listeners = {
    reload: new Set<(doc: Y.Doc) => void>(),
    status: new Set<(arg: { status: string }) => void>(),
    sync: new Set<(isSynced: boolean) => void>(),
    update: new Set<(arg: unknown) => void>(),
  };
  private connected = false;
  private synced = false;

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
    this.connected = true;
    this.emit("status", { status: "connected" });
    if (this.synced) this.emit("sync", true);
  }

  disconnect(): void {
    this.connected = false;
    this.emit("sync", false);
    this.emit("status", { status: "disconnected" });
    this.rawAwareness.setLocalState(null);
  }

  setSynced(isSynced: boolean): void {
    this.synced = isSynced;
    if (this.connected) this.emit("sync", isSynced);
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

  private emit(type: "reload", payload: Y.Doc): void;
  private emit(type: "status", payload: { status: string }): void;
  private emit(type: "sync", payload: boolean): void;
  private emit(type: "update", payload: unknown): void;
  private emit(type: keyof NotesRealtimeProvider["listeners"], payload: unknown): void {
    for (const listener of this.listeners[type]) {
      listener(payload as never);
    }
  }
}

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Maximum number of init attempts before giving up and switching to offline-queue mode.
const MAX_INIT_RETRIES = 5;
// Base delay in ms for exponential backoff (doubles each attempt: 500, 1000, 2000, 4000, 8000).
const INIT_RETRY_BASE_MS = 500;

export class RedbPersistence {
  /** True once remote state has been loaded and applied (or after a final init failure). */
  public synced = false;
  /** Resolves when init completes (success or exhausted retries). */
  public whenSynced: Promise<void>;

  // Pending Y.Doc state-as-update bytes captured before init finished.
  // Stored as raw incremental Yjs updates received from doc.on("update").
  private pendingFlush = false;
  private pendingUpdates: Uint8Array[] = [];
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private draftTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private initAttempt = 0;
  private draftWasApplied = false;
  private onShutdown?: () => void;

  // Resolvers so we can imperatively settle whenSynced after retries.
  private resolveWhenSynced!: () => void;
  private rejectWhenSynced!: (reason?: unknown) => void;

  constructor(
    private runtime: ModuoRuntime | null,
    private workspaceId: string,
    private noteId: string,
    private clientId: string,
    private doc: Y.Doc,
    private onStatus: (status: NotesSyncStatus) => void,
    private setMaxSeq: (seq: number) => void,
    private getNextSeq: () => number
  ) {
    this.whenSynced = new Promise<void>((resolve, reject) => {
      this.resolveWhenSynced = resolve;
      this.rejectWhenSynced = reject;
    });
    this.doc.on("update", this.onUpdate);
    this.onShutdown = () => {
      if (!this.destroyed) void this.flush();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.onShutdown);
      window.addEventListener("pagehide", this.onShutdown);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.onShutdown?.();
      });
    }
    void this.tryInit();
  }

  private draftStorageKey(): string {
    return `draft:${this.workspaceId}:${this.noteId}`;
  }

  private draftLocalStorageKey(): string {
    return `moduo:notes-crdt-draft:v1:${this.workspaceId}:${this.noteId}`;
  }

  private async readDraftB64(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    try {
      const value = window.localStorage.getItem(this.draftLocalStorageKey());
      return value && value.length ? value : null;
    } catch {
      // fall through
    }
    try {
      if (this.runtime?.localStore) {
        const raw = await this.runtime.localStore.get(NOTES_DRAFT_NAMESPACE, this.draftStorageKey());
        return typeof raw === "string" && raw ? raw : null;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async writeDraftB64(b64: string): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.draftLocalStorageKey(), b64);
    } catch {
      // ignore
    }
    try {
      if (this.runtime?.localStore) {
        await this.runtime.localStore.set(NOTES_DRAFT_NAMESPACE, this.draftStorageKey(), b64);
      }
    } catch {
      // ignore
    }
  }

  private async clearDraftB64(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(this.draftLocalStorageKey());
    } catch {
      // ignore
    }
    try {
      if (this.runtime?.localStore) {
        await this.runtime.localStore.remove(NOTES_DRAFT_NAMESPACE, this.draftStorageKey());
      }
    } catch {
      // ignore
    }
  }

  private scheduleDraftSave(): void {
    if (this.destroyed) return;
    if (this.draftTimeoutId) clearTimeout(this.draftTimeoutId);
    this.draftTimeoutId = setTimeout(() => {
      this.draftTimeoutId = null;
      try {
        const b64 = encodeUint8ToBase64(Y.encodeStateAsUpdate(this.doc));
        void this.writeDraftB64(b64);
      } catch {
        // ignore
      }
    }, 250);
  }

  // ---------------------------------------------------------------------------
  // Init with exponential-backoff retry
  // ---------------------------------------------------------------------------

  private async tryInit(): Promise<void> {
    if (this.destroyed) return;

    const draftB64 = await this.readDraftB64();
    console.log(`%c[NOTES:tryInit] noteId=${this.noteId} attempt=${this.initAttempt + 1} draftB64len=${draftB64?.length ?? 0}`, "color:#a8f;font-weight:bold");
    if (draftB64) {
      try {
        Y.applyUpdate(this.doc, decodeBase64ToUint8(draftB64), "bootstrap");
        this.draftWasApplied = true;
        console.log(`%c[NOTES:tryInit] applied LOCAL DRAFT — share keys: ${[...this.doc.share.keys()].join(",")}`, "color:#a8f");
      } catch (e) {
        console.error(`[RedbPersistence] Failed to apply local draft for ${this.noteId}:`, e);
      }
    }

    if (!this.runtime) {
      // No backend available — go straight to "offline-synced" so edits can be
      // queued locally and flushed if a runtime appears later.
      this.synced = true;
      this.onStatus("offline");
      this.resolveWhenSynced();
      return;
    }

    this.initAttempt += 1;

    try {
      const state = await this.runtime.notes.getDocState(this.workspaceId, this.noteId);

      if (this.destroyed) return;

      console.log(`%c[NOTES:tryInit] remote snapshotB64len=${state?.snapshotB64?.length ?? 0} pendingUpdatesFromServer=${state?.updates?.length ?? 0}`, "color:#a8f");
      if (state?.snapshotB64) {
        Y.applyUpdate(this.doc, decodeBase64ToUint8(state.snapshotB64), "bootstrap");
        const root = this.doc.get("root-v2", Y.XmlElement);
        const children = root.toArray();
        const textPreview = children[0] ? (children[0] as any).toArray?.().map((t: any) => t.toString?.() ?? "").join("") : "";
        console.log(`%c[NOTES:tryInit] after snapshot: rootType=${root.constructor.name} rootChildren=${children.length} textPreview="${textPreview.slice(0, 60)}"`, "color:#a8f");
      } else {
        console.log(`%c[NOTES:tryInit] NO snapshot from server — fresh/empty doc`, "color:#fa8");
      }

      const updates = Array.isArray(state?.updates) ? state.updates : [];
      let maxSeq = 0;
      for (const row of updates) {
        if (row?.updateB64) {
          try {
            Y.applyUpdate(this.doc, decodeBase64ToUint8(row.updateB64), "remote");
          } catch (e) {
            console.error(
              `[RedbPersistence] Failed to apply update for ${this.noteId} at seq ${row.clientSeq}:`,
              e
            );
          }
        }
        maxSeq = Math.max(maxSeq, Number(row?.clientSeq ?? 0));
      }
      this.setMaxSeq(maxSeq);

      const rootFinal = this.doc.get("root-v2", Y.XmlElement);
      const childrenFinal = rootFinal.toArray();
      const textFinal = childrenFinal[0] ? (childrenFinal[0] as any).toArray?.().map((t: any) => t.toString?.() ?? "").join("") : "";
      console.log(`%c[NOTES:tryInit] SYNCED — shareKeys=[${[...this.doc.share.keys()].join(",")}] rootChildren=${childrenFinal.length} textPreview="${textFinal.slice(0, 80)}"`, "color:#4fa;font-weight:bold");

      this.synced = true;
      this.onStatus("synced");
      this.resolveWhenSynced();

      // Drain any edits the user made while we were loading.
      if (this.pendingFlush) {
        this.pendingFlush = false;
        void this.flush();
      }

      // If we recovered a local draft (e.g. crash/force-quit), ensure we persist it remotely.
      if (this.draftWasApplied) {
        this.pendingUpdates.push(Y.encodeStateAsUpdate(this.doc));
        void this.flush();
      }
    } catch (e) {
      if (this.destroyed) return;

      console.error(`[RedbPersistence] init attempt ${this.initAttempt} failed:`, e);

      if (this.initAttempt < MAX_INIT_RETRIES) {
        // Schedule next attempt with exponential backoff.
        const delay = INIT_RETRY_BASE_MS * Math.pow(2, this.initAttempt - 1);
        this.onStatus("error");
        this.retryTimeoutId = setTimeout(() => {
          this.retryTimeoutId = null;
          void this.tryInit();
        }, delay);
      } else {
        // All retries exhausted — switch to offline-queue mode so edits aren't lost.
        // The next successful flush will persist everything via encodeStateAsUpdate.
        console.error(
          `[RedbPersistence] giving up after ${MAX_INIT_RETRIES} attempts — enabling offline-queue mode for ${this.noteId}`
        );
        this.synced = true; // Allow onUpdate/flush to proceed.
        this.onStatus("error");
        // Resolve (not reject) so callers that `await whenSynced` are unblocked.
        this.resolveWhenSynced();

        // If the user has already made edits, schedule an immediate flush attempt.
        if (this.pendingFlush) {
          this.pendingFlush = false;
          void this.flush();
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Update listener — called by Y.Doc on every local change
  // ---------------------------------------------------------------------------

  private onUpdate = (update: Uint8Array, origin: any) => {
    if (origin === "remote" || origin === "bootstrap" || this.destroyed) {
      console.log(`%c[NOTES:onUpdate] SKIPPED origin=${origin} size=${update.byteLength}`, "color:#888");
      return;
    }
    console.log(`%c[NOTES:onUpdate] LOCAL update size=${update.byteLength} synced=${this.synced} pendingCount=${this.pendingUpdates.length + 1}`, "color:#fa4");
    this.pendingUpdates.push(update);
    this.scheduleDraftSave();

    if (!this.synced) {
      this.pendingFlush = true;
      console.log(`%c[NOTES:onUpdate] not yet synced — queued for later flush`, "color:#888");
      return;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      void this.flush();
    }, 200);
  };

  // ---------------------------------------------------------------------------
  // Flush — encode current doc state and send to backend
  // ---------------------------------------------------------------------------

  async flush(): Promise<void> {
    if (this.destroyed || !this.runtime) {
      return;
    }

    // If init hasn't finished yet, wait for it before attempting a flush so we
    // don't race against the remote-state apply step.
    if (!this.synced) {
      await this.whenSynced;
      if (this.destroyed) {
        return;
      }
    }

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.pendingUpdates.length === 0) {
      return;
    }

    const queued = this.pendingUpdates;
    this.pendingUpdates = [];
    const update = queued.length === 1 ? queued[0] : Y.mergeUpdates(queued);
    if (!update.byteLength) {
      console.log(`%c[NOTES:flush] update byteLength=0, nothing to flush`, "color:#888");
      return;
    }

    console.log(`%c[NOTES:flush] flushing noteId=${this.noteId} updateSize=${update.byteLength} queuedCount=${queued.length}`, "color:#fa4;font-weight:bold");
    const root = this.doc.get("root-v2", Y.XmlElement);
    const children = root.toArray();
    const textPreview = children[0] ? (children[0] as any).toArray?.().map((t: any) => t.toString?.() ?? "").join("") : "";
    console.log(`%c[NOTES:flush] doc state: rootType=${root.constructor.name} rootChildren=${children.length} textPreview="${textPreview.slice(0, 80)}"`, "color:#fa4");

    this.onStatus("syncing");
    const currentSeq = this.getNextSeq();
    try {
      const b64 = encodeUint8ToBase64(update);
      await this.runtime.notes.applyCrdtUpdates(this.workspaceId, this.noteId, this.clientId, [
        {
          idempotencyKey: `${this.workspaceId}:${this.noteId}:${this.clientId}:${currentSeq}`,
          clientSeq: currentSeq,
          updateB64: b64,
        },
      ]);
      console.log(`%c[NOTES:flush] applyCrdtUpdates OK seq=${currentSeq}`, "color:#4fa;font-weight:bold");
      this.onStatus("synced");
      void this.clearDraftB64();
    } catch (e) {
      // Requeue unsent updates so the next flush can retry without data loss.
      this.pendingUpdates = [...queued, ...this.pendingUpdates];
      console.error(`[RedbPersistence] applyCrdtUpdates ERROR:`, e);
      this.onStatus("error");
    }
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  disconnect() {
    this.destroyed = true;
    this.doc.off("update", this.onUpdate);
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.draftTimeoutId) clearTimeout(this.draftTimeoutId);
    if (this.retryTimeoutId) clearTimeout(this.retryTimeoutId);
    if (this.onShutdown && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.onShutdown);
      window.removeEventListener("pagehide", this.onShutdown);
    }
    // Settle the promise so anything still awaiting `whenSynced` is unblocked.
    this.resolveWhenSynced();
  }
}

export class NotesSyncEngine {
  private readonly clientId = safeId();
  private readonly sessions = new Map<string, NoteSession>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly seqByNote = new Map<string, number>();
  private readonly runtime: ModuoRuntime | null;
  private destroyed = false;

  constructor(
    runtimeClient: ModuoRuntime | null,
    _userId: string,
    private readonly workspaceId: string
  ) {
    this.runtime = runtimeClient ?? runtime;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.runtime ? "synced" : "offline");
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private broadcastStatus = (status: NotesSyncStatus) => {
    for (const listener of this.statusListeners) listener(status);
  };

  async checkNeedsBootstrap(noteId: string): Promise<boolean> {
    this.providerFactory(noteId, new Map());
    const session = this.sessions.get(noteId)!;
    await session.persistence.whenSynced;
    const needsBootstrap = session.doc.store.clients.size === 0;
    return needsBootstrap;
  }

  async flushNote(noteId: string): Promise<void> {
    if (this.destroyed) return;
    const session = this.sessions.get(noteId);
    if (session) {
      await session.persistence.flush();
    }
  }

  async closeNote(noteId: string, flushFirst = true): Promise<void> {
    if (this.destroyed) return;
    const session = this.sessions.get(noteId);
    if (!session) return;

    if (flushFirst) {
      await session.persistence.flush();
    }
    session.provider.disconnect();
    session.persistence.disconnect();
    session.doc.destroy();
    this.sessions.delete(noteId);
    this.seqByNote.delete(noteId);
  }

  getOrCreateSession(noteId: string): NoteSession {
    this.providerFactory(noteId, new Map());
    const session = this.sessions.get(noteId);
    if (!session) {
      throw new Error(`Notes session missing for noteId=${noteId}`);
    }
    return session;
  }

  pokeNoteDoc(noteId: string): void {
    const session = this.sessions.get(noteId);
    if (!session) return;
    const rootV2 = session.doc.share.get("root-v2");
    if (!(rootV2 instanceof Y.XmlElement)) return;
    const marker = `poke-${Date.now()}`;
    session.doc.transact(() => {
      rootV2.setAttribute("__moduo_poke__", marker);
      rootV2.removeAttribute("__moduo_poke__");
    }, "bootstrap");
  }

  providerFactory = (noteId: string, yjsDocMap: Map<string, Y.Doc>): Provider => {
    const existing = this.sessions.get(noteId);
    if (existing) {
      yjsDocMap.set(noteId, existing.doc);
      return existing.provider;
    }
    let doc = yjsDocMap.get(noteId);
    if (!doc) {
      doc = new Y.Doc();
      yjsDocMap.set(noteId, doc);
    }

    const provider = new NotesRealtimeProvider(doc);
    const persistence = new RedbPersistence(
      this.runtime,
      this.workspaceId,
      noteId,
      this.clientId,
      doc,
      this.broadcastStatus,
      (maxSeq: number) => this.seqByNote.set(noteId, maxSeq),
      () => {
        const seq = (this.seqByNote.get(noteId) ?? 0) + 1;
        this.seqByNote.set(noteId, seq);
        return seq;
      }
    );

    const session: NoteSession = {
      doc,
      provider,
      persistence,
    };

    this.sessions.set(noteId, session);

    // Wire up provider connection status when loaded
    persistence.whenSynced.then(() => {
      const current = this.sessions.get(noteId);
      if (current?.provider === provider) {
        provider.setSynced(true);
      }
    }).catch(() => { });

    return provider;
  };

  async destroy(): Promise<void> {
    this.destroyed = true;

    await Promise.allSettled(
      [...this.sessions.values()].map(s => s.persistence.flush())
    );

    for (const session of this.sessions.values()) {
      session.provider.disconnect();
      session.persistence.disconnect();
      session.doc.destroy();
    }
    this.sessions.clear();
  }
}

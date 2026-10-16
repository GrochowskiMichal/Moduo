// The pending-upload queue (specs/attachments.md decision 8, AT2-1/AT2-6).
// A file is prepared once (pipeline.ts), stored with its bytes (IndexedDB
// `moduo-uploads`, see store.ts) and then walked through AT-1's protocol:
// begin → original → preview → finalize. Every step is recorded, so a reload,
// an app restart or a dropped connection picks up at the step it stopped at,
// and the TUS transport resumes a big original mid-file.
//
// Failures split like the notes meta-outbox's replay (network waits, a refusal
// never retries on its own): offline / interrupted / full / busy wait and retry
// by themselves with backoff; a refused file (too big, no access, task gone) is
// dropped from storage and shows its reason until dismissed; anything else
// waits for Retry. Wakes on `online`, on the window coming back, and on start
// after sign-in (the boot hook in use-upload-queue.ts).

import type { AttachmentPreviewMime } from "@contracts/vocabularies";
import type {
  AttachmentBeginInput,
  AttachmentRecord,
  ModuoRuntime,
  StorageStatus,
} from "../runtime.types";
import {
  AttachmentOpError,
  classifyUploadError,
  problemRetriesItself,
  type UploadProblem,
} from "./errors";
import type { PreparedUpload } from "./pipeline";

export type UploadTarget =
  | { workspaceId: string; entityType: "task"; entityId: string }
  /** CV-9: a file for a chat message not sent yet: its minted id, in its conversation. */
  | { workspaceId: string; entityType: "chat_message"; entityId: string; channelId: string };

export function targetKey(t: UploadTarget): string {
  return `${t.workspaceId}:${t.entityType}:${t.entityId}`;
}

export type UploadState =
  /** Waiting its turn. */
  | "queued"
  /** Bytes moving (begin, upload or finalize). */
  | "uploading"
  /** Retries by itself: offline, interrupted, storage full, busy. */
  | "waiting"
  /** Stopped; Retry starts it again. */
  | "failed"
  /** Never retries (too big, no access, task gone); shown until dismissed. */
  | "rejected";

export type UploadItem = {
  id: string;
  userId: string;
  target: UploadTarget;
  /** Files added together; several too-big ones read as one line. */
  batchId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  original: Blob;
  preview: Blob | null;
  previewMime: AttachmentPreviewMime | null;
  width: number | null;
  height: number | null;
  /** The server row once begun, and the steps already done. */
  attachmentId: string | null;
  objectPath: string | null;
  previewPath: string | null;
  begunAt: number | null;
  originalSent: boolean;
  previewSent: boolean;
  attempts: number;
  /** Upload refusals in a row (the pending row moved on); restarts, then stops. */
  refusals: number;
  /**
   * The task may not be on the server yet (a capture made offline waits in
   * the store's outbox, AT-3): until the first begin goes through, "the task
   * is gone" means "not synced yet" and the file keeps waiting, for a day.
   */
  awaitTask?: boolean;
  nextRetryAt: number;
  state: UploadState;
  problem: UploadProblem | null;
  createdAt: number;
};

export type UploadView = Omit<UploadItem, "original"> & { loaded: number; total: number };

export type UploadSnapshot = {
  items: readonly UploadView[];
  /** Per target: the pool was at 95%+ after this session's last upload there. */
  almostFull: Readonly<Record<string, { usedBytes: number; totalBytes: number }>>;
};

export type UploadStore = {
  all(): Promise<UploadItem[]>;
  /** One item as stored now: null when it's gone (finished or dismissed,
   *  maybe in another tab), undefined when the store can't be read. */
  get(id: string): Promise<UploadItem | null | undefined>;
  /** True once the item is durably stored. */
  put(item: UploadItem): Promise<boolean>;
  remove(id: string): Promise<void>;
};

export function memoryUploadStore(initial: UploadItem[] = []): UploadStore & {
  items: Map<string, UploadItem>;
} {
  const items = new Map(initial.map((i) => [i.id, i]));
  return {
    items,
    async all() {
      return [...items.values()];
    },
    async get(id) {
      const item = items.get(id);
      return item ? { ...item } : null;
    },
    async put(item) {
      items.set(item.id, { ...item });
      return true;
    },
    async remove(id) {
      items.delete(id);
    },
  };
}

type AttachmentsApi = Pick<
  ModuoRuntime["attachments"],
  "begin" | "uploadObject" | "finalize" | "status"
> &
  Partial<Pick<ModuoRuntime["attachments"], "abandon">>;

export type UploadQueueDeps = {
  store: UploadStore;
  getApi: () => AttachmentsApi | null;
  prepare: (file: File, perFileBytes: number | null) => Promise<PreparedUpload>;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  isOnline?: () => boolean;
  newId?: () => string;
  /** Asks the browser to keep IndexedDB through storage pressure (web). */
  requestPersist?: () => void;
  /** This build may only read (below the minimum build): files keep waiting. */
  isReadOnly?: () => boolean;
  /**
   * Runs `fn` holding a cross-tab claim on one file, or answers false when
   * another tab holds it. Every tab loads the same stored queue, so without it
   * two tabs would upload the same file twice. Default: the Web Locks API.
   */
  claim?: (id: string, fn: () => Promise<void>) => Promise<boolean>;
};

function webLockClaim(id: string, fn: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return fn().then(() => true);
  return locks.request(`moduo-upload:${id}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await fn();
    return true;
  });
}

export const MAX_CONCURRENT = 2;
/** The INSERT policy only takes a pending row younger than 24 h. */
const BEGIN_STALE_MS = 23 * 60 * 60 * 1000;
const FULL_RETRY_MS = 5 * 60 * 1000;
const BUSY_RETRY_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_REFUSALS = 2;
/** How long a file waits for its task to reach the server (an offline capture). */
const AWAIT_TASK_MS = 24 * 60 * 60 * 1000;
/** Another tab holds the file: look again after this long. */
const CLAIMED_ELSEWHERE_MS = 30 * 1000;
/** Progress repaints at most this often. */
const PROGRESS_EMIT_MS = 100;

/** Exponential backoff with ±20% jitter, capped at 5 minutes. */
export function backoffMs(attempts: number, problem: UploadProblem | null, random = Math.random) {
  if (problem?.kind === "storage_full") return FULL_RETRY_MS;
  if (problem?.kind === "busy") return BUSY_RETRY_MS;
  const base = Math.min(2000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(base * (0.8 + 0.4 * random()));
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === "AbortError" : (e as Error)?.name === "AbortError";
}

const REJECTED_KINDS = new Set<UploadProblem["kind"]>([
  "too_large",
  "server_too_large",
  "empty",
  "no_access",
  "task_gone",
]);

export class UploadQueue {
  private items = new Map<string, UploadItem>();
  private progress = new Map<string, { loaded: number; total: number }>();
  private running = new Map<string, AbortController>();
  private almostFull: Record<string, { usedBytes: number; totalBytes: number }> = {};
  private listeners = new Set<() => void>();
  private uploadedListeners = new Set<
    (rec: AttachmentRecord | null, target: UploadTarget) => void
  >();
  private snapshot: UploadSnapshot = { items: [], almostFull: {} };
  private userId: string | null = null;
  private api: AttachmentsApi | null = null;
  private loaded: Promise<void> | null = null;
  private restored = false;
  private timer: unknown = null;
  private persistAsked = false;
  private progressTimer: unknown = null;
  /** Items known to be in the store: only those can be "gone" from it. */
  private persisted = new Set<string>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly isOnline: () => boolean;
  private readonly newId: () => string;

  constructor(private readonly deps: UploadQueueDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.isOnline =
      deps.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    this.claim = deps.claim ?? webLockClaim;
  }

  private readonly claim: (id: string, fn: () => Promise<void>) => Promise<boolean>;

  // ── subscription (useSyncExternalStore) ─────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): UploadSnapshot => this.snapshot;

  /** Fires once per file that reached `ready` here, or with null when another
   *  tab finished one for that target (re-read the list). */
  onUploaded(fn: (rec: AttachmentRecord | null, target: UploadTarget) => void): () => void {
    this.uploadedListeners.add(fn);
    return () => this.uploadedListeners.delete(fn);
  }

  /** Coalesce progress repaints: a big upload reports hundreds of times. */
  private emitProgress() {
    if (this.progressTimer != null) return;
    this.progressTimer = this.setTimer(() => {
      this.progressTimer = null;
      this.emit();
    }, PROGRESS_EMIT_MS);
  }

  private emit() {
    const items = [...this.items.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ original: _original, ...rest }) => {
        const p = this.progress.get(rest.id);
        return { ...rest, loaded: p?.loaded ?? 0, total: p?.total ?? rest.sizeBytes };
      });
    this.snapshot = { items, almostFull: { ...this.almostFull } };
    for (const fn of this.listeners) fn();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  /** Start (or resume) for the signed-in person: restores their pending files. */
  async start(userId: string, api?: AttachmentsApi | null): Promise<void> {
    if (api) this.api = api;
    if (this.userId !== userId) this.abortAll();
    this.userId = userId;
    this.loaded ??= this.deps.store
      .all()
      .then((rows) => {
        for (const row of rows) {
          this.persisted.add(row.id);
          if (this.items.has(row.id)) continue;
          // Whatever was mid-flight when the app closed goes back in line.
          this.items.set(row.id, {
            ...row,
            state: row.state === "uploading" ? "queued" : row.state,
          });
        }
      })
      .catch(() => {});
    await this.loaded;
    this.restored = true;
    this.emit();
    this.pump();
  }

  /** The device's stored uploads are back in the queue (a send waiting on its
   *  files can trust what the snapshot says only from here; CV-9). */
  hasRestored(): boolean {
    return this.restored;
  }

  /** Signed out: stop moving bytes. Pending files stay stored for next time. */
  stop(): void {
    this.userId = null;
    this.abortAll();
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private abortAll() {
    for (const ctrl of this.running.values()) ctrl.abort();
    this.running.clear();
  }

  /** Back online / back to the window: retry what was waiting on the network. */
  wake(): void {
    const now = this.now();
    for (const item of this.items.values()) {
      if (
        item.state === "waiting" &&
        (item.problem?.kind === "offline" ||
          item.problem?.kind === "interrupted" ||
          item.problem?.kind === "task_syncing")
      ) {
        item.nextRetryAt = Math.min(item.nextRetryAt, now);
      }
    }
    this.pump();
  }

  /** One person's files still to upload on this device (the reset-cache guard). */
  pendingIds(userId: string): string[] {
    const ids: string[] = [];
    for (const item of this.items.values()) {
      if (item.userId === userId && item.state !== "rejected") ids.push(item.id);
    }
    return ids;
  }

  // ── adding ──────────────────────────────────────────────────────────────────

  /**
   * Prepare and queue files for one target. Checks the pool first (when the
   * status can be read): a file over the per-file limit is refused before any
   * bytes move, one that doesn't fit the pool waits as "storage full".
   * Answers with the files' queue ids (refused ones included), so a caller
   * that shows no strip (a row or card drop, AT-3) can say what happened.
   */
  async add(
    files: File[],
    target: UploadTarget,
    userId: string,
    status?: StorageStatus | null,
    opts: { awaitTask?: boolean } = {},
  ): Promise<string[]> {
    if (files.length === 0) return [];
    const api = this.api ?? this.deps.getApi();
    const pool =
      status !== undefined
        ? status
        : api
          ? await api.status(target.workspaceId).catch(() => null)
          : null;
    const batchId = this.newId();
    const ids: string[] = [];
    let extra = 0;
    for (const file of files) {
      let prepared: PreparedUpload;
      try {
        prepared = await this.deps.prepare(file, pool?.perFileBytes ?? null);
      } catch {
        prepared = {
          original: file,
          fileName: file.name || "file",
          mime: file.type || "application/octet-stream",
          preview: null,
          previewMime: null,
          width: null,
          height: null,
        };
      }
      const now = this.now();
      const item: UploadItem = {
        id: this.newId(),
        userId,
        target,
        batchId,
        fileName: prepared.fileName,
        mime: prepared.mime,
        sizeBytes: prepared.original.size,
        original: prepared.original,
        preview: prepared.preview,
        previewMime: prepared.previewMime,
        width: prepared.width,
        height: prepared.height,
        attachmentId: null,
        objectPath: null,
        previewPath: null,
        begunAt: null,
        originalSent: false,
        previewSent: false,
        attempts: 0,
        refusals: 0,
        ...(opts.awaitTask ? { awaitTask: true } : {}),
        nextRetryAt: 0,
        state: "queued",
        problem: null,
        createdAt: now,
      };
      ids.push(item.id);
      const size = item.sizeBytes + (prepared.preview?.size ?? 0);
      if (item.sizeBytes === 0) {
        this.reject(item, { kind: "empty" });
        this.emit();
        continue;
      }
      if (pool && item.sizeBytes > pool.perFileBytes) {
        this.reject(item, {
          kind: "too_large",
          sizeBytes: item.sizeBytes,
          perFileBytes: pool.perFileBytes,
          tier: pool.tier,
        });
        this.emit();
        continue;
      }
      // Begin weighs the original alone; the batch's earlier files count whole
      // (their previews join the pending bytes once sent).
      if (pool && pool.usedBytes + pool.pendingBytes + extra + item.sizeBytes > pool.totalBytes) {
        item.state = "waiting";
        item.problem = {
          kind: "storage_full",
          usedBytes: pool.usedBytes + pool.pendingBytes,
          totalBytes: pool.totalBytes,
          tier: pool.tier,
        };
        item.nextRetryAt = now + FULL_RETRY_MS;
      } else {
        extra += size;
      }
      this.items.set(item.id, item);
      await this.save(item);
      if (!this.persistAsked) {
        this.persistAsked = true;
        this.deps.requestPersist?.();
      }
      // Start this one now; the rest of the batch prepares meanwhile.
      this.pump();
    }
    this.emit();
    return ids;
  }

  /** Try now (a failed or waiting file). Starts over when the last try failed. */
  retry(id: string): void {
    const item = this.items.get(id);
    if (!item || item.state === "uploading" || item.state === "rejected") return;
    if (item.state === "failed") this.restart(item);
    item.state = "queued";
    item.problem = null;
    item.attempts = 0;
    item.refusals = 0;
    item.nextRetryAt = 0;
    void this.save(item);
    this.emit();
    this.pump();
  }

  /** Forget a file. Its server row, if begun, is let go at once (AT-3). */
  dismiss(id: string): void {
    this.running.get(id)?.abort();
    this.running.delete(id);
    this.release(this.items.get(id)?.attachmentId ?? null);
    this.items.delete(id);
    this.progress.delete(id);
    this.persisted.delete(id);
    void this.deps.store.remove(id).catch(() => {});
    this.emit();
  }

  dismissAlmostFull(target: UploadTarget): void {
    delete this.almostFull[targetKey(target)];
    this.emit();
  }

  // ── running ─────────────────────────────────────────────────────────────────

  /** Persist an item still in the queue (a dismissed one must not come back). */
  private async save(item: UploadItem) {
    if (this.items.get(item.id) !== item) return;
    const ok = await this.deps.store.put(item).catch(() => false);
    if (ok) this.persisted.add(item.id);
  }

  /**
   * Let go of an upload's server row that will never finish (dismissed,
   * refused, or about to be begun again): its space in the pool is free at
   * once instead of after the 24 h sweep (AT-3, `attachments_op_abandon`). A
   * row that finished meanwhile is left alone by the server. Fire and forget.
   */
  private release(attachmentId: string | null) {
    if (!attachmentId) return;
    const api = this.api ?? this.deps.getApi();
    void api?.abandon?.(attachmentId).catch(() => {});
  }

  private reject(item: UploadItem, problem: UploadProblem) {
    this.release(item.attachmentId);
    item.attachmentId = null;
    item.state = "rejected";
    item.problem = problem;
    // Nothing to retry: let the bytes go.
    item.original = new Blob([]);
    this.items.set(item.id, item);
    this.persisted.delete(item.id);
    void this.deps.store.remove(item.id).catch(() => {});
  }

  /** Start a file over: its old server row (if any) is let go. */
  private restart(item: UploadItem) {
    this.release(item.attachmentId);
    item.attachmentId = null;
    item.objectPath = null;
    item.previewPath = null;
    item.begunAt = null;
    item.originalSent = false;
    item.previewSent = false;
  }

  private pump() {
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const userId = this.userId;
    const api = this.api ?? this.deps.getApi();
    if (!userId || !api) return;
    // Every op would be refused; the files wait for an updated app.
    if (this.deps.isReadOnly?.()) {
      this.emit();
      return;
    }
    const now = this.now();
    let next = Number.POSITIVE_INFINITY;
    for (const item of [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt)) {
      if (item.userId !== userId) continue;
      if (item.state !== "queued" && item.state !== "waiting") continue;
      if (this.running.has(item.id)) continue;
      if (!this.isOnline()) {
        if (item.problem?.kind !== "offline") {
          item.state = "waiting";
          item.problem = { kind: "offline" };
        }
        continue;
      }
      if (item.nextRetryAt > now) {
        next = Math.min(next, item.nextRetryAt);
        continue;
      }
      if (this.running.size >= MAX_CONCURRENT) break;
      void this.run(item, api);
    }
    if (Number.isFinite(next)) {
      this.timer = this.setTimer(() => this.pump(), Math.max(0, next - now));
    }
    this.emit();
  }

  private async run(item: UploadItem, api: AttachmentsApi) {
    const ctrl = new AbortController();
    this.running.set(item.id, ctrl);
    item.state = "uploading";
    item.problem = null;
    this.emit();
    let claimed = true;
    try {
      claimed = await this.claim(item.id, () => this.runClaimed(item, api, ctrl));
    } catch {
      // The claim itself failed (locks unavailable mid-way): try again later.
      claimed = false;
    } finally {
      if (this.running.get(item.id) === ctrl) this.running.delete(item.id);
    }
    if (!claimed && this.items.get(item.id) === item) {
      // Another tab is uploading this file; look again later.
      item.state = "waiting";
      item.problem = { kind: "elsewhere" };
      item.nextRetryAt = this.now() + CLAIMED_ELSEWHERE_MS;
    }
    this.pump();
  }

  private async runClaimed(item: UploadItem, api: AttachmentsApi, ctrl: AbortController) {
    try {
      // Another tab may have finished or moved this file on: work from the
      // stored copy, and drop it here when it's gone.
      const stored = await this.deps.store.get(item.id);
      // "Gone" only means something for a file that was stored: a write that
      // failed (quota, an unstorable Blob) must not make the file vanish.
      if (stored === null && this.persisted.has(item.id)) {
        this.persisted.delete(item.id);
        if (this.items.get(item.id) === item) {
          this.items.delete(item.id);
          this.progress.delete(item.id);
        }
        // Finished in another tab: views of this target re-read the server.
        for (const fn of this.uploadedListeners) fn(null, item.target);
        return;
      }
      if (stored) {
        item.attachmentId = stored.attachmentId;
        item.objectPath = stored.objectPath;
        item.previewPath = stored.previewPath;
        item.begunAt = stored.begunAt;
        item.originalSent = stored.originalSent;
        item.previewSent = stored.previewSent;
      }
      if (
        !item.attachmentId ||
        (item.begunAt != null && this.now() - item.begunAt > BEGIN_STALE_MS)
      ) {
        const input: AttachmentBeginInput = {
          workspaceId: item.target.workspaceId,
          entityType: item.target.entityType,
          entityId: item.target.entityId,
          ...(item.target.entityType === "chat_message"
            ? { channelId: item.target.channelId }
            : {}),
          fileName: item.fileName,
          mime: item.mime,
          sizeBytes: item.sizeBytes,
          previewMime: item.preview ? item.previewMime : null,
          width: item.width,
          height: item.height,
        };
        const rec = await api.begin(input);
        if (ctrl.signal.aborted || this.items.get(item.id) !== item) {
          // Dismissed (or stopped) while begin was answering: the row it just
          // made will never be used, so let it go now.
          this.release(rec.id);
          throw new DOMException("aborted", "AbortError");
        }
        this.restart(item);
        item.attachmentId = rec.id;
        item.objectPath = rec.objectPath;
        item.previewPath = rec.previewPath;
        item.begunAt = this.now();
        // The task is on the server: from here "gone" means gone.
        delete item.awaitTask;
        await this.save(item);
      }
      if (ctrl.signal.aborted) throw new DOMException("aborted", "AbortError");
      if (!item.originalSent) {
        if (!item.objectPath) throw new AttachmentOpError("upload_failed");
        await api.uploadObject({
          path: item.objectPath,
          blob: item.original,
          contentType: item.mime,
          signal: ctrl.signal,
          onProgress: (loaded, total) => {
            this.progress.set(item.id, { loaded, total });
            this.emitProgress();
          },
        });
        item.originalSent = true;
        await this.save(item);
      }
      if (item.preview && item.previewPath && !item.previewSent) {
        try {
          await api.uploadObject({
            path: item.previewPath,
            blob: item.preview,
            contentType: item.previewMime ?? "image/jpeg",
            signal: ctrl.signal,
          });
        } catch (e) {
          // No preview is fine (the tile shows the file type); a dropped
          // connection is not: retry the whole step later.
          if (isAbort(e) || classifyUploadError(e, this.isOnline()).kind !== "failed") throw e;
        }
        item.previewSent = true;
        await this.save(item);
      }
      const rec = await api.finalize(item.attachmentId as string);
      if (rec.status !== "ready") throw new AttachmentOpError("upload_mismatch");
      // Attached, even if dismissed while finalizing: say so truthfully.
      this.items.delete(item.id);
      this.progress.delete(item.id);
      this.persisted.delete(item.id);
      await this.deps.store.remove(item.id).catch(() => {});
      for (const fn of this.uploadedListeners) fn(rec, item.target);
      // The 95% caption: uploaders see it under the strip, no popup.
      const status = await api.status(item.target.workspaceId).catch(() => null);
      const key = targetKey(item.target);
      if (status && status.level >= 95) {
        this.almostFull[key] = { usedBytes: status.usedBytes, totalBytes: status.totalBytes };
      } else {
        delete this.almostFull[key];
      }
    } catch (e) {
      if (this.items.get(item.id) !== item) return; // dismissed meanwhile
      if (isAbort(e)) {
        item.state = "queued";
        return;
      }
      this.fail(item, e);
    }
  }

  private fail(item: UploadItem, e: unknown) {
    if (this.deps.isReadOnly?.()) {
      // Refused because this build may only read: keep the file and its
      // server row as they are; an updated app picks it up.
      item.state = "queued";
      item.problem = null;
      void this.save(item);
      return;
    }
    const code = e instanceof AttachmentOpError ? e.code : null;
    if (code === "not_uploaded") {
      // Finalize didn't find the bytes: send them again, after a short wait.
      item.originalSent = false;
      item.previewSent = false;
      item.attempts += 1;
      item.state = "waiting";
      item.problem = { kind: "interrupted" };
      item.nextRetryAt = this.now() + backoffMs(item.attempts, null, this.random);
      void this.save(item);
      return;
    }
    if (code === "upload_refused") {
      // The pending row moved on (swept, older than 24 h): begin again, twice at most.
      item.refusals += 1;
      this.restart(item);
      if (item.refusals <= MAX_REFUSALS) {
        item.state = "queued";
        item.nextRetryAt = 0;
        void this.save(item);
        return;
      }
    }
    const problem = classifyUploadError(e, this.isOnline());
    if (
      problem.kind === "task_gone" &&
      item.awaitTask &&
      this.now() - item.createdAt < AWAIT_TASK_MS
    ) {
      // An offline capture's task hasn't reached the server yet (its outbox
      // sends it when the network is back, maybe a moment after this woke).
      item.attempts += 1;
      item.state = "waiting";
      item.problem = { kind: "task_syncing" };
      item.nextRetryAt = this.now() + backoffMs(item.attempts, null, this.random);
      void this.save(item);
      return;
    }
    if (REJECTED_KINDS.has(problem.kind)) {
      this.reject(item, problem);
      return;
    }
    item.problem = problem;
    item.attempts += 1;
    if (problemRetriesItself(problem)) {
      item.state = "waiting";
      item.nextRetryAt = this.now() + backoffMs(item.attempts, problem, this.random);
    } else {
      // Failed or mismatched: Retry starts the file over.
      item.state = "failed";
      this.restart(item);
    }
    void this.save(item);
  }
}

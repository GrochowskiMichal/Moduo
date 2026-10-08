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

export type UploadTarget = { workspaceId: string; entityType: "task"; entityId: string };

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
  put(item: UploadItem): Promise<void>;
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
    async put(item) {
      items.set(item.id, { ...item });
    },
    async remove(id) {
      items.delete(id);
    },
  };
}

type AttachmentsApi = Pick<
  ModuoRuntime["attachments"],
  "begin" | "uploadObject" | "finalize" | "status"
>;

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
};

export const MAX_CONCURRENT = 2;
/** The INSERT policy only takes a pending row younger than 24 h. */
const BEGIN_STALE_MS = 23 * 60 * 60 * 1000;
const FULL_RETRY_MS = 5 * 60 * 1000;
const BUSY_RETRY_MS = 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_REFUSALS = 2;

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

const REJECTED_KINDS = new Set<UploadProblem["kind"]>(["too_large", "no_access", "task_gone"]);

export class UploadQueue {
  private items = new Map<string, UploadItem>();
  private progress = new Map<string, { loaded: number; total: number }>();
  private running = new Map<string, AbortController>();
  private almostFull: Record<string, { usedBytes: number; totalBytes: number }> = {};
  private listeners = new Set<() => void>();
  private uploadedListeners = new Set<(rec: AttachmentRecord, target: UploadTarget) => void>();
  private snapshot: UploadSnapshot = { items: [], almostFull: {} };
  private userId: string | null = null;
  private loaded: Promise<void> | null = null;
  private timer: unknown = null;
  private persistAsked = false;
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
  }

  // ── subscription (useSyncExternalStore) ─────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): UploadSnapshot => this.snapshot;

  /** Fires once per file that reached `ready`. */
  onUploaded(fn: (rec: AttachmentRecord, target: UploadTarget) => void): () => void {
    this.uploadedListeners.add(fn);
    return () => this.uploadedListeners.delete(fn);
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
  async start(userId: string): Promise<void> {
    if (this.userId !== userId) this.abortAll();
    this.userId = userId;
    this.loaded ??= this.deps.store
      .all()
      .then((rows) => {
        for (const row of rows) {
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
    this.emit();
    this.pump();
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
        (item.problem?.kind === "offline" || item.problem?.kind === "interrupted")
      ) {
        item.nextRetryAt = Math.min(item.nextRetryAt, now);
      }
    }
    this.pump();
  }

  /** Files still to upload on this device (the reset-cache guard). */
  countPending(): number {
    let n = 0;
    for (const item of this.items.values()) if (item.state !== "rejected") n += 1;
    return n;
  }

  // ── adding ──────────────────────────────────────────────────────────────────

  /**
   * Prepare and queue files for one target. Checks the pool first (when the
   * status can be read): a file over the per-file limit is refused before any
   * bytes move, one that doesn't fit the pool waits as "storage full".
   */
  async add(
    files: File[],
    target: UploadTarget,
    userId: string,
    status?: StorageStatus | null,
  ): Promise<void> {
    if (files.length === 0) return;
    const api = this.deps.getApi();
    const pool =
      status !== undefined
        ? status
        : api
          ? await api.status(target.workspaceId).catch(() => null)
          : null;
    const batchId = this.newId();
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
        nextRetryAt: 0,
        state: "queued",
        problem: null,
        createdAt: now,
      };
      const size = item.sizeBytes + (prepared.preview?.size ?? 0);
      if (pool && item.sizeBytes > pool.perFileBytes) {
        this.reject(item, {
          kind: "too_large",
          sizeBytes: item.sizeBytes,
          perFileBytes: pool.perFileBytes,
          tier: pool.tier,
        });
        continue;
      }
      if (pool && pool.usedBytes + pool.pendingBytes + extra + size > pool.totalBytes) {
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
    }
    this.emit();
    this.pump();
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

  /** Forget a file (its server row, if begun, is swept by the purge in 24 h). */
  dismiss(id: string): void {
    this.running.get(id)?.abort();
    this.running.delete(id);
    this.items.delete(id);
    this.progress.delete(id);
    void this.deps.store.remove(id).catch(() => {});
    this.emit();
  }

  dismissAlmostFull(target: UploadTarget): void {
    delete this.almostFull[targetKey(target)];
    this.emit();
  }

  // ── running ─────────────────────────────────────────────────────────────────

  private async save(item: UploadItem) {
    await this.deps.store.put(item).catch(() => {});
  }

  private reject(item: UploadItem, problem: UploadProblem) {
    item.state = "rejected";
    item.problem = problem;
    // Nothing to retry: let the bytes go.
    item.original = new Blob([]);
    this.items.set(item.id, item);
    void this.deps.store.remove(item.id).catch(() => {});
  }

  private restart(item: UploadItem) {
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
    const api = this.deps.getApi();
    if (!userId || !api) return;
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
    try {
      if (
        !item.attachmentId ||
        (item.begunAt != null && this.now() - item.begunAt > BEGIN_STALE_MS)
      ) {
        const input: AttachmentBeginInput = {
          workspaceId: item.target.workspaceId,
          entityType: item.target.entityType,
          entityId: item.target.entityId,
          fileName: item.fileName,
          mime: item.mime,
          sizeBytes: item.sizeBytes,
          previewMime: item.preview ? item.previewMime : null,
          width: item.width,
          height: item.height,
        };
        const rec = await api.begin(input);
        this.restart(item);
        item.attachmentId = rec.id;
        item.objectPath = rec.objectPath;
        item.previewPath = rec.previewPath;
        item.begunAt = this.now();
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
            this.emit();
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
      this.items.delete(item.id);
      this.progress.delete(item.id);
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
      if (!this.items.has(item.id)) return; // dismissed meanwhile
      if (isAbort(e)) {
        item.state = "queued";
        return;
      }
      this.fail(item, e);
    } finally {
      if (this.running.get(item.id) === ctrl) this.running.delete(item.id);
      this.pump();
    }
  }

  private fail(item: UploadItem, e: unknown) {
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

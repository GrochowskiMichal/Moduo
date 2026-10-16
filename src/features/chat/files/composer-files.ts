// The files waiting in a conversation's composer (CV-9, spec §7): pasted,
// dropped or picked, they start uploading at once under the message id the
// composer minted for its next message (upload first, send after); the send
// takes that id and the count, and the outbox waits for them (files/gate.ts).
// Kept per conversation for the session, so switching away and back keeps
// them; the upload queue keeps the bytes (and retries) underneath.

import { useCallback, useSyncExternalStore } from "react";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { getUploadQueue } from "@/lib/uploads";
import { describeProblem } from "@/lib/uploads/errors";
import type { UploadView } from "@/lib/uploads/queue";
import { newMessageId } from "../store/outbox";
import { capNotice, takeFiles } from "./model";

export type ComposerFileState = "uploading" | "ready" | "failed";

export type ComposerFile = {
  /** The upload queue's id for it. */
  key: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  /** A local picture of it (an image), until the composer lets it go. */
  thumb: string | null;
  state: ComposerFileState;
  /** Bytes sent so far, of `total`. */
  loaded: number;
  total: number;
  /** Why it stopped (failed only). */
  problem: string | null;
};

type Entry = {
  key: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  thumb: string | null;
  attachmentId: string | null;
};

type Draft = { messageId: string; entries: Entry[]; notice: string | null; adding: number };

type QueueApi = Pick<
  ReturnType<typeof getUploadQueue>,
  "add" | "dismiss" | "getSnapshot" | "subscribe"
>;

/** The per-conversation drafts' files. One per app (the composer remounts per conversation). */
export class ComposerFilesStore {
  private drafts = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly queue: () => QueueApi,
    private readonly mint: () => string = newMessageId,
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    const off = this.queue().subscribe(fn);
    return () => {
      this.listeners.delete(fn);
      off();
    };
  };

  private seen: { v: number; snap: unknown; token: object } | null = null;

  /** Changes whenever a draft or the queue (progress included) changes. */
  getVersion = (): object => {
    const snap = this.queue().getSnapshot();
    if (!this.seen || this.seen.v !== this.version || this.seen.snap !== snap) {
      this.seen = { v: this.version, snap, token: {} };
    }
    return this.seen.token;
  };

  private emit() {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  private draft(channelId: string): Draft {
    let d = this.drafts.get(channelId);
    if (!d) {
      d = { messageId: this.mint(), entries: [], notice: null, adding: 0 };
      this.drafts.set(channelId, d);
    }
    return d;
  }

  /** The id the next message's files upload under. */
  messageId(channelId: string): string {
    return this.draft(channelId).messageId;
  }

  notice(channelId: string): string | null {
    return this.drafts.get(channelId)?.notice ?? null;
  }

  /** Files still being prepared (not in the queue yet): the send waits for them. */
  busy(channelId: string): boolean {
    return (this.drafts.get(channelId)?.adding ?? 0) > 0;
  }

  /** What the composer shows, from the queue's live state. */
  files(channelId: string): ComposerFile[] {
    const d = this.drafts.get(channelId);
    if (!d) return [];
    const items = new Map(this.queue().getSnapshot().items.map((i) => [i.id, i]));
    const out: ComposerFile[] = [];
    for (const e of d.entries) {
      const item = items.get(e.key);
      if (item?.attachmentId) e.attachmentId = item.attachmentId;
      if (!item && !e.attachmentId) continue; // let go elsewhere (another window)
      out.push(view(e, item));
    }
    return out;
  }

  /**
   * Add files: up to the message's cap (the rest refused before any upload,
   * with a line saying so), each queued under the draft's message id.
   */
  async add(args: {
    channelId: string;
    workspaceId: string;
    userId: string;
    files: File[];
  }): Promise<void> {
    const d = this.draft(args.channelId);
    const current = this.files(args.channelId).length + d.adding;
    const { take, refused } = takeFiles(current, args.files.length);
    d.notice = capNotice(refused);
    const picked = args.files.slice(0, take);
    if (picked.length === 0) {
      this.emit();
      return;
    }
    d.adding += picked.length;
    this.emit();
    try {
      const ids = await this.queue().add(
        picked,
        {
          workspaceId: args.workspaceId,
          entityType: "chat_message",
          entityId: d.messageId,
          channelId: args.channelId,
        },
        args.userId,
      );
      ids.forEach((key, i) => {
        const file = picked[i];
        if (!file) return;
        d.entries.push({
          key,
          fileName: file.name || "file",
          mime: file.type || "application/octet-stream",
          sizeBytes: file.size,
          thumb:
            file.type.startsWith("image/") && typeof URL !== "undefined" && URL.createObjectURL
              ? URL.createObjectURL(file)
              : null,
          attachmentId: null,
        });
      });
    } finally {
      d.adding -= picked.length;
      this.emit();
    }
  }

  /** Take a file back out (before sending): its upload stops, or the finished file goes. */
  remove(channelId: string, key: string, runtime: Pick<ModuoRuntime, "attachments"> | null): void {
    const d = this.drafts.get(channelId);
    const i = d?.entries.findIndex((e) => e.key === key) ?? -1;
    if (!d || i < 0) return;
    const [entry] = d.entries.splice(i, 1);
    if (!entry) return;
    const inQueue = this.queue()
      .getSnapshot()
      .items.some((item) => item.id === key);
    if (inQueue) this.queue().dismiss(key);
    else if (entry.attachmentId) void runtime?.attachments.remove(entry.attachmentId).catch(() => {});
    release(entry);
    d.notice = null;
    this.emit();
  }

  /**
   * The send: the id its files went up under and how many go (a file that
   * stopped is left out: it never joins), or null when it has none. The
   * draft starts over with a new id.
   */
  take(channelId: string): { id: string; files: number } | null {
    const d = this.drafts.get(channelId);
    if (!d || d.entries.length === 0) return null;
    const files = this.files(channelId);
    const going = files.filter((f) => f.state !== "failed");
    for (const f of files) if (f.state === "failed") this.queue().dismiss(f.key);
    const out = going.length > 0 ? { id: d.messageId, files: going.length } : null;
    for (const e of d.entries) release(e);
    this.drafts.delete(channelId);
    this.emit();
    return out;
  }
}

function release(e: Entry) {
  if (e.thumb && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(e.thumb);
}

function view(e: Entry, item: UploadView | undefined): ComposerFile {
  if (!item) {
    return { ...pick(e), state: "ready", loaded: e.sizeBytes, total: e.sizeBytes, problem: null };
  }
  const failed = item.state === "failed" || item.state === "rejected";
  return {
    ...pick(e),
    state: failed ? "failed" : "uploading",
    loaded: item.loaded,
    total: item.total || e.sizeBytes,
    problem:
      failed && item.problem
        ? describeProblem(item.problem, {
            fileName: e.fileName,
            isOwner: false,
            on: "chat_message",
          }).text
        : failed
          ? "Not attached — the upload failed"
          : null,
  };
}

function pick(e: Entry) {
  return {
    key: e.key,
    fileName: e.fileName,
    mime: e.mime,
    sizeBytes: e.sizeBytes,
    thumb: e.thumb,
  };
}

let shared: ComposerFilesStore | null = null;

export function composerFilesStore(): ComposerFilesStore {
  shared ??= new ComposerFilesStore(() => getUploadQueue());
  return shared;
}

export type ComposerFilesApi = {
  files: ComposerFile[];
  notice: string | null;
  busy: boolean;
  add: (files: File[]) => void;
  remove: (key: string) => void;
  /** At send: the id and count for the outbox, or null without files. */
  take: () => { id: string; files: number } | null;
};

/** A conversation composer's files (null without a signed-in person and a workspace). */
export function useComposerFiles(args: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  channelId: string;
  store?: ComposerFilesStore;
}): ComposerFilesApi | null {
  const store = args.store ?? composerFilesStore();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const { runtime, workspaceId, userId, channelId } = args;
  const add = useCallback(
    (files: File[]) => {
      if (!workspaceId || !userId || files.length === 0) return;
      void store.add({ channelId, workspaceId, userId, files });
    },
    [store, channelId, workspaceId, userId],
  );
  const remove = useCallback(
    (key: string) => store.remove(channelId, key, runtime),
    [store, channelId, runtime],
  );
  const take = useCallback(() => store.take(channelId), [store, channelId]);
  if (!workspaceId || !userId) return null;
  return {
    files: store.files(channelId),
    notice: store.notice(channelId),
    busy: store.busy(channelId),
    add,
    remove,
    take,
  };
}

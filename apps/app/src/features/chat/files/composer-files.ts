// The files waiting in a conversation's composer (CV-9, spec §7): pasted,
// dropped or picked, they start uploading at once under the message id the
// composer minted for its next message (upload first, send after); the send
// takes that id and the count, and the outbox waits for them (files/gate.ts).
// Kept per conversation for the session, so switching away and back keeps
// them; the upload queue keeps the bytes (and retries) underneath.

import { useCallback, useSyncExternalStore } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { getUploadQueue } from "@/lib/uploads";
import { AttachmentOpError, describeProblem } from "@/lib/uploads/errors";
import type { UploadView } from "@/lib/uploads/queue";

import { newMessageId } from "../store/outbox";
import { capNotice, fileShape, takeFiles } from "./model";

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
  /** Why it stopped (failed), or that taking it out failed (ready: it still goes). */
  problem: string | null;
};

type Entry = {
  key: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  thumb: string | null;
  attachmentId: string | null;
  /** When it was added: the server lets an unsent message's file go after a day. */
  addedAt: number;
  /** Taking it back out failed: it's still on the server and still goes. */
  problem: string | null;
  /** Came back after a failed take-out: the next stale check leaves it (else it'd fail again at once). */
  spareStale?: boolean;
};

type Draft = {
  messageId: string;
  entries: Entry[];
  notice: string | null;
  /** Files still being read in (not in the queue yet). */
  adding: number;
  /** Files being taken back out on the server: until they are, they'd still go. */
  removing: number;
  /** Bumped when a file comes back (its take-out failed): a held send must not go on its own. */
  returned: number;
  /** Server ids whose upload finished under this draft's id (the queue says so, even after a dismiss). */
  finished: Set<string>;
  /** Server ids taken out with × before they finished, whose take-out failed: if one finishes later it would go. */
  unfinished: Set<string>;
};

type Remover = Pick<ModuoRuntime, "attachments">;

/**
 * The server drops an unsent message's files a day after upload (the purge):
 * a draft's file older than this is taken out at send, with a line saying so,
 * rather than going missing on the way.
 */
export const DRAFT_FILE_STALE_MS = 23 * 60 * 60 * 1000;

export const REMOVE_FAILED = "Couldn't take it out: it still goes. Try again.";

export function staleNotice(n: number): string {
  return n === 1
    ? "A file waited over a day and was taken out: send again to post without it"
    : `${n} files waited over a day and were taken out: send again to post without them`;
}

type QueueApi = Pick<
  ReturnType<typeof getUploadQueue>,
  "add" | "dismiss" | "getSnapshot" | "subscribe"
> &
  Partial<Pick<ReturnType<typeof getUploadQueue>, "onUploaded">>;

/** The per-conversation drafts' files. One per app (the composer remounts per conversation). */
export class ComposerFilesStore {
  private drafts = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly queue: () => QueueApi,
    private readonly mint: () => string = newMessageId,
    private readonly now: () => number = Date.now,
  ) {}

  /** What takes a file back out on the server (the composer hands it over). */
  private remover: Remover | null = null;

  setRemover(runtime: Remover | null): void {
    if (runtime) this.remover = runtime;
  }

  /** Server ids being taken out right now. */
  private dropping = new Set<string>();

  private watching = false;

  /**
   * Keep each file's server id as soon as the queue knows it, even with no
   * composer on screen: a finished upload leaves the queue, and the composer's
   * remove (and only it) needs the id to take a finished file back out.
   */
  private watch() {
    if (this.watching) return;
    this.watching = true;
    const q = this.queue();
    q.subscribe(() => this.capture());
    q.onUploaded?.((rec, target) => {
      if (!rec || target.entityType !== "chat_message") return;
      // Only an unsent draft's files: a taken draft's files belong to its send.
      const found = [...this.drafts.entries()].find(([, x]) => x.messageId === target.entityId);
      if (!found) return;
      const [channelId, d] = found;
      // Recorded first, whatever follows: a × in the moment between finalize
      // and the queue's next snapshot still sees the file as uploading.
      d.finished.add(rec.id);
      if (d.entries.some((e) => e.attachmentId === rec.id)) return;
      // Taken out before it finished and the take-out failed: it's ready now,
      // so it'd go. Take it out again (the chip comes back if that fails).
      // Checked before `dropping`, which that failed take-out leaves a moment later.
      const late = d.unfinished.delete(rec.id);
      if (!late && this.dropping.has(rec.id)) return;
      if (!late && [...this.known.values()].includes(rec.id)) return;
      // The queue announces each id as begin answers (captured above); a file
      // here without one may be this, so leave it (and only for a name no
      // other file shares, say it is).
      const open = d.entries.filter((x) => !x.attachmentId);
      if (!late && open.length > 0) {
        const named = open.filter((x) => x.fileName === rec.fileName);
        const e = named.length === 1 ? named[0] : undefined;
        if (e) e.attachmentId = rec.id;
        return;
      }
      // Taken out with × while it finished: it's ready under this draft's id
      // and the send would take it. Take it out on the server too.
      this.dropOnServer(channelId, d, rec.id, {
        key: `done:${rec.id}`,
        fileName: rec.fileName,
        mime: rec.mime,
        sizeBytes: rec.sizeBytes,
        thumb: null,
        attachmentId: rec.id,
        addedAt: this.now(),
        problem: null,
      });
    });
  }

  /**
   * Take a file out of the unsent message on the server; the send waits until
   * it's out. When that fails and `back` is given, the file comes back as a
   * chip saying it still goes (else it would go unseen). With `ifFinished`
   * (× on a file still uploading) it comes back only if its upload finished:
   * an unfinished row never joins the send, so a chip would promise a file
   * that doesn't go. (A finalize the server did but whose answer was lost
   * looks unfinished here; if it was ready, its send carries it unseen. So
   * does a send made before a late finish lands: the draft is gone by then.)
   */
  private dropOnServer(
    channelId: string,
    d: Draft,
    id: string,
    back: Entry | null,
    at = -1,
    ifFinished = false,
  ) {
    const runtime = this.remover;
    if (!runtime) {
      if (back) this.putBack(channelId, d, back, at);
      return;
    }
    d.removing += 1;
    this.dropping.add(id);
    this.emit();
    void runtime.attachments
      .remove(id)
      .then(
        () => {
          if (back) release(back);
        },
        (e: unknown) => {
          // Not found: the row is gone already (purged, or let go by the
          // queue), which is what was asked.
          const gone = e instanceof AttachmentOpError && e.code === "attachment_not_found";
          if (!back) return;
          if (gone) release(back);
          else if (ifFinished && !d.finished.has(id)) {
            // Not finished: it won't go, unless it finishes later (watched).
            d.unfinished.add(id);
            release(back);
          } else this.putBack(channelId, d, back, at);
        },
      )
      .finally(() => {
        d.removing -= 1;
        this.dropping.delete(id);
        this.emit();
      });
  }

  private putBack(channelId: string, d: Draft, e: Entry, at: number) {
    if (this.drafts.get(channelId) !== d) {
      release(e);
      return;
    }
    e.problem = REMOVE_FAILED;
    // It still goes. Its server clock keeps running (addedAt stays), but the
    // next stale check leaves it, so it isn't taken out (and failing) over and over.
    e.spareStale = true;
    d.returned += 1;
    const i = at < 0 ? d.entries.length : Math.min(at, d.entries.length);
    d.entries.splice(i, 0, e);
  }

  /** Queue key → server id, for chat uploads, kept even before the composer
   *  holds the key (a batch's first file can finish while the rest prepare). */
  private known = new Map<string, string>();

  private capture() {
    for (const item of this.queue().getSnapshot().items) {
      if (item.target.entityType === "chat_message" && item.attachmentId) {
        this.known.set(item.id, item.attachmentId);
      }
    }
    for (const d of this.drafts.values()) {
      for (const e of d.entries) {
        if (!e.attachmentId) e.attachmentId = this.known.get(e.key) ?? null;
      }
    }
  }

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

  private views = new Map<string, { token: object; view: ComposerFilesView }>();

  /**
   * A conversation's files as one snapshot: a new object only when something
   * changed. With the React Compiler on, a hook must return what
   * `useSyncExternalStore` hands it (docs/gotchas/ui.md, RF-1): reading the
   * store beside it is memoised away and never repaints.
   */
  view(channelId: string): ComposerFilesView {
    const token = this.getVersion();
    const hit = this.views.get(channelId);
    if (hit && hit.token === token) return hit.view;
    const view = {
      files: this.files(channelId),
      notice: this.notice(channelId),
      busy: this.busy(channelId),
      returned: this.drafts.get(channelId)?.returned ?? 0,
    };
    this.views.set(channelId, { token, view });
    return view;
  }

  private emit() {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  private draft(channelId: string): Draft {
    let d = this.drafts.get(channelId);
    if (!d) {
      d = {
        messageId: this.mint(),
        entries: [],
        notice: null,
        adding: 0,
        removing: 0,
        returned: 0,
        finished: new Set(),
        unfinished: new Set(),
      };
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

  /** Files still being read in, or being taken back out: the send waits for them. */
  busy(channelId: string): boolean {
    const d = this.drafts.get(channelId);
    return !!d && d.adding + d.removing > 0;
  }

  /** What the composer shows, from the queue's live state. */
  files(channelId: string): ComposerFile[] {
    const d = this.drafts.get(channelId);
    if (!d) return [];
    const items = new Map(
      this.queue()
        .getSnapshot()
        .items.map((i) => [i.id, i]),
    );
    const out: ComposerFile[] = [];
    for (const e of d.entries) {
      const item = items.get(e.key);
      if (item?.attachmentId) e.attachmentId = item.attachmentId;
      // Gone from the queue without a known server id: it finished (a removed
      // file leaves `entries` with it), so it shows as up.
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
    runtime?: Remover | null;
  }): Promise<void> {
    this.watch();
    this.setRemover(args.runtime ?? null);
    const d = this.draft(args.channelId);
    // A file that stopped never goes: it doesn't take a place.
    const current =
      this.files(args.channelId).filter((f) => f.state !== "failed").length + d.adding;
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
            fileShape({ mime: file.type, fileName: file.name }) === "image" &&
            typeof URL !== "undefined" &&
            URL.createObjectURL
              ? URL.createObjectURL(file)
              : null,
          attachmentId: this.known.get(key) ?? null,
          addedAt: this.now(),
          problem: null,
        });
      });
    } finally {
      d.adding -= picked.length;
      this.emit();
    }
  }

  /**
   * Take a file back out (before sending): its upload stops, and a file the
   * server already holds (finished, or finishing) is taken out there too; the
   * send waits until it is.
   */
  remove(channelId: string, key: string, runtime: Remover | null): void {
    this.setRemover(runtime);
    const d = this.drafts.get(channelId);
    const i = d?.entries.findIndex((e) => e.key === key) ?? -1;
    if (!d || i < 0) return;
    const [entry] = d.entries.splice(i, 1);
    if (!entry) return;
    this.capture();
    entry.attachmentId ??= this.known.get(key) ?? null;
    this.known.delete(key);
    d.notice = null;
    const item = this.queue()
      .getSnapshot()
      .items.find((x) => x.id === key);
    const inQueue = !!item;
    // A stopped upload never goes: if its take-out fails it needn't come back.
    const stopped = item?.state === "failed" || item?.state === "rejected";
    if (inQueue) {
      this.queue().dismiss(key);
      // Its finalize may already be on the way (the queue attaches a file
      // dismissed while finalizing): take the row out too. Not found = the
      // dismiss already let it go; any other failure brings the chip back.
      if (entry.attachmentId && this.remover) {
        this.dropOnServer(channelId, d, entry.attachmentId, stopped ? null : entry, i, true);
        if (stopped) release(entry);
      } else release(entry);
    } else if (entry.attachmentId) {
      this.dropOnServer(channelId, d, entry.attachmentId, entry, i);
    } else {
      release(entry);
    }
    this.emit();
  }

  /**
   * Before a send: take out files that waited longer than the server keeps an
   * unsent message's files, with a line saying so. True when it took any out
   * (the send holds: the person sees why, and sends again).
   */
  dropStale(channelId: string): boolean {
    const d = this.drafts.get(channelId);
    if (!d) return false;
    const states = new Map(this.files(channelId).map((f) => [f.key, f.state]));
    const stale = d.entries.filter(
      (e) => !e.spareStale && this.now() - e.addedAt > DRAFT_FILE_STALE_MS,
    );
    for (const e of d.entries) e.spareStale = false;
    // A stopped file never goes anyway: it leaves quietly.
    const going = stale.filter((e) => states.get(e.key) !== "failed");
    for (const e of stale) this.remove(channelId, e.key, null);
    if (going.length === 0) return false;
    d.notice = staleNotice(going.length);
    this.emit();
    return true;
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
    for (const e of d.entries) {
      release(e);
      this.known.delete(e.key);
    }
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
    return {
      ...pick(e),
      state: "ready",
      loaded: e.sizeBytes,
      total: e.sizeBytes,
      problem: e.problem,
    };
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

export type ComposerFilesView = {
  files: ComposerFile[];
  notice: string | null;
  busy: boolean;
  /** Changes when a file came back after a failed take-out. */
  returned: number;
};

export type ComposerFilesApi = {
  files: ComposerFile[];
  notice: string | null;
  busy: boolean;
  /** Changes when a file came back after a failed take-out: a held send stops. */
  returned: number;
  add: (files: File[]) => void;
  remove: (key: string) => void;
  /** Before a send: take out files too old to go (true: the send holds). */
  dropStale: () => boolean;
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
  const { runtime, workspaceId, userId, channelId } = args;
  const snap = useSyncExternalStore(
    store.subscribe,
    () => store.view(channelId),
    () => store.view(channelId),
  );
  const add = useCallback(
    (files: File[]) => {
      if (!workspaceId || !userId || files.length === 0) return;
      void store.add({ channelId, workspaceId, userId, files, runtime });
    },
    [store, channelId, workspaceId, userId, runtime],
  );
  const remove = useCallback(
    (key: string) => store.remove(channelId, key, runtime),
    [store, channelId, runtime],
  );
  const take = useCallback(() => store.take(channelId), [store, channelId]);
  const dropStale = useCallback(() => store.dropStale(channelId), [store, channelId]);
  if (!workspaceId || !userId) return null;
  return {
    files: snap.files,
    notice: snap.notice,
    busy: snap.busy,
    returned: snap.returned,
    add,
    remove,
    dropStale,
    take,
  };
}

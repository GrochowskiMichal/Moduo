// CV-9 · Files in chat: the pure rules (media box, the 10-file cap, shapes),
// the gate between the outbox and the upload queue, the composer's files, and
// a send that waits for its files.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAT_FILE_LINK_TTL_SECONDS } from "@contracts/attachments";
import { afterEach, describe, expect, it } from "@rstest/core";
import { clearSignedUrlCache, signPaths } from "@/features/attachments/signed-urls";
import { AttachmentOpError } from "@/lib/uploads/errors";
import type { UploadView } from "@/lib/uploads/queue";
import { memoryChatCopy } from "../store/device-copy";
import { ChatStore, FILES_ALL_STOPPED } from "../store/store";
import { FakeChatServer, fakeLive, ME, settle, uuid, WS } from "../store/testing";
import {
  ComposerFilesStore,
  DRAFT_FILE_STALE_MS,
  REMOVE_FAILED,
  staleNotice,
} from "./composer-files";
import { type ChatFileGate, type ChatFilesState, filesState, uploadQueueGate } from "./gate";
import { asAttachmentRecord, resignDelayMs } from "./message-files";
import { capNotice, FEED_MEDIA, fileShape, fitMedia, hasSendableFiles, takeFiles } from "./model";

describe("files in a message (CV-9, §7)", () => {
  it("fits a picture's stored size inside the 360 × 240 media box, never enlarging it", () => {
    expect(fitMedia(1440, 900)).toEqual({ width: 360, height: 225 });
    expect(fitMedia(400, 1200)).toEqual({ width: 80, height: 240 });
    expect(fitMedia(200, 100)).toEqual({ width: 200, height: 100 });
    expect(fitMedia(null, null)).toEqual({ width: 360, height: 240 });
  });

  it("mirrors the media box tokens", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
    expect(css).toContain(`--feed-media-max-w: 22.5rem; /* ${FEED_MEDIA.w} */`);
    expect(css).toContain(`--feed-media-max-h: 15rem;   /* ${FEED_MEDIA.h} */`);
  });

  it("draws only safe pictures inline, by stored type and name together; a PDF is a card", () => {
    const shape = (mime: string, fileName: string) => fileShape({ mime, fileName });
    expect(shape("image/png", "shot.png")).toBe("image");
    expect(shape("image/jpeg", "photo.JPG")).toBe("image");
    expect(shape("image/gif", "a.gif")).toBe("image");
    expect(shape("image/webp", "a.webp")).toBe("image");
    expect(shape("application/pdf", "deck.pdf")).toBe("pdf");
    // Never inline: SVG, HTML, XML, scripts, anything unknown.
    expect(shape("image/svg+xml", "logo.svg")).toBe("chip");
    expect(shape("text/html", "page.html")).toBe("chip");
    expect(shape("application/xml", "feed.xml")).toBe("chip");
    expect(shape("text/javascript", "app.js")).toBe("chip");
    expect(shape("application/zip", "assets.zip")).toBe("chip");
    expect(shape("application/octet-stream", "file")).toBe("chip");
    // A type the name contradicts falls back to a download.
    expect(shape("image/png", "page.html")).toBe("chip");
    expect(shape("image/png", "logo.svg")).toBe("chip");
    expect(shape("application/pdf", "page.html")).toBe("chip");
  });

  it("hands the viewer a picture to draw only for the four safe types", () => {
    const file = (mime: string, fileName: string, previewPath: string | null) =>
      asAttachmentRecord({
        id: "f",
        messageId: "m",
        authorId: ME,
        fileName,
        mime,
        sizeBytes: 10,
        width: null,
        height: null,
        objectPath: "w/o",
        previewPath,
        previewMime: previewPath ? "image/webp" : null,
        sentAt: "2026-10-16T00:00:00Z",
      }).previewPath;
    expect(file("image/png", "a.png", "w/p")).toBe("w/p");
    // A picture without a stored preview is drawn from the picture itself.
    expect(file("image/png", "a.png", null)).toBe("w/o");
    expect(file("image/svg+xml", "logo.svg", "w/p")).toBeNull();
    expect(file("image/png", "page.html", "w/p")).toBeNull();
    expect(file("application/pdf", "deck.pdf", "w/p")).toBeNull();
  });

  it("never draws a file's bytes in a frame, an object or raw HTML", () => {
    for (const name of ["message-files.tsx", "files-view.tsx", "composer-chips.tsx"]) {
      const src = readFileSync(resolve(process.cwd(), "src/features/chat/files", name), "utf8");
      expect(src).not.toMatch(/<iframe|<object|<embed|dangerouslySetInnerHTML|srcDoc/);
    }
  });

  it("takes up to 10 files a message; the eleventh is refused before upload, with a line", () => {
    expect(takeFiles(0, 3)).toEqual({ take: 3, refused: 0 });
    expect(takeFiles(9, 2)).toEqual({ take: 1, refused: 1 });
    expect(takeFiles(10, 1)).toEqual({ take: 0, refused: 1 });
    expect(capNotice(1)).toBe("A message holds up to 10 files: 1 wasn't added");
    expect(capNotice(0)).toBeNull();
  });
});

const view = (entityId: string, state: UploadView["state"]) =>
  ({
    target: { workspaceId: WS, entityType: "chat_message", entityId, channelId: "c" },
    state,
  }) as Pick<UploadView, "target" | "state">;

describe("the outbox's gate on a message's uploads", () => {
  it("waits while any upload of that message is moving, fails when one stopped, else goes", () => {
    expect(filesState([], "m1", true)).toBe("ready");
    expect(filesState([view("m1", "uploading"), view("m2", "failed")], "m1", true)).toBe("waiting");
    expect(filesState([view("m1", "queued"), view("m1", "rejected")], "m1", true)).toBe("failed");
    expect(filesState([view("m2", "uploading")], "m1", true)).toBe("ready");
  });

  it("waits before the device's stored uploads are back (an empty queue proves nothing)", () => {
    expect(filesState([], "m1", false)).toBe("waiting");
  });
});

// A queue double: items by id, `add` makes them queued, `finish` lets one go.
function fakeQueue() {
  let items: UploadView[] = [];
  let snapshot = { items: [] as readonly UploadView[], almostFull: {} };
  const listeners = new Set<() => void>();
  const uploaded = new Set<(rec: unknown, target: UploadView["target"]) => void>();
  const emit = () => {
    snapshot = { items: [...items], almostFull: {} };
    for (const fn of listeners) fn();
  };
  let n = 0;
  return {
    onUploaded(fn: (rec: unknown, target: UploadView["target"]) => void) {
      uploaded.add(fn);
      return () => uploaded.delete(fn);
    },
    /** The queue's finalize answering for this file (even after a dismiss). */
    finishWith(id: string, target: UploadView["target"], fileName: string) {
      items = items.filter((i) => i.id !== id);
      for (const fn of uploaded) {
        fn({ id: `a-${id}`, fileName, mime: "image/png", sizeBytes: 1, status: "ready" }, target);
      }
      emit();
    },
    added: [] as { target: UploadView["target"]; names: string[] }[],
    dismissed: [] as string[],
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async add(files: File[], target: UploadView["target"]) {
      this.added.push({ target, names: files.map((f) => f.name) });
      const ids = files.map(() => `q${++n}`);
      ids.forEach((id, i) => {
        items.push({
          id,
          target,
          state: "uploading",
          fileName: files[i]!.name,
          mime: files[i]!.type,
          sizeBytes: files[i]!.size,
          loaded: 0,
          total: files[i]!.size,
          attachmentId: `a-${id}`,
        } as unknown as UploadView);
      });
      emit();
      return ids;
    },
    dismiss(id: string) {
      this.dismissed.push(id);
      items = items.filter((i) => i.id !== id);
      emit();
    },
    finish(id: string) {
      items = items.filter((i) => i.id !== id);
      emit();
    },
    fail(id: string) {
      items = items.map((i) => (i.id === id ? { ...i, state: "rejected" as const } : i));
      emit();
    },
  };
}

const file = (name: string, type = "image/png") => new File(["x"], name, { type });

describe("the composer's files", () => {
  it("uploads under the draft's minted id, caps at 10, and hands the id and count to the send", async () => {
    const q = fakeQueue();
    let minted = 0;
    const store = new ComposerFilesStore(
      () => q as never,
      () => `msg-${++minted}`,
    );
    const C = "chan";
    // The hook's snapshot is a new object only when something changed (the
    // React Compiler memoises any other read: the chips would never show).
    const empty = store.view(C);
    expect(store.view(C)).toBe(empty);
    await store.add({
      channelId: C,
      workspaceId: WS,
      userId: ME,
      files: [file("a.png"), file("b.pdf", "application/pdf")],
    });
    const added = store.view(C);
    expect(added).not.toBe(empty);
    expect(added.files).toHaveLength(2);
    expect(store.view(C)).toBe(added);
    expect(q.added[0]!.target).toEqual({
      workspaceId: WS,
      entityType: "chat_message",
      entityId: "msg-1",
      channelId: C,
    });
    expect(store.files(C).map((f) => [f.fileName, f.state])).toEqual([
      ["a.png", "uploading"],
      ["b.pdf", "uploading"],
    ]);
    // Nine more: eight fit, one is refused before any upload.
    await store.add({
      channelId: C,
      workspaceId: WS,
      userId: ME,
      files: Array.from({ length: 9 }, (_, i) => file(`f${i}.png`)),
    });
    expect(store.files(C)).toHaveLength(10);
    expect(q.added[1]!.names).toHaveLength(8);
    expect(store.notice(C)).toBe("A message holds up to 10 files: 1 wasn't added");

    // A finished upload stays a chip (ready); a stopped one is left out of the send.
    q.finish("q1");
    q.fail("q2");
    expect(
      store
        .files(C)
        .slice(0, 2)
        .map((f) => f.state),
    ).toEqual(["ready", "failed"]);
    expect(store.take(C)).toEqual({ id: "msg-1", files: 9 });
    expect(q.dismissed).toContain("q2");
    // The next message starts over under a new id.
    expect(store.files(C)).toEqual([]);
    expect(store.messageId(C)).toBe("msg-2");
  });

  it("takes a file back out: an upload in progress stops", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("a.png")] });
    store.remove("c", "q1", null);
    expect(q.dismissed).toEqual(["q1"]);
    expect(store.take("c")).toBeNull();
  });

  it("takes a finished file back out: the send waits until it's gone from the server", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("a.png")] });
    q.finish("q1");
    let done: () => void = () => {};
    const removed: string[] = [];
    const runtime = {
      attachments: {
        remove: (id: string) => {
          removed.push(id);
          return new Promise<void>((r) => {
            done = r;
          });
        },
      },
    };
    store.remove("c", "q1", runtime as never);
    // The id came from the queue as begin answered, though the file finished.
    expect(removed).toEqual(["a-q1"]);
    expect(store.busy("c")).toBe(true);
    done();
    await settle();
    expect(store.busy("c")).toBe(false);
  });

  // A remover whose calls resolve (or fail) when the test says.
  function remover() {
    const calls: { id: string; ok: () => void; fail: (code?: string) => void }[] = [];
    const runtime = {
      attachments: {
        remove: (id: string) =>
          new Promise<void>((ok, no) => {
            calls.push({
              id,
              ok,
              fail: (code?: string) =>
                no(code ? new AttachmentOpError(code) : new Error("offline")),
            });
          }),
      },
    };
    return { calls, runtime: runtime as never };
  }
  const T = (id: string) => ({
    workspaceId: WS,
    entityType: "chat_message" as const,
    entityId: id,
    channelId: "c",
  });

  it("× while the upload finishes: the file is taken out on the server and the send waits", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    const r = remover();
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("a.png")] });
    // Still in the queue (finalize on its way): dismissed, and the row goes too.
    store.remove("c", "q1", r.runtime);
    expect(q.dismissed).toEqual(["q1"]);
    expect(r.calls.map((c) => c.id)).toEqual(["a-q1"]);
    expect(store.busy("c")).toBe(true);
    // The queue's finalize lands anyway: no second remove (already going).
    q.finishWith("q1", T("m"), "a.png");
    expect(r.calls).toHaveLength(1);
    r.calls[0]!.ok();
    await settle();
    expect(store.busy("c")).toBe(false);
    expect(store.take("c")).toBeNull();
  });

  it("a finish no live chip owns (removed before its id was known) is taken out; the send waits", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    const r = remover();
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("a.png")] });
    store.setRemover(r.runtime);
    // A finish under this draft's id for a file no chip holds.
    q.finishWith("q9", T("m"), "z.png");
    expect(r.calls.map((c) => c.id)).toEqual(["a-q9"]);
    expect(store.busy("c")).toBe(true);
    r.calls[0]!.ok();
    await settle();
    expect(store.busy("c")).toBe(false);
  });

  it("a finish after the send took the draft is left alone (it belongs to that message)", async () => {
    const q = fakeQueue();
    let minted = 0;
    const store = new ComposerFilesStore(
      () => q as never,
      () => `m${++minted}`,
    );
    const r = remover();
    store.setRemover(r.runtime);
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("a.png")] });
    expect(store.take("c")).toEqual({ id: "m1", files: 1 });
    q.finishWith("q1", T("m1"), "a.png");
    expect(r.calls).toEqual([]);
  });

  it("a failed remove puts the chip back saying it still goes", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    const r = remover();
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("a.png")] });
    q.finish("q1");
    store.remove("c", "q1", r.runtime);
    expect(store.files("c")).toHaveLength(0);
    expect(store.busy("c")).toBe(true);
    r.calls[0]!.fail();
    await settle();
    expect(store.busy("c")).toBe(false);
    expect(store.files("c").map((f) => [f.fileName, f.state, f.problem])).toEqual([
      ["a.png", "ready", REMOVE_FAILED],
    ]);
    // It's still on the server, so it's counted in the send.
    expect(store.take("c")).toEqual({ id: "m", files: 1 });
  });

  it("files older than the server keeps an unsent message's files are taken out at send, with a line", async () => {
    const q = fakeQueue();
    let now = 1_000;
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
      () => now,
    );
    const r = remover();
    store.setRemover(r.runtime);
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("old.png")] });
    q.finish("q1");
    expect(store.dropStale("c")).toBe(false);
    now += DRAFT_FILE_STALE_MS + 1;
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("new.png")] });
    expect(store.dropStale("c")).toBe(true);
    expect(store.notice("c")).toBe(staleNotice(1));
    expect(store.files("c").map((f) => f.fileName)).toEqual(["new.png"]);
    expect(r.calls.map((c) => c.id)).toEqual(["a-q1"]);
    expect(store.busy("c")).toBe(true);
  });

  it("× during finalize: a failed take-out brings the chip back; not found means it's gone", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    const r = remover();
    await store.add({
      channelId: "c",
      workspaceId: WS,
      userId: ME,
      files: [file("a.png"), file("b.png")],
    });
    store.remove("c", "q1", r.runtime);
    store.remove("c", "q2", r.runtime);
    const before = store.view("c").returned;
    r.calls[0]!.fail();
    r.calls[1]!.fail("attachment_not_found");
    await settle();
    expect(store.files("c").map((f) => [f.fileName, f.problem])).toEqual([
      ["a.png", REMOVE_FAILED],
    ]);
    expect(store.view("c").returned).toBe(before + 1);
    expect(store.take("c")).toEqual({ id: "m", files: 1 });
  });

  it("a stale file whose row the server already purged leaves for good (no loop)", async () => {
    const q = fakeQueue();
    let now = 0;
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
      () => now,
    );
    const r = remover();
    store.setRemover(r.runtime);
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("old.png")] });
    q.finish("q1");
    now += DRAFT_FILE_STALE_MS + 1;
    expect(store.dropStale("c")).toBe(true);
    r.calls[0]!.fail("attachment_not_found");
    await settle();
    expect(store.files("c")).toEqual([]);
    expect(store.busy("c")).toBe(false);
    expect(store.dropStale("c")).toBe(false);
  });

  it("a stale stopped file leaves quietly: no line, the send doesn't hold", async () => {
    const q = fakeQueue();
    let now = 0;
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
      () => now,
    );
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: [file("x.png")] });
    q.fail("q1");
    now += DRAFT_FILE_STALE_MS + 1;
    expect(store.dropStale("c")).toBe(false);
    expect(store.notice("c")).toBeNull();
    expect(store.files("c")).toEqual([]);
  });

  it("only files that didn't stop make a message of files only", () => {
    expect(hasSendableFiles(undefined)).toBe(false);
    expect(hasSendableFiles([{ state: "failed" }, { state: "failed" }])).toBe(false);
    expect(hasSendableFiles([{ state: "failed" }, { state: "uploading" }])).toBe(true);
    expect(hasSendableFiles([{ state: "ready" }])).toBe(true);
  });

  it("doesn't count a stopped file against the 10", async () => {
    const q = fakeQueue();
    const store = new ComposerFilesStore(
      () => q as never,
      () => "m",
    );
    const ten = Array.from({ length: 10 }, (_, i) => file(`f${i}.png`));
    await store.add({ channelId: "c", workspaceId: WS, userId: ME, files: ten });
    q.fail("q1");
    q.fail("q2");
    await store.add({
      channelId: "c",
      workspaceId: WS,
      userId: ME,
      files: [file("x.png"), file("y.png"), file("z.png")],
    });
    expect(q.added[1]!.names).toEqual(["x.png", "y.png"]);
    expect(store.notice("c")).toBe("A message holds up to 10 files: 1 wasn't added");
  });

  it("Retry lets go of the stopped uploads only; Discard of all", () => {
    const target = (id: string) => ({
      workspaceId: WS,
      entityType: "chat_message" as const,
      entityId: id,
      channelId: "c",
    });
    const items = [
      { id: "u1", target: target("m"), state: "rejected" },
      { id: "u2", target: target("m"), state: "uploading" },
      { id: "u3", target: target("other"), state: "failed" },
    ] as unknown as UploadView[];
    const dismissed: string[] = [];
    const gate = uploadQueueGate({
      getSnapshot: () => ({ items, almostFull: {} }) as never,
      subscribe: () => () => {},
      onUploaded: () => () => {},
      dismiss: (id: string) => dismissed.push(id),
      hasRestored: () => true,
    } as never);
    gate.release("m", "stopped");
    expect(dismissed).toEqual(["u1"]);
    gate.release("m");
    expect(dismissed).toEqual(["u1", "u1", "u2"]);
  });
});

describe("a send with files waits for them (upload first, send after)", () => {
  const stores: ChatStore[] = [];
  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose({ persist: false });
  });

  it("holds its own message until the files are up; later text goes; a stopped file says Not sent", async () => {
    const C = uuid(9101);
    const state = new Map<string, ChatFilesState>();
    const listeners = new Set<() => void>();
    const released: string[] = [];
    const gate: ChatFileGate = {
      state: (id) => state.get(id) ?? "ready",
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      // The stopped uploads go; with nothing else moving, the message is ready.
      release: (id) => {
        released.push(id);
        state.set(id, "ready");
      },
    };
    const ping = () => {
      for (const fn of listeners) fn();
    };
    const server = new FakeChatServer();
    server.addChannel(C, { isDefault: true });
    const store = new ChatStore(server.transport(), ME, WS, {
      copy: memoryChatCopy(),
      live: fakeLive(),
      files: gate,
      timing: { persistMs: 0, markReadMs: 0, joinDebounceMs: 0, focusThrottleMs: 0 },
    });
    stores.push(store);
    store.acquire();
    await store.ready();
    await store.open(C);

    const withFiles = uuid(9201);
    state.set(withFiles, "waiting");
    expect(store.send({ channelId: C, body: "", id: withFiles, files: 2 })).toBe(withFiles);
    const after = store.send({ channelId: C, body: "words after" });
    await settle(20);
    expect(server.rows.has(withFiles)).toBe(false);
    expect(server.rows.has(after)).toBe(true);
    const row = store.getSnapshot().windows[C]!.rows.find((r) => r.id === withFiles);
    expect(row?.fileCount).toBe(2);
    expect(row?.sendState).toBe("sending");

    state.set(withFiles, "ready");
    ping();
    await settle(20);
    expect(server.rows.has(withFiles)).toBe(true);

    // A file that stopped: "Not sent"; Retry sends it with the files that made it.
    const stuck = uuid(9202);
    state.set(stuck, "failed");
    store.send({ channelId: C, body: "deck", id: stuck, files: 1 });
    await settle(20);
    const failed = store.getSnapshot().windows[C]!.rows.find((r) => r.id === stuck);
    expect(failed?.sendState).toBe("failed");
    expect(failed?.sendError).toBe("A file didn't upload");
    store.retry(stuck);
    await settle(20);
    expect(released).toContain(stuck);
    expect(server.rows.has(stuck)).toBe(true);
  });

  it("a message of files only whose files all stopped says why and offers no Retry", async () => {
    const C = uuid(9102);
    const counts = new Map<string, { stopped: number; moving: number }>();
    const released: string[] = [];
    const gate: ChatFileGate = {
      state: () => "failed",
      subscribe: () => () => {},
      release: (id) => released.push(id),
      counts: (id) => counts.get(id) ?? { stopped: 0, moving: 0 },
    };
    const server = new FakeChatServer();
    server.addChannel(C, { isDefault: true });
    const store = new ChatStore(server.transport(), ME, WS, {
      copy: memoryChatCopy(),
      live: fakeLive(),
      files: gate,
      timing: { persistMs: 0, markReadMs: 0, joinDebounceMs: 0, focusThrottleMs: 0 },
    });
    stores.push(store);
    store.acquire();
    await store.ready();
    await store.open(C);

    const dead = uuid(9301);
    counts.set(dead, { stopped: 2, moving: 0 });
    store.send({ channelId: C, body: "", id: dead, files: 2 });
    // One of two stopped (the other made it): Retry still sends it.
    const half = uuid(9302);
    counts.set(half, { stopped: 1, moving: 0 });
    store.send({ channelId: C, body: "", id: half, files: 2 });
    await settle(20);
    const rows = store.getSnapshot().windows[C]!.rows;
    const d = rows.find((r) => r.id === dead);
    expect(d?.sendState).toBe("failed");
    expect(d?.sendError).toBe(FILES_ALL_STOPPED);
    expect(d?.sendRetry).toBe(false);
    const h = rows.find((r) => r.id === half);
    expect(h?.sendError).toBe("A file didn't upload");
    expect(h?.sendRetry).toBeUndefined();
    store.retry(dead);
    await settle(20);
    expect(released).not.toContain(dead);
    expect(store.getSnapshot().windows[C]!.rows.find((r) => r.id === dead)?.sendState).toBe(
      "failed",
    );
  });
});

describe("chat file links", () => {
  it("re-signs to a new link each cycle, before the old one dies", async () => {
    clearSignedUrlCache();
    let now = 0;
    let n = 0;
    const runtime = {
      attachments: {
        signedUrls: async (paths: string[]) => new Map(paths.map((p) => [p, `${p}#${++n}`])),
      },
    } as never;
    const ttl = CHAT_FILE_LINK_TTL_SECONDS.preview;
    const delay = resignDelayMs(ttl);
    expect(delay).toBeLessThan(ttl * 1000 - 60_000);
    const first = await signPaths(runtime, ["p"], ttl, () => now);
    const seen = [first.get("p")];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      now += delay;
      // A plain read still hands back the cached link (fresh until a minute before it dies)…
      expect((await signPaths(runtime, ["p"], ttl, () => now)).get("p")).toBe(seen.at(-1));
      // …so the hook's re-sign skips the cache: a new link, alive for a full ttl.
      seen.push((await signPaths(runtime, ["p"], ttl, () => now, { fresh: true })).get("p"));
    }
    expect(new Set(seen).size).toBe(4);
    clearSignedUrlCache();
  });

  it("chat originals use the 3-minute link; tasks keep their default", () => {
    expect(CHAT_FILE_LINK_TTL_SECONDS.original).toBe(180);
    const read = (f: string) =>
      readFileSync(resolve(process.cwd(), "src/features/chat/files", f), "utf8");
    for (const f of ["files-view.tsx", "message-files.tsx"]) {
      expect(read(f)).toContain("originalTtlSeconds={CHAT_FILE_LINK_TTL_SECONDS.original}");
    }
    const viewer = read("../../attachments/ui/attachment-viewer.tsx");
    expect(viewer).toContain("originalTtlSeconds = ATTACHMENT_LINK_TTL_SECONDS.original");
    expect(viewer.match(/signPaths\(runtime, \[[^\]]+\], originalTtlSeconds\)/g)).toHaveLength(2);
  });
});

// CV-9 · Files in chat: the pure rules (media box, the 10-file cap, shapes),
// the gate between the outbox and the upload queue, the composer's files, and
// a send that waits for its files.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "@rstest/core";
import type { UploadView } from "@/lib/uploads/queue";
import { memoryChatCopy } from "../store/device-copy";
import { ChatStore } from "../store/store";
import { FakeChatServer, fakeLive, ME, settle, uuid, WS } from "../store/testing";
import { ComposerFilesStore } from "./composer-files";
import { type ChatFileGate, type ChatFilesState, filesState, uploadQueueGate } from "./gate";
import { asAttachmentRecord } from "./message-files";
import { capNotice, FEED_MEDIA, fileShape, fitMedia, takeFiles } from "./model";

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
  const emit = () => {
    snapshot = { items: [...items], almostFull: {} };
    for (const fn of listeners) fn();
  };
  let n = 0;
  return {
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
});

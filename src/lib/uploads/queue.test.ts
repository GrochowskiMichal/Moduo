import { describe, expect, it } from "@rstest/core";
import type { AttachmentRecord, StorageStatus } from "../runtime.types";
import { AttachmentOpError } from "./errors";
import type { PreparedUpload } from "./pipeline";
import { backoffMs, memoryUploadStore, type UploadItem, UploadQueue } from "./queue";

const TARGET = { workspaceId: "ws1", entityType: "task" as const, entityId: "t1" };
const MB = 1048576;

function status(over: Partial<StorageStatus> = {}): StorageStatus {
  return {
    tier: "pro",
    perFileBytes: 50 * MB,
    totalBytes: 1000 * MB,
    usedBytes: 0,
    pendingBytes: 0,
    level: 0,
    overLimit: false,
    isOwner: true,
    ownedWorkspaces: 1,
    ...over,
  };
}

function record(id: string, over: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id,
    entityType: "task",
    entityId: "t1",
    uploaderId: "u1",
    fileName: "f",
    mime: "image/png",
    sizeBytes: 3,
    width: null,
    height: null,
    status: "pending",
    deletedAt: null,
    createdAt: "2026-10-09T10:00:00Z",
    objectPath: `ws1/${id}/original.png`,
    previewPath: `ws1/${id}/preview.png`,
    previewMime: "image/png",
    ...over,
  };
}

type Step = "begin" | "upload" | "finalize";

/** A scripted attachments API: each call shifts its next answer (default: ok). */
function fakeApi(script: Partial<Record<Step, (unknown | (() => unknown))[]>> = {}) {
  const calls: { step: Step; arg: unknown }[] = [];
  let n = 0;
  const next = (step: Step) => {
    const queue = script[step];
    const answer = queue && queue.length > 0 ? queue.shift() : undefined;
    const v = typeof answer === "function" ? (answer as () => unknown)() : answer;
    if (v instanceof Error) throw v;
    return v;
  };
  const api = {
    calls,
    status: async (_ws: string) => status(),
    async begin(input: unknown) {
      calls.push({ step: "begin", arg: input });
      next("begin");
      n += 1;
      return record(`a${n}`);
    },
    async uploadObject(input: { path: string; onProgress?: (l: number, t: number) => void }) {
      calls.push({ step: "upload", arg: input.path });
      next("upload");
      input.onProgress?.(3, 3);
    },
    async finalize(id: string) {
      calls.push({ step: "finalize", arg: id });
      const v = next("finalize");
      return (v as AttachmentRecord | undefined) ?? record(id, { status: "ready" });
    },
  };
  return api;
}

const prepare = async (file: File): Promise<PreparedUpload> => ({
  original: file,
  fileName: file.name,
  mime: file.type,
  preview: file.type.startsWith("image/") ? new Blob(["p"], { type: "image/png" }) : null,
  previewMime: file.type.startsWith("image/") ? "image/png" : null,
  width: null,
  height: null,
});

function setup(
  opts: {
    api?: ReturnType<typeof fakeApi>;
    store?: ReturnType<typeof memoryUploadStore>;
    online?: () => boolean;
  } = {},
) {
  let clock = 1_000_000;
  let ids = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const api = opts.api ?? fakeApi();
  const store = opts.store ?? memoryUploadStore();
  const persisted: string[] = [];
  const queue = new UploadQueue({
    store,
    getApi: () => api,
    prepare,
    now: () => clock,
    random: () => 0.5,
    newId: () => `id${++ids}`,
    isOnline: opts.online ?? (() => true),
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    requestPersist: () => persisted.push("asked"),
  });
  const uploaded: AttachmentRecord[] = [];
  queue.onUploaded((rec) => uploaded.push(rec));
  return {
    queue,
    api,
    store,
    uploaded,
    persisted,
    advance: async (ms: number) => {
      clock += ms;
      for (const t of [...timers]) {
        if (t.at <= clock) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
      await settle();
    },
  };
}

/** Let the queue's promise chains run out. */
async function settle() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

const png = (name = "shot.png", size = 3) =>
  new File([new Uint8Array(size)], name, { type: "image/png" });

describe("UploadQueue", () => {
  it("walks begin → original → preview → finalize, then forgets the file", async () => {
    const t = setup();
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.api.calls.map((c) => c.step)).toEqual(["begin", "upload", "upload", "finalize"]);
    expect(t.api.calls[1].arg).toBe("ws1/a1/original.png");
    expect(t.api.calls[2].arg).toBe("ws1/a1/preview.png");
    expect(t.uploaded.map((r) => r.id)).toEqual(["a1"]);
    expect(t.queue.getSnapshot().items).toEqual([]);
    expect(t.store.items.size).toBe(0);
    expect(t.persisted).toEqual(["asked"]);
  });

  it("refuses a file over the per-file limit before any bytes move", async () => {
    const t = setup();
    await t.queue.start("u1");
    await t.queue.add([png("rec.mov", 60 * MB)], TARGET, "u1", status());
    await settle();
    expect(t.api.calls).toEqual([]);
    const [item] = t.queue.getSnapshot().items;
    expect(item.state).toBe("rejected");
    expect(item.problem).toEqual({
      kind: "too_large",
      sizeBytes: 60 * MB,
      perFileBytes: 50 * MB,
      tier: "pro",
    });
    // Nothing kept on disk for a file that can never go.
    expect(t.store.items.size).toBe(0);
    expect(t.queue.countPending()).toBe(0);
  });

  it("keeps a file that doesn't fit the pool waiting as 'storage full'", async () => {
    const t = setup();
    await t.queue.start("u1");
    await t.queue.add([png("a.png", 10)], TARGET, "u1", status({ usedBytes: 1000 * MB - 5 }));
    await settle();
    const [item] = t.queue.getSnapshot().items;
    expect(item.state).toBe("waiting");
    expect(item.problem?.kind).toBe("storage_full");
    expect(t.api.calls).toEqual([]);
    expect(t.queue.countPending()).toBe(1);
  });

  it("waits offline and goes when the network comes back", async () => {
    let online = false;
    const t = setup({ online: () => online });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.queue.getSnapshot().items[0]).toMatchObject({
      state: "waiting",
      problem: { kind: "offline" },
    });
    expect(t.api.calls).toEqual([]);
    online = true;
    t.queue.wake();
    await settle();
    expect(t.uploaded).toHaveLength(1);
  });

  it("retries a dropped connection with backoff, resuming at the step it stopped at", async () => {
    const api = fakeApi({ upload: [new Error("Failed to fetch")] });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.queue.getSnapshot().items[0]).toMatchObject({
      state: "waiting",
      problem: { kind: "interrupted" },
      attempts: 1,
    });
    await t.advance(backoffMs(1, { kind: "interrupted" }, () => 0.5));
    // No second begin: the pending row is reused.
    expect(api.calls.map((c) => c.step)).toEqual([
      "begin",
      "upload",
      "upload",
      "upload",
      "finalize",
    ]);
    expect(t.uploaded).toHaveLength(1);
  });

  it("survives a restart: a stored file resumes after sign-in, past the steps already done", async () => {
    const stored: UploadItem = {
      id: "x1",
      userId: "u1",
      target: TARGET,
      batchId: "b",
      fileName: "big.mov",
      mime: "video/quicktime",
      sizeBytes: 3,
      original: new Blob([new Uint8Array(3)]),
      preview: null,
      previewMime: null,
      width: null,
      height: null,
      attachmentId: "a9",
      objectPath: "ws1/a9/original.mov",
      previewPath: null,
      begunAt: 1_000_000 - 60_000,
      originalSent: false,
      previewSent: false,
      attempts: 0,
      refusals: 0,
      nextRetryAt: 0,
      state: "uploading", // the app closed mid-upload
      problem: null,
      createdAt: 1,
    };
    const store = memoryUploadStore([stored]);
    const t = setup({ store });
    expect(t.queue.countPending()).toBe(0);
    await t.queue.start("u1");
    await settle();
    expect(t.api.calls.map((c) => c.step)).toEqual(["upload", "finalize"]);
    expect(t.api.calls[0].arg).toBe("ws1/a9/original.mov");
    expect(t.uploaded.map((r) => r.id)).toEqual(["a9"]);
  });

  it("doesn't run another person's stored files", async () => {
    const store = memoryUploadStore();
    const t = setup({ store });
    await t.queue.start("u2");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.api.calls).toEqual([]);
    expect(t.queue.countPending()).toBe(1);
  });

  it("drops a refused file (no edit access) and shows why, without retrying", async () => {
    const api = fakeApi({ begin: [new AttachmentOpError("no_edit_access")] });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.queue.getSnapshot().items[0]).toMatchObject({
      state: "rejected",
      problem: { kind: "no_access" },
    });
    expect(t.store.items.size).toBe(0);
  });

  it("marks a file the server stored differently as failed; Retry starts it over", async () => {
    const api = fakeApi({ finalize: [() => record("a1", { status: "failed" })] });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    const [item] = t.queue.getSnapshot().items;
    expect(item).toMatchObject({
      state: "failed",
      problem: { kind: "mismatch" },
      attachmentId: null,
    });
    t.queue.retry(item.id);
    await settle();
    expect(api.calls.filter((c) => c.step === "begin")).toHaveLength(2);
    expect(t.uploaded.map((r) => r.id)).toEqual(["a2"]);
  });

  it("begins again when Storage refuses the path (the pending row moved on)", async () => {
    const api = fakeApi({ upload: [new AttachmentOpError("upload_refused", null, 403)] });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(api.calls.filter((c) => c.step === "begin")).toHaveLength(2);
    expect(t.uploaded.map((r) => r.id)).toEqual(["a2"]);
  });

  it("retries finalize's 'not uploaded' by sending the bytes again", async () => {
    const api = fakeApi({ finalize: [new AttachmentOpError("not_uploaded")] });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.queue.getSnapshot().items[0].state).toBe("waiting");
    await t.advance(5000);
    expect(t.uploaded).toHaveLength(1);
  });

  it("keeps a full pool waiting five minutes between tries", async () => {
    const full = new AttachmentOpError("storage_full", {
      size_bytes: 3,
      used_bytes: 100,
      pending_bytes: 0,
      total_bytes: 100,
      tier: "free",
    });
    const api = fakeApi({ begin: [full] });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.queue.getSnapshot().items[0].problem?.kind).toBe("storage_full");
    await t.advance(60_000);
    expect(api.calls.filter((c) => c.step === "begin")).toHaveLength(1);
    await t.advance(5 * 60_000);
    expect(t.uploaded).toHaveLength(1);
  });

  it("notes a pool at 95% after an upload, for the strip's caption", async () => {
    const api = fakeApi();
    api.status = async () => status({ level: 95, usedBytes: 960 * MB });
    const t = setup({ api });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    expect(t.queue.getSnapshot().almostFull).toEqual({
      "ws1:task:t1": { usedBytes: 960 * MB, totalBytes: 1000 * MB },
    });
  });

  it("dismissing forgets the file everywhere", async () => {
    const t = setup({ online: () => false });
    await t.queue.start("u1");
    await t.queue.add([png()], TARGET, "u1", status());
    await settle();
    const [item] = t.queue.getSnapshot().items;
    t.queue.dismiss(item.id);
    await settle();
    expect(t.queue.getSnapshot().items).toEqual([]);
    expect(t.store.items.size).toBe(0);
  });

  it("backs off exponentially with jitter, capped at five minutes", () => {
    const mid = () => 0.5;
    expect(backoffMs(1, null, mid)).toBe(2000);
    expect(backoffMs(3, null, mid)).toBe(8000);
    expect(backoffMs(20, null, mid)).toBe(300_000);
    expect(backoffMs(1, null, () => 0)).toBe(1600);
    expect(backoffMs(1, { kind: "busy" }, mid)).toBe(60_000);
  });
});

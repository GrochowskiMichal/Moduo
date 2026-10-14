// AT-3: files from a capture (AT3-2) and from a row or card drop (AT3-1) go
// into the device's upload queue for their task, and a drop says in one quiet
// line what happened.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

const q = rs.hoisted(() => ({
  added: [] as Array<{ files: File[]; target: unknown; userId: string; opts: unknown }>,
}));

rs.mock("@/lib/uploads", () => ({
  getUploadQueue: () => ({
    add: async (
      files: File[],
      target: unknown,
      userId: string,
      _status: unknown,
      opts: unknown,
    ) => {
      q.added.push({ files, target, userId, opts });
      return [];
    },
  }),
}));

import { dropSummary } from "./attach-to-task";
import { attachCaptureFiles } from "./capture";

const shot = () => new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  q.added.length = 0;
});

describe("attachCaptureFiles (the capture's file seam)", () => {
  it("queues the files for the task once it's made", async () => {
    attachCaptureFiles({
      workspaceId: "w1",
      userId: "u1",
      task: Promise.resolve({ id: "t1", queued: false }),
      files: [shot()],
    });
    await flush();
    expect(q.added).toHaveLength(1);
    expect(q.added[0]).toMatchObject({
      target: { workspaceId: "w1", entityType: "task", entityId: "t1" },
      userId: "u1",
      opts: { awaitTask: false },
    });
  });

  it("a task captured offline: its files wait for it to reach the server", async () => {
    attachCaptureFiles({
      workspaceId: "w1",
      userId: "u1",
      task: Promise.resolve({ id: "t1", queued: true }),
      files: [shot()],
    });
    await flush();
    expect(q.added[0]?.opts).toEqual({ awaitTask: true });
  });

  it("a capture the server refused: nothing to attach to, nothing queued", async () => {
    attachCaptureFiles({
      workspaceId: "w1",
      userId: "u1",
      task: Promise.resolve(null),
      files: [shot()],
    });
    attachCaptureFiles({
      workspaceId: "w1",
      userId: "u1",
      task: Promise.resolve({ id: "t1", queued: false }),
      files: [],
    });
    await flush();
    expect(q.added).toEqual([]);
  });
});

describe("dropSummary (a row or card drop's one line)", () => {
  const item = (fileName: string, over: Record<string, unknown> = {}) => ({
    fileName,
    sizeBytes: 4,
    state: "queued" as const,
    problem: null,
    ...over,
  });

  it("names one file, counts several", () => {
    expect(dropSummary([item("shot.png")], "Fix login")).toMatchObject({
      text: "Attaching shot.png",
      description: "on “Fix login”",
      full: false,
    });
    expect(dropSummary([item("a.png"), item("b.png")], "Fix login")?.text).toBe(
      "Attaching 2 files",
    );
  });

  it("says why a refused file wasn't attached, beside the ones that were", () => {
    const tooBig = item("rec.mov", {
      state: "rejected",
      sizeBytes: 60 * 1048576,
      problem: {
        kind: "too_large",
        sizeBytes: 60 * 1048576,
        perFileBytes: 50 * 1048576,
        tier: "pro",
      },
    });
    const s = dropSummary([item("a.png"), tooBig], "Fix login");
    expect(s?.text).toBe("Attaching a.png");
    expect(s?.description).toContain("rec.mov is 60 MB — your plan allows 50 MB per file");
    expect(dropSummary([tooBig], "Fix login")?.text).toContain("rec.mov is 60 MB");
  });

  it("a full pool offers Free up space", () => {
    const s = dropSummary(
      [
        item("a.png", {
          state: "waiting",
          problem: {
            kind: "storage_full",
            usedBytes: 2 * 1073741824,
            totalBytes: 2 * 1073741824,
            tier: "free",
          },
        }),
      ],
      "Fix login",
    );
    expect(s).toMatchObject({ full: true });
    expect(s?.text).toContain("storage is full");
  });

  it("nothing to say for nothing dropped", () => {
    expect(dropSummary([], "Fix login")).toBeNull();
  });
});

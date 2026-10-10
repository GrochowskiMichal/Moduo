// AT-2 on the real panel: the strip right under the description (AT2-2),
// paste/drop anywhere on the task or "+" uploading through the shared queue
// (AT2-1), the viewer (←/→, Download, Copy, Delete with Undo), each upload
// state's caption and action (AT2-4), and view-only.

import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Snapshot = { items: unknown[]; almostFull: Record<string, unknown> };
const fakeQueue = {
  snapshot: { items: [], almostFull: {} } as Snapshot,
  listeners: new Set<() => void>(),
  add: rs.fn(async () => {}),
  retry: rs.fn(),
  dismiss: rs.fn(),
  dismissAlmostFull: rs.fn(),
  subscribe(fn: () => void) {
    fakeQueue.listeners.add(fn);
    return () => fakeQueue.listeners.delete(fn);
  },
  getSnapshot: () => fakeQueue.snapshot,
  onUploaded: () => () => {},
  set(next: Snapshot) {
    fakeQueue.snapshot = next;
    for (const fn of fakeQueue.listeners) fn();
  },
};

rs.mock("@/lib/uploads", () => ({
  getUploadQueue: () => fakeQueue,
  countPendingUploads: async () => 0,
}));

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

rs.mock("../../spine/hooks/use-comment-people", () => ({
  useCommentPeople: () => ({
    currentUserId: "u1",
    mentionable: [],
    names: [],
    nameOf: () => null,
    personOf: () => null,
  }),
}));

import type { AttachmentRecord, ModuoRuntime } from "@/lib/runtime.types";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
import { TaskDetailPanel } from "./task-detail-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  URL.createObjectURL ??= () => "blob:x";
  URL.revokeObjectURL ??= () => {};
});
beforeEach(() => {
  fakeQueue.snapshot = { items: [], almostFull: {} };
  fakeQueue.add.mockClear();
  fakeQueue.retry.mockClear();
  fakeQueue.dismiss.mockClear();
});
afterEach(() => cleanup());

const INBOX: Bucket = {
  id: "inbox",
  workspaceId: "w",
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

const task = (): Task => ({
  ...makeTask({
    workspaceId: "w",
    bucketId: "inbox",
    title: "Fix the black background",
    position: "a",
  }),
  id: "t1",
  creatorId: "u1",
  assigneeId: "u1",
  description: "<p>Repro steps</p>",
});

const api = (t: Task): TasksModuleApi =>
  ({
    canEdit: true,
    tasks: [t],
    tags: [],
    tagsByTask: new Map(),
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    blockersByTask: new Map(),
    dependentsByTask: new Map(),
    taskRelations: [],
    queuedTaskIds: new Set<string>(),
    queueClaims: new Map(),
    activityStamp: 0,
    currentUserId: "u1",
    loadActivity: async () => [],
    patchTask: rs.fn(),
    toggleDone: rs.fn(),
    toggleQueue: rs.fn(),
  }) as unknown as TasksModuleApi;

function rec(id: string, over: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id,
    entityType: "task",
    entityId: "t1",
    uploaderId: "u1",
    fileName: `${id}.png`,
    mime: "image/png",
    sizeBytes: 120_000,
    width: 1440,
    height: 900,
    status: "ready",
    deletedAt: null,
    createdAt: `2026-10-09T10:0${id.length}:00Z`,
    objectPath: `w/${id}/original.png`,
    previewPath: `w/${id}/preview.png`,
    previewMime: "image/png",
    ...over,
  };
}

function fakeRuntime(records: AttachmentRecord[]) {
  const attachments = {
    listForEntity: rs.fn(async () => records),
    signedUrls: rs.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://s/${p}`]))),
    status: rs.fn(async () => ({
      tier: "free",
      perFileBytes: 20 * 1048576,
      totalBytes: 2 * 1073741824,
      usedBytes: 0,
      pendingBytes: 0,
      level: 0,
      overLimit: false,
      isOwner: true,
      ownedWorkspaces: 1,
    })),
    remove: rs.fn(async (id: string) => ({ ...records.find((r) => r.id === id) })),
    restore: rs.fn(async (id: string) => ({ ...records.find((r) => r.id === id) })),
  };
  const runtime = {
    attachments,
    spine: {
      listComments: async () => [],
      listLinks: async () => [],
      getEntities: async () => [],
    },
    tasks: { listTimeTotals: async () => [] },
  };
  return { runtime: runtime as unknown as ModuoRuntime, attachments };
}

function renderPanel(runtime: ModuoRuntime, canEdit = true) {
  const t = task();
  return render(
    <TooltipProvider>
      <TaskDetailPanel
        task={t}
        buckets={[]}
        inbox={INBOX}
        canEdit={canEdit}
        onRequestCapture={() => {}}
        onSelectTask={() => {}}
        api={api(t)}
        runtime={runtime}
        workspaceId="w"
      />
    </TooltipProvider>,
  );
}

const png = (name = "shot.png") => new File(["x"], name, { type: "image/png" });

function fileTransfer(files: File[], types = ["Files"]) {
  return {
    types,
    files,
    items: files.map((f) => ({ kind: "file", getAsFile: () => f })),
    dropEffect: "none",
  };
}

describe("TaskDetailPanel — attachments (AT-2)", () => {
  it("shows the strip right under the description: thumbnails, file tiles, and +", async () => {
    const { runtime } = fakeRuntime([
      rec("a"),
      rec("bb", {
        fileName: "spec.pdf",
        mime: "application/pdf",
        previewPath: null,
        sizeBytes: 2 * 1048576,
      }),
    ]);
    renderPanel(runtime);
    const strip = await screen.findByRole("list", { name: "Attachments" });
    const image = within(strip).getByRole("button", { name: "Open a.png" });
    await waitFor(() =>
      expect(image.querySelector("img")?.getAttribute("src")).toBe("https://s/w/a/preview.png"),
    );
    const fileTile = within(strip).getByRole("button", { name: "Open spec.pdf" });
    expect(fileTile.textContent).toContain("spec.pdf");
    expect(fileTile.textContent).toContain("2 MB");
    expect(within(strip).getByRole("button", { name: "Add files" })).toBeTruthy();
    // It sits in the title block, after the description.
    const description = screen.getByRole("textbox", { name: "Description" });
    expect(
      description.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uploads files dropped anywhere on the task, with a drop highlight while dragging", async () => {
    const { runtime } = fakeRuntime([]);
    const { container } = renderPanel(runtime);
    await screen.findByRole("list", { name: "Attachments" });
    const title = screen.getByRole("textbox", { name: "Task title" });
    const file = png();
    fireEvent.dragEnter(title, { dataTransfer: fileTransfer([file]) });
    expect(container.querySelector("[data-drop-active]")).not.toBeNull();
    fireEvent.drop(title, { dataTransfer: fileTransfer([file]) });
    expect(container.querySelector("[data-drop-active]")).toBeNull();
    expect(fakeQueue.add).toHaveBeenCalledWith(
      [file],
      { workspaceId: "w", entityType: "task", entityId: "t1" },
      "u1",
    );
  });

  it("attaches a pasted screenshot, but leaves a text paste alone", async () => {
    const { runtime } = fakeRuntime([]);
    renderPanel(runtime);
    await screen.findByRole("list", { name: "Attachments" });
    const title = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.paste(title, { clipboardData: fileTransfer([png()], ["text/plain", "Files"]) });
    expect(fakeQueue.add).not.toHaveBeenCalled();
    fireEvent.paste(title, { clipboardData: fileTransfer([png()]) });
    expect(fakeQueue.add).toHaveBeenCalledTimes(1);
  });

  it("picks files through the + tile", async () => {
    const { runtime } = fakeRuntime([]);
    const { container } = renderPanel(runtime);
    await screen.findByRole("list", { name: "Attachments" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = png("picked.png");
    fireEvent.change(input, { target: { files: [file] } });
    expect(fakeQueue.add).toHaveBeenCalledWith([file], expect.anything(), "u1");
  });

  it("view-only: files open, but there's no + and a drop attaches nothing", async () => {
    const { runtime } = fakeRuntime([rec("a")]);
    renderPanel(runtime, false);
    const strip = await screen.findByRole("list", { name: "Attachments" });
    expect(within(strip).getByRole("button", { name: "Open a.png" })).toBeTruthy();
    expect(within(strip).queryByRole("button", { name: "Add files" })).toBeNull();
    fireEvent.drop(screen.getByRole("textbox", { name: "Task title" }), {
      dataTransfer: fileTransfer([png()]),
    });
    expect(fakeQueue.add).not.toHaveBeenCalled();
  });

  it("opens the viewer: ←/→ between files, Download, Copy, Delete with Undo", async () => {
    const { runtime, attachments } = fakeRuntime([rec("a"), rec("bb"), rec("ccc")]);
    renderPanel(runtime);
    fireEvent.click(await screen.findByRole("button", { name: "Open bb.png" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("bb.png")).toBeTruthy();
    expect(within(dialog).getByText(/2 of 3/)).toBeTruthy();
    for (const name of ["Copy image", "Download", "Delete", "Previous", "Next"]) {
      expect(within(dialog).getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("ccc.png")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByText("a.png")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(within(dialog).getByText("ccc.png")).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await waitFor(() => expect(attachments.remove).toHaveBeenCalledWith("ccc"));
    expect(screen.queryByRole("button", { name: "Open ccc.png" })).toBeNull();
  });

  it("shows an upload's progress in place, and a problem as a caption with its action", async () => {
    const { runtime } = fakeRuntime([]);
    renderPanel(runtime);
    await screen.findByRole("list", { name: "Attachments" });
    const base = {
      userId: "u1",
      target: { workspaceId: "w", entityType: "task", entityId: "t1" },
      batchId: "b1",
      mime: "video/quicktime",
      preview: null,
      previewMime: null,
      width: null,
      height: null,
      attachmentId: null,
      objectPath: null,
      previewPath: null,
      begunAt: null,
      originalSent: false,
      previewSent: false,
      attempts: 0,
      refusals: 0,
      nextRetryAt: 0,
      createdAt: 1,
    };
    act(() =>
      fakeQueue.set({
        items: [
          {
            ...base,
            id: "u1",
            fileName: "clip.mov",
            sizeBytes: 10 * 1048576,
            state: "uploading",
            problem: null,
            loaded: 5 * 1048576,
            total: 10 * 1048576,
          },
          {
            ...base,
            id: "u2",
            fileName: "notes.zip",
            sizeBytes: 1000,
            state: "failed",
            problem: { kind: "failed" },
            loaded: 0,
            total: 1000,
          },
          {
            ...base,
            id: "u3",
            fileName: "rec.mov",
            sizeBytes: 340 * 1048576,
            state: "rejected",
            problem: {
              kind: "too_large",
              sizeBytes: 340 * 1048576,
              perFileBytes: 20 * 1048576,
              tier: "free",
            },
            loaded: 0,
            total: 0,
          },
        ],
        almostFull: { "w:task:t1": { usedBytes: 1.95 * 1073741824, totalBytes: 2 * 1073741824 } },
      }),
    );
    expect(screen.getByText("50% of 10 MB")).toBeTruthy();
    expect(screen.getByText(/Not attached — the upload failed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(fakeQueue.retry).toHaveBeenCalledWith("u2");
    // Too big for any plan right now (50 MB cap): no Upgrade, just the facts.
    expect(screen.getByText("rec.mov is 340 MB — your plan allows 20 MB per file")).toBeTruthy();
    expect(screen.getByText("Storage almost full — 2 of 2 GB")).toBeTruthy();
  });
});

import type { Meta, StoryObj } from "@storybook/react";

import type { ReactNode } from "react";

import type { AttachmentRecord, ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { getUploadQueue } from "@/lib/uploads";
import type { WorkspaceMember } from "../../workspaces/types";
import { useWorkspace, WorkspaceContext } from "../../workspaces/workspace-context";
import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { ActivityEntry, Bucket, Task } from "../model";
import { TaskDetailPanel } from "./task-detail-panel";

// The detail panel per tasks-v2 comp §1 + §5 option C (TV-U3, U3-1/U3-3).
// Visual captures are a deliberate human run (tests/visual/tasks-detail.spec.ts).

function member(userId: string, displayName: string): WorkspaceMember {
  return {
    id: `m-${userId}`,
    workspaceId: "w1",
    userId,
    role: "editor",
    roleId: null,
    overrides: {},
    perms: ["tasks.edit"] as WorkspaceMember["perms"],
    joinedAt: null,
    isActive: true,
    removedAt: null,
    displayName,
    avatarUrl: null,
  };
}

const MEMBERS = [member("storybook-user", "Maciej"), member("mike", "Mike")];

/** The preview's workspace, with two members so names and avatars resolve. */
function WithMembers({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  return (
    <WorkspaceContext.Provider value={{ ...ws, members: MEMBERS }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// A fixed "now": the visual spec freezes the page clock at the same instant
// (and zone), so the feed's clock times and dates read the same at every capture.
const NOW = new Date("2026-10-09T13:00:00Z").getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function bucket(id: string, name: string, isSystem = false): Bucket {
  return {
    id,
    workspaceId: "w1",
    ownerId: "storybook-user",
    name,
    isSystem,
    group: null,
    position: id,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

const INBOX = bucket("inbox", "Inbox", true);
const APP = bucket("b-app", "Moduo App");

function task(fields: Partial<Task> & { title: string }): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b-app", title: fields.title, position: "a" }),
    id: "t1",
    creatorId: "storybook-user",
    assigneeId: "storybook-user",
    createdAt: ago(60 * 24 * 3),
    updatedAt: ago(40),
    ...fields,
  };
}

const ACTIVITY: ActivityEntry[] = [
  {
    id: "a1",
    workspaceId: "w1",
    module: "tasks",
    entityType: "task",
    entityId: "t1",
    op: "tasks.queue_add",
    actorType: "user",
    actorId: "storybook-user",
    actorLabel: "Maciej",
    payload: {},
    createdAt: ago(90),
  },
];

const COMMENTS: SpineComment[] = [
  {
    id: "c1",
    workspaceId: "w1",
    entityType: "task",
    entityId: "t1",
    body: "Let's start with the rail counts and the scrollbars — both are tiny.",
    createdBy: "mike",
    authorKind: "user",
    authorLabel: null,
    createdAt: ago(48),
    updatedAt: ago(48),
    deletedAt: null,
  },
];

function stubApi(t: Task, over: Partial<TasksModuleApi> = {}): TasksModuleApi {
  return {
    canEdit: true,
    tasks: [t],
    tags: [
      { id: "g1", name: "tasks", color: "violet" },
      { id: "g2", name: "UI", color: "green" },
      { id: "g3", name: "UX", color: "amber" },
    ],
    tagsByTask: new Map([
      [
        "t1",
        [
          { id: "g1", name: "tasks", color: "violet" },
          { id: "g2", name: "UI", color: "green" },
          { id: "g3", name: "UX", color: "amber" },
        ],
      ],
    ]),
    subtasksByParent: new Map(),
    subtaskProgressByTask: new Map(),
    blockersByTask: new Map(),
    dependentsByTask: new Map(),
    taskRelations: [],
    queuedTaskIds: new Set(["t1"]),
    queueClaims: new Map(),
    activityStamp: 0,
    currentUserId: "storybook-user",
    loadActivity: async () => ACTIVITY,
    patchTask: () => {},
    toggleDone: () => {},
    toggleQueue: () => {},
    setTimeSpent: () => {},
    createTask: async () => null,
    createTagForTask: () => {},
    archiveTask: () => {},
    deleteTask: () => {},
    setTaskParent: () => {},
    ...over,
  } as unknown as TasksModuleApi;
}

/** A flat picture standing in for a screenshot (no network in stories). */
function picture(fill: string, accent: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'><rect width='640' height='400' fill='${fill}'/><rect x='40' y='48' width='320' height='28' rx='8' fill='${accent}'/><rect x='40' y='104' width='520' height='16' rx='8' fill='${accent}' opacity='.5'/><rect x='40' y='136' width='440' height='16' rx='8' fill='${accent}' opacity='.5'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function attachment(id: string, fileName: string, over: Partial<AttachmentRecord> = {}) {
  return {
    id,
    entityType: "task",
    entityId: "t1",
    uploaderId: "storybook-user",
    fileName,
    mime: "image/png",
    sizeBytes: 420_000,
    width: 2880,
    height: 1800,
    status: "ready",
    deletedAt: null,
    createdAt: ago(60),
    objectPath: `w1/${id}/original.png`,
    previewPath: `w1/${id}/preview.png`,
    previewMime: "image/png",
    ...over,
  } satisfies AttachmentRecord;
}

// Shared by every story's stub: the queue runs on one of them.
const urls = new Map<string, string>([
  ["w1/a1/preview.png", picture("dimgray", "gainsboro")],
  ["w1/a1/original.png", picture("dimgray", "gainsboro")],
  ["w1/a2/preview.png", picture("darkslategray", "silver")],
  ["w1/a2/original.png", picture("darkslategray", "silver")],
]);
const pending = new Map<string, AttachmentRecord>();
let n = 0;

/**
 * AT-2's storage in memory: two screenshots and a PDF, and an upload that
 * really runs (begin → bytes with progress → finalize), so paste/drop can be
 * tried in the story. Blobs become object URLs for the "signed" links.
 */
function stubAttachments(withFiles: boolean) {
  const rows: AttachmentRecord[] = withFiles
    ? [
        attachment("a1", "black-background.png"),
        attachment("a2", "settings-panel.png"),
        attachment("a3", "Landing brief v3.pdf", {
          mime: "application/pdf",
          sizeBytes: 2_516_582,
          previewPath: null,
          width: null,
          height: null,
        }),
      ]
    : [];
  return {
    listForEntity: async () => rows.filter((r) => !r.deletedAt),
    signedUrls: async (paths: string[]) =>
      new Map(paths.filter((p) => urls.has(p)).map((p) => [p, urls.get(p) as string])),
    status: async () => ({
      tier: "pro",
      perFileBytes: 52_428_800,
      totalBytes: 53_687_091_200,
      usedBytes: 1_288_490_188,
      pendingBytes: 0,
      level: 0,
      overLimit: false,
      isOwner: true,
      ownedWorkspaces: 2,
    }),
    begin: async (input: {
      fileName: string;
      mime: string;
      sizeBytes: number;
      previewMime: string | null;
      width: number | null;
      height: number | null;
    }) => {
      n += 1;
      const id = `up${n}`;
      const row = attachment(id, input.fileName, {
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        status: "pending",
        createdAt: new Date().toISOString(),
        objectPath: `w1/${id}/original`,
        previewPath: input.previewMime ? `w1/${id}/preview` : null,
        previewMime: input.previewMime,
        width: input.width,
        height: input.height,
      });
      pending.set(id, row);
      return row;
    },
    uploadObject: async ({
      path,
      blob,
      onProgress,
    }: {
      path: string;
      blob: Blob;
      onProgress?: (l: number, t: number) => void;
    }) => {
      for (let step = 1; step <= 5; step += 1) {
        await new Promise((r) => setTimeout(r, 250));
        onProgress?.((blob.size * step) / 5, blob.size);
      }
      urls.set(path, URL.createObjectURL(blob));
    },
    finalize: async (id: string) => {
      const row = { ...(pending.get(id) as AttachmentRecord), status: "ready" as const };
      if (row.previewPath && !urls.has(row.previewPath)) row.previewPath = null;
      rows.push(row);
      return row;
    },
    remove: async (id: string) => {
      const row = rows.find((r) => r.id === id) as AttachmentRecord;
      row.deletedAt = new Date().toISOString();
      return row;
    },
    restore: async (id: string) => {
      const row = rows.find((r) => r.id === id) as AttachmentRecord;
      row.deletedAt = null;
      return row;
    },
  };
}

function stubRuntime(comments: SpineComment[], mySeconds: number, withFiles = true): ModuoRuntime {
  const attachments = stubAttachments(withFiles);
  // The queue normally starts in the app shell; here it runs on the stub.
  void getUploadQueue().start(
    "storybook-user",
    attachments as unknown as ModuoRuntime["attachments"],
  );
  return {
    attachments,
    spine: {
      listComments: async () => comments,
      addComment: async () => comments[0],
      listLinks: async () => [],
      getEntities: async () => [],
    },
    tasks: {
      listTimeTotals: async () => [
        { taskId: "t1", totalSeconds: 4800, mySeconds, myWaitingSeconds: 0, mySecondsSince: null },
      ],
    },
  } as unknown as ModuoRuntime;
}

const FULL = task({
  title: "Task Module UI/UX Review",
  description: "<p>Full review — UX against competitors, then the UI pass.</p>",
  priority: "medium",
  energyLevel: "high",
  dueDate: new Date(NOW + 86_400_000).toISOString(),
  durationMinutes: 240,
  timeSpentSeconds: 4800,
});

const CORE_ONLY = task({
  id: "t1",
  title: 'Landing: "Book a call" section',
  bucketId: "b-app",
  dueDate: new Date(NOW + 3 * 86_400_000).toISOString(),
});

const meta = {
  title: "Tasks/TaskDetailPanel",
  component: TaskDetailPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <WithMembers>
        <div className="h-dvh w-96 border-l border-border bg-card p-3">
          <Story />
        </div>
      </WithMembers>
    ),
  ],
  args: {
    task: FULL,
    buckets: [APP],
    inbox: INBOX,
    canEdit: true,
    onRequestCapture: () => {},
    onSelectTask: () => {},
    api: stubApi(FULL),
    runtime: stubRuntime(COMMENTS, 3000),
    workspaceId: "w1",
  },
} satisfies Meta<typeof TaskDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Comp §1: header, checkbox + title, set properties, the Time row with your share, the feed. */
export const Populated: Story = {};

/** Comp §5 option C: the core five always, the rarer four as one quiet line. */
export const CorePropertiesOnly: Story = {
  args: {
    task: CORE_ONLY,
    api: stubApi(CORE_ONLY, { queuedTaskIds: new Set() }),
    runtime: stubRuntime([], 0, false),
  },
};

/** A view-only member: values without editors, no quiet line, no ⋯. */
export const ReadOnly: Story = {
  args: { canEdit: false, api: stubApi(FULL, { canEdit: false }) },
};

export const NothingSelected: Story = {
  args: { task: null },
};

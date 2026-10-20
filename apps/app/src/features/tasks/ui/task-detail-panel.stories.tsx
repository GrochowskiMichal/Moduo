import type { Meta, StoryObj } from "@storybook/react";

import { type ReactNode, useMemo } from "react";

import type { AttachmentRecord, ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { getUploadQueue } from "@/lib/uploads";
import { RightPanel } from "../../../components/app/right-panel";
import type { WorkspaceMember } from "../../workspaces/types";
import { useWorkspace, WorkspaceContext } from "../../workspaces/workspace-context";
import type { TaskCommands } from "../commands";
import { makeTask } from "../helpers";
import type { ActivityEntry, Bucket, Tag, Task } from "../model";
import { FakeTasksProvider, fakeTasksRuntime, queueEntry, tagLink } from "../testing/fake-tasks";
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
    editedAt: null,
    reactions: [],
  },
];

function tag(id: string, name: string, color: string): Tag {
  return {
    id,
    workspaceId: "w1",
    ownerId: "storybook-user",
    name,
    color,
    createdAt: ago(240),
    updatedAt: ago(240),
    deletedAt: null,
  };
}

const TAGS = [tag("g1", "tasks", "violet"), tag("g2", "UI", "green"), tag("g3", "UX", "amber")];

/**
 * What the panel's commands answer in a story: nothing is saved (as before
 * A4), the trail shows ACTIVITY, and "Focus on this" starts.
 */
const STORY_COMMANDS: Partial<TaskCommands> = {
  loadActivity: async () => ACTIVITY,
  patchTask: () => {},
  setTaskStatus: () => {},
  toggleDone: () => {},
  toggleQueue: () => {},
  setTimeSpent: () => {},
  logTime: async () => true,
  editTimeEntry: async () => true,
  removeTimeEntry: async () => true,
  listMyTimeEntries: async () => [],
  createTask: async () => null,
  createTagForTask: () => {},
  archiveTask: () => {},
  deleteTask: () => {},
  setTaskParent: () => {},
  focusOnTask: () => true,
  restoreTask: async () => true,
  addSession: () => true,
  updateSession: () => true,
  removeSession: () => true,
  addReminder: () => true,
  removeReminder: () => {},
  addWaiting: () => null,
  removeWaiting: () => {},
};

/**
 * The page's Tasks context for a story (A4): a store holding the story's
 * task with its tags, in my Focus unless the story says otherwise.
 */
function StoryTasks({
  task,
  queued,
  canEdit,
  children,
}: {
  task: Task | null;
  queued: boolean;
  canEdit: boolean;
  children: ReactNode;
}) {
  const runtime = useMemo(
    () =>
      fakeTasksRuntime({
        buckets: [INBOX, APP],
        tasks: task ? [task] : [],
        tags: TAGS,
        tagLinks: TAGS.map((g) => tagLink(g.id, "t1")),
        queue: queued ? [queueEntry("t1", "storybook-user")] : [],
      }).runtime,
    [task, queued],
  );
  return (
    <FakeTasksProvider
      runtime={runtime}
      userId="storybook-user"
      workspaceId="w1"
      permission={canEdit ? "edit" : "view"}
      commands={STORY_COMMANDS}
    >
      {children}
    </FakeTasksProvider>
  );
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
      previewMime: AttachmentRecord["previewMime"];
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
    (Story, { args, parameters }) => (
      <WithMembers>
        <StoryTasks
          task={args.task ?? null}
          queued={parameters.queued !== false}
          canEdit={args.canEdit !== false}
        >
          <div className="h-dvh w-96 border-l border-border bg-card p-3">
            <Story />
          </div>
        </StoryTasks>
      </WithMembers>
    ),
  ],
  args: {
    task: FULL,
    canEdit: true,
    onRequestCapture: () => {},
    onSelectTask: () => {},
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
    runtime: stubRuntime([], 0, false),
  },
  // Not in my Focus.
  parameters: { queued: false },
};

/** A view-only member: values without editors, no quiet line, no ⋯. */
export const ReadOnly: Story = {
  args: { canEdit: false },
};

export const NothingSelected: Story = {
  args: { task: null },
};

const MARKDOWN = task({
  title: "Collect brand assets from client",
  description: [
    "Acme's old identity only exists as exports. We need the **source files** before Design can close.",
    "",
    "**What we asked for**",
    "",
    "- Logo source files (Illustrator or SVG)",
    "- Pantone and CMYK values from their current cards",
    "- Licences for the two typefaces on their site",
    "",
    "1. Rebuild the lockups",
    "2. Add the type licences to the guide",
    "",
    "- [x] Ask Anna for the files",
    "- [ ] Check the print specs",
    "",
    "> Legal signs off on anything that leaves Acme.",
    "",
    "Run `npm run brand` after, see [the brand guide](https://example.com) by [Oct 17](moduo://date/2026-10-17).",
  ].join("\n"),
});

/**
 * The description as Markdown (dogfood call #15): bullets as round-1c frame
 * 3 draws them (`.ldesc`); numbers, checkboxes, the quote, code and the link
 * are the agent's layout, revisitable.
 */
export const MarkdownDescription: Story = {
  args: { task: MARKDOWN },
};

/**
 * Hosted as the Tasks page does, at the 280 px floor (round-2b frame 5): the
 * task's actions in the title row, "Details ▾ ……… Focus ↗ ⋯"; the breadcrumb
 * line holds only the crumbs and the handle.
 */
export const InThePanelAtFloor: Story = {
  render: (args) => (
    <div className="h-full w-70 rounded-xl border border-border bg-card p-3">
      <RightPanel
        module="tasks"
        activeId="details"
        onChange={() => {}}
        views={{
          details: () => <TaskDetailPanel {...args} onOpenFullPage={() => {}} />,
          project: () => null,
        }}
      />
    </div>
  ),
};

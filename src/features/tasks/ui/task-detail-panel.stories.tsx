import type { Meta, StoryObj } from "@storybook/react";

import type { ReactNode } from "react";

import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
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

function stubRuntime(comments: SpineComment[], mySeconds: number): ModuoRuntime {
  return {
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
    runtime: stubRuntime([], 0),
  },
};

/** A view-only member: values without editors, no quiet line, no ⋯. */
export const ReadOnly: Story = {
  args: { canEdit: false, api: stubApi(FULL, { canEdit: false }) },
};

export const NothingSelected: Story = {
  args: { task: null },
};

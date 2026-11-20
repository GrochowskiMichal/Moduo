// Shared fixtures for the Tasks List and Board stories (TV-U1): a two-person
// workspace, a handful of tasks covering every row mark, and the Tasks context
// over a fake runtime seeded with them (`StoryTasks`, A4).
// Story-only; nothing in the app imports it.

import { type ReactNode, useState } from "react";

import type { CommentMark } from "../../../lib/sync/types";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import { makeTask } from "../helpers";
import type { Bucket, Tag, Task, TaskWaitingEntry } from "../model";
import {
  FakeTasksProvider,
  fakeTasksRuntime,
  type FakeTasksSeed,
  queueEntry,
  relation,
  tagLink,
} from "../testing/fake-tasks";

const MEMBERS = [
  {
    userId: "u1",
    displayName: "Maciej",
    isActive: true,
    removedAt: null,
    avatarUrl: null,
    perms: ["tasks.edit"],
  },
  {
    userId: "u2",
    displayName: "Mike",
    isActive: true,
    removedAt: null,
    avatarUrl: null,
    perms: ["tasks.edit"],
  },
];

/** Two active members, so assignee avatars and claims have someone to show. */
export function TeamWorkspace({ children }: { children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={{ members: MEMBERS } as unknown as WorkspaceContextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function bucket(id: string, name: string, position: string): Bucket {
  return {
    id,
    workspaceId: "w1",
    ownerId: "u1",
    name,
    isSystem: id === "inbox",
    group: null,
    position,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

export const INBOX = bucket("inbox", "Inbox", "0");
export const BUCKETS = [bucket("b-app", "Moduo App", "a"), bucket("b-landing", "Landing", "b")];

function day(offset: number, hour = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

let n = 0;
function task(fields: Partial<Task> & { title: string }): Task {
  n += 1;
  return {
    ...makeTask({
      workspaceId: "w1",
      bucketId: fields.bucketId ?? "b-app",
      title: fields.title,
      position: String(n).padStart(10, "0"),
    }),
    id: fields.id ?? `t${n}`,
    assigneeId: "u1",
    updatedAt: day(-1),
    ...fields,
  };
}

export const TASKS: Task[] = [
  task({ id: "review", title: "Task module UI/UX review", priority: "medium", dueDate: day(3) }),
  task({
    id: "assignee",
    title: "Assignee selector in task creation modal is too big",
    priority: "high",
  }),
  task({
    id: "accounts",
    title: "Explore multiple accounts (and account-related workspaces) on one app",
    priority: "low",
    dueDate: day(12),
    assigneeId: "u2",
  }),
  task({
    id: "notes",
    title: "Notes: fix broken task-line rendering",
    priority: "medium",
    dueDate: day(4),
  }),
  task({ id: "schedule", title: "Fully rebuild the scheduling modal in the calendar" }),
  task({ id: "sub", title: "Sketch the new modal", parentId: "schedule" }),
  task({
    id: "policy",
    title: "Write cookie policy and terms of service",
    scheduledAt: day(-2, 10),
  }),
  task({
    id: "settings",
    title: "Settings: fix icon & logo modal UI",
    priority: "medium",
    assigneeId: null,
  }),
  task({
    id: "book",
    title: "Landing: “Book a call” section",
    bucketId: "b-landing",
    dueDate: day(1),
  }),
  task({
    id: "done-1",
    title: "Lock production signup to invites",
    status: "done",
    dueDate: day(-4),
  }),
  task({
    id: "done-2",
    title: "Reflect payment plans as Stripe plans",
    status: "done",
    updatedAt: day(-20),
  }),
];

const TAGS: Record<string, Array<{ id: string; name: string; color: string }>> = {
  review: [
    { id: "g1", name: "tasks", color: "gray" },
    { id: "g2", name: "ui", color: "gray" },
    { id: "g3", name: "review", color: "gray" },
  ],
  assignee: [
    { id: "g2", name: "ui", color: "gray" },
    { id: "g4", name: "capture", color: "gray" },
  ],
  notes: [{ id: "g5", name: "notes", color: "gray" }],
  schedule: [{ id: "g2", name: "ui", color: "gray" }],
};

function tagRow(id: string, name: string): Tag {
  return {
    id,
    workspaceId: "w1",
    ownerId: "u1",
    name,
    color: "gray",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

/** Three comments on the review task (TV-U10's row facts). */
export function commentsOn(taskId: string, count: number): CommentMark[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${taskId}-${i}`,
    taskId,
    updatedAt: "2026-10-10T09:00:00.000Z",
    deletedAt: null,
  }));
}

const WAITING: TaskWaitingEntry = {
  id: "w1",
  workspaceId: "w",
  taskId: "accounts",
  kind: "text",
  ref: null,
  label: "Anna",
  since: "2026-10-10T09:00:00.000Z",
  createdBy: null,
  updatedAt: "2026-10-10T09:00:00.000Z",
};

/**
 * What the store reads for the List and Board stories: the projects, the
 * tasks, two of them in my Focus and Mike's, tags, a blocker, comments and a
 * waiting line, so every row mark shows. `extra` adds or replaces tables.
 */
export function storySeed(tasks: Task[] = TASKS, extra: FakeTasksSeed = {}): FakeTasksSeed {
  const ids = new Set(tasks.map((t) => t.id));
  const tagged = Object.entries(TAGS).filter(([taskId]) => ids.has(taskId));
  const tags = new Map(tagged.flatMap(([, list]) => list.map((g) => [g.id, g.name] as const)));
  return {
    buckets: [INBOX, ...BUCKETS],
    tasks,
    queue: [
      queueEntry("review", "u1"),
      queueEntry("notes", "u1", { position: "b" }),
      queueEntry("accounts", "u2"),
      queueEntry("notes", "u2"),
    ].filter((q) => ids.has(q.taskId)),
    tags: [...tags].map(([id, name]) => tagRow(id, name)),
    tagLinks: tagged.flatMap(([taskId, list]) => list.map((g) => tagLink(g.id, taskId))),
    relations: ids.has("policy") && ids.has("schedule") ? [relation("policy", "schedule")] : [],
    comments: ids.has("review") ? commentsOn("review", 3) : [],
    waiting: ids.has("accounts") ? [WAITING] : [],
    ...extra,
  };
}

/**
 * The Tasks context the views read (A4), over a fake runtime that answers
 * from `seed`. Writes go to that runtime and show at once, as on the page.
 */
export function StoryTasks({
  seed = storySeed(),
  userId = "u1",
  workspaceId = "w1",
  children,
}: {
  seed?: FakeTasksSeed;
  userId?: string;
  workspaceId?: string;
  children: ReactNode;
}) {
  const [runtime] = useState(() => fakeTasksRuntime(seed).runtime);
  return (
    <FakeTasksProvider runtime={runtime} userId={userId} workspaceId={workspaceId}>
      {children}
    </FakeTasksProvider>
  );
}

export const bucketNameById = (id: string) =>
  id === "inbox" ? "Inbox" : (BUCKETS.find((b) => b.id === id)?.name ?? "Inbox");

// Shared fixtures for the Tasks List and Board stories (TV-U1): a two-person
// workspace, a handful of tasks covering every row mark, and a stub api.
// Story-only; nothing in the app imports it.

import type { ReactNode } from "react";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import { makeTask, subtaskProgress } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";

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

/** Enough of the module api for the List and Board to render every mark. */
export function stubApi(tasks: Task[] = TASKS): TasksModuleApi {
  const byParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
  }
  const progress = new Map([...byParent].map(([id, kids]) => [id, subtaskProgress(kids)]));
  const blocker = tasks.find((t) => t.id === "policy");
  return {
    loading: false,
    tasks,
    queuedTaskIds: new Set(["review", "notes"]),
    queueClaims: new Map([
      ["accounts", ["u2"]],
      ["notes", ["u2"]],
    ]),
    subtasksByParent: byParent,
    subtaskProgressByTask: progress,
    tagsByTask: new Map(Object.entries(TAGS)),
    blockedTaskIds: new Set(["schedule"]),
    blockersByTask: new Map(blocker ? [["schedule", [blocker]]] : []),
    toggleDone: () => {},
    toggleQueue: () => {},
    patchTask: () => {},
    deleteTask: () => {},
    setTaskParent: () => {},
    skipOccurrence: () => {},
  } as unknown as TasksModuleApi;
}

export const bucketNameById = (id: string) =>
  id === "inbox" ? "Inbox" : (BUCKETS.find((b) => b.id === id)?.name ?? "Inbox");

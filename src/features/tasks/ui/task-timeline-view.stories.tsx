import type { Meta, StoryObj } from "@storybook/react";
import { addDays } from "date-fns";

import { makeTask } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task, TaskRelation } from "../model";
import { TaskTimelineView } from "./task-timeline-view";

// Timeline baselines (specs/tasks-timeline.md TL-1: AC1–AC4, AC7 render, AC9,
// AC10). Visual captures are a deliberate human run (gotchas: Storybook render
// is blocked in worktrees; visual diffs are stop-and-ask). Dates are relative
// to "now" so the bars keep their position against the today line.

function bucket(id: string, name: string, position: string): Bucket {
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

function day(offset: number, hour = 9): string {
  const d = addDays(new Date(), offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

let n = 0;
function task(fields: Partial<Task> & { title: string }): Task {
  n += 1;
  return {
    ...makeTask({
      workspaceId: "w1",
      bucketId: fields.bucketId ?? "b-work",
      title: fields.title,
      position: String(n).padStart(10, "0"),
    }),
    id: fields.id ?? `t${n}`,
    ...fields,
  };
}

const BUCKETS = [bucket("b-work", "Deep work", "a"), bucket("b-admin", "Admin", "b")];
const INBOX = bucket("inbox", "Inbox", "0");

// All four date shapes + done + blocked + past-end drift + tray (AC2/AC7/AC9).
const TASKS: Task[] = [
  task({ id: "spec", title: "Write the launch spec", scheduledAt: day(-2), dueDate: day(3, 0) }),
  task({ id: "build", title: "Build the landing page", scheduledAt: day(4), dueDate: day(9, 0) }),
  task({ id: "kickoff", title: "Kickoff prep — start known, end open", scheduledAt: day(1) }),
  task({ id: "review", title: "Review pass due", dueDate: day(7, 0) }),
  task({
    id: "shipped",
    title: "Already shipped",
    scheduledAt: day(-6),
    dueDate: day(-4, 0),
    status: "done",
  }),
  task({ id: "overdue", title: "Slipping quietly", dueDate: day(-3, 0) }),
  task({ id: "admin-1", title: "Expense report", bucketId: "b-admin", scheduledAt: day(2) }),
  task({ id: "tray-1", title: "Someday: rewrite onboarding" }),
  task({ id: "tray-2", title: "Collect testimonials" }),
];

const RELATIONS: TaskRelation[] = [
  { id: "r1", workspaceId: "w1", blockerTaskId: "spec", blockedTaskId: "build", createdAt: "" },
];

function stubApi(tasks: Task[], relations: TaskRelation[]): TasksModuleApi {
  const blockedIds = new Set(relations.map((r) => r.blockedTaskId));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blockersByTask = new Map<string, Task[]>();
  for (const rel of relations) {
    const blocker = byId.get(rel.blockerTaskId);
    if (!blocker) continue;
    const list = blockersByTask.get(rel.blockedTaskId);
    if (list) list.push(blocker);
    else blockersByTask.set(rel.blockedTaskId, [blocker]);
  }
  return {
    loading: false,
    taskRelations: relations,
    blockedTaskIds: blockedIds,
    blockersByTask,
    toggleDone: () => {},
    patchTask: () => {},
  } as unknown as TasksModuleApi;
}

const baseArgs = {
  tasks: TASKS,
  scopeTitle: "All",
  view: "timeline" as const,
  onViewChange: () => {},
  zoom: "month" as const,
  onZoomChange: () => {},
  buckets: BUCKETS,
  inbox: INBOX,
  canEdit: true,
  onRequestCapture: () => {},
  selectedTaskId: null,
  onSelectTask: () => {},
  api: stubApi(TASKS, RELATIONS),
};

const meta = {
  title: "Tasks/TaskTimelineView",
  component: TaskTimelineView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: 560, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
  args: baseArgs,
} satisfies Meta<typeof TaskTimelineView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The four bar shapes, a done bar, a blocked bar + arrow, the drift dot, tray. */
export const Populated: Story = {};

export const WeekZoom: Story = {
  args: { zoom: "week" },
};

export const QuarterZoom: Story = {
  args: { zoom: "quarter" },
};

/** No dated tasks → hint + prominent tray (AC10). */
export const Empty: Story = {
  args: {
    tasks: TASKS.filter((t) => !t.scheduledAt && !t.dueDate),
    api: stubApi(
      TASKS.filter((t) => !t.scheduledAt && !t.dueDate),
      [],
    ),
  },
};

/** Everything visible, nothing editable (AC10). */
export const ReadOnly: Story = {
  args: { canEdit: false },
};

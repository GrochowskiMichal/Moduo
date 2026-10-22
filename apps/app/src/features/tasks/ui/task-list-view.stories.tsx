import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { Section, Task } from "../model";
import { TaskListView } from "./task-list-view";
import {
  bucketNameById,
  BUCKETS,
  commentsOn,
  INBOX,
  storySeed,
  StoryTasks,
  TASKS,
  TeamWorkspace,
} from "./tasks-stories-fixtures";

// TV-U1 rows (specs/tasks-v2.md §6): fixed right-hand columns, quiet counts,
// the priority glyph, done rows and the "N completed" line. Baselines are a
// human capture (tests/visual/tasks-list.spec.ts); switch density, radius,
// shade and accent from the toolbar.

const appTasks = TASKS.filter((t) => t.bucketId === "b-app");

/** Handles for the Detailed stories (the server numbers tasks). */
const numbered = (tasks: Task[]) => tasks.map((t, i) => ({ ...t, number: 140 + i }));

const SECTIONS: Section[] = [
  {
    id: "s-design",
    workspaceId: "w",
    projectId: "b-app",
    name: "Design",
    position: 1,
    startsOn: null,
    endsOn: "2026-10-24",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "s-build",
    workspaceId: "w",
    projectId: "b-app",
    name: "Build",
    position: 2,
    startsOn: null,
    endsOn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
];

function Interactive(props: React.ComponentProps<typeof TaskListView>) {
  const [selected, setSelected] = useState<string | null>(props.selectedTaskId);
  return <TaskListView {...props} selectedTaskId={selected} onSelectTask={setSelected} />;
}

const meta = {
  title: "Tasks/TaskListView",
  component: TaskListView,
  parameters: { layout: "fullscreen" },
  decorators: [
    // The Tasks context the List reads (A4): a story's `tasksSeed`, else the shared one.
    (Story, { id, parameters }) => (
      <TeamWorkspace>
        <StoryTasks key={id} seed={parameters.tasksSeed}>
          <div className="h-[600px] bg-card p-4">
            <Story />
          </div>
        </StoryTasks>
      </TeamWorkspace>
    ),
  ],
  args: {
    tasks: appTasks,
    scopeTitle: "Moduo App",
    selection: "b-app",
    view: "list",
    onViewChange: () => {},
    groupBy: "none",
    buckets: BUCKETS,
    inbox: INBOX,
    bucketNameById,
    canEdit: true,
    onRequestCapture: () => {},
    selectedTaskId: "review",
    onSelectTask: () => {},
  },
  render: (args) => <Interactive {...args} />,
} satisfies Meta<typeof TaskListView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One bucket: no bucket text (implied), columns line up, completed hidden. */
export const SingleBucket: Story = {};

/** All, grouped by bucket: no group ends with a completed line; the list
 *  ends with its one "N completed · Show" (MOD-148). */
export const AllByBucket: Story = {
  args: { tasks: TASKS, scopeTitle: "All", selection: "all", groupBy: "bucket" },
};

/** All, flat: the bucket shows as dot + name text, never a pill. */
export const AllFlat: Story = {
  args: { tasks: TASKS, scopeTitle: "All", selection: "all", groupBy: "status" },
};

/** Display → Group by → Date: Earlier · Today · Tomorrow · five day names · Later · No date. */
export const ByDate: Story = {
  args: { tasks: TASKS, scopeTitle: "All", selection: "all", groupBy: "date" },
};

/** Display → Rows → Detailed (TV-U10): the handle before the title, then
 *  Project › Section, the status name, Due, Next session, time, the
 *  assignee's name and Updated, under sortable headers; every column as wide
 *  as its widest value, the title the one flexible track. Switch Density to
 *  see the three heights (AC11.2's visual baselines are a human capture). */
export const DetailedRows: Story = {
  args: {
    tasks: numbered(TASKS).map((t, i) => (i % 3 === 0 ? { ...t, sectionId: "s-design" } : t)),
    rows: "detailed",
    completed: "all",
    taskKey: "MOD",
    order: "due",
    sections: SECTIONS,
    onSort: () => {},
  },
  parameters: { tasksSeed: storySeed(numbered(TASKS), { sections: SECTIONS }) },
};

/** A project grouped by Section (its default, TV-U10): "No section" first,
 *  each section with "2 of 5" and its end date, the "+" always there, the
 *  folded "Backlog · n" and "+ Add section" at the end. */
export const BySection: Story = {
  args: {
    groupBy: "section",
    sections: SECTIONS,
    tasks: appTasks.map((t, i) => ({
      ...t,
      sectionId: i % 2 === 0 ? "s-design" : i % 3 === 0 ? "s-build" : null,
      ...(i === 1 ? { statusCategory: "backlog" as const } : {}),
    })),
    onAddSection: () => {},
    onRenameSection: () => {},
    onDeleteSection: () => {},
  },
};

/** A project grouped by section with mostly finished work (MOD-148, the
 *  dogfood board): Completed is Hidden, so no section ends with its own
 *  "N completed · show"; one quiet "9 completed · Show" ends the list after
 *  "+ Add section" and lists them in place, in their sections, until "Hide".
 *  Backlog keeps its folded line in its section; Build, all done, keeps its
 *  header. */
const DONE_AT = "2026-09-20T00:00:00.000Z";
const MOSTLY_DONE: Task[] = [
  ...appTasks.slice(0, 2).map((t, i) => ({
    ...t,
    status: "todo" as const,
    sectionId: i === 0 ? null : "s-design",
  })),
  ...appTasks.slice(2, 3).map((t) => ({
    ...t,
    status: "todo" as const,
    statusCategory: "backlog" as const,
    sectionId: "s-design",
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    ...(appTasks[i % appTasks.length] as Task),
    id: `finished-${i}`,
    title: `Finished piece ${i + 1}`,
    position: `z${i}`,
    parentId: null,
    status: "done" as const,
    statusCategory: "done" as const,
    updatedAt: DONE_AT,
    completedAt: DONE_AT,
    sectionId: i < 2 ? null : i < 5 ? "s-design" : "s-build",
  })),
];
export const BySectionMostlyDone: Story = {
  args: {
    groupBy: "section",
    sections: SECTIONS,
    tasks: MOSTLY_DONE,
    selectedTaskId: MOSTLY_DONE[0]?.id ?? null,
    onAddSection: () => {},
    onRenameSection: () => {},
    onDeleteSection: () => {},
  },
  parameters: { tasksSeed: storySeed(MOSTLY_DONE, { sections: SECTIONS }) },
};

/** The same project in Display → Completed: 7 days, three pieces finished
 *  yesterday: those show in Build, struck through, and no section has a line
 *  of its own; one "6 older completed · Show" ends the list for the work
 *  finished before the last seven days (MOD-148 follow-up). */
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();
const MOSTLY_DONE_RECENT: Task[] = MOSTLY_DONE.map((t) =>
  t.id === "finished-6" || t.id === "finished-7" || t.id === "finished-8"
    ? { ...t, updatedAt: YESTERDAY, completedAt: YESTERDAY }
    : t,
);
export const BySectionSevenDays: Story = {
  args: {
    ...BySectionMostlyDone.args,
    completed: "week",
    tasks: MOSTLY_DONE_RECENT,
  },
  parameters: { tasksSeed: storySeed(MOSTLY_DONE_RECENT, { sections: SECTIONS }) },
};

/** A late row (REPLAN 23): muted, never red; hover or select it for
 *  Move · Won't do · Break down over the end of its title. */
export const LateRow: Story = {
  args: {
    tasks: appTasks.map((t, i) =>
      i === 0 ? { ...t, dueOn: "2026-01-05", dueDate: "2026-01-05T00:00:00.000Z" } : t,
    ),
    selectedTaskId: appTasks[0]?.id ?? null,
  },
};

/** Display → Completed: All — done rows dim as a whole except the checkbox. */
export const CompletedAll: Story = {
  args: { completed: "all" },
};

/** Display → Show on rows with Energy on. */
export const WithEnergy: Story = {
  args: {
    properties: ["priority", "energy", "date", "assignee"],
    tasks: appTasks.map((t, i) => ({
      ...t,
      energyLevel: (["low", "medium", "high", null] as const)[i % 4],
    })),
  },
};

/** View-only: no queue toggles, only the marks someone has queued. */
export const ReadOnly: Story = {
  args: { canEdit: false },
};

/** Finished files on a task (AT-3's 📎 count). */
const filesOn = (taskId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `f-${taskId}-${i}`,
    taskId,
    status: "ready",
    updatedAt: "2026-10-15T09:00:00.000Z",
    deletedAt: null,
  }));

/** An agent at work on a row (TV-D16), for the narrow story. */
const agentAt = (taskId: string, state: "working" | "needs_you") => ({
  id: `agent-${taskId}`,
  workspaceId: "w1",
  taskId,
  userId: "u1",
  agent: "Claude",
  state,
  note: null,
  step: null,
  steps: null,
  links: [],
  earlier: [],
  summaryAt: null,
  summaryPostedAt: null,
  startedAt: "2026-10-15T09:00:00.000Z",
  updatedAt: "2026-10-15T09:00:00.000Z",
  stoppedAt: null,
});

/** MOD-138, MOD-125: the agent's mark and the counts sit at each row's end,
 *  wherever the title stops; the title gives way first and never below about
 *  ten characters; under 16rem of title cell the mark drops its state, under
 *  12rem its agent too. Three centre widths: 340 px (a 1024 px window with
 *  both side panels open), 440 px and 600 px. */
export const NarrowRows: Story = {
  parameters: {
    tasksSeed: storySeed(TASKS, {
      agentSessions: [agentAt("review", "needs_you"), agentAt("settings", "working")],
      comments: [...commentsOn("review", 3), ...commentsOn("assignee", 12)],
      attachments: [...filesOn("review", 2), ...filesOn("settings", 1)],
    }),
  },
  render: (args) => (
    <div className="flex flex-col gap-6">
      {["w-85", "w-110", "w-150"].map((width) => (
        <div key={width} className={`${width} h-44 rounded-md border border-hairline`}>
          <Interactive {...args} />
        </div>
      ))}
    </div>
  ),
};

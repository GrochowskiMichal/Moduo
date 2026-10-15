import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { Section, Task } from "../model";
import { TaskListView } from "./task-list-view";
import {
  BUCKETS,
  bucketNameById,
  INBOX,
  stubApi,
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
    (Story) => (
      <TeamWorkspace>
        <div className="h-[600px] bg-card p-4">
          <Story />
        </div>
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
    api: stubApi(),
  },
  render: (args) => <Interactive {...args} />,
} satisfies Meta<typeof TaskListView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One bucket: no bucket text (implied), columns line up, completed hidden. */
export const SingleBucket: Story = {};

/** All, grouped by bucket: each group ends with its own completed line. */
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
    api: stubApi(numbered(TASKS), { sections: SECTIONS }),
  },
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
  args: {
    api: stubApi(TASKS, {
      agentSessions: [agentAt("review", "needs_you"), agentAt("settings", "working")],
      commentCounts: new Map([
        ["review", 3],
        ["assignee", 12],
      ]),
      attachmentCounts: new Map([
        ["review", 2],
        ["settings", 1],
      ]),
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

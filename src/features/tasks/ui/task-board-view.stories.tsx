import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { ProjectStatus, Section, Task } from "../model";
import { TaskBoardView } from "./task-board-view";
import {
  BUCKETS,
  bucketNameById,
  INBOX,
  stubApi,
  TASKS,
  TeamWorkspace,
} from "./tasks-stories-fixtures";

// The Board v3 (TV-U11; tasks-v3 §5, calls 22, 53a, 53b, 85, default o):
// cards at one fixed width per density on the kit card, folded columns as a
// small button, a project's own statuses, lanes. Baselines are a human
// capture (tests/visual/tasks-board.spec.ts).

function Interactive(props: React.ComponentProps<typeof TaskBoardView>) {
  const [selected, setSelected] = useState<string | null>(props.selectedTaskId);
  return <TaskBoardView {...props} selectedTaskId={selected} onSelectTask={setSelected} />;
}

const stamp = "2026-10-01T00:00:00.000Z";
const status = (
  id: string,
  category: ProjectStatus["category"],
  name: string,
  position = 0,
): ProjectStatus => ({
  id,
  workspaceId: "w1",
  projectId: "b-app",
  category,
  name,
  position,
  hidden: false,
  createdAt: stamp,
  updatedAt: stamp,
});

/** A dev project's own statuses (53a): In review sits in In progress. */
const APP_STATUSES: ProjectStatus[] = [
  status("s-backlog", "backlog", "Backlog"),
  status("s-todo", "todo", "Todo"),
  status("s-doing", "in_progress", "In progress", 0),
  status("s-review", "in_progress", "In review", 1),
  status("s-done", "done", "Done"),
  status("s-cancel", "wont_do", "Canceled"),
];

const SECTIONS: Section[] = [
  { id: "sec-1", projectId: "b-app", name: "Week 1", position: 1 },
  { id: "sec-2", projectId: "b-app", name: "Week 2", position: 2 },
].map((s) => ({
  ...s,
  workspaceId: "w1",
  startsOn: null,
  endsOn: null,
  createdAt: stamp,
  updatedAt: stamp,
}));

/** The project's tasks with statuses, sections and a few in Backlog. */
const APP_TASKS: Task[] = TASKS.filter((t) => t.bucketId === "b-app").map((t, i) => {
  const statusId =
    t.status === "done" ? "s-done" : i % 3 === 0 ? "s-review" : i % 3 === 1 ? "s-todo" : "s-doing";
  const category = APP_STATUSES.find((s) => s.id === statusId)?.category ?? "todo";
  return {
    ...t,
    statusId,
    statusCategory: category,
    status: category === "in_progress" ? "in_progress" : category === "done" ? "done" : "todo",
    sectionId: i % 2 === 0 ? "sec-1" : i % 4 === 1 ? "sec-2" : null,
  };
});
const BACKLOG: Task[] = [1, 2, 3].map((k) => ({
  ...APP_TASKS[0],
  id: `backlog-${k}`,
  title: `Someday idea ${k}`,
  status: "todo",
  statusCategory: "backlog",
  statusId: "s-backlog",
  dueDate: null,
  priority: null,
}));
const PROJECT_TASKS = [...APP_TASKS, ...BACKLOG];

const projectApi = stubApi(PROJECT_TASKS, {
  statuses: APP_STATUSES,
  statusById: new Map(APP_STATUSES.map((s) => [s.id, s])),
  statusesForBucket: (id: string) => (id === "b-app" ? APP_STATUSES : []),
  sections: SECTIONS,
});

const meta = {
  title: "Tasks/TaskBoardView",
  component: TaskBoardView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TeamWorkspace>
        <div className="h-[560px] bg-card p-4">
          <Story />
        </div>
      </TeamWorkspace>
    ),
  ],
  args: {
    tasks: TASKS,
    scopeTitle: "All",
    selection: "all",
    view: "board",
    onViewChange: () => {},
    boardGroupBy: "status",
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
} satisfies Meta<typeof TaskBoardView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Across projects: the five categories; no column ends with a completed
 *  line: the board's end has one "N completed · Show" for every column's
 *  hidden cards (MOD-148); a column's "+" says "Pick a project first". */
export const ByStatus: Story = {};

/** Display → Completed: 7 days — recent done cards show, faded; the older
 *  ones wait behind the column's own "N completed · show" line. */
export const RecentCompleted: Story = {
  args: { completed: "week" },
};

/** Columns by project in All; an empty one hides behind "1 hidden · Show". */
export const ByBucket: Story = {
  args: { boardGroupBy: "bucket" },
};

/** One project's own statuses (53a): Backlog folded first (53b), In review
 *  next to In progress, "+ Add status" at the end. */
export const ProjectStatuses: Story = {
  args: {
    tasks: PROJECT_TASKS,
    scopeTitle: "Moduo App",
    selection: "b-app",
    selectedTaskId: null,
    onAddStatus: () => {},
    api: projectApi,
  },
};

/** Grouped by section (22a): No section first, then the weeks, "+ Add
 *  section", then the one "N completed · Show" for the done cards of every
 *  section (MOD-148). */
export const BySection: Story = {
  args: { ...ProjectStatuses.args, boardGroupBy: "section" },
};

/** Lanes by assignee (call 85): one level, each lane folds. */
export const LanesByAssignee: Story = {
  args: { ...ProjectStatuses.args, lanes: "assignee" },
};

/** Display → Rows: Detailed (the handle, a second line) and Description preview (AC7.4). */
export const DetailedWithDescription: Story = {
  args: {
    ...ProjectStatuses.args,
    rows: "detailed",
    description: true,
    taskKey: "MOD",
    tasks: PROJECT_TASKS.map((t, i) => ({
      ...t,
      number: 140 + i,
      description:
        i % 2 === 0
          ? "<p>Check the empty states, the long titles and the done fade on every density.</p>"
          : "",
    })),
  },
};

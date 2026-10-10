import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

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
    onGroupByChange: () => {},
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

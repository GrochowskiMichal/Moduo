import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { TaskBoardView } from "./task-board-view";
import {
  BUCKETS,
  bucketNameById,
  INBOX,
  stubApi,
  TASKS,
  TeamWorkspace,
} from "./tasks-stories-fixtures";

// TV-U1 board (specs/tasks-v2.md §6): columns flex between 280 and 400 px,
// one quiet meta line per card, tint selection, done cards faded. Baselines
// are a human capture (tests/visual/tasks-board.spec.ts).

function Interactive(props: React.ComponentProps<typeof TaskBoardView>) {
  const [selected, setSelected] = useState<string | null>(props.selectedTaskId);
  return <TaskBoardView {...props} selectedTaskId={selected} onSelectTask={setSelected} />;
}

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

/** By status: the Done column ends with its "N completed · show" line. */
export const ByStatus: Story = {};

/** Display → Completed: 7 days — recent done cards show, faded. */
export const RecentCompleted: Story = {
  args: { completed: "week" },
};

/** Columns by bucket in All. */
export const ByBucket: Story = {
  args: { boardGroupBy: "bucket" },
};

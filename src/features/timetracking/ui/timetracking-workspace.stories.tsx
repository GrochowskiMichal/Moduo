import type { Meta, StoryObj } from "@storybook/react";

import { TimetrackingWorkspace } from "./timetracking-workspace";

const meta: Meta<typeof TimetrackingWorkspace> = {
  title: "features/timetracking/ui/timetracking-workspace",
  component: TimetrackingWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

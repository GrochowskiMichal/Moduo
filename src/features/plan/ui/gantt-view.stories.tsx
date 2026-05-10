import type { Meta, StoryObj } from "@storybook/react";

import { GanttView } from "./gantt-view";

const meta: Meta<typeof GanttView> = {
  title: "features/plan/ui/gantt-view",
  component: GanttView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

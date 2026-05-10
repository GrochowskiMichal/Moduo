import type { Meta, StoryObj } from "@storybook/react";

import { TasksWidget } from "./tasks-widget";

const meta: Meta<typeof TasksWidget> = {
  title: "features/dashboard/ui/widgets/tasks-widget",
  component: TasksWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

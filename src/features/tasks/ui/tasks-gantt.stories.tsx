import type { Meta, StoryObj } from "@storybook/react";

import { TasksGantt } from "./tasks-gantt";

const meta: Meta<typeof TasksGantt> = {
  title: "features/tasks/ui/tasks-gantt",
  component: TasksGantt,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

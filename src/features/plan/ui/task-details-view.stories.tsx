import type { Meta, StoryObj } from "@storybook/react";

import { TaskDetailsView } from "./task-details-view";

const meta: Meta<typeof TaskDetailsView> = {
  title: "features/plan/ui/task-details-view",
  component: TaskDetailsView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

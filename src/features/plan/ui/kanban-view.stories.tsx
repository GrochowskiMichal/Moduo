import type { Meta, StoryObj } from "@storybook/react";

import { KanbanView } from "./kanban-view";

const meta: Meta<typeof KanbanView> = {
  title: "features/plan/ui/kanban-view",
  component: KanbanView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

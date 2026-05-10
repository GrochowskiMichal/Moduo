import type { Meta, StoryObj } from "@storybook/react";

import { KanbanTaskContextModal } from "./kanban-task-context-modal";

const meta: Meta<typeof KanbanTaskContextModal> = {
  title: "features/plan/ui/kanban-task-context-modal",
  component: KanbanTaskContextModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

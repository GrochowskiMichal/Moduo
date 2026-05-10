import type { Meta, StoryObj } from "@storybook/react";

import { TodoListWidget } from "./todo-list-widget";

const meta: Meta<typeof TodoListWidget> = {
  title: "features/dashboard/ui/widgets/todo-list-widget",
  component: TodoListWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { PomodoroWidget } from "./pomodoro-widget";

const meta: Meta<typeof PomodoroWidget> = {
  title: "features/dashboard/ui/widgets/pomodoro-widget",
  component: PomodoroWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

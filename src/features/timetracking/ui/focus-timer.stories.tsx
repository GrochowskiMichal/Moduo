import type { Meta, StoryObj } from "@storybook/react";

import { FocusTimer } from "./focus-timer";

const meta: Meta<typeof FocusTimer> = {
  title: "features/timetracking/ui/focus-timer",
  component: FocusTimer,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { ClockWidget } from "./clock-widget";

const meta: Meta<typeof ClockWidget> = {
  title: "features/dashboard/ui/widgets/clock-widget",
  component: ClockWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

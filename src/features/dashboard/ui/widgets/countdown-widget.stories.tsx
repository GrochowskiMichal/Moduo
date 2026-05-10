import type { Meta, StoryObj } from "@storybook/react";

import { CountdownWidget } from "./countdown-widget";

const meta: Meta<typeof CountdownWidget> = {
  title: "features/dashboard/ui/widgets/countdown-widget",
  component: CountdownWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

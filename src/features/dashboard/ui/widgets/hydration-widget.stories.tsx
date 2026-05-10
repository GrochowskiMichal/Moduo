import type { Meta, StoryObj } from "@storybook/react";

import { HydrationWidget } from "./hydration-widget";

const meta: Meta<typeof HydrationWidget> = {
  title: "features/dashboard/ui/widgets/hydration-widget",
  component: HydrationWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

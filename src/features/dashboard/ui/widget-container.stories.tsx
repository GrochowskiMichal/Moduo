import type { Meta, StoryObj } from "@storybook/react";

import { WidgetContainer } from "./widget-container";

const meta: Meta<typeof WidgetContainer> = {
  title: "features/dashboard/ui/widget-container",
  component: WidgetContainer,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

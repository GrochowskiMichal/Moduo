import type { Meta, StoryObj } from "@storybook/react";

import { WidgetsPanel } from "./widgets-panel";

const meta: Meta<typeof WidgetsPanel> = {
  title: "features/dashboard/ui/widgets-panel",
  component: WidgetsPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { GridWorkspace } from "./grid-workspace";

const meta: Meta<typeof GridWorkspace> = {
  title: "features/dashboard/ui/grid-workspace",
  component: GridWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

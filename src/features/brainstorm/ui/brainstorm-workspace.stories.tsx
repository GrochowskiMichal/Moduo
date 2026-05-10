import type { Meta, StoryObj } from "@storybook/react";

import { BrainstormWorkspace } from "./brainstorm-workspace";

const meta: Meta<typeof BrainstormWorkspace> = {
  title: "features/brainstorm/ui/brainstorm-workspace",
  component: BrainstormWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

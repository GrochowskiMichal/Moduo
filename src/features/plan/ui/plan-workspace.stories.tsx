import type { Meta, StoryObj } from "@storybook/react";

import { PlanWorkspace } from "./plan-workspace";

const meta: Meta<typeof PlanWorkspace> = {
  title: "features/plan/ui/plan-workspace",
  component: PlanWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

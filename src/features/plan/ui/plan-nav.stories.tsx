import type { Meta, StoryObj } from "@storybook/react";

import { PlanNav } from "./plan-nav";

const meta: Meta<typeof PlanNav> = {
  title: "features/plan/ui/plan-nav",
  component: PlanNav,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

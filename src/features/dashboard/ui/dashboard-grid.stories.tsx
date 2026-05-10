import type { Meta, StoryObj } from "@storybook/react";

import { DashboardGrid } from "./dashboard-grid";

const meta: Meta<typeof DashboardGrid> = {
  title: "features/dashboard/ui/dashboard-grid",
  component: DashboardGrid,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

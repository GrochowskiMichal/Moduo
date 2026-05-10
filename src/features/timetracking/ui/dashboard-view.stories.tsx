import type { Meta, StoryObj } from "@storybook/react";

import { DashboardView } from "./dashboard-view";

const meta: Meta<typeof DashboardView> = {
  title: "features/timetracking/ui/dashboard-view",
  component: DashboardView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

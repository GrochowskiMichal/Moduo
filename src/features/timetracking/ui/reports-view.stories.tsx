import type { Meta, StoryObj } from "@storybook/react";

import { ReportsView } from "./reports-view";

const meta: Meta<typeof ReportsView> = {
  title: "features/timetracking/ui/reports-view",
  component: ReportsView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

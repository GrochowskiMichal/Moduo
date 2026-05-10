import type { Meta, StoryObj } from "@storybook/react";

import { JobTrackerWidget } from "./job-tracker-widget";

const meta: Meta<typeof JobTrackerWidget> = {
  title: "features/dashboard/ui/widgets/job-tracker-widget",
  component: JobTrackerWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

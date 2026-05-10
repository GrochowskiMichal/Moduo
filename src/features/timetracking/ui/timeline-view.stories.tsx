import type { Meta, StoryObj } from "@storybook/react";

import { TimelineView } from "./timeline-view";

const meta: Meta<typeof TimelineView> = {
  title: "features/timetracking/ui/timeline-view",
  component: TimelineView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

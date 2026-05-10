import type { Meta, StoryObj } from "@storybook/react";

import { TimetrackingNav } from "./timetracking-nav";

const meta: Meta<typeof TimetrackingNav> = {
  title: "features/timetracking/ui/timetracking-nav",
  component: TimetrackingNav,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

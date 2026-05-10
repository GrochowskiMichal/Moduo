import type { Meta, StoryObj } from "@storybook/react";

import { ProjectsView } from "./projects-view";

const meta: Meta<typeof ProjectsView> = {
  title: "features/timetracking/ui/projects-view",
  component: ProjectsView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

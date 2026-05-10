import type { Meta, StoryObj } from "@storybook/react";

import { ProjectSettingsNav } from "./project-settings-panel";

const meta: Meta<typeof ProjectSettingsNav> = {
  title: "features/plan/ui/project-settings-panel",
  component: ProjectSettingsNav,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

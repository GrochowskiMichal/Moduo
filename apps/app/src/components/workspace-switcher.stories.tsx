import type { Meta, StoryObj } from "@storybook/react";

import { WorkspaceSwitcher } from "./workspace-switcher";

const meta: Meta<typeof WorkspaceSwitcher> = {
  title: "Components/workspace-switcher",
  component: WorkspaceSwitcher,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

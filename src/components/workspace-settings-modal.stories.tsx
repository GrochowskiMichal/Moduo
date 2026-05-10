import type { Meta, StoryObj } from "@storybook/react";

import { WorkspaceSettingsModal } from "./workspace-settings-modal";

const meta: Meta<typeof WorkspaceSettingsModal> = {
  title: "Components/workspace-settings-modal",
  component: WorkspaceSettingsModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

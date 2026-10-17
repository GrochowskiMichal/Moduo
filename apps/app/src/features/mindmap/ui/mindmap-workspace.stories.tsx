import type { Meta, StoryObj } from "@storybook/react";

import { MindmapWorkspace } from "./mindmap-workspace";

const meta: Meta<typeof MindmapWorkspace> = {
  title: "features/mindmap/ui/mindmap-workspace",
  component: MindmapWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { MindmapCustomNode } from "./custom-node";

const meta: Meta<typeof MindmapCustomNode> = {
  title: "features/mindmap/ui/custom-node",
  component: MindmapCustomNode,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

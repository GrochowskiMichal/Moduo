import type { Meta, StoryObj } from "@storybook/react";

import { MindmapMiniMap } from "./mindmap-mini-map";

const meta: Meta<typeof MindmapMiniMap> = {
  title: "features/mindmap/ui/components/mindmap-mini-map",
  component: MindmapMiniMap,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

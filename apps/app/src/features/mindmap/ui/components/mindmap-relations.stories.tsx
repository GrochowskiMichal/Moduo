import type { Meta, StoryObj } from "@storybook/react";

import { MindmapRelations } from "./mindmap-relations";

const meta: Meta<typeof MindmapRelations> = {
  title: "features/mindmap/ui/components/mindmap-relations",
  component: MindmapRelations,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

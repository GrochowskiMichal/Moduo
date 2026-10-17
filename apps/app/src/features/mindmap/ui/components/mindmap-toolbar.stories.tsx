import type { Meta, StoryObj } from "@storybook/react";

import { MindmapToolbar } from "./mindmap-toolbar";

const meta: Meta<typeof MindmapToolbar> = {
  title: "features/mindmap/ui/components/mindmap-toolbar",
  component: MindmapToolbar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

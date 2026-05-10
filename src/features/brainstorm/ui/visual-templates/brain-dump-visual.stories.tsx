import type { Meta, StoryObj } from "@storybook/react";

import { BrainDumpVisual } from "./brain-dump-visual";

const meta: Meta<typeof BrainDumpVisual> = {
  title: "features/brainstorm/ui/visual-templates/brain-dump-visual",
  component: BrainDumpVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

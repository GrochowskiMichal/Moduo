import type { Meta, StoryObj } from "@storybook/react";

import { AffinityDiagramVisual } from "./affinity-diagram-visual";

const meta: Meta<typeof AffinityDiagramVisual> = {
  title: "features/brainstorm/ui/visual-templates/affinity-diagram-visual",
  component: AffinityDiagramVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

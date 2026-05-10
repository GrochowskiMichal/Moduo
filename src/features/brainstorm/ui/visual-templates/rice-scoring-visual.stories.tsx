import type { Meta, StoryObj } from "@storybook/react";

import { RiceScoringVisual } from "./rice-scoring-visual";

const meta: Meta<typeof RiceScoringVisual> = {
  title: "features/brainstorm/ui/visual-templates/rice-scoring-visual",
  component: RiceScoringVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

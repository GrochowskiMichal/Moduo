import type { Meta, StoryObj } from "@storybook/react";

import { EisenhowerMatrixVisual } from "./eisenhower-matrix-visual";

const meta: Meta<typeof EisenhowerMatrixVisual> = {
  title: "features/brainstorm/ui/visual-templates/eisenhower-matrix-visual",
  component: EisenhowerMatrixVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

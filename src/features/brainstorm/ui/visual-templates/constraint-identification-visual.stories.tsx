import type { Meta, StoryObj } from "@storybook/react";

import { ConstraintIdentificationVisual } from "./constraint-identification-visual";

const meta: Meta<typeof ConstraintIdentificationVisual> = {
  title: "features/brainstorm/ui/visual-templates/constraint-identification-visual",
  component: ConstraintIdentificationVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { FiveWhysVisual } from "./five-whys-visual";

const meta: Meta<typeof FiveWhysVisual> = {
  title: "features/brainstorm/ui/visual-templates/five-whys-visual",
  component: FiveWhysVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

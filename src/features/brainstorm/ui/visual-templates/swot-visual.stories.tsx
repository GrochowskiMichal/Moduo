import type { Meta, StoryObj } from "@storybook/react";

import { SwotVisual } from "./swot-visual";

const meta: Meta<typeof SwotVisual> = {
  title: "features/brainstorm/ui/visual-templates/swot-visual",
  component: SwotVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { SixThinkingHatsVisual } from "./six-thinking-hats-visual";

const meta: Meta<typeof SixThinkingHatsVisual> = {
  title: "features/brainstorm/ui/visual-templates/six-thinking-hats-visual",
  component: SixThinkingHatsVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

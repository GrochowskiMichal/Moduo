import type { Meta, StoryObj } from "@storybook/react";

import { StarburstingVisual } from "./starbursting-visual";

const meta: Meta<typeof StarburstingVisual> = {
  title: "features/brainstorm/ui/visual-templates/starbursting-visual",
  component: StarburstingVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

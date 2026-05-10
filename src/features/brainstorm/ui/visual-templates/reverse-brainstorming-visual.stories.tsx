import type { Meta, StoryObj } from "@storybook/react";

import { ReverseBrainstormingVisual } from "./reverse-brainstorming-visual";

const meta: Meta<typeof ReverseBrainstormingVisual> = {
  title: "features/brainstorm/ui/visual-templates/reverse-brainstorming-visual",
  component: ReverseBrainstormingVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

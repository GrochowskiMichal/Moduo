import type { Meta, StoryObj } from "@storybook/react";

import { NgtVisual } from "./ngt-visual";

const meta: Meta<typeof NgtVisual> = {
  title: "features/brainstorm/ui/visual-templates/ngt-visual",
  component: NgtVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

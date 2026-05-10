import type { Meta, StoryObj } from "@storybook/react";

import { PortersFiveVisual } from "./porters-five-visual";

const meta: Meta<typeof PortersFiveVisual> = {
  title: "features/brainstorm/ui/visual-templates/porters-five-visual",
  component: PortersFiveVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

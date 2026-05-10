import type { Meta, StoryObj } from "@storybook/react";

import { BuyerPersonaVisual } from "./buyer-persona-visual";

const meta: Meta<typeof BuyerPersonaVisual> = {
  title: "features/brainstorm/ui/visual-templates/buyer-persona-visual",
  component: BuyerPersonaVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

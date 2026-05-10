import type { Meta, StoryObj } from "@storybook/react";

import { PestelVisual } from "./pestel-visual";

const meta: Meta<typeof PestelVisual> = {
  title: "features/brainstorm/ui/visual-templates/pestel-visual",
  component: PestelVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

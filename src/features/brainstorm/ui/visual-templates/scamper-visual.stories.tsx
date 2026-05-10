import type { Meta, StoryObj } from "@storybook/react";

import { ScamperVisual } from "./scamper-visual";

const meta: Meta<typeof ScamperVisual> = {
  title: "features/brainstorm/ui/visual-templates/scamper-visual",
  component: ScamperVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

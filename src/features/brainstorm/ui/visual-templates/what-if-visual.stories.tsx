import type { Meta, StoryObj } from "@storybook/react";

import { WhatIfVisual } from "./what-if-visual";

const meta: Meta<typeof WhatIfVisual> = {
  title: "features/brainstorm/ui/visual-templates/what-if-visual",
  component: WhatIfVisual,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

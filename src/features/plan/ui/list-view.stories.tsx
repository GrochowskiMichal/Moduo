import type { Meta, StoryObj } from "@storybook/react";

import { ListView } from "./list-view";

const meta: Meta<typeof ListView> = {
  title: "features/plan/ui/list-view",
  component: ListView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { Icon } from "./icon";

const meta: Meta<typeof Icon> = {
  title: "Components/ui/icon",
  component: Icon,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

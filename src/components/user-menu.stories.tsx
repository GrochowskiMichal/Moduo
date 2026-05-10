import type { Meta, StoryObj } from "@storybook/react";

import { UserMenu } from "./user-menu";

const meta: Meta<typeof UserMenu> = {
  title: "Components/user-menu",
  component: UserMenu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

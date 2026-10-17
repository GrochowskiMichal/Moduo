import type { Meta, StoryObj } from "@storybook/react";

import { NotificationCenter } from "./notification-center";

const meta: Meta<typeof NotificationCenter> = {
  title: "Components/notification-center",
  component: NotificationCenter,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

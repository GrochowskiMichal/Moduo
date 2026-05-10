import type { Meta, StoryObj } from "@storybook/react";

import { AppChrome } from "./app-chrome";

const meta: Meta<typeof AppChrome> = {
  title: "Components/app/app-chrome",
  component: AppChrome,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

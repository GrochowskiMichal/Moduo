import type { Meta, StoryObj } from "@storybook/react";

import { EmailAuthPanel } from "./email-auth-panel";

const meta: Meta<typeof EmailAuthPanel> = {
  title: "Components/auth/email-auth-panel",
  component: EmailAuthPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

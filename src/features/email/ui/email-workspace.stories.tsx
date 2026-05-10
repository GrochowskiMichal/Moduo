import type { Meta, StoryObj } from "@storybook/react";

import { EmailWorkspace } from "./email-workspace";

const meta: Meta<typeof EmailWorkspace> = {
  title: "features/email/ui/email-workspace",
  component: EmailWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

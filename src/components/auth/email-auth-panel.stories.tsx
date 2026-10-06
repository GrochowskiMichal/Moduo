import type { Meta, StoryObj } from "@storybook/react";

import { EmailAuthPanel } from "./email-auth-panel";

const meta: Meta<typeof EmailAuthPanel> = {
  title: "Components/auth/email-auth-panel",
  component: EmailAuthPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-screen items-center justify-center bg-background px-5 py-8">
        <div className="w-full max-w-[480px] rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

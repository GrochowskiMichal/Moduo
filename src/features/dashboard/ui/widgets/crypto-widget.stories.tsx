import type { Meta, StoryObj } from "@storybook/react";

import { CryptoWidget } from "./crypto-widget";

const meta: Meta<typeof CryptoWidget> = {
  title: "features/dashboard/ui/widgets/crypto-widget",
  component: CryptoWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { LinkView } from "./link-view";

const meta: Meta<typeof LinkView> = {
  title: "features/plan/ui/link-view",
  component: LinkView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

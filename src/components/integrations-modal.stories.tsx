import type { Meta, StoryObj } from "@storybook/react";

import { IntegrationsModal } from "./integrations-modal";

const meta: Meta<typeof IntegrationsModal> = {
  title: "Components/integrations-modal",
  component: IntegrationsModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

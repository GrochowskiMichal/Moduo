import type { Meta, StoryObj } from "@storybook/react";

import { TemplatesPreview } from "./templates-preview";

const meta: Meta<typeof TemplatesPreview> = {
  title: "features/templates/ui/templates-preview",
  component: TemplatesPreview,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

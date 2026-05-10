import type { Meta, StoryObj } from "@storybook/react";

import { TemplatesEditor } from "./templates-editor";

const meta: Meta<typeof TemplatesEditor> = {
  title: "features/templates/ui/templates-editor",
  component: TemplatesEditor,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

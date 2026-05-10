import type { Meta, StoryObj } from "@storybook/react";

import { TemplatesWorkspace } from "./templates-workspace";

const meta: Meta<typeof TemplatesWorkspace> = {
  title: "features/templates/ui/templates-workspace",
  component: TemplatesWorkspace,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { WidgetShellEditProvider } from "./widget-shell";

const meta: Meta<typeof WidgetShellEditProvider> = {
  title: "features/dashboard/ui/widgets/widget-shell",
  component: WidgetShellEditProvider,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

import type { Meta, StoryObj } from "@storybook/react";

import { StockWidget } from "./stock-widget";

const meta: Meta<typeof StockWidget> = {
  title: "features/dashboard/ui/widgets/stock-widget",
  component: StockWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

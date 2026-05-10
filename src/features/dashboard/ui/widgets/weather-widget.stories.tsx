import type { Meta, StoryObj } from "@storybook/react";

import { WeatherWidget } from "./weather-widget";

const meta: Meta<typeof WeatherWidget> = {
  title: "features/dashboard/ui/widgets/weather-widget",
  component: WeatherWidget,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

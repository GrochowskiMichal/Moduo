import type { Meta, StoryObj } from "@storybook/react";

import { FrameworkPoster } from "./framework-poster";

const meta: Meta<typeof FrameworkPoster> = {
  title: "features/brainstorm/ui/visual-templates/framework-poster",
  component: FrameworkPoster,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

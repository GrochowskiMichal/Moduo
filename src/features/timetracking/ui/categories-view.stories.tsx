import type { Meta, StoryObj } from "@storybook/react";

import { CategoriesView } from "./categories-view";

const meta: Meta<typeof CategoriesView> = {
  title: "features/timetracking/ui/categories-view",
  component: CategoriesView,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

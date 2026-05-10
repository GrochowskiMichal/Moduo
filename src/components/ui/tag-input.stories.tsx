import type { Meta, StoryObj } from "@storybook/react";

import { TagInput } from "./tag-input";

const meta: Meta<typeof TagInput> = {
  title: "Components/ui/tag-input",
  component: TagInput,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {},
};

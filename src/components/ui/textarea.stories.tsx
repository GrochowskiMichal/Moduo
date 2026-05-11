import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "./label";
import { Textarea } from "./textarea";

const meta: Meta<typeof Textarea> = {
  title: "Components/ui/textarea",
  component: Textarea,
  tags: ["autodocs"],
  args: {
    placeholder: "Write a note…",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="grid w-96 gap-2">
      <Label htmlFor="body">Body</Label>
      <Textarea id="body" rows={5} {...args} />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, value: "Cannot edit." },
};

export const Invalid: Story = {
  render: (args) => <Textarea {...args} aria-invalid="true" defaultValue="Too short." />,
};

import type { Meta, StoryObj } from "@storybook/react";

import { Input } from "./input";
import { Label } from "./label";

const meta: Meta<typeof Label> = {
  title: "Components/ui/label",
  component: Label,
  tags: ["autodocs"],
  args: {
    children: "Label",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Paired: Story = {
  render: () => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="display-name">Display name</Label>
      <Input id="display-name" placeholder="How you're shown" />
    </div>
  ),
};

export const Required: Story = {
  render: () => (
    <Label>
      Email
      <span aria-hidden className="text-destructive">
        *
      </span>
    </Label>
  ),
};

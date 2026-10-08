import type { Meta, StoryObj } from "@storybook/react";

import { Checkbox } from "./checkbox";
import { Label } from "./label";

const meta: Meta<typeof Checkbox> = {
  title: "Components/ui/checkbox",
  component: Checkbox,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="cb-personal" defaultChecked />
      <Label htmlFor="cb-personal">Personal</Label>
    </div>
  ),
};

export const Unchecked: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="cb-work" />
      <Label htmlFor="cb-work">Work</Label>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="cb-holidays" defaultChecked disabled />
      <Label htmlFor="cb-holidays">Holidays (read-only)</Label>
    </div>
  ),
};

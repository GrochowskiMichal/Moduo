import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "./label";
import { RadioGroup, RadioGroupItem } from "./radio-group";

const meta: Meta<typeof RadioGroup> = {
  title: "Components/ui/radio-group",
  component: RadioGroup,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="dark">
      <div className="flex items-center gap-2">
        <RadioGroupItem id="theme-dark" value="dark" />
        <Label htmlFor="theme-dark">Dark</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="theme-light" value="light" />
        <Label htmlFor="theme-light">Light</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="theme-system" value="system" />
        <Label htmlFor="theme-system">System</Label>
      </div>
    </RadioGroup>
  ),
};

export const Disabled: Story = {
  render: () => (
    <RadioGroup defaultValue="soft" disabled>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-sharp" value="sharp" />
        <Label htmlFor="r-sharp">Sharp</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-soft" value="soft" />
        <Label htmlFor="r-soft">Soft</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-round" value="round" />
        <Label htmlFor="r-round">Round</Label>
      </div>
    </RadioGroup>
  ),
};

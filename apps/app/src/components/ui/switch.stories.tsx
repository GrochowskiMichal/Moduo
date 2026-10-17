import type { Meta, StoryObj } from "@storybook/react";

import { Label } from "./label";
import { Switch } from "./switch";

const meta: Meta<typeof Switch> = {
  title: "Components/ui/switch",
  component: Switch,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Switch id="airplane" />
      <Label htmlFor="airplane">Airplane mode</Label>
    </div>
  ),
};

export const Checked: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Switch id="sync" defaultChecked />
      <Label htmlFor="sync">Sync enabled</Label>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2">
        <Switch size="sm" id="sw-sm" />
        <Label htmlFor="sw-sm">Small</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="sw-md" />
        <Label htmlFor="sw-md">Default</Label>
      </div>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Switch id="off-disabled" disabled />
        <Label htmlFor="off-disabled">Disabled (off)</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="on-disabled" defaultChecked disabled />
        <Label htmlFor="on-disabled">Disabled (on)</Label>
      </div>
    </div>
  ),
};

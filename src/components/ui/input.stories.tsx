import type { Meta, StoryObj } from "@storybook/react";

import { Input } from "./input";
import { Label } from "./label";

const meta: Meta<typeof Input> = {
  title: "Components/ui/input",
  component: Input,
  tags: ["autodocs"],
  args: {
    placeholder: "Enter text…",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" {...args} placeholder="you@example.com" />
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, value: "Disabled value" },
};

export const Invalid: Story = {
  render: (args) => <Input {...args} aria-invalid="true" defaultValue="not-an-email" />,
};

export const Types: Story = {
  render: () => (
    <div className="grid w-72 gap-3">
      <Input type="text" placeholder="Text" />
      <Input type="email" placeholder="Email" />
      <Input type="password" placeholder="Password" />
      <Input type="number" placeholder="Number" />
      <Input type="search" placeholder="Search" />
    </div>
  ),
};

/** FieldShell surface variants — filled (default), ghost (quiet inline-edit),
 *  bare (plain-text until focus). Hover/focus a ghost field to see the
 *  hairline + fill appear. */
export const Variants: Story = {
  render: () => (
    <div className="grid w-72 gap-3">
      <Input variant="filled" placeholder="Filled (default)" />
      <Input variant="ghost" placeholder="Ghost — hover/focus me" />
      <Input variant="bare" placeholder="Bare — plain until focus" />
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="grid w-72 gap-3">
      <Input size="md" placeholder="md — --ctrl-h" />
      <Input size="sm" placeholder="sm — --ctrl-h-sm" />
    </div>
  ),
};

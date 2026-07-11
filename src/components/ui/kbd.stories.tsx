import type { Meta, StoryObj } from "@storybook/react";

import { Kbd } from "./kbd";

const meta: Meta<typeof Kbd> = {
  title: "Components/ui/kbd",
  component: Kbd,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Kbd>⌘K</Kbd>,
};

export const Combo: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Kbd>⌘</Kbd>
      <Kbd>⇧</Kbd>
      <Kbd>N</Kbd>
    </div>
  ),
};

export const InlineHint: Story = {
  render: () => (
    <p className="text-sm text-muted-foreground">
      Press <Kbd>?</Kbd> to see every shortcut.
    </p>
  ),
};

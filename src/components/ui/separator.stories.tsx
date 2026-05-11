import type { Meta, StoryObj } from "@storybook/react";

import { Separator } from "./separator";

const meta: Meta<typeof Separator> = {
  title: "Components/ui/separator",
  component: Separator,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div className="w-72 space-y-2">
      <div className="text-sm font-medium text-foreground">Recent notes</div>
      <div className="text-xs text-muted-foreground">Updated just now</div>
      <Separator />
      <div className="text-xs text-muted-foreground">Press ⌘K for the palette.</div>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="flex h-6 items-center gap-3 text-xs text-muted-foreground">
      <span>Pinned</span>
      <Separator orientation="vertical" />
      <span>Updated 3m ago</span>
      <Separator orientation="vertical" />
      <span>2 tags</span>
    </div>
  ),
};

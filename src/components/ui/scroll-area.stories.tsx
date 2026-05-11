import type { Meta, StoryObj } from "@storybook/react";

import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";

const meta: Meta<typeof ScrollArea> = {
  title: "Components/ui/scroll-area",
  component: ScrollArea,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

const TAGS = Array.from({ length: 40 }).map((_, i) => `Tag ${i + 1}`);

export const Vertical: Story = {
  render: () => (
    <ScrollArea className="h-64 w-56 rounded-md border border-border bg-card p-4">
      <div className="text-sm font-medium text-foreground">Tags</div>
      <Separator className="my-2" />
      <ul className="space-y-1 text-sm text-foreground">
        {TAGS.map((t) => (
          <li key={t} className="text-muted-foreground">{t}</li>
        ))}
      </ul>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-96 rounded-md border border-border bg-card p-4">
      <div className="flex gap-3 pb-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground"
          >
            Card {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

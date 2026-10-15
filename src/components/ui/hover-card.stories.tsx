import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

const meta: Meta<typeof HoverCard> = {
  title: "Components/ui/hover-card",
  component: HoverCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link">Collect brand assets</Button>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-foreground">Collect brand assets from client</p>
          <p className="text-xs text-muted-foreground">MOD-142 · Acme rebrand › Design · Fri</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
};

/** Open on load, so the surface can be checked without hovering. */
export const Open: Story = {
  render: () => (
    <div className="p-10">
      <HoverCard defaultOpen>
        <HoverCardTrigger asChild>
          <Button variant="link">Anna Novak</Button>
        </HoverCardTrigger>
        <HoverCardContent>
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium text-foreground">Anna Novak</p>
            <p className="text-xs text-muted-foreground">Brand manager · Acme Inc.</p>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  ),
};

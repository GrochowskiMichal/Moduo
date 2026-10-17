import type { Meta, StoryObj } from "@storybook/react";
import { Bell, Plus, Search, Settings } from "lucide-react";

import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Components/ui/tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const IconButton: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="New note">
          <Plus />
        </Button>
      </TooltipTrigger>
      <TooltipContent>New note · ⌘N</TooltipContent>
    </Tooltip>
  ),
};

export const IconBar: Story = {
  render: () => (
    <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
      {[
        { icon: Plus, label: "New note", shortcut: "⌘N" },
        { icon: Search, label: "Search", shortcut: "⌘F" },
        { icon: Bell, label: "Notifications", shortcut: "⌘/" },
        { icon: Settings, label: "Settings", shortcut: "⌘," },
      ].map(({ icon: I, label, shortcut }) => (
        <Tooltip key={label}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={label}>
              <I />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {label} · {shortcut}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
};

export const Sides: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-12 p-12">
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger asChild>
            <Button variant="outline">{side}</Button>
          </TooltipTrigger>
          <TooltipContent side={side}>Tooltip on {side}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  ),
};

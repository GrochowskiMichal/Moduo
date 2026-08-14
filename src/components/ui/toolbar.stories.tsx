import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChevronLeft, ChevronRight, Columns3, List, Plus, SlidersHorizontal } from "lucide-react";

import { Toolbar } from "./toolbar";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { SegmentedControl } from "./segmented-control";
import { TooltipProvider } from "./tooltip";

const meta: Meta<typeof Toolbar> = {
  title: "Components/ui/toolbar",
  component: Toolbar,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="w-[640px]">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A Tasks-style control row: all children on the sm rung, one font + radius. */
export const Default: Story = {
  render: () => {
    const [view, setView] = useState("list");
    return (
      <Toolbar>
        <h1 className="truncate font-display text-lg text-foreground">Inbox</h1>
        <Toolbar.Spacer />
        <Toolbar.Group>
          <Button size="sm" variant="outline">
            <SlidersHorizontal aria-hidden />
            Filter
          </Button>
          <SegmentedControl
            aria-label="View"
            size="sm"
            value={view}
            onValueChange={setView}
            items={[
              { value: "list", label: "List", icon: List },
              { value: "board", label: "Board", icon: Columns3 },
            ]}
          />
        </Toolbar.Group>
        <Toolbar.Primary>
          <Button size="sm">
            <Plus aria-hidden />
            New task
          </Button>
        </Toolbar.Primary>
      </Toolbar>
    );
  },
};

/**
 * The `gap` axis (DF-18). A prev/next pair reads as one control (`tight`);
 * a 256px rail needs `snug` where the default would overflow. Pick a step —
 * a raw `gap-*` className override means the primitive enforces nothing.
 */
export const GapSteps: Story = {
  render: () => {
    const [view, setView] = useState("day");
    return (
      <div className="space-y-4">
        <Toolbar aria-label="Calendar controls">
          <Toolbar.Group gap="tight">
            <IconButton icon={ChevronLeft} label="Previous period" />
            <IconButton icon={ChevronRight} label="Next period" />
          </Toolbar.Group>
          <Button size="sm" variant="outline">
            Today
          </Button>
          <span className="font-display text-sm font-medium text-foreground">March 2026</span>
          <Toolbar.Spacer />
          <Toolbar.Group>
            <SegmentedControl
              aria-label="Calendar view"
              size="sm"
              value={view}
              onValueChange={setView}
              items={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
              ]}
            />
          </Toolbar.Group>
        </Toolbar>

        <div className="w-64 rounded-lg border border-border p-2">
          <Toolbar gap="snug" aria-label="Directory">
            <SegmentedControl
              aria-label="Filter directory"
              size="sm"
              value="people"
              onValueChange={() => {}}
              items={[
                { value: "people", label: "People 24" },
                { value: "companies", label: "Companies 6" },
              ]}
            />
            <Toolbar.Spacer />
            <Toolbar.Group gap="snug" className="shrink-0">
              <IconButton icon={Plus} label="New contact" />
            </Toolbar.Group>
          </Toolbar>
        </div>
      </div>
    );
  },
};

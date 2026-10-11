import type { Meta, StoryObj } from "@storybook/react";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  GanttChart,
  List,
  ListFilter,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { AtThreeDensities } from "./kit-densities";
import { SegmentedControl } from "./segmented-control";
import { Toolbar } from "./toolbar";
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

/**
 * The toolbar grammar every view copies (DS-6, tasks-v3 §19; visual audit §C):
 * `title + count … Search · Filter · Display | view switcher | one primary`.
 * One rung (`sm`, 26 px). Every control is a ghost button except the single
 * primary; Group by lives inside Display, never as its own select. The title
 * is a person's project name, shown as typed, with its count beside it.
 */
function ViewToolbar() {
  const [view, setView] = useState("list");
  return (
    <Toolbar aria-label="Website relaunch">
      <h1 className="flex min-w-0 items-baseline gap-2 font-display text-lg font-semibold text-foreground">
        <span className="truncate">Website relaunch</span>
        <span className="font-sans text-sm font-normal text-subtle-foreground tabular-nums">
          76
        </span>
      </h1>
      <Toolbar.Spacer />
      <Toolbar.Group>
        <Button size="sm" variant="ghost">
          <Search aria-hidden />
          Search
        </Button>
        <Button size="sm" variant="ghost">
          <ListFilter aria-hidden />
          Filter
        </Button>
        <Button size="sm" variant="ghost">
          <SlidersHorizontal aria-hidden />
          Display
        </Button>
        <SegmentedControl
          aria-label="View"
          size="sm"
          iconOnly
          value={view}
          onValueChange={setView}
          items={[
            { value: "list", label: "List", icon: List },
            { value: "board", label: "Board", icon: Columns3 },
            { value: "timeline", label: "Timeline", icon: GanttChart },
          ]}
        />
      </Toolbar.Group>
      <Toolbar.Primary>
        <Button size="sm">
          <Plus aria-hidden />
          New
        </Button>
      </Toolbar.Primary>
    </Toolbar>
  );
}

export const Default: Story = {
  render: () => <ViewToolbar />,
};

/** The same toolbar at the three density steps: the rung shrinks, the text holds. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities direction="column">
      <ViewToolbar />
    </AtThreeDensities>
  ),
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

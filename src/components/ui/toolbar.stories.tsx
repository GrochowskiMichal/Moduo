import type { Meta, StoryObj } from "@storybook/react";
import { Columns3, List, Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";
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

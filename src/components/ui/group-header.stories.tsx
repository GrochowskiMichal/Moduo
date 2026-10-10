import type { Meta, StoryObj } from "@storybook/react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";

import { TeamMark } from "./avatar";
import { GroupHeader } from "./group-header";
import { IconButton } from "./icon-button";
import { AtThreeDensities } from "./kit-densities";
import { TooltipProvider } from "./tooltip";

const meta: Meta<typeof GroupHeader> = {
  title: "Components/ui/group-header",
  component: GroupHeader,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="w-[480px]">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const actions = (
  <>
    <IconButton icon={Plus} label="Add a task to this group" />
    <IconButton icon={MoreHorizontal} label="Group options" />
  </>
);

/**
 * One header for every grouping. Names appear exactly as typed ("iOS app",
 * "Q3 launch", "design system"): sentence case, never small caps (call 40).
 * Hover shows the actions in their reserved slot.
 */
export const Default: Story = {
  render: () => {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <div className="flex flex-col gap-1">
        <GroupHeader
          label="iOS app"
          count={12}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          actions={actions}
        />
        <GroupHeader label="Today" sub="· Mon, Oct 12" count={2} onToggle={() => {}} />
        <GroupHeader label="Discovery" count="3/3" onToggle={() => {}} collapsed />
        <GroupHeader
          label="For Design"
          leading={<TeamMark name="Design" />}
          sub="· 2 unclaimed"
          onToggle={() => {}}
        />
        <GroupHeader label="design system" count={4} />
      </div>
    );
  },
};

/** Sticky inside a scroller: the header stays while its rows pass under it. */
export const Sticky: Story = {
  render: () => (
    <div className="h-48 overflow-auto rounded-lg border border-hairline bg-background">
      {["Backlog", "In review", "Done"].map((name) => (
        <section key={name}>
          <GroupHeader label={name} count={6} sticky onToggle={() => {}} />
          {Array.from({ length: 6 }, (_, i) => (
            <p key={i} className="flex h-(--row-h) items-center px-3 text-md text-foreground">
              {name} item {i + 1}
            </p>
          ))}
        </section>
      ))}
    </div>
  ),
};

/** Height follows density: 28 / 26 / 24 px. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities direction="column">
      <div className="flex flex-col gap-1">
        <GroupHeader label="iOS app" count={12} onToggle={() => {}} actions={actions} />
        <GroupHeader label="Today" sub="· Mon, Oct 12" count={2} onToggle={() => {}} />
      </div>
    </AtThreeDensities>
  ),
};

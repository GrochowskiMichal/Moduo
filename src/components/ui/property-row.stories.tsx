import type { Meta, StoryObj } from "@storybook/react";
import { CalendarDays, Flag, Inbox, Tag } from "lucide-react";

import { PropertyRow } from "./property-row";
import { Badge } from "./badge";

const meta: Meta<typeof PropertyRow> = {
  title: "Components/ui/property-row",
  component: PropertyRow,
  decorators: [
    (Story) => (
      <div className="w-80 rounded-lg border border-border bg-card p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Scalar properties stack into an aligned label-left / value-right grid. */
export const Grid: Story = {
  render: () => (
    <div className="space-y-1">
      <PropertyRow label="Status">
        <span className="text-sm text-foreground">In progress</span>
      </PropertyRow>
      <PropertyRow label="Bucket" icon={Inbox}>
        <span className="text-sm text-foreground">Inbox</span>
      </PropertyRow>
      <PropertyRow label="Due" icon={CalendarDays}>
        <span className="text-sm text-foreground">Tomorrow</span>
      </PropertyRow>
      <PropertyRow label="Priority" icon={Flag}>
        <span className="text-sm text-muted-foreground">—</span>
      </PropertyRow>
    </div>
  ),
};

/** Multi-line / wrapping values top-align with `align="start"`. */
export const MultiLineValue: Story = {
  render: () => (
    <PropertyRow label="Tags" icon={Tag} align="start">
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">design</Badge>
        <Badge variant="secondary">urgent</Badge>
        <Badge variant="secondary">q3-roadmap</Badge>
      </div>
    </PropertyRow>
  ),
};

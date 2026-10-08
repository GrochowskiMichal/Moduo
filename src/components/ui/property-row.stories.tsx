import type { Meta, StoryObj } from "@storybook/react";
import { CalendarDays, Circle, Clock, Flag, Plus } from "lucide-react";
import { Badge } from "./badge";
import { PropertyRow, PropertyValue } from "./property-row";

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

/**
 * The detail-panel grid (tasks-v2 §9): every value starts at the same x behind
 * a 14px icon slot, no chevrons, hover shows the field, placeholders muted.
 */
export const Grid: Story = {
  render: () => (
    <div className="space-y-px">
      <PropertyRow label="Status">
        <PropertyValue icon={<Circle />}>Todo</PropertyValue>
      </PropertyRow>
      <PropertyRow label="Priority">
        <PropertyValue icon={<Flag />} empty>
          Set priority
        </PropertyValue>
      </PropertyRow>
      <PropertyRow label="Due">
        <PropertyValue icon={<CalendarDays />}>Thu, Oct 9</PropertyValue>
      </PropertyRow>
      <PropertyRow label="Scheduled">
        <PropertyValue icon={<Clock />} disabled>
          Oct 9, 09:00 (view only)
        </PropertyValue>
      </PropertyRow>
    </div>
  ),
};

/** A value with trailing content (the Time row's hairline bar). */
export const WithTrailing: Story = {
  render: () => (
    <PropertyRow label="Time">
      <PropertyValue
        icon={<Clock />}
        trailing={
          <span className="h-0.5 w-14 shrink-0 overflow-hidden rounded-full bg-hairline">
            <span className="block h-full w-1/3 bg-muted-foreground" />
          </span>
        }
      >
        1h 20m <span className="text-muted-foreground">of ~4h</span>
      </PropertyValue>
    </PropertyRow>
  ),
};

/** Multi-line / wrapping values top-align with `align="start"`. */
export const MultiLineValue: Story = {
  render: () => (
    <PropertyRow label="Tags" align="start">
      <div className="flex flex-wrap items-center gap-1.5 py-1">
        <Badge variant="secondary">design</Badge>
        <Badge variant="secondary">urgent</Badge>
        <Badge variant="secondary">q3-roadmap</Badge>
        <PropertyValue icon={<Plus />} aria-label="Add tag" />
      </div>
    </PropertyRow>
  ),
};

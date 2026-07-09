import type { Meta, StoryObj } from "@storybook/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { WidgetInstance } from "../engine/types";
import { WidgetFrame } from "./widget-frame";

// DB-3 edit-mode frame (AC4): the remove ✕ + size popover revealed in edit mode.
// The body is a placeholder until DB-5 mounts the registry widget. Visual capture
// is a deliberate human run (gotchas: Storybook render is blocked in worktrees).

function widget(overrides: Partial<WidgetInstance> = {}): WidgetInstance {
  return { id: "w1", type: "tasks", size: "M", x: 0, y: 0, config: {}, ...overrides };
}

const meta: Meta<typeof WidgetFrame> = {
  title: "Features/dashboard/widget-frame",
  component: WidgetFrame,
  decorators: [
    (Story) => (
      <TooltipProvider>
        {/* Sized like an M cell (4×2) at a comfortable window. */}
        <div style={{ width: 380, height: 190 }}>
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  args: {
    widget: widget(),
    onRemove: () => {},
    onResize: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Normal mode — pure card, no arrange affordances. */
export const Default: Story = {
  args: { editing: false },
};

/** Edit mode — remove ✕ + resize popover appear top-right. */
export const Editing: Story = {
  args: { editing: true },
};

/** Edit mode on the smallest (S 2×2) footprint — the controls must still fit. */
export const EditingSmall: Story = {
  args: { editing: true, widget: widget({ type: "clock", size: "S" }) },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div style={{ width: 190, height: 190 }}>
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

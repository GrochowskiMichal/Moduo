import type { Meta, StoryObj } from "@storybook/react";

import { TaskBlockChip } from "./task-block-chip";

// Chip-state baselines for the calendar grid (specs/calendar.md AC2). Visual
// captures are a deliberate human run (gotchas: Storybook render is blocked in
// the worktree; visual diffs are stop-and-ask). Event/external/elapsed chip
// states join with CAL-2/CAL-4.
const START = new Date(2026, 6, 2, 9, 0).getTime();
const END = START + 45 * 60_000;

const meta = {
  title: "Calendar/TaskBlockChip",
  component: TaskBlockChip,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 180, height: 56 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Write the offer draft",
    startMs: START,
    endMs: END,
    done: false,
    compact: false,
    canEdit: true,
    onToggleDone: () => {},
  },
} satisfies Meta<typeof TaskBlockChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Done: Story = {
  args: { done: true },
};

export const Compact: Story = {
  args: { compact: true },
  decorators: [
    (Story) => (
      <div style={{ width: 180, height: 22 }}>
        <Story />
      </div>
    ),
  ],
};

export const ViewOnly: Story = {
  args: { canEdit: false },
};

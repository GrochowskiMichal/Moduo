import type { Meta, StoryObj } from "@storybook/react";

import { EntityRefChip } from "./entity-ref-chip";

// Visual baselines for `tests/visual/spine.spec.ts · "entity-ref-chip — task /
// contact / note"` are a deliberate human capture (gotchas: Storybook render is
// blocked in the worktree; visual diffs are stop-and-ask). These stories make
// the states snapshot-ready.
const meta = {
  title: "Spine/EntityRefChip",
  component: EntityRefChip,
  parameters: { layout: "centered" },
} satisfies Meta<typeof EntityRefChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Task: Story = {
  args: { type: "task", label: "Ship Q3 landing page" },
};

export const Contact: Story = {
  args: { type: "contact", label: "Acme Corp" },
};

export const Note: Story = {
  args: { type: "note", label: "Kickoff call notes" },
};

export const Linkable: Story = {
  args: { type: "task", label: "Ship Q3 landing page", onClick: () => {} },
};

export const Removable: Story = {
  args: { type: "contact", label: "Acme Corp", onRemove: () => {} },
};

export const Tombstoned: Story = {
  args: { type: "note", label: "Deleted note", tombstoned: true },
};

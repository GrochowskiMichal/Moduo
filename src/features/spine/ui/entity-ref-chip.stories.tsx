import type { Meta, StoryObj } from "@storybook/react";

import { EntityRefChip } from "./entity-ref-chip";

const meta: Meta<typeof EntityRefChip> = {
  title: "Spine/EntityRefChip",
  component: EntityRefChip,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Task: Story = {
  args: { entityType: "task", label: "Ship CT-4 resolver" },
};

export const Contact: Story = {
  args: { entityType: "contact", label: "Ada Lovelace" },
};

export const Note: Story = {
  args: { entityType: "note", label: "Spine architecture notes" },
};

export const Removable: Story = {
  args: { entityType: "task", label: "Ship CT-4 resolver", onRemove: () => {} },
};

export const Tombstoned: Story = {
  args: { entityType: "contact", label: "Ada Lovelace", tombstoned: true, onRemove: () => {} },
};

/** Inline in prose: the chip sits on the text baseline among words. */
export const InProse: Story = {
  render: () => (
    <p className="max-w-prose text-sm leading-relaxed text-foreground">
      Following up with{" "}
      <EntityRefChip entityType="contact" label="Ada Lovelace" onClick={() => {}} /> on{" "}
      <EntityRefChip entityType="task" label="Ship CT-4 resolver" onClick={() => {}} /> — see{" "}
      <EntityRefChip entityType="note" label="Spine architecture notes" onClick={() => {}} /> for
      context.
    </p>
  ),
};

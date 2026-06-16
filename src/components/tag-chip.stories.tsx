import type { Meta, StoryObj } from "@storybook/react";

import { TagChip, TagChipList } from "./tag-chip";
import { LABEL_COLORS } from "./tag-colors";

const meta: Meta<typeof TagChip> = {
  title: "Components/tag-chip",
  component: TagChip,
};

export default meta;
type Story = StoryObj<typeof meta>;

/** v2: the "#" carries the hue, the name stays neutral. Borderless, no dot. */
export const Default: Story = {
  args: { name: "deep-work", color: "blue" },
};

export const AllHues: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {LABEL_COLORS.map((c) => (
        <TagChip key={c} name={c} color={c} />
      ))}
    </div>
  ),
};

/** Active filter chip — fully hued (# + name). */
export const Active: Story = {
  args: { name: "waiting-on", color: "green", active: true },
};

export const Removable: Story = {
  args: { name: "deep-work", color: "violet", onRemove: () => {} },
};

export const Clickable: Story = {
  args: { name: "deep-work", color: "amber", onClick: () => {} },
};

export const InAList: Story = {
  render: () => (
    <TagChipList
      tags={[
        { id: "1", name: "deep-work", color: "blue" },
        { id: "2", name: "waiting-on", color: "green" },
        { id: "3", name: "errand", color: "amber" },
        { id: "4", name: "someday", color: "violet" },
        { id: "5", name: "extra", color: "red" },
      ]}
      max={3}
    />
  ),
};

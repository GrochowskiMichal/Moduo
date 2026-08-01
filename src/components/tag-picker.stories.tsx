import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { TagChip } from "./tag-chip";
import { LABEL_COLORS, pickTagColor } from "./tag-colors";
import { type PickableTag, TagPicker } from "./tag-picker";

const meta: Meta<typeof TagPicker> = {
  title: "Components/tag-picker",
  component: TagPicker,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;

const SEED: PickableTag[] = [
  { id: "1", name: "deep-work", color: "blue" },
  { id: "2", name: "errand", color: "amber" },
  { id: "3", name: "waiting-on", color: "violet" },
  { id: "4", name: "quick-win", color: "green" },
];

/** Every label hue, as the quiet inline chip used on rows/cards/detail. */
export const Chips: Story = {
  render: () => (
    <div className="flex max-w-sm flex-wrap gap-1.5">
      {LABEL_COLORS.map((c) => (
        <TagChip key={c} name={c} color={c} />
      ))}
    </div>
  ),
};

/** Removable (detail panel) and active (filter) variants. */
export const ChipStates: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <TagChip name="deep-work" color="blue" onRemove={() => {}} />
      <TagChip name="errand" color="amber" active onRemove={() => {}} />
      <TagChip name="waiting-on" color="violet" onClick={() => {}} />
    </div>
  ),
};

/** Interactive: create (auto-color), toggle, recolor, delete. */
export const Interactive: Story = {
  render: () => {
    const [tags, setTags] = useState<PickableTag[]>(SEED);
    const [selected, setSelected] = useState<string[]>(["1"]);
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="flex flex-wrap gap-1.5">
          {selected
            .map((id) => tags.find((t) => t.id === id))
            .filter((t): t is PickableTag => !!t)
            .map((t) => (
              <TagChip
                key={t.id}
                name={t.name}
                color={t.color}
                onRemove={() => setSelected((s) => s.filter((x) => x !== t.id))}
              />
            ))}
        </div>
        <TagPicker
          tags={tags}
          selectedIds={selected}
          canEdit
          onToggle={(id) =>
            setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
          }
          onCreate={(name) => {
            const id = String(tags.length + 1);
            setTags((prev) => [...prev, { id, name, color: pickTagColor(prev) }]);
            setSelected((s) => [...s, id]);
          }}
          onRecolor={(id, color) =>
            setTags((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)))
          }
          onDelete={(id) => {
            setTags((prev) => prev.filter((t) => t.id !== id));
            setSelected((s) => s.filter((x) => x !== id));
          }}
        />
      </div>
    );
  },
};

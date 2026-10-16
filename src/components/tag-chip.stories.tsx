import type { Meta, StoryObj } from "@storybook/react";

import { TagChip, TagChipList } from "./tag-chip";
import { LABEL_COLORS } from "./tag-colors";

const meta: Meta<typeof TagChip> = {
  title: "Components/tag-chip",
  component: TagChip,
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The dot chip (MOD-97, option C): a neutral pill, the hue's dot, the name. No "#". */
export const Default: Story = {
  args: { name: "deep-work", color: "blue" },
};

/** Every label hue at `sm` (rows and cards). The pill stays neutral; the dot carries the hue. */
export const AllHues: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-1.5">
      {LABEL_COLORS.map((c) => (
        <TagChip key={c} name={c} color={c} />
      ))}
    </div>
  ),
};

/** `sm` 18 px · 12 px text (rows, cards) and `md` 22 px · 13 px text (details panel). */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["sm", "md"] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-1.5">
          <span className="w-8 font-sans text-xs text-muted-foreground">{size}</span>
          {LABEL_COLORS.map((c) => (
            <TagChip key={c} name={c} color={c} size={size} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** The details panel's chips end with a small muted × (24 px hit area). */
export const Removable: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {LABEL_COLORS.map((c) => (
          <TagChip key={c} name={c} color={c} size="md" onRemove={() => {}} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {LABEL_COLORS.map((c) => (
          <TagChip key={c} name={c} color={c} onRemove={() => {}} />
        ))}
      </div>
    </div>
  ),
};

/** An active filter chip: a 1 px inset ring in the hue, the name in full foreground. */
export const Active: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {LABEL_COLORS.map((c) => (
          <TagChip key={c} name={c} color={c} active />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {LABEL_COLORS.map((c) => (
          <TagChip key={c} name={c} color={c} size="md" active onRemove={() => {}} />
        ))}
      </div>
    </div>
  ),
};

export const Clickable: Story = {
  args: { name: "deep-work", color: "amber", onClick: () => {} },
};

/** Detailed rows show two, Board cards three, then "+n" (its hover text names the rest). */
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

/** The same chips in both themes, side by side (the toolbar's theme is ignored here). */
export const BothThemes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(["dark", "light"] as const).map((theme) => (
        <section
          key={theme}
          data-theme={theme}
          aria-label={theme === "dark" ? "Dark" : "Light"}
          className="flex flex-col gap-3 rounded-lg bg-background p-4 text-foreground"
        >
          <p className="font-sans text-xs text-muted-foreground">
            {theme === "dark" ? "Dark" : "Light"}
          </p>
          <div className="flex max-w-sm flex-wrap items-center gap-1.5">
            {LABEL_COLORS.map((c) => (
              <TagChip key={c} name={c} color={c} />
            ))}
          </div>
          <div className="flex max-w-sm flex-wrap items-center gap-1.5">
            <TagChip name="website" color="blue" size="md" onRemove={() => {}} />
            <TagChip name="visual" color="violet" size="md" onRemove={() => {}} />
            <TagChip name="tasks" color="green" active />
          </div>
        </section>
      ))}
    </div>
  ),
};

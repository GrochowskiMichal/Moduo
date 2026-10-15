import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { AtThreeDensities } from "./kit-densities";
import { QuickReactionRow, ReactionButton, type ReactionItem, Reactions } from "./reactions";

const meta: Meta<typeof Reactions> = {
  title: "Components/ui/reactions",
  component: Reactions,
};

export default meta;
type Story = StoryObj<typeof meta>;

const SIX = ["👍", "✅", "👀", "🙏", "❤️", "😄"];
const NAMES: Record<string, string> = {
  "👍": "Thumbs up",
  "✅": "Done",
  "👀": "Looking",
  "🙏": "Thanks",
  "❤️": "Love",
  "😄": "Smile",
};
const labelOf = (key: string) => NAMES[key] ?? key;

const START: ReactionItem[] = [
  { key: "👍", count: 3, mine: true, label: "Thumbs up", who: "You, Mike and Anna" },
  { key: "🎉", count: 1, mine: false, label: "🎉", who: "Anna" },
  { key: "👀", count: 2, mine: false, label: "Looking", who: "Mike and Anna" },
];

function useToggle(start: ReactionItem[]) {
  const [items, setItems] = useState(start);
  const toggle = (key: string, on: boolean) =>
    setItems((list) => {
      const at = list.find((r) => r.key === key);
      if (!at)
        return on
          ? [...list, { key, count: 1, mine: true, label: labelOf(key), who: "You" }]
          : list;
      const count = at.count + (on ? 1 : -1);
      return count <= 0
        ? list.filter((r) => r.key !== key)
        : list.map((r) => (r.key === key ? { ...r, count, mine: on } : r));
    });
  return [items, toggle] as const;
}

/** Chips under a message or comment, with the ☺ button that opens your row. */
export const Default: Story = {
  render: () => {
    const [items, toggle] = useToggle(START);
    const mine = new Set(items.filter((r) => r.mine).map((r) => r.key));
    return (
      <Reactions
        items={items}
        onToggle={toggle}
        trailing={
          <ReactionButton
            keys={SIX}
            mine={mine}
            labelOf={labelOf}
            onPick={toggle}
            onCustomize={() => {}}
          />
        }
      />
    );
  },
};

/** Your quick row: six, "Customize…", and "Any emoji" once the picker exists. */
export const QuickRow: Story = {
  render: () => (
    <QuickReactionRow
      keys={["🎉", "👍", "🔥", "✅", "👀", "🙏"]}
      mine={new Set(["👍"])}
      labelOf={labelOf}
      onPick={() => {}}
      onCustomize={() => {}}
      onAnyEmoji={() => {}}
    />
  ),
};

/** Read-only: nobody may react here, the chips still say who did. */
export const ReadOnly: Story = {
  render: () => <Reactions items={START} disabled />,
};

/** The kit check (AC14.2): the chips and the quick row at the three densities. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      {() => (
        <div className="flex flex-col items-start gap-3">
          <Reactions items={START} onToggle={() => {}} />
          <QuickReactionRow
            keys={SIX}
            mine={new Set(["👍"])}
            labelOf={labelOf}
            onPick={() => {}}
            onCustomize={() => {}}
          />
        </div>
      )}
    </AtThreeDensities>
  ),
};

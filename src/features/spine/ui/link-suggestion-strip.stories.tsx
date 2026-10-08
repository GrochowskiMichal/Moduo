import type { Meta, StoryObj } from "@storybook/react";

import type { LinkSuggestion } from "../suggest";
import { LinkSuggestionStrip } from "./link-suggestion-strip";

function suggestion(over: Partial<LinkSuggestion> = {}): LinkSuggestion {
  return {
    other: { type: "company", id: "co1" },
    label: "Acme Corp",
    icon: null,
    signals: ["email-domain"],
    suggestedKind: "works-at",
    score: 60,
    ...over,
  };
}

const meta: Meta<typeof LinkSuggestionStrip> = {
  title: "Spine/LinkSuggestionStrip",
  component: LinkSuggestionStrip,
  decorators: [
    (Story) => (
      <div className="w-96 rounded-lg border border-border bg-card p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Email-domain match → a quiet "works at" suggestion. The Link button is the one accent. */
export const EmailDomain: Story = {
  args: { suggestion: suggestion() },
};

/** Shared tags — the strongest affinity signal; suggested as a plain reference. */
export const SharedTags: Story = {
  args: {
    suggestion: suggestion({
      other: { type: "note", id: "n1" },
      label: "Account plan",
      signals: ["shared-tag"],
      suggestedKind: "references",
      score: 200,
    }),
  },
};

/** ±Time-window co-activity — the weakest signal, shown only when nothing stronger exists. */
export const TimeWindow: Story = {
  args: {
    suggestion: suggestion({
      other: { type: "task", id: "t1" },
      label: "Ship the launch page",
      signals: ["time-window"],
      suggestedKind: "references",
      score: 10,
    }),
  },
};

/** In-flight (accept/dismiss pending) — both actions disabled. */
export const Busy: Story = {
  args: { suggestion: suggestion(), busy: true },
};

/** Nothing at rest — the strip renders nothing (no empty box). */
export const Empty: Story = {
  args: { suggestion: null },
};

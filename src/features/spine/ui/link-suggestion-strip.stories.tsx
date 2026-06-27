import type { Meta, StoryObj } from "@storybook/react";

import type { EntityRef } from "@/lib/entity-links";
import { buildSuggestions, type LinkSuggestion } from "../suggest";
import { LinkSuggestionStrip } from "./link-suggestion-strip";

// Visual baselines for `tests/visual/spine.spec.ts · "link-suggestion-strip"`
// are a deliberate human capture (gotchas: Storybook render is blocked in the
// worktree; visual diffs are stop-and-ask). These stories make the states
// snapshot-ready. Suggestions are built through the real scorer so the reason
// text + ranking match production.
const focus: EntityRef = { type: "contact", id: "focus-1" };

function suggest(over: Partial<Parameters<typeof buildSuggestions>[1][number]>): LinkSuggestion {
  return buildSuggestions(focus, [
    {
      target: { type: "company", id: "co-1" },
      label: "Acme Corp",
      icon: "building-2",
      suggestedKind: "references",
      sharedTagCount: 0,
      addressMatch: false,
      nearInTime: false,
      ...over,
    },
  ])[0];
}

const meta = {
  title: "Spine/LinkSuggestionStrip",
  component: LinkSuggestionStrip,
  parameters: { layout: "padded" },
  args: {
    onAccept: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof LinkSuggestionStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddressMatch: Story = {
  args: { suggestion: suggest({ addressMatch: true, suggestedKind: "works-at" }) },
};

export const SharedTag: Story = {
  args: {
    suggestion: suggest({
      target: { type: "task", id: "t-1" },
      label: "Ship Q3 landing page",
      icon: "circle-check",
      sharedTagCount: 2,
    }),
  },
};

export const SharedTagAndTime: Story = {
  args: {
    suggestion: suggest({
      target: { type: "note", id: "n-1" },
      label: "Kickoff call notes",
      icon: "file-text",
      sharedTagCount: 1,
      nearInTime: true,
    }),
  },
};

export const Openable: Story = {
  args: {
    suggestion: suggest({ addressMatch: true, suggestedKind: "works-at" }),
    onOpen: () => {},
  },
};

export const Busy: Story = {
  args: { suggestion: suggest({ addressMatch: true, suggestedKind: "works-at" }), busy: true },
};

// Renders nothing — the at-rest empty state (no pending suggestion).
export const Empty: Story = {
  args: { suggestion: null },
};

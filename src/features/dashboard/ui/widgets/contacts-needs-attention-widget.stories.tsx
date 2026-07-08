import type { Meta, StoryObj } from "@storybook/react";

import type { NeedsAttentionItem } from "@/features/contacts/needs-attention";
import { NeedsAttentionList } from "./contacts-needs-attention-widget";

const ITEMS: NeedsAttentionItem[] = [
  { contactId: "c1", name: "Dana Lee", status: "active", reason: "overdue-followup", detail: "Follow-up due 3 days ago" },
  { contactId: "c2", name: "Mara Quinn", status: "active", reason: "no-touch", detail: "No touch in 21 days" },
  { contactId: "c3", name: "Sam Ortiz", status: "lead", reason: "stale-lead", detail: "Lead untouched for 44 days" },
];

const meta: Meta<typeof NeedsAttentionList> = {
  title: "Contacts/NeedsAttentionWidget",
  component: NeedsAttentionList,
  decorators: [
    (Story) => (
      <div className="h-80 w-96 overflow-hidden rounded-lg border border-border bg-card">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Contacts needing attention; each row deep-links to the hub. Quiet, never red. */
export const Populated: Story = {
  args: { items: ITEMS },
};

/** All caught up — a calm empty state, never an error tone. */
export const Empty: Story = {
  args: { items: [] },
};

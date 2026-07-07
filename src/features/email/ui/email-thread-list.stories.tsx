import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { LabelColor } from "../../../components/tag-colors";
import type { EmailThread } from "../model/email-types";
import { EmailThreadList } from "./email-thread-list";

let seq = 0;
function makeThread(partial: Partial<EmailThread>): EmailThread {
  seq += 1;
  return {
    threadId: `thread-${seq}`,
    accountId: "acc-personal",
    accountEmail: "you@gmail.com",
    subject: "Subject line goes here",
    participants: ["Jane Doe"],
    fromName: "Jane Doe",
    fromEmail: "jane@example.com",
    snippet: "Here is a preview of the latest message in this conversation…",
    date: "2026-07-04T08:10:00.000Z",
    timestampMs: Date.parse("2026-07-04T08:10:00.000Z"),
    messageCount: 1,
    unread: false,
    unreadCount: 0,
    starred: false,
    folder: "INBOX",
    latestUid: 100 + seq,
    ...partial,
  };
}

const threads: EmailThread[] = [
  makeThread({
    subject: "Re: Q3 launch timeline",
    fromName: "Jane Doe",
    participants: ["Jane Doe", "Marco Reyes"],
    snippet: "Sounds good — let's lock the copy review for Thursday and ship Friday.",
    unread: true,
    unreadCount: 2,
    messageCount: 4,
    starred: true,
    accountId: "acc-personal",
  }),
  makeThread({
    subject: "Your invoice is ready",
    fromName: "Stripe",
    participants: ["Stripe"],
    snippet: "Invoice #4821 for June is attached. No action needed.",
    unread: true,
    unreadCount: 1,
    accountId: "acc-work",
  }),
  makeThread({
    subject: "Coffee next week?",
    fromName: "Priya Nair",
    participants: ["Priya Nair"],
    snippet: "Would love to catch up — are you around Tuesday afternoon?",
    unread: false,
    unreadCount: 0,
    messageCount: 3,
    accountId: "acc-icloud",
  }),
  makeThread({
    subject: "Weekly digest: 8 new items",
    fromName: "Product Hunt",
    participants: ["Product Hunt"],
    snippet: "The best new products this week, curated for you.",
    unread: false,
    unreadCount: 0,
    accountId: "acc-personal",
  }),
];

const accountHues: Record<string, LabelColor> = {
  "acc-personal": "blue",
  "acc-icloud": "violet",
  "acc-work": "teal",
};

function Harness({
  data = threads,
  loading = false,
  error = null as string | null,
  showAccountDot = true,
}) {
  const [selected, setSelected] = useState<string | null>(data[0]?.threadId ?? null);
  return (
    <div className="h-[32rem] w-[28rem] overflow-y-auto rounded-xl border border-border bg-card">
      <EmailThreadList
        threads={data}
        loading={loading}
        error={error}
        selectedThreadId={selected}
        showAccountDot={showAccountDot}
        accountHues={accountHues}
        onSelectThread={(t) => setSelected(t.threadId)}
        onArchive={() => {}}
        onSnooze={() => {}}
        onFollowUp={() => {}}
        onDelete={() => {}}
        onRetry={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof EmailThreadList> = {
  title: "features/email/ui/email-thread-list",
  component: EmailThreadList,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Unified scope — mixed unread/read, a pinned thread, multi-message chips, hue dots. */
export const Unified: Story = { render: () => <Harness /> };

/** Single-account scope — no hue dots. */
export const SingleAccount: Story = {
  render: () => <Harness showAccountDot={false} />,
};

/** Loading skeleton rows (no data yet). */
export const Loading: Story = {
  render: () => <Harness data={[]} loading />,
};

/** Error state with retry. */
export const ErrorState: Story = {
  render: () => <Harness data={[]} error="IMAP connection was refused." />,
};

/** Inbox zero — the calm empty state. */
export const InboxZero: Story = {
  render: () => <Harness data={[]} />,
};

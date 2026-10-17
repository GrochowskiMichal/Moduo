import type { Meta, StoryObj } from "@storybook/react";

import type { EmailEnvelope, EmailThread } from "../model/email-types";
import { EmailReader } from "./email-reader";

const thread: EmailThread = {
  threadId: "thread-1",
  accountId: "acc-personal",
  accountEmail: "you@gmail.com",
  subject: "Re: Q3 launch timeline",
  participants: ["Jane Doe", "Marco Reyes"],
  fromName: "Marco Reyes",
  fromEmail: "marco@example.com",
  snippet: "Sounds good — let's lock the copy review for Thursday.",
  date: "2026-07-04T08:10:00.000Z",
  timestampMs: Date.parse("2026-07-04T08:10:00.000Z"),
  messageCount: 3,
  unread: true,
  unreadCount: 1,
  starred: true,
  folder: "INBOX",
  latestUid: 103,
};

function envelope(partial: Partial<EmailEnvelope>): EmailEnvelope {
  return {
    id: "e",
    messageKey: "mk",
    accountId: "acc-personal",
    folder: "INBOX",
    uid: 100,
    sender: "Jane Doe",
    senderEmail: "jane@example.com",
    to: "you@gmail.com",
    subject: "Re: Q3 launch timeline",
    preview: "A preview of this message…",
    date: "2026-07-04T07:00:00.000Z",
    read: true,
    starred: false,
    threadId: "thread-1",
    hasCachedBody: true,
    ...partial,
  };
}

const messages: EmailEnvelope[] = [
  envelope({
    uid: 100,
    sender: "Jane Doe",
    senderEmail: "jane@example.com",
    preview: "Kicking this off — here's the proposed timeline.",
    date: "2026-07-03T15:00:00.000Z",
    read: true,
  }),
  envelope({
    uid: 101,
    sender: "You",
    senderEmail: "you@gmail.com",
    preview: "Looks right to me, one tweak on the copy review.",
    date: "2026-07-04T06:00:00.000Z",
    read: true,
  }),
  envelope({
    uid: 103,
    sender: "Marco Reyes",
    senderEmail: "marco@example.com",
    preview: "Sounds good — let's lock the copy review for Thursday.",
    date: "2026-07-04T08:10:00.000Z",
    read: false,
  }),
];

const bodyHtml = `
  <p style="font-family: sans-serif; color: #1f1f1f;">Hi team,</p>
  <p style="font-family: sans-serif; color: #1f1f1f;">
    Sounds good — let's lock the <strong>copy review for Thursday</strong> and ship Friday.
    I'll send the final assets tonight.
  </p>
  <p style="font-family: sans-serif; color: #1f1f1f;">Best,<br/>Marco</p>
`;

const stubGetThread = async () => messages;
const stubGetBody = async () => ({ body: "Plain text fallback.", bodyHtml });

const meta: Meta<typeof EmailReader> = {
  title: "features/email/ui/email-reader",
  component: EmailReader,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A three-message thread — newest expanded (HTML body), older collapsed. */
export const Conversation: Story = {
  render: () => (
    <div className="h-[40rem] w-[32rem] rounded-xl border border-border bg-card p-4">
      <EmailReader thread={thread} getThread={stubGetThread} getBody={stubGetBody} />
    </div>
  ),
};

/** No thread selected — the quiet empty state. */
export const NoSelection: Story = {
  render: () => (
    <div className="h-[40rem] w-[32rem] rounded-xl border border-border bg-card p-4">
      <EmailReader thread={null} getThread={stubGetThread} getBody={stubGetBody} />
    </div>
  ),
};

const remoteBodyHtml = `
  <p style="font-family: sans-serif; color: #1f1f1f;">Weekly digest with a tracked banner:</p>
  <img src="https://picsum.photos/480/120" alt="Banner" width="480" height="120" />
  <p style="font-family: sans-serif; color: #1f1f1f;">…and a tracking pixel you'll never see.</p>
  <img src="https://picsum.photos/1/1" alt="" width="1" height="1" />
`;

const stubGetRemoteBody = async () => ({ body: "Plain text fallback.", bodyHtml: remoteBodyHtml });

/** DF-6 — remote images blocked by default, with the Load-images bar. */
export const RemoteImagesBlocked: Story = {
  render: () => (
    <div className="h-[40rem] w-[32rem] rounded-xl border border-border bg-card p-4">
      <EmailReader
        thread={thread}
        getThread={async () => [messages[2]]}
        getBody={stubGetRemoteBody}
        onAllowSenderImages={() => {}}
      />
    </div>
  ),
};

/** DF-6 — the same message with the sender on the always-allow list. */
export const RemoteImagesAllowed: Story = {
  render: () => (
    <div className="h-[40rem] w-[32rem] rounded-xl border border-border bg-card p-4">
      <EmailReader
        thread={thread}
        getThread={async () => [messages[2]]}
        getBody={stubGetRemoteBody}
        imageAllowedSenders={new Set(["marco@example.com"])}
      />
    </div>
  ),
};

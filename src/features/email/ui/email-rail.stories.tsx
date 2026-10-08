import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import type { LabelColor } from "../../../components/tag-colors";
import type { SavedAccount } from "../model/email-types";
import { EmailRail, type EmailScope, type EmailView } from "./email-rail";

const accounts: SavedAccount[] = [
  {
    id: "acc-personal",
    provider: "gmail",
    email: "you@gmail.com",
    lastSyncAt: "2026-07-04T08:00:00.000Z",
    status: "active",
    lastError: null,
  },
  {
    id: "acc-icloud",
    provider: "icloud",
    email: "you@icloud.com",
    lastSyncAt: "2026-07-04T07:30:00.000Z",
    status: "reauth_required",
    lastError: null,
  },
  {
    id: "acc-work",
    provider: "custom",
    email: "you@studio.dev",
    lastSyncAt: "2026-07-03T22:00:00.000Z",
    status: "error",
    lastError: "Connection timed out after 30s.",
  },
];

const accountHues: Record<string, LabelColor> = {
  "acc-personal": "blue",
  "acc-icloud": "violet",
  "acc-work": "teal",
};

const unreadByAccount: Record<string, number> = {
  "acc-personal": 12,
  "acc-icloud": 0,
  "acc-work": 3,
};

function Harness({ startScope = null as EmailScope }) {
  const [scope, setScope] = useState<EmailScope>(startScope);
  const [view, setView] = useState<EmailView>("inbox");
  return (
    <div className="w-64 rounded-xl border border-border bg-card p-3">
      <EmailRail
        accounts={accounts}
        accountHues={accountHues}
        unifiedUnread={15}
        unreadByAccount={unreadByAccount}
        selectedAccountId={scope}
        onSelectScope={(s) => {
          setScope(s);
          setView("inbox");
        }}
        activeView={view}
        onSelectView={setView}
        snoozedCount={4}
        followUpCount={2}
        onConnect={() => {}}
        onReconnect={() => {}}
      />
    </div>
  );
}

const meta: Meta<typeof EmailRail> = {
  title: "features/email/ui/email-rail",
  component: EmailRail,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Unified selected (default), three accounts incl. reauth + error statuses. */
export const Default: Story = { render: () => <Harness /> };

/** An account scope selected instead of Unified. */
export const AccountSelected: Story = {
  render: () => <Harness startScope="acc-personal" />,
};

/** No accounts connected — just Unified + destinations + Connect. */
export const NoAccounts: Story = {
  render: () => {
    const [scope, setScope] = useState<EmailScope>(null);
    const [view, setView] = useState<EmailView>("inbox");
    return (
      <div className="w-64 rounded-xl border border-border bg-card p-3">
        <EmailRail
          accounts={[]}
          accountHues={{}}
          unifiedUnread={0}
          unreadByAccount={{}}
          selectedAccountId={scope}
          onSelectScope={setScope}
          activeView={view}
          onSelectView={setView}
          snoozedCount={0}
          followUpCount={0}
          onConnect={() => {}}
          onReconnect={() => {}}
        />
      </div>
    );
  },
};

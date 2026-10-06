import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Button } from "../../../components/ui/button";
import type { ModuoRuntime } from "../../../lib/runtime";
import { AuthContext, type AuthContextValue } from "../../../providers/auth-provider";
import { WorkspaceContext, type WorkspaceContextValue } from "../../workspaces/workspace-context";
import type { SavedAccount } from "../model/email-types";

import { EmailConnectDialog } from "./email-connect-dialog";

// A story-level runtime shim: the connect calls resolve to a fake saved account
// after a short delay so the "Connecting…" state is visible without a backend.
const fakeAccount: SavedAccount = {
  id: "acc-story",
  provider: "gmail",
  email: "you@example.com",
  lastSyncAt: null,
  status: "active",
  lastError: null,
};

const stubRuntime = {
  email: {
    async startGoogleOAuth() {
      await delay(600);
      return fakeAccount;
    },
    async connectAndSave() {
      await delay(600);
      return fakeAccount;
    },
    async listAccounts() {
      return [];
    },
    async disconnect() {},
  },
} as unknown as ModuoRuntime;

const authValue: AuthContextValue = {
  userId: "user-story",
  userEmail: "you@example.com",
  accessToken: null,
  isSignedIn: true,
  loading: false,
  configError: null,
  runtime: stubRuntime,
  planTier: "free",
  signOut: async () => {},
  refreshPlanTier: async () => {},
};

const workspaceValue = {
  selectedWorkspaceId: "ws-story",
} as unknown as WorkspaceContextValue;

function StoryProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={authValue}>
      <WorkspaceContext.Provider value={workspaceValue}>{children}</WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
}

const reconnectIcloud: SavedAccount = {
  id: "acc-icloud",
  provider: "icloud",
  email: "person@icloud.com",
  lastSyncAt: "2026-07-01T09:00:00.000Z",
  status: "reauth_required",
  lastError: null,
};

const meta: Meta<typeof EmailConnectDialog> = {
  title: "features/email/ui/email-connect-dialog",
  component: EmailConnectDialog,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Open dialog, defaults to the Gmail tab (OAuth + app-password paths). */
export const Open: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button type="button" onClick={() => setOpen(true)}>
          Connect email account
        </Button>
        <EmailConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  },
};

/** Closed state — the launcher button only. */
export const Closed: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button type="button" onClick={() => setOpen(true)}>
          Connect email account
        </Button>
        <EmailConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  },
};

/** Reconnect mode — provider + email locked, iCloud credential-only repair. */
export const Reconnect: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <Button type="button" onClick={() => setOpen(true)}>
          Reconnect
        </Button>
        <EmailConnectDialog open={open} onOpenChange={setOpen} isReconnect={reconnectIcloud} />
      </>
    );
  },
};

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

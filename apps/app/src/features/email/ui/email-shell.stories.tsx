// Every Mail shell state (AC40) on the fixture engine.
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";

import type { MailAccount, MailOpRecord } from "@/lib/runtime.types.mail-engine";

import { createMailStore, type MailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { FailedActionsBar } from "./failed-actions-bar";
import { MailShell } from "./mail-shell";
import { MailBodyUnavailable, MailListStateView } from "./mail-states";

function useFixtureStore(
  patch: (accounts: MailAccount[]) => Partial<ReturnType<MailStore["getState"]>> = () => ({}),
) {
  const [store, setStore] = useState<MailStore | null>(null);
  useEffect(() => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 2000 }),
      now: () => FIXTURE_NOW_MS,
    });
    const s = createMailStore({ engine });
    const off = engine.subscribe((e) => {
      if (e.kind === "threads_changed")
        s.setState((st) => ({ threadsVersion: st.threadsVersion + 1 }));
      if (e.kind === "counts") s.setState({ counts: e.counts });
    });
    void Promise.all([engine.listAccounts(), engine.counts()]).then(([accounts, counts]) => {
      s.setState({ accounts, counts, ...patch(accounts) });
      setStore(s);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return store;
}

function Shell(props: {
  patch?: (a: MailAccount[]) => Partial<ReturnType<MailStore["getState"]>>;
  offline?: boolean;
  density?: "comfortable" | "compact";
}) {
  const store = useFixtureStore(props.patch);
  if (!store) return null;
  return (
    <div className="h-screen">
      <MailShell
        store={store}
        now={() => FIXTURE_NOW_MS}
        offline={props.offline}
        density={props.density}
      />
    </div>
  );
}

const meta: Meta = { title: "Email/Shell", parameters: { layout: "fullscreen" } };
export default meta;
type Story = StoryObj;

const failed: MailOpRecord = {
  opId: "op1",
  kind: "done",
  threadIds: ["t1"],
  state: "failed",
  attempts: 8,
  lastError: "Mailbox is read-only",
  createdAtMs: FIXTURE_NOW_MS,
};

export const Inbox: Story = { render: () => <Shell /> };
export const Compact: Story = { render: () => <Shell density="compact" /> };
export const Offline: Story = { render: () => <Shell offline /> };
export const Reconnect: Story = {
  render: () => (
    <Shell
      patch={(a) => ({
        accounts: a.map((x, i) => (i === 0 ? { ...x, syncState: "reconnect" } : x)),
      })}
    />
  ),
};
export const Backfilling: Story = {
  render: () => (
    <Shell
      patch={(a) => ({
        accounts: a.map((x, i) =>
          i === 1 ? { ...x, syncState: "backfilling", backfillProgress: 0.4 } : x,
        ),
      })}
    />
  ),
};
export const FailedActions: Story = {
  render: () => <Shell patch={() => ({ failedOps: [failed, { ...failed, opId: "op2" }] })} />,
};
export const NoAccounts: Story = {
  render: () => <MailListStateView state={{ kind: "no_accounts" }} />,
};
export const FirstSync: Story = {
  render: () => <MailListStateView state={{ kind: "first_sync" }} />,
};
export const EmptyFolder: Story = {
  render: () => <MailListStateView state={{ kind: "empty_folder", name: "Spam" }} />,
};
export const InboxZero: Story = {
  render: () => <MailListStateView state={{ kind: "inbox_zero", clearedToday: 34 }} />,
};
export const BodyUnavailableOffline: Story = { render: () => <MailBodyUnavailable /> };
export const FailedBarAlone: Story = {
  render: () => <FailedActionsBar failed={[failed]} onRetry={() => {}} onDiscard={() => {}} />,
};

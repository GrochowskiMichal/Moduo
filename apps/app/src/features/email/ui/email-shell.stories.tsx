// Every Mail shell state (AC40) on the fixture engine.
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";

import type { MailAccount, MailOpRecord } from "@/lib/runtime.types.mail-engine";

import { createMailStore, type MailStore } from "../store/mail-store";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailShell } from "./mail-shell";
import { MailBodyUnavailable, MailFirstSync, MailListStateView } from "./mail-states";
import { MailSystemLines } from "./system-lines";

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
  density?: "comfortable" | "compact";
}) {
  const store = useFixtureStore(props.patch);
  if (!store) return null;
  return (
    <div className="h-screen">
      <MailShell store={store} now={() => FIXTURE_NOW_MS} density={props.density} />
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
  subject: "Workshop materials",
};

export const Inbox: Story = { render: () => <Shell /> };
export const Compact: Story = { render: () => <Shell density="compact" /> };
export const Offline: Story = {
  render: () => (
    <Shell patch={(a) => ({ accounts: a.map((x) => ({ ...x, syncState: "offline" })) })} />
  ),
};
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
  render: () => <MailFirstSync />,
};
export const EmptyFolder: Story = {
  render: () => (
    <MailListStateView state={{ kind: "empty_place", place: "snoozed", name: "Snoozed" }} />
  ),
};
export const TabClear: Story = {
  render: () => (
    <MailListStateView
      state={{
        kind: "tab_clear",
        tabLabel: "Personal",
        clearedToday: 34,
        others: [{ tab: { kind: "notifications" }, label: "Notifications", unread: 4 }],
      }}
    />
  ),
};
export const BodyUnavailableOffline: Story = { render: () => <MailBodyUnavailable /> };
export const FailedLineAlone: Story = {
  render: () => <MailSystemLines accounts={[]} outboxCount={0} awayCount={0} failed={[failed]} />,
};

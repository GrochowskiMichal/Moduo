import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { MailAccount } from "@/lib/runtime.types.mail-engine";

import { MailFirstSync, mailListState, MailListStateView, MailNextTabs } from "./mail-states";

afterEach(cleanup);

const account = (syncState: MailAccount["syncState"]): MailAccount => ({
  id: "a",
  address: "me@x.test",
  displayName: "Me",
  provider: "gmail",
  hue: 0,
  syncState,
  backfillProgress: null,
  lastError: null,
});

const base = {
  accounts: [account("idle")],
  loading: false,
  rowCount: 0,
  view: { kind: "unified", role: "inbox" } as const,
  isInbox: true,
  folderName: "Inbox",
  tabLabel: "Personal",
  clearedToday: 0,
};

describe("Mail list states (specs/mail-v3.md §4, AC17)", () => {
  it("tab clear, per-place empty, skeleton, four providers", () => {
    // A clear tab: "{Tab} is clear", the day's count, a button per other tab with unread.
    const onTab = rs.fn();
    const clear = mailListState({
      ...base,
      clearedToday: 12,
      others: [{ tab: { kind: "notifications" }, label: "Notifications", unread: 4 }],
    });
    expect(clear.kind).toBe("tab_clear");
    const ui = render(<MailListStateView state={clear as never} onTab={onTab} />);
    screen.getByText("Personal is clear");
    screen.getByText("You cleared 12 today.");
    // specs/mail-improve.md AC22: the next tabs are the reader's, not the list's.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(onTab).not.toHaveBeenCalled();
    ui.unmount();

    // Nothing cleared and no other tab waiting.
    render(<MailListStateView state={mailListState(base) as never} />);
    screen.getByText("Nothing waiting on you here.");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    cleanup();

    // Each place has its own copy plus Back to Inbox.
    const places = [
      [{ kind: "snoozed" }, "Nothing snoozed", "s hides a thread until you want it back."],
      [
        { kind: "followups" },
        "No follow-ups",
        "Set “Remind me if no reply” when you send, or press w on a sent thread.",
      ],
      [
        { kind: "unified", role: "archive" },
        "Nothing in Archive",
        "e marks a thread done and files it here. A reply brings it back.",
      ],
      [
        { kind: "new_senders" },
        "No new senders",
        "First-time senders wait here while the Screener is on.",
      ],
      [{ kind: "outbox" }, "Outbox is empty", "Messages you send offline wait here."],
      [{ kind: "unified", role: "spam" }, "Nothing in Spam", null],
    ] as const;
    for (const [view, title, body] of places) {
      const back = rs.fn();
      const state = mailListState({ ...base, view, isInbox: false, folderName: "Spam" });
      render(<MailListStateView state={state as never} onBackToInbox={back} />);
      screen.getByText(title);
      if (body) screen.getByText(body);
      fireEvent.click(screen.getByRole("button", { name: "Back to Inbox" }));
      expect(back).toHaveBeenCalled();
      cleanup();
    }

    // First sync: the line, then skeleton rows, no spinner.
    expect(mailListState({ ...base, accounts: [account("first_sync")] }).kind).toBe("first_sync");
    const sync = render(<MailFirstSync />);
    expect(screen.getByRole("status").textContent).toBe(
      "Getting your newest mail. History follows in the background.",
    );
    expect(sync.container.querySelectorAll('[data-slot="mail-skeleton-row"]').length).toBe(7);
    expect(sync.container.querySelector(".animate-spin")).toBeNull();
    cleanup();

    // No account: a connect card with the four providers, each opening on itself.
    const onConnect = rs.fn();
    render(
      <MailListStateView
        state={mailListState({ ...base, accounts: [] }) as never}
        onConnect={onConnect}
      />,
    );
    const names = ["Google", "Microsoft", "iCloud", "Other (IMAP)"];
    for (const name of names) fireEvent.click(screen.getByRole("button", { name }));
    expect(onConnect.mock.calls.map((c) => c[0])).toEqual(["gmail", "outlook", "icloud", "custom"]);
  });
});

// specs/mail-improve.md MI-0, AC22: inbox zero says "{Tab} is clear · You cleared {n}
// today" in the list; the reader shows only a small "Next" label and the next tabs as
// buttons with their counts and `g` keys, no second heading. An empty place keeps its
// state (with "Back to Inbox" and its `g i` key) in the list; the reader stays empty.
describe("inbox zero and empty place (AC22)", () => {
  it("the reader's Next: tabs with counts and their g keys, no heading", () => {
    const onTab = rs.fn();
    const ui = render(
      <MailNextTabs
        others={[
          { tab: { kind: "notifications" }, label: "Notifications", unread: 4 },
          { tab: { kind: "custom", customTabId: "ct1" }, label: "Investors", unread: 2 },
        ]}
        onTab={onTab}
      />,
    );
    screen.getByText("Next");
    expect(ui.container.querySelector("h1, h2, h3, h4")).toBeNull();
    const notif = screen.getByRole("button", { name: "Notifications · 4" });
    expect(notif.getAttribute("aria-keyshortcuts")).toBe("g n");
    expect(notif.querySelector("kbd")?.textContent).toBe("gn");
    const custom = screen.getByRole("button", { name: "Investors · 2" });
    expect(custom.getAttribute("aria-keyshortcuts")).toBe("g v");
    fireEvent.click(notif);
    expect(onTab).toHaveBeenCalledWith({ kind: "notifications" });
    cleanup();
    // Nothing else waiting: nothing at all.
    const none = render(<MailNextTabs others={[]} onTab={onTab} />);
    expect(none.container.textContent).toBe("");
  });

  it("an empty place: Back to Inbox with its g i key", () => {
    const state = mailListState({ ...base, view: { kind: "snoozed" }, isInbox: false });
    render(<MailListStateView state={state as never} onBackToInbox={() => {}} />);
    const back = screen.getByRole("button", { name: "Back to Inbox" });
    expect(back.getAttribute("aria-keyshortcuts")).toBe("g i");
    expect(back.querySelector("kbd")?.textContent).toBe("gi");
  });
});

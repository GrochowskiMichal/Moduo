import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { MailAccount } from "@/lib/runtime.types.mail-engine";

import { MailFirstSync, mailListState, MailListStateView } from "./mail-states";

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
    fireEvent.click(screen.getByRole("button", { name: "Notifications · 4" }));
    expect(onTab).toHaveBeenCalledWith({ kind: "notifications" });
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

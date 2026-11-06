import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailAccount, MailOpRecord, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { MailSystemLines, type MailSystemLinesProps } from "./system-lines";

afterEach(cleanup);
// The tooltip's popper measures with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const NOW = 100 * 86_400_000;
const acc = (id: string, name: string, patch: Partial<MailAccount> = {}): MailAccount => ({
  id,
  address: `${id}@x.test`,
  displayName: name,
  provider: "gmail",
  hue: 0,
  syncState: "idle",
  backfillProgress: null,
  lastError: null,
  ...patch,
});
const op = (opId: string, kind: MailOpRecord["kind"], thread: string, subject: string) =>
  ({
    opId,
    kind,
    threadIds: [thread],
    state: "failed",
    attempts: 3,
    lastError: "Its server is read-only",
    createdAtMs: NOW - 1000,
    subject,
  }) satisfies MailOpRecord;
const due: MailThreadRow = {
  threadId: "t-due",
  accountId: "studio",
  subject: "Pilot terms",
  snippet: "",
  senders: [
    { name: "Me", email: "studio@x.test" },
    { name: "Ana Lima", email: "ana@acme.test" },
  ],
  lastDateMs: NOW - 7 * 86_400_000,
  messageCount: 2,
  unread: false,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
};

function mount(p: Partial<MailSystemLinesProps>) {
  return render(
    <TooltipProvider>
      <MailSystemLines
        accounts={[acc("studio", "Studio")]}
        outboxCount={0}
        awayCount={0}
        selfAddresses={["studio@x.test"]}
        nowMs={NOW}
        {...p}
      />
    </TooltipProvider>,
  );
}

const lines = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>('[data-slot="mail-system-line"]')].map((l) => ({
    role: l.getAttribute("role"),
    title: l.querySelector(".font-medium")?.textContent,
  }));

describe("Mail system lines (specs/mail-v3.md §4, AC18, AC9)", () => {
  it("order, copy, nudge only alone", () => {
    const accounts = [
      acc("studio", "Studio", { syncState: "offline" }),
      acc("lumen", "Lumen", { syncState: "reconnect" }),
      acc("work", "Work", { syncState: "error", lastError: "connection_refused" }),
    ];
    const byThread: Record<string, string> = { t1: "lumen", t2: "lumen", t3: "work" };
    const retry = rs.fn();
    const undo = rs.fn();
    const ui = mount({
      accounts,
      awayCount: 3,
      failed: [
        op("o1", "done", "t1", "Workshop materials"),
        op("o2", "move", "t2", "Studio rent, November"),
        op("o3", "done", "t3", "Quarterly numbers"),
      ],
      failedAccount: (o) => byThread[o.threadIds[0]!] ?? null,
      followups: [due],
      nudgeAllowed: true,
      onRetryOps: retry,
      onUndoOps: undo,
    });
    // §4's order; every line is a status except the failed lines (alerts); no nudge.
    expect(lines(ui.container)).toEqual([
      { role: "status", title: "Studio is offline" },
      { role: "status", title: "Lumen needs you to sign in again" },
      { role: "status", title: "Work couldn't sync" },
      { role: "status", title: "3 emails came back while you were away" },
      { role: "alert", title: "2 actions didn't reach Lumen" },
      { role: "alert", title: "1 action didn't reach Work" },
    ]);
    screen.getByText("Its new mail is paused until you sign in; other accounts keep syncing.");
    screen.getByText("Connection refused; retrying every minute.");
    screen.getByText(
      "Snoozes return only while Moduo runs, so these came due while it was closed. They're first in Personal, under Came back.",
    );

    // The failed line names each action and thread, then the reason.
    const [lumen, work] = screen.getAllByRole("alert");
    within(lumen!).getByText(
      "Done · Workshop materials, and Move · Studio rent, November. Its server is read-only; Moduo keeps retrying for a day.",
    );
    // Undo both / Retry now act on exactly that account's ops.
    const undoBoth = within(lumen!).getByRole("button", { name: "Undo both" });
    fireEvent.focus(undoBoth);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Shows the threads as the server has them",
    );
    fireEvent.click(undoBoth);
    fireEvent.click(within(lumen!).getByRole("button", { name: "Retry now" }));
    expect(undo).toHaveBeenCalledWith(["o1", "o2"]);
    expect(retry).toHaveBeenCalledWith(["o1", "o2"]);
    fireEvent.click(within(work!).getByRole("button", { name: "Retry now" }));
    expect(retry).toHaveBeenLastCalledWith(["o3"]);
    expect(screen.queryByText(/No reply from/)).toBeNull();
  });

  it("three or more failed actions: the first two, and N more, Undo all", () => {
    mount({
      failed: [
        op("o1", "done", "t1", "A"),
        op("o2", "snooze", "t2", "B"),
        op("o3", "delete", "t3", "C"),
        op("o4", "pin", "t4", "D"),
      ],
    });
    screen.getByText("4 actions didn't reach Studio");
    screen.getByText(
      "Done · A, Snooze · B, and 2 more. Its server is read-only; Moduo keeps retrying for a day.",
    );
    screen.getByRole("button", { name: "Undo all" });
  });

  it("a failed move names its destination", () => {
    mount({
      failed: [
        { ...op("o1", "move", "t1", "Studio rent, November"), targetName: "Receipts" },
        { ...op("o2", "move", "t2", "Pilot terms"), targetName: null },
      ],
    });
    screen.getByText(
      "Move to Receipts · Studio rent, November, and Move · Pilot terms. Its server is read-only; Moduo keeps retrying for a day.",
    );
  });

  it("offline counts what waits, or that reading works", () => {
    const offline = [acc("studio", "Studio", { syncState: "offline" })];
    mount({ accounts: offline, outboxCount: 1, pendingOps: 3 });
    screen.getByText("Offline, changes will sync");
    screen.getByText("1 message waits in Outbox. 3 triage actions are saved on this Mac.");
    cleanup();
    mount({ accounts: offline });
    screen.getByText("Reading works from what's on this Mac.");
  });

  it("the nudge shows alone on Personal, with its Dismiss tooltip", () => {
    const open = rs.fn();
    const dismiss = rs.fn();
    const ui = mount({
      followups: [due],
      nudgeAllowed: true,
      onOpenThread: open,
      onDismissFollowup: dismiss,
    });
    expect(lines(ui.container)).toEqual([{ role: "status", title: "No reply from Ana · 7 days" }]);
    screen.getByText("Pilot terms");
    fireEvent.click(screen.getByRole("button", { name: /No reply from Ana/ }));
    expect(open).toHaveBeenCalledWith("t-due");
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.focus(dismissBtn);
    expect(screen.getByRole("tooltip").textContent).toBe("Stops waiting for Ana");
    fireEvent.click(dismissBtn);
    expect(dismiss).toHaveBeenCalledWith("t-due");
    cleanup();

    // Off Personal: no nudge, and nothing at all.
    const off = mount({ followups: [due], nudgeAllowed: false });
    expect(lines(off.container)).toEqual([]);
  });
});

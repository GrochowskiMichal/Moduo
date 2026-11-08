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
      { role: "alert", title: "3 actions didn't sync" },
    ]);
    screen.getByText("Its new mail is paused until you sign in; other accounts keep syncing.");
    screen.getByText("Connection refused; retrying every minute.");
    screen.getByText(
      "Snoozes return only while Moduo runs, so these came due while it was closed. They're first in Personal, under Came back.",
    );

    // specs/mail-improve.md AC20: two or more fold into one line with Show and Retry all.
    const fold = screen.getByRole("alert");
    fireEvent.click(within(fold).getByRole("button", { name: "Retry all" }));
    expect(retry).toHaveBeenCalledWith(["o1", "o2", "o3"]);
    expect(undo).not.toHaveBeenCalled();
    expect(screen.queryByText(/No reply from/)).toBeNull();
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

// specs/mail-improve.md MI-0, AC20: each failed action is one line of at most 32 px,
// "Couldn't archive "{subject}" · {cause} · Retry · Undo", the subject cut in the middle
// and the cause never; two or more fold into "{n} actions didn't sync · Show · Retry all",
// and Show lists them in a box that scrolls past five lines.
describe("failed actions are one line and fold (AC20)", () => {
  it("one failed action: one line, verb, subject, cause, Retry, Undo", () => {
    const retry = rs.fn();
    const undo = rs.fn();
    const ui = mount({
      failed: [op("o1", "done", "t1", "Workshop materials")],
      onRetryOps: retry,
      onUndoOps: undo,
    });
    const line = screen.getByRole("alert");
    expect(line.getAttribute("data-slot")).toBe("mail-failed-line");
    // ≤ 32 px (spec §5): the compact row token, not --row-h (36 px).
    expect(line.className).toContain("h-(--mail-row-compact)");
    expect(line.textContent).toContain('Couldn\'t archive "Workshop materials"');
    expect(line.textContent).toContain("Its server is read-only");
    fireEvent.click(within(line).getByRole("button", { name: "Retry" }));
    fireEvent.click(within(line).getByRole("button", { name: "Undo" }));
    expect(retry).toHaveBeenCalledWith(["o1"]);
    expect(undo).toHaveBeenCalledWith(["o1"]);
    expect(ui.container.querySelectorAll('[data-slot="mail-failed-line"]')).toHaveLength(1);
  });

  it("a 200-character subject is cut in the middle; the cause stays whole", () => {
    const subject = `Quarterly ${"planning ".repeat(22)}final v3`;
    mount({ failed: [{ ...op("o1", "move", "t1", subject), targetName: "Receipts" }] });
    const line = screen.getByRole("alert");
    const head = line.querySelector<HTMLElement>("[data-middle-head]")!;
    const tail = line.querySelector<HTMLElement>("[data-middle-tail]")!;
    expect(head.className).toContain("truncate");
    expect(tail.className).not.toContain("truncate");
    expect((head.textContent ?? "") + (tail.textContent ?? "")).toBe(subject);
    expect(line.title).toContain(subject);
    const cause = line.querySelector<HTMLElement>("[data-cause]")!;
    expect(cause.textContent).toBe("Its server is read-only");
    expect(cause.className).toContain("shrink-0");
    expect(line.textContent).toContain("Couldn't move");
  });

  it("two or more fold into a summary with Show and Retry all", () => {
    const retry = rs.fn();
    mount({
      failed: [
        op("o1", "done", "t1", "A"),
        op("o2", "snooze", "t2", "B"),
        op("o3", "delete", "t3", "C"),
        op("o4", "pin", "t4", "D"),
        op("o5", "done", "t5", "E"),
        op("o6", "done", "t6", "F"),
      ],
      onRetryOps: retry,
    });
    const fold = screen.getByRole("alert");
    expect(fold.textContent).toContain("6 actions didn't sync");
    fireEvent.click(within(fold).getByRole("button", { name: "Retry all" }));
    expect(retry).toHaveBeenCalledWith(["o1", "o2", "o3", "o4", "o5", "o6"]);
    fireEvent.click(within(fold).getByRole("button", { name: "Show" }));
    const list = screen.getByRole("list", { name: "Actions that didn't sync" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(list.className).toContain("max-h-(--failed-list-max)");
    expect(list.className).toContain("overflow-y-auto");
  });
});

import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { densityChoice, densityPatch } from "../../settings/mail/density";
import { groupWindow } from "../shell/use-thread-window";
import { MailRow, type MailRowActions, ROW_HEIGHT } from "./mail-row";
import { rowFlags, rowTime, stripSubject, visibleFlags } from "./mail-row-model";
import { MailThreadList } from "./thread-list";

afterEach(cleanup);

const DAY = 86_400_000;
// A Wednesday noon, local time.
const NOW = new Date(2026, 10, 4, 12, 0).getTime();
const ME = "me@moduo.test";

function row(patch: Partial<MailThreadRow> = {}): MailThreadRow {
  return {
    threadId: "t1",
    accountId: "a1",
    subject: "Pilot terms",
    snippet: "Here are the terms we discussed",
    senders: [{ name: "Ana Lopes", email: "ana@acme.test" }],
    lastDateMs: NOW - 60_000,
    messageCount: 1,
    unread: true,
    pinned: false,
    hasAttachments: false,
    hasInvite: false,
    tab: "personal",
    priority: false,
    muted: false,
    snoozedUntilMs: null,
    ...patch,
  };
}

function actions(): MailRowActions {
  return {
    open: rs.fn(),
    togglePick: rs.fn(),
    hover: rs.fn(),
    done: rs.fn(),
    undone: rs.fn(),
    snooze: rs.fn(),
    more: rs.fn(),
  };
}

type RowProps = Partial<Parameters<typeof MailRow>[0]>;

function mount(props: RowProps = {}) {
  const a = props.actions ?? actions();
  const ui = render(
    <TooltipProvider>
      <MailRow
        row={row()}
        cursor={false}
        picked={false}
        showActions={false}
        accountHue={null}
        density="comfortable"
        previewLines={2}
        nowMs={NOW}
        self={new Set([ME])}
        actions={a}
        {...props}
      />
    </TooltipProvider>,
  );
  const el = ui.container.querySelector<HTMLElement>("[data-thread-id]")!;
  return { ui, el, actions: a };
}

const flagIds = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>("[data-flag]")].map((f) => f.dataset.flag);

describe("MailRow (specs/mail-v3.md §3, AC15)", () => {
  it("flags, to-line, stripped subject, time by place", () => {
    // Subjects lose Re:/Fwd:/Fw:/AW:/WG:/Antw:, repeated and in any case; the title keeps it.
    expect(stripSubject("Re: RE: fwd: Fw: AW: wg: Antw: Budget")).toBe("Budget");
    expect(stripSubject("Regarding the plan")).toBe("Regarding the plan");
    const subject = "Re: Fwd: Pilot terms";
    let { el } = mount({ row: row({ subject }) });
    const subj = el.querySelector<HTMLElement>("[data-row-subject]")!;
    expect(subj.textContent).toBe("Pilot terms");
    expect(subj.title).toBe(subject);
    cleanup();

    // "To {name}" where you wrote it (Sent, Follow-ups, Outbox, Drafts); senders elsewhere.
    const sent = row({
      senders: [
        { name: "Ana Lopes", email: "ana@acme.test" },
        { name: "Me", email: ME },
      ],
    });
    for (const place of ["sent", "followups", "outbox", "drafts"] as const) {
      ({ el } = mount({ row: sent, place }));
      expect(el.querySelector("[data-row-who]")!.textContent).toBe("To Ana Lopes");
      cleanup();
    }
    ({ el } = mount({ row: sent, place: "inbox" }));
    expect(el.querySelector("[data-row-who]")!.textContent).toBe("Ana Lopes, Me");
    cleanup();

    // Every flag in the table, each in its own case.
    const ctx = { place: "inbox" as const, nowMs: NOW };
    const ids = (r: MailThreadRow, extra = {}) =>
      rowFlags(r, { ...ctx, ...extra }).map((f) => f.id);
    expect(ids(row({ priority: true }))).toEqual(["priority"]);
    expect(ids(row({ pinned: true }))).toEqual(["pinned"]);
    expect(ids(row({ hasAttachments: true }))).toEqual(["attachment"]);
    expect(ids(row({ hasInvite: true }))).toEqual(["invite"]);
    expect(ids(row({ muted: true }))).toEqual(["muted"]);
    expect(ids(row({ snoozedUntilMs: NOW + DAY }))).toEqual(["snoozed"]);
    expect(ids(row({ snoozedUntilMs: NOW + DAY }), { place: "snoozed" })).toEqual([]);
    expect(ids(row(), { linked: ["task", "note"] })).toEqual(["task", "note"]);
    expect(ids(row({ followUpAtMs: NOW + 1 * DAY }))).toEqual(["waiting"]);
    expect(ids(row({ returnReason: "snooze" }))).toEqual(["back"]);
    expect(ids(row({ returnReason: "reply" }))).toEqual(["new_reply"]);
    expect(ids(row(), { notSent: true })).toEqual(["not_sent"]);
    const outbox = (offline: boolean) =>
      rowFlags(row({ outboxState: "pending" }), { ...ctx, offline })[0]?.text;
    expect(outbox(true)).toBe("Waiting for connection");
    expect(outbox(false)).toBe("Sending…");
    expect(rowFlags(row({ followUpAtMs: NOW + DAY }), ctx)[0]?.label).toMatch(/^Reminds /);

    // At most three, then "+N" naming the rest.
    const busy = row({
      priority: true,
      pinned: true,
      hasAttachments: true,
      hasInvite: true,
      muted: true,
    });
    expect(visibleFlags(rowFlags(busy, ctx)).hidden).toHaveLength(2);
    ({ el } = mount({ row: busy, notSent: true }));
    expect(flagIds(el)).toEqual(["not_sent", "priority", "pinned"]);
    expect(el.querySelector("[data-flag='not_sent']")!.textContent).toBe("Not sent");
    expect(el.querySelector("[data-flag='not_sent']")!.className).toContain("text-destructive");
    const more = el.querySelector<HTMLElement>("[data-flag-more]")!;
    expect(more.textContent).toMatch(/^\+3/);
    expect(more.title).toBe("Invite, Attachment, Muted");
    cleanup();
    ({ el } = mount({ row: row(), linked: ["task"] }));
    expect(flagIds(el)).toEqual(["task"]);
    cleanup();

    // Time by place.
    expect(rowTime(row({ snoozedUntilMs: NOW + 5 * DAY - 3 * 3_600_000 }), "snoozed", NOW)).toMatch(
      /^Returns \S+ \d/,
    );
    expect(
      rowTime(row({ lastDateMs: NOW - 7 * DAY, followUpAtMs: NOW - DAY }), "followups", NOW),
    ).toBe("No reply · 7 days");
    expect(rowTime(row({ followUpAtMs: NOW + DAY }), "followups", NOW)).toMatch(/^Reminds \S+$/);
    expect(rowTime(row({ outboxState: "pending" }), "outbox", NOW)).toBe("Waiting");
    const weekday = new Date(NOW - 3 * DAY).toLocaleDateString(undefined, { weekday: "short" });
    expect(rowTime(row({ lastDateMs: NOW - 3 * DAY }), "inbox", NOW)).toBe(weekday);
    expect(rowTime(row({ lastDateMs: NOW - 30 * DAY }), "inbox", NOW)).not.toBe(
      new Date(NOW - 30 * DAY).toLocaleDateString(undefined, { weekday: "short" }),
    );
    expect(rowTime(row({ lastDateMs: NOW - 60_000 }), "inbox", NOW)).toMatch(/\d:\d\d/);
  });

  it("row lead: identity avatar, account ring, unread dot and the pick checkbox", () => {
    const { el, actions: a } = mount({ accountHue: "teal" });
    const avatar = el.querySelector<HTMLElement>("[data-avatar]")!;
    expect(avatar.dataset.label).toBeTruthy();
    expect(avatar.className).toContain("bg-label-fill");
    expect(el.querySelector<HTMLElement>("[data-account-ring]")!.dataset.label).toBe("teal");
    expect(el.querySelector("[data-unread-dot]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select · x" }));
    expect(a.togglePick).toHaveBeenCalledWith("t1");
    expect(a.open).not.toHaveBeenCalled();
    cleanup();
    const one = mount({ accountHue: null, row: row({ unread: false }) });
    expect(one.el.querySelector("[data-account-ring]")).toBeNull();
    expect(one.el.querySelector("[data-unread-dot]")).toBeNull();
  });

  it("hover actions overlay the snippet; the time stays; a done row offers Not done", () => {
    const { el, actions: a } = mount({ showActions: true });
    expect(el.querySelector("time")).not.toBeNull();
    expect(el.querySelector("[data-row-actions]")!.className).toContain("absolute");
    screen.getByRole("button", { name: "Done" });
    cleanup();
    const done = mount({ showActions: true, place: "archive", actions: a });
    fireEvent.click(screen.getByRole("button", { name: "Not done" }));
    expect(a.undone).toHaveBeenCalledWith("t1");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(done.el.querySelector("time")).not.toBeNull();
  });

  it("compact is one 32 px line", async () => {
    // The virtual list's number mirrors the token (decision 13).
    const css = await fs.readFile(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");
    const rem = Number(/--mail-row-compact:\s*([\d.]+)rem/.exec(css)?.[1]);
    expect(rem * 16).toBe(ROW_HEIGHT.compact);
    expect(ROW_HEIGHT.compact).toBe(32);
    expect(ROW_HEIGHT.comfortable).toBe(72);

    // One line: sender (fixed column), subject, the fading snippet, flags, time. No
    // second line, and compact ignores the preview-line choice.
    const { el } = mount({ density: "compact", previewLines: 2, row: row({ pinned: true }) });
    expect(el.querySelector(".flex-col")).toBeNull();
    expect(el.querySelector(".line-clamp-2")).toBeNull();
    expect(el.className).toContain("items-center");
    expect(el.querySelector("[data-row-who]")!.className).toContain("w-(--mail-sender-w)");
    const snippet = el.querySelector<HTMLElement>("[data-row-snippet]")!;
    expect(snippet.className).toContain("truncate");
    expect(snippet.className).toContain("basis-0");
    expect(flagIds(el)).toEqual(["pinned"]);
    cleanup();

    // The list draws every compact row at 32 px.
    const rows = [row({ threadId: "a" }), row({ threadId: "b" })];
    const ui = render(
      <TooltipProvider>
        <MailThreadList
          items={groupWindow(rows)}
          cursor={null}
          picked={[]}
          hovered={null}
          hues={{}}
          showHue={false}
          density="compact"
          previewLines={2}
          nowMs={NOW}
          actions={actions()}
        />
      </TooltipProvider>,
    );
    const heights = [...ui.container.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (r) => r.parentElement!.style.height,
    );
    expect(heights).toEqual(["32px", "32px"]);
  });

  it("Settings density: three options, and a stored compact with 2 lines reads as Compact", () => {
    expect(densityChoice({ density: "compact", previewLines: 2 })).toBe("compact");
    expect(densityChoice({ density: "compact", previewLines: 1 })).toBe("compact");
    expect(densityChoice({ density: "comfortable", previewLines: 1 })).toBe("comfortable:1");
    expect(densityPatch("compact")).toEqual({ density: "compact" });
    expect(densityPatch("comfortable:2")).toEqual({ density: "comfortable", previewLines: 2 });
  });
});

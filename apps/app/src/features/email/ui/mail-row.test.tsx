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

  it("row lead: identity avatar, unread dot and the pick control", () => {
    const { el, actions: a } = mount({ accountHue: "teal", accountName: "Work" });
    const avatar = el.querySelector<HTMLElement>("[data-avatar]")!;
    expect(avatar.dataset.label).toBeTruthy();
    expect(avatar.className).toContain("bg-label-fill");
    expect(el.querySelector("[data-unread-dot]")).not.toBeNull();
    // Pointer-only (the row is a listbox option): hidden from the role tree, found by its label.
    fireEvent.click(el.querySelector('[data-row-control="Select · x"]')!);
    expect(a.togglePick).toHaveBeenCalledWith("t1");
    expect(a.open).not.toHaveBeenCalled();
    cleanup();
    const one = mount({ accountHue: null, row: row({ unread: false }) });
    expect(one.el.querySelector("[data-unread-dot]")).toBeNull();
  });

  it("hover actions overlay the snippet; the time stays; a done row offers Not done", () => {
    const { el, actions: a } = mount({ showActions: true });
    expect(el.querySelector("time")).not.toBeNull();
    expect(el.querySelector("[data-row-actions]")!.className).toContain("absolute");
    expect(el.querySelector('[data-row-control="Done"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    cleanup();
    const done = mount({ showActions: true, place: "archive", actions: a });
    fireEvent.click(done.el.querySelector('[data-row-control="Not done"]')!);
    expect(a.undone).toHaveBeenCalledWith("t1");
    expect(done.el.querySelector('[data-row-control="Done"]')).toBeNull();
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

// specs/mail-improve.md MI-0, AC5 and AC6: initials on the label fill, no account ring, a
// filled account tick after the time; hover draws a check ring inside the avatar, a picked
// row fills it with primary and a check, an unpicked row in selection mode stays plain.
describe("avatar, tick and checks (AC5, AC6)", () => {
  it("initials, no ring, and the account tick after the time", () => {
    const { el } = mount({ accountHue: "teal", accountName: "Work" });
    const avatar = el.querySelector<HTMLElement>("[data-avatar]")!;
    expect(avatar.textContent).toBe("AL");
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector("[data-account-ring]")).toBeNull();
    expect(el.querySelector(".ring-2")).toBeNull();
    const tick = el.querySelector<HTMLElement>("[data-account-tick]")!;
    expect(tick.dataset.label).toBe("teal");
    expect(tick.title).toBe("Work");
    // After the time, at the right edge.
    const time = el.querySelector("time")!;
    expect(time.compareDocumentPosition(tick) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The row's name comes from its one screen-reader line (no aria-label: axe's
    // label-content-name-mismatch would compare it to the visible initials and snippet).
    expect(el.hasAttribute("aria-label")).toBe(false);
    expect(el.querySelector("[data-row-name]")!.textContent).toContain("Work");
    cleanup();
    // Read rows: the tick at half strength.
    const read = mount({ accountHue: "teal", accountName: "Work", row: row({ unread: false }) });
    expect(read.el.querySelector<HTMLElement>("[data-account-tick]")!.className).toContain(
      "opacity-50",
    );
    cleanup();
    // One account: no tick.
    const single = mount({ accountHue: null });
    expect(single.el.querySelector("[data-account-tick]")).toBeNull();
  });

  it("hover ring, picked fill, and no check on unpicked rows while selecting", () => {
    const check = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-check]")!;
    const classes = (el: HTMLElement) => el.className.split(/\s+/);
    let { el } = mount();
    expect(check(el).dataset.check).toBe("hover");
    // Hidden at rest, drawn inside the avatar circle on row hover.
    expect(classes(check(el))).toContain("hidden");
    expect(classes(check(el))).toContain("group-hover:flex");
    expect(classes(check(el))).toContain("rounded-full");
    cleanup();

    ({ el } = mount({ picked: true, selecting: true }));
    expect(check(el).dataset.check).toBe("picked");
    expect(classes(check(el))).toContain("bg-primary");
    expect(check(el).querySelector("svg")).not.toBeNull();
    cleanup();

    ({ el } = mount({ picked: false, selecting: true }));
    expect(check(el).dataset.check).toBe("hover");
    expect(classes(check(el))).not.toContain("flex");
    expect(el.querySelector<HTMLElement>("[data-avatar]")!.className).not.toContain("invisible");
  });
});

// specs/mail-improve.md MI-0, AC7, AC8 and AC28 (rows).
describe("pinned rows, fade, selected contrast, accessible name (AC7, AC8, AC28)", () => {
  it("no pin flag under PINNED; elsewhere it stays", () => {
    let { el } = mount({ row: row({ pinned: true }), inPinnedGroup: true });
    expect(flagIds(el)).not.toContain("pinned");
    cleanup();
    ({ el } = mount({ row: row({ pinned: true }) }));
    expect(flagIds(el)).toContain("pinned");
  });

  it("quick actions sit over a fade of the row's own background", () => {
    const { el } = mount({ showActions: true });
    const bar = el.querySelector<HTMLElement>("[data-row-actions]")!;
    expect(bar.hasAttribute("data-fade")).toBe(true);
    expect(bar.className).toContain("from-transparent");
    expect(bar.className).toContain("to-(--row-bg)");
  });

  it("the selected row keeps full-contrast sender and subject", () => {
    const { el } = mount({ cursor: true, row: row({ unread: false }) });
    for (const sel of ["[data-row-who]", "[data-row-subject]"]) {
      const part = el.querySelector<HTMLElement>(sel)!;
      expect(part.className).toContain("text-foreground");
      expect(part.className).not.toContain("text-muted-foreground");
    }
  });

  it("the row's name reads with commas, without the initials", () => {
    const { el } = mount({
      row: row({
        messageCount: 6,
        priority: true,
        hasAttachments: true,
        subject: "Hale & Co renewal",
      }),
      linked: ["task"],
      accountHue: "teal",
      accountName: "Work",
    });
    const time = el.querySelector("time")!.textContent;
    expect(el.hasAttribute("aria-label")).toBe(false);
    screen.getByRole("option", {
      name: `Ana Lopes, 6 messages, unread, priority person, has attachments, has a task, ${time}, Hale & Co renewal, Work`,
    });
    expect(el.querySelector("[data-row-name]")!.textContent).toBe(
      `Ana Lopes, 6 messages, unread, priority person, has attachments, has a task, ${time}, Hale & Co renewal, Work`,
    );
    expect(el.querySelector("[data-row-name]")!.textContent).not.toContain("AL,");
  });
});

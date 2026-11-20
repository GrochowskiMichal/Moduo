import { describe, expect, it } from "@rstest/core";

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import {
  AWAY_GROUP_MAX,
  groupWindow,
  MAIL_GROUP_LABELS,
  type MailListItem,
  navigableIds,
} from "./use-thread-window";

function row(id: string, patch: Partial<MailThreadRow> = {}): MailThreadRow {
  return {
    threadId: id,
    accountId: "a1",
    subject: `Subject ${id}`,
    snippet: "",
    senders: [{ name: `Sender ${id}`, email: `${id}@x.test` }],
    lastDateMs: 1_000,
    messageCount: 1,
    unread: false,
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

/** Each item as a short token: `#Label` for a header, the id for a row. */
const shape = (items: MailListItem[]) =>
  items.map((it) => {
    if (it.kind === "header") return `#${it.label}`;
    if (it.kind === "row") return it.row.threadId;
    if (it.kind === "sender") return `@${it.group.email}·${it.group.threadIds.length}`;
    return `+${it.count}`;
  });

describe("useThreadWindow groups (specs/mail-v3.md §3, AC14)", () => {
  it("away, pinned and everything-else groups", () => {
    const rows = [
      row("p1", { pinned: true }),
      row("t1"),
      row("t2"),
      row("back1"),
      row("p2", { pinned: true }),
    ];
    const items = groupWindow(rows, { awayReturned: ["back1"], personal: true });
    expect(shape(items)).toEqual([
      `#${MAIL_GROUP_LABELS.away}`,
      "back1",
      `#${MAIL_GROUP_LABELS.pinned}`,
      "p1",
      "p2",
      `#${MAIL_GROUP_LABELS.rest}`,
      "t1",
      "t2",
    ]);
    expect(MAIL_GROUP_LABELS).toEqual({
      away: "Came back while you were away",
      pinned: "Pinned",
      rest: "Everything else",
    });
    // Headers are items of their own; j/k walk only the threads.
    expect(navigableIds(items)).toEqual(["back1", "p1", "p2", "t1", "t2"]);
  });

  it("shows the away group only on Personal, and no headers for one plain group", () => {
    const rows = [row("t1"), row("back1")];
    expect(shape(groupWindow(rows, { awayReturned: ["back1"], personal: false }))).toEqual([
      "t1",
      "back1",
    ]);
    expect(shape(groupWindow(rows, {}))).toEqual(["t1", "back1"]);
    expect(shape(groupWindow([row("p", { pinned: true })], {}))).toEqual([
      `#${MAIL_GROUP_LABELS.pinned}`,
      "p",
    ]);
  });

  it("shows the first 20 came-back threads, then Show {n} more", () => {
    const ids = Array.from({ length: AWAY_GROUP_MAX + 3 }, (_, i) => `b${i}`);
    const rows = [...ids.map((id) => row(id)), row("t1")];
    const folded = shape(groupWindow(rows, { awayReturned: ids, personal: true }));
    expect(folded.slice(0, 2)).toEqual([`#${MAIL_GROUP_LABELS.away}`, "b0"]);
    expect(folded).toContain("+3");
    expect(folded).not.toContain(`b${AWAY_GROUP_MAX}`);
    const all = shape(groupWindow(rows, { awayReturned: ids, personal: true, awayShowAll: true }));
    expect(all).not.toContain("+3");
    expect(all).toContain(`b${AWAY_GROUP_MAX + 2}`);
  });

  it("Newsletters: one row per sender, expanded on demand", () => {
    const lumen = { name: "Lumen Weekly", email: "hello@lumen.test" };
    const rows = [
      row("n1", { tab: "newsletters", senders: [lumen], lastDateMs: 5 }),
      row("n2", { tab: "newsletters", senders: [lumen], lastDateMs: 4 }),
      row("solo", { tab: "newsletters", lastDateMs: 3 }),
    ];
    const folded = groupWindow(rows, { newsletters: true });
    expect(shape(folded)).toEqual(["@hello@lumen.test·2", "solo"]);
    const sender = folded[0];
    expect(sender?.kind === "sender" && sender.group.name).toBe("Lumen Weekly");
    // A folded sender is walked through its newest thread.
    expect(navigableIds(folded)).toEqual(["n1", "solo"]);
    const open = groupWindow(rows, { newsletters: true, openSenders: new Set([lumen.email]) });
    expect(shape(open)).toEqual(["@hello@lumen.test·2", "n1", "n2", "solo"]);
    expect(navigableIds(open)).toEqual(["n1", "n2", "solo"]);
  });
});

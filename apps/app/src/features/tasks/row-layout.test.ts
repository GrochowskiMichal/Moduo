// TV-U1 · U1-1 — the row's fixed right-hand columns (which ones a view
// shows, collapsing the empty ones) and the one date a row's column carries.

import { describe, expect, it } from "@rstest/core";

import { formatAge } from "../../lib/time-format";
import { makeTask } from "./helpers";
import { isLate, type Task } from "./model";
import {
  columnWidths,
  DEFAULT_ROW_PROPERTIES,
  fitColumns,
  formatShortDate,
  handleLabel,
  projectLabel,
  rowColumns,
  type RowColumnsContext,
  rowDate,
} from "./row-layout";
import { waitingLabelsOf } from "./ui/row-facts";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b", title: id, position: id }),
    id,
    assigneeId: null,
    ...over,
  };
}

const ctx = (over: Partial<RowColumnsContext> = {}): RowColumnsContext => ({
  properties: DEFAULT_ROW_PROPERTIES,
  showAssignee: true,
  canEdit: true,
  isQueued: () => false,
  isClaimed: () => false,
  ...over,
});

describe("rowColumns (U1-1)", () => {
  it("collapses every property column that's empty on all rows", () => {
    const cols = rowColumns([task("a"), task("b")], ctx());
    expect(cols).toMatchObject({ priority: false, energy: false, date: false, assignee: false });
  });

  it("shows a column as soon as one row has a value for it", () => {
    const cols = rowColumns(
      [
        task("a", { priority: "high" }),
        task("b", { dueDate: "2026-10-20T00:00:00.000Z" }),
        task("c", { assigneeId: "u1" }),
      ],
      ctx(),
    );
    expect(cols).toMatchObject({ priority: true, date: true, assignee: true });
  });

  it("counts a scheduled time as a date too", () => {
    expect(rowColumns([task("a", { scheduledAt: "2026-10-20T09:00:00.000Z" })], ctx()).date).toBe(
      true,
    );
  });

  it("keeps energy off by default, and shows it once Display turns it on", () => {
    const rows = [task("a", { energyLevel: "low" })];
    expect(rowColumns(rows, ctx()).energy).toBe(false);
    expect(
      rowColumns(rows, ctx({ properties: [...DEFAULT_ROW_PROPERTIES, "energy"] })).energy,
    ).toBe(true);
  });

  it("drops a column Display turned off, even with values", () => {
    const rows = [task("a", { priority: "high", dueDate: "2026-10-20T00:00:00.000Z" })];
    const cols = rowColumns(rows, ctx({ properties: ["date"] }));
    expect(cols.priority).toBe(false);
    expect(cols.date).toBe(true);
  });

  it("has no assignee column where there's nobody to tell apart (solo, My tasks)", () => {
    const rows = [task("a", { assigneeId: "u1" })];
    expect(rowColumns(rows, ctx({ showAssignee: false })).assignee).toBe(false);
  });

  it("an editor gets the queue column for any open row; done rows can't be queued", () => {
    expect(rowColumns([task("a")], ctx()).queue).toBe(true);
    expect(rowColumns([task("a", { status: "done" })], ctx()).queue).toBe(false);
  });

  it("read-only, the queue column shows only when something is queued or claimed", () => {
    const rows = [task("a"), task("b")];
    expect(rowColumns(rows, ctx({ canEdit: false })).queue).toBe(false);
    expect(rowColumns(rows, ctx({ canEdit: false, isClaimed: (id) => id === "b" })).queue).toBe(
      true,
    );
  });

  it("widens the queue cell only when some row is in my queue and someone else's", () => {
    const rows = [task("a"), task("b")];
    expect(rowColumns(rows, ctx({ isQueued: (id) => id === "a" })).queueWide).toBe(false);
    expect(
      rowColumns(rows, ctx({ isQueued: (id) => id === "a", isClaimed: (id) => id === "a" }))
        .queueWide,
    ).toBe(true);
  });
});

describe("formatShortDate", () => {
  const now = new Date(2026, 9, 9, 12, 0); // Fri Oct 9 2026, local

  it("names today, tomorrow and yesterday", () => {
    expect(formatShortDate(new Date(2026, 9, 9, 8).toISOString(), now)).toBe("Today");
    expect(formatShortDate(new Date(2026, 9, 10).toISOString(), now)).toBe("Tomorrow");
    expect(formatShortDate(new Date(2026, 9, 8).toISOString(), now)).toBe("Yesterday");
  });

  it("uses the weekday for the rest of the coming week, the date after that", () => {
    const thu = new Date(2026, 9, 15);
    expect(formatShortDate(thu.toISOString(), now)).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(thu),
    );
    const later = new Date(2026, 9, 16);
    expect(formatShortDate(later.toISOString(), now)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(later),
    );
  });

  it("never uses a weekday for the past (it would read as the coming one)", () => {
    const lastMon = new Date(2026, 9, 5);
    expect(formatShortDate(lastMon.toISOString(), now)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(lastMon),
    );
  });

  it("adds the year outside this year", () => {
    const next = new Date(2027, 0, 5);
    expect(formatShortDate(next.toISOString(), now)).toBe(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(next),
    );
  });
});

describe("rowDate (U1-1: one date column)", () => {
  const now = new Date(2026, 9, 9, 12, 0);
  const at = (d: number, h = 0) => new Date(2026, 9, d, h).toISOString();

  it("is null without dates", () => {
    expect(rowDate(task("a"), now)).toBeNull();
  });

  it("shows a time scheduled for today as the time, with no drift before it", () => {
    const date = rowDate(task("a", { scheduledAt: at(9, 15) }), now);
    expect(date?.kind).toBe("scheduled");
    expect(date?.label).toBe(
      new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
        new Date(at(9, 15)),
      ),
    );
    expect(date?.drifted).toBe(false);
  });

  it("marks a passed scheduled time on an open task as drifted (quiet, never red)", () => {
    expect(rowDate(task("a", { scheduledAt: at(8, 9) }), now)?.drifted).toBe(true);
    expect(rowDate(task("a", { scheduledAt: at(8, 9), status: "done" }), now)?.drifted).toBe(false);
  });

  it("shows whichever date comes first by day; the scheduled time wins a tie", () => {
    const dueFirst = rowDate(task("a", { scheduledAt: at(14, 10), dueDate: at(12) }), now);
    expect(dueFirst?.kind).toBe("due");
    const scheduledFirst = rowDate(task("a", { scheduledAt: at(10, 10), dueDate: at(14) }), now);
    expect(scheduledFirst?.kind).toBe("scheduled");
    const sameDay = rowDate(task("a", { scheduledAt: at(12, 10), dueDate: at(12) }), now);
    expect(sameDay?.kind).toBe("scheduled");
  });

  it("describes both dates, the shown one first (the cell's name matches its editor)", () => {
    const scheduledShown = rowDate(task("a", { scheduledAt: at(10, 10), dueDate: at(14) }), now);
    expect(scheduledShown?.description).toMatch(/^Scheduled .+ · Due .+$/);
    const dueShown = rowDate(task("a", { scheduledAt: at(14, 10), dueDate: at(12) }), now);
    expect(dueShown?.description).toMatch(/^Due .+ · Scheduled .+$/);
  });
});

// TV-U10 — Detailed's columns, their widths, and which drop for room.
describe("Detailed rows (TV-U10)", () => {
  const detailed = (over: Partial<RowColumnsContext> = {}) =>
    ctx({ rows: "detailed", taskKey: "MOD", isWaiting: (id) => id === "w", ...over });

  it("adds handle, Project › Section, status, Due, Next session, waiting and updated", () => {
    const cols = rowColumns(
      [
        task("a", { number: 7, dueDate: "2026-10-20T00:00:00.000Z" }),
        task("w", { scheduledAt: "2026-10-21T09:00:00.000Z" }),
      ],
      detailed(),
    );
    expect(cols).toMatchObject({
      handle: true,
      project: true,
      status: true,
      due: true,
      session: true,
      waiting: true,
      updated: true,
      // Detailed's two date columns replace Standard's one.
      date: false,
    });
  });

  it("needs the workspace key and a numbered task for handles", () => {
    expect(rowColumns([task("a", { number: 7 })], detailed({ taskKey: null })).handle).toBe(false);
    expect(rowColumns([task("a")], detailed()).handle).toBe(false);
    expect(handleLabel("MOD", 142)).toBe("MOD-142");
    expect(handleLabel(null, 142)).toBeNull();
    expect(projectLabel("Acme", "Design")).toBe("Acme › Design");
    expect(projectLabel("Acme", null)).toBe("Acme");
  });

  it("sizes each column to its widest value, never narrower than its header", () => {
    const widths = columnWidths([{ due: "Tomorrow", status: "In review" }, { due: "Oct 16" }], {
      headers: true,
    });
    // "Tomorrow" (8) + its room (1); "In review" (9) + the icon's room (3).
    expect(widths.due).toBe(9);
    expect(widths.status).toBe(12);
    // Nothing in view: the header label's width ("Updated").
    expect(widths.updated).toBe(7);
    // A long project name stops growing the column (it wraps in its cell).
    expect(columnWidths([{ project: "x".repeat(80) }]).project).toBe(32);
  });

  it("drops whole columns, in order, as the centre narrows (research §1)", () => {
    const cols = rowColumns(
      [task("a", { number: 7, dueDate: "2026-10-20T00:00:00.000Z", scheduledAt: null })],
      detailed(),
    );
    const widths = columnWidths([{ project: "Acme rebrand › Design", status: "In review" }], {
      headers: true,
    });
    const wide = fitColumns(cols, widths, 1600, "detailed");
    expect(wide.hidden).toBe(0);
    const narrow = fitColumns(cols, widths, 460, "detailed");
    expect(narrow.hidden).toBeGreaterThan(0);
    // Updated goes first; Due never goes.
    expect(narrow.updated).toBe(false);
    expect(narrow.due).toBe(true);
    // Standard drops nothing.
    expect(fitColumns(cols, widths, 300, "standard")).toBe(cols);
  });
});

describe("the List's facts (TV-U10)", () => {
  const now = new Date(2026, 9, 13, 12, 0);

  it("ages read short: now, minutes, hours, days, weeks, then the date", () => {
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    expect(formatAge(ago(10_000), now)).toBe("now");
    expect(formatAge(ago(5 * 60_000), now)).toBe("5m");
    expect(formatAge(ago(3 * 3_600_000), now)).toBe("3h");
    expect(formatAge(ago(2 * 86_400_000), now)).toBe("2d");
    expect(formatAge(ago(15 * 86_400_000), now)).toBe("2w");
    expect(formatAge(ago(60 * 86_400_000), now)).toMatch(/Aug|14/);
  });

  it("late is an open task past its due day, never Backlog or closed", () => {
    const due = (over: Partial<Task>) => task("t", { dueOn: "2026-10-12", ...over });
    expect(isLate(due({}), "2026-10-13")).toBe(true);
    expect(isLate(due({}), "2026-10-12")).toBe(false);
    expect(isLate(due({ status: "done" }), "2026-10-13")).toBe(false);
    expect(isLate(due({ statusCategory: "backlog" }), "2026-10-13")).toBe(false);
    expect(isLate(task("t"), "2026-10-13")).toBe(false);
  });

  it("waiting reads 'on Anna · 2d', the earliest first, with '+n' for more", () => {
    const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const later = new Date(now.getTime() - 3_600_000).toISOString();
    const labels = waitingLabelsOf(
      [
        { taskId: "t1", kind: "person", ref: "u2", label: null, since },
        { taskId: "t1", kind: "text", ref: null, label: "the printer", since: later },
        { taskId: "t2", kind: "email", ref: null, label: null, since: later },
      ],
      (id) => (id === "u2" ? "Anna" : null),
      now,
    );
    expect(labels.get("t1")).toBe("on Anna +1 · 2d");
    expect(labels.get("t2")).toBe("on a reply · 1h");
  });
});

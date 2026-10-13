// TV-U15 · "day groups and one row per task" (specs/tasks-v3.md AC map:
// AC2.2, AC11.3). Upcoming's coverage rule, its one Date grouping (Earlier ·
// Today · Tomorrow · five day names · Later, the seven days always there),
// one row per task at its next session or due date, "missed 2:00 PM", the
// day headers' load line and the drag-to-another-day writes.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Task } from "./model";
import {
  dropDayFor,
  inUpcoming,
  isMissedSession,
  moveToDay,
  orderUpcoming,
  shiftDay,
  upcomingAccepts,
  upcomingGroups,
  upcomingHeaderLine,
  upcomingWhen,
} from "./upcoming";

const ME = "me";
// Wednesday, Oct 14 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0, 0);
const at = (day: number, h = 0, m = 0) => new Date(2026, 9, day, h, m, 0).toISOString();

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    creatorId: ME,
    assigneeId: ME,
    statusCategory: "todo",
    ...over,
  };
}

const coverage = { me: ME, myTeams: new Set(["design"]) };

describe("day groups and one row per task (AC2.2, AC11.3)", () => {
  it("covers your dated work and unassigned work, minus other teams' and Backlog", () => {
    const mine = task("mine", { dueDate: at(15) });
    const unassigned = task("unassigned", { assigneeId: null, dueDate: at(15) });
    const ours = task("ours", { assigneeId: null, teamId: "design", dueDate: at(15) });
    const theirs = task("theirs", { assigneeId: null, teamId: "dev", dueDate: at(15) });
    const someoneElses = task("someone", { assigneeId: "mike", dueDate: at(15) });
    const dateless = task("dateless");
    const parked = task("parked", { statusCategory: "backlog", dueDate: at(15) });
    const wontDo = task("wont", { status: "archived", statusCategory: "wont_do", dueDate: at(15) });
    const doneToday = task("doneToday", {
      status: "done",
      statusCategory: "done",
      dueDate: at(14),
    });
    const doneEarlier = task("doneEarlier", {
      status: "done",
      statusCategory: "done",
      dueDate: at(10),
    });
    const all = [
      mine,
      unassigned,
      ours,
      theirs,
      someoneElses,
      dateless,
      parked,
      wontDo,
      doneToday,
      doneEarlier,
    ];
    expect(all.filter((t) => inUpcoming(t, coverage, NOW)).map((t) => t.id)).toEqual([
      "mine",
      "unassigned",
      "ours",
      "doneToday",
    ]);
  });

  it("groups Earlier · Today · Tomorrow · five day names · Later, the seven days always", () => {
    const groups = upcomingGroups(
      [
        task("late", { dueDate: at(12) }),
        task("today", { dueDate: at(14) }),
        task("sat", { dueDate: at(17) }),
        task("nextMonth", { dueDate: new Date(2026, 10, 7).toISOString() }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.key)).toEqual([
      "earlier",
      "today",
      "tomorrow",
      "day2",
      "day3",
      "day4",
      "day5",
      "day6",
      "later",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Earlier",
      "Today",
      "Tomorrow",
      "Fri",
      "Sat",
      "Sun",
      "Mon",
      "Tue",
      "Later",
    ]);
    expect(groups.find((g) => g.key === "day3")?.tasks.map((t) => t.id)).toEqual(["sat"]);
    // Earlier and Later only when they hold work.
    expect(upcomingGroups([task("t", { dueDate: at(15) })], NOW).map((g) => g.key)).toEqual([
      "today",
      "tomorrow",
      "day2",
      "day3",
      "day4",
      "day5",
      "day6",
    ]);
  });

  it("places a row at its next session or due date, whichever comes first", () => {
    const sessionFirst = task("a", { scheduledAt: at(15, 9), dueDate: at(17) });
    const dueFirst = task("b", { scheduledAt: at(19, 9), dueDate: at(16) });
    const groups = upcomingGroups([sessionFirst, dueFirst], NOW);
    const where = (id: string) => groups.find((g) => g.tasks.some((t) => t.id === id))?.key;
    expect(where("a")).toBe("tomorrow");
    expect(where("b")).toBe("day2");
    // One row each.
    expect(groups.flatMap((g) => g.tasks)).toHaveLength(2);
  });

  it("a session that ended with the task open reads missed; a passed due date reads late", () => {
    const missed = task("m", { scheduledAt: at(13, 14), durationMinutes: 30 });
    expect(isMissedSession(missed, NOW)).toBe(true);
    expect(upcomingWhen(missed, NOW)).toMatch(/^missed Yesterday, 2:00\s?PM$/);
    const missedToday = task("mt", { scheduledAt: at(14, 8), durationMinutes: 60 });
    expect(upcomingWhen(missedToday, NOW)).toMatch(/^missed 8:00\s?AM$/);
    // A session still running isn't missed.
    const running = task("r", { scheduledAt: at(14, 9, 30), durationMinutes: 60 });
    expect(isMissedSession(running, NOW)).toBe(false);
    expect(upcomingWhen(running, NOW)).toMatch(/^9:30\s?AM · 1h$/);
    const late = task("l", { dueDate: at(8) });
    expect(upcomingWhen(late, NOW)).toBe("Oct 8 · late");
    expect(upcomingGroups([missed, late], NOW)[0]?.key).toBe("earlier");
  });

  it("a row inside a day shows only its time; Later shows the day", () => {
    expect(upcomingWhen(task("d", { dueDate: at(15) }), NOW)).toBe("due Tomorrow");
    expect(upcomingWhen(task("t", { dueDate: at(16), dueTime: "17:00:00" }), NOW)).toMatch(
      /^due 5:00\s?PM$/,
    );
    expect(upcomingWhen(task("n", { dueDate: new Date(2026, 10, 7).toISOString() }), NOW)).toBe(
      "due Nov 7",
    );
  });

  it("day headers carry the day's load, the estimate only when there is one", () => {
    const tomorrow = [
      task("x", { dueDate: at(15), estimateMinutes: 90 }),
      task("y", { scheduledAt: at(15, 9), durationMinutes: 60 }),
      task("z", { dueDate: at(15), status: "done", statusCategory: "done", estimateMinutes: 30 }),
    ];
    expect(upcomingHeaderLine("tomorrow", tomorrow, NOW)).toBe("· Thu, Oct 15 · 2 · ~2h 30m");
    expect(upcomingHeaderLine("day2", [task("w", { dueDate: at(16) })], NOW)).toBe("· Oct 16 · 1");
    expect(upcomingHeaderLine("day3", [], NOW)).toBe("· Oct 17");
    expect(upcomingHeaderLine("earlier", [], NOW)).toBeNull();
  });

  it("within a day: timed first, then priority, then the sidebar's project order", () => {
    const rank = (id: string) => (id === "p1" ? 0 : 1);
    const ordered = orderUpcoming(
      [
        task("plain-p2", { dueDate: at(15), bucketId: "p2" }),
        task("plain-p1", { dueDate: at(15) }),
        task("high", { dueDate: at(15), priority: "high", bucketId: "p2" }),
        task("at-11", { scheduledAt: at(15, 11) }),
        task("at-9", { scheduledAt: at(15, 9) }),
        task("today", { dueDate: at(14) }),
      ],
      rank,
    );
    expect(ordered.map((t) => t.id)).toEqual([
      "today",
      "at-9",
      "at-11",
      "high",
      "plain-p1",
      "plain-p2",
    ]);
  });

  it("moving to another day moves the due date, or the session keeping its time", () => {
    const due = task("due", { dueDate: at(15) });
    const move = moveToDay(due, "2026-10-17");
    expect(move).toEqual({ kind: "due", dueDate: at(17), day: "2026-10-17" });
    const session = task("s", { scheduledAt: at(15, 9, 30), durationMinutes: 45 });
    expect(moveToDay(session, "2026-10-19")).toEqual({
      kind: "session",
      scheduledAt: at(19, 9, 30),
      day: "2026-10-19",
    });
    expect(moveToDay(due, "2026-10-15")).toBeNull();
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("drops: Earlier takes nothing, Later opens the picker, a day its date", () => {
    const due = task("due", { dueDate: at(15) });
    expect(dropDayFor("earlier", NOW)).toBeNull();
    expect(dropDayFor("later", NOW)).toBe("pick");
    expect(dropDayFor("day3", NOW)).toBe("2026-10-17");
    expect(upcomingAccepts("earlier", due, NOW)).toBe(false);
    expect(upcomingAccepts("tomorrow", due, NOW)).toBe(false);
    expect(upcomingAccepts("day3", due, NOW)).toBe(true);
    expect(upcomingAccepts("later", due, NOW)).toBe(true);
  });
});

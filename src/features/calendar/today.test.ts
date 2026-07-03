import { describe, expect, it } from "vitest";

import { shapeToday } from "./today";
import type { LensTask } from "./lens";
import type { CalendarEventModel } from "./events";

const NOW = new Date(2026, 6, 2, 14, 0); // Thu Jul 2 2026, 14:00 local

function task(over: Partial<LensTask>): LensTask {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "task",
    scheduledAt: over.scheduledAt ?? null,
    durationMinutes: over.durationMinutes ?? 30,
    status: over.status ?? "todo",
    deletedAt: over.deletedAt ?? null,
  };
}
function event(over: Partial<CalendarEventModel>): CalendarEventModel {
  return {
    id: over.id ?? "e1",
    workspaceId: "w",
    ownerId: "u",
    sourceAccountId: over.sourceAccountId ?? null,
    externalEventId: over.externalEventId ?? null,
    calendarId: "c",
    title: over.title ?? "event",
    description: "",
    startsAt: over.startsAt ?? new Date(2026, 6, 2, 15, 0).toISOString(),
    endsAt: over.endsAt ?? new Date(2026, 6, 2, 16, 0).toISOString(),
    allDay: over.allDay ?? false,
    rrule: over.rrule ?? null,
    status: over.status ?? "confirmed",
    color: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}
function iso(h: number, m = 0): string {
  return new Date(2026, 6, 2, h, m).toISOString();
}

describe("today — the dashboard widget shaper (AC14)", () => {
  it("composes today's timed chips (events + blocks) sorted by start", () => {
    const view = shapeToday({
      tasks: [task({ id: "morning", scheduledAt: iso(9) }), task({ id: "afternoon", scheduledAt: iso(16) })],
      events: [event({ id: "mtg", startsAt: iso(15), endsAt: iso(15, 30) })],
      weekStartsOn: 1,
      now: NOW,
    });
    expect(view.chips.map((c) => c.entityId)).toEqual(["morning", "mtg", "afternoon"]);
    expect(view.chips.map((c) => c.entityType)).toEqual(["task", "event", "task"]);
  });

  it("picks next-up = the first not-ended, not-done chip; remaining = upcoming only", () => {
    const view = shapeToday({
      tasks: [
        task({ id: "past", scheduledAt: iso(9) }), // ended before now
        task({ id: "soon", scheduledAt: iso(15) }), // upcoming
      ],
      events: [event({ id: "later", startsAt: iso(16), endsAt: iso(17) })],
      weekStartsOn: 1,
      now: NOW,
    });
    expect(view.next?.entityId).toBe("soon");
    expect(view.remaining.map((c) => c.entityId)).toEqual(["soon", "later"]);
  });

  it("excludes done blocks from next-up/remaining but keeps them in chips", () => {
    const view = shapeToday({
      tasks: [task({ id: "done", scheduledAt: iso(15), status: "done" })],
      events: [],
      weekStartsOn: 1,
      now: NOW,
    });
    expect(view.chips.map((c) => c.entityId)).toEqual(["done"]);
    expect(view.next).toBeNull();
    expect(view.remaining).toEqual([]);
  });

  it("caps remaining to maxRemaining", () => {
    const tasks = [16, 17, 18, 19, 20].map((h) => task({ id: `t${h}`, scheduledAt: iso(h) }));
    const view = shapeToday({ tasks, events: [], weekStartsOn: 1, now: NOW, maxRemaining: 3 });
    expect(view.remaining).toHaveLength(3);
    expect(view.remaining.map((c) => c.entityId)).toEqual(["t16", "t17", "t18"]);
  });

  it("counts the strip (open tasks whose scheduled block passed)", () => {
    const view = shapeToday({
      tasks: [
        task({ id: "elapsed", scheduledAt: iso(9) }), // 9:00–9:30, passed → strip
        task({ id: "upcoming", scheduledAt: iso(16) }),
      ],
      events: [],
      weekStartsOn: 1,
      now: NOW,
    });
    expect(view.stripCount).toBe(1);
  });

  it("puts the now-line at the right minute into today", () => {
    const view = shapeToday({ tasks: [], events: [], weekStartsOn: 1, now: NOW });
    expect(view.nowMinutes).toBe(14 * 60);
  });

  it("excludes all-day events — the widget is a timed agenda (pinned intent)", () => {
    const view = shapeToday({
      tasks: [],
      events: [
        event({
          id: "allday",
          allDay: true,
          startsAt: new Date(2026, 6, 2, 0, 0).toISOString(),
          endsAt: new Date(2026, 6, 3, 0, 0).toISOString(),
        }),
      ],
      weekStartsOn: 1,
      now: NOW,
    });
    expect(view.chips).toEqual([]);
  });

  it("only counts today (a task tomorrow doesn't chip)", () => {
    const view = shapeToday({
      tasks: [task({ id: "tomorrow", scheduledAt: new Date(2026, 6, 3, 10, 0).toISOString() })],
      events: [],
      weekStartsOn: 1,
      now: NOW,
    });
    expect(view.chips).toEqual([]);
  });
});

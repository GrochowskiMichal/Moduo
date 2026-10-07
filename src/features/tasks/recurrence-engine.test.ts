import { describe, expect, it } from "@rstest/core";

import { makeTask, todayStr } from "./helpers";
import type { RecurrenceRule, Task, TaskStatus } from "./model";
import {
  catchUpPatch,
  currentOccurrence,
  occurrenceAfter,
  recurrenceOnStatusChange,
  skipOccurrencePatch,
} from "./recurrence-engine";

// Fixed instants (UTC) so the suite is deterministic regardless of wall clock.
const T0 = new Date("2026-06-10T08:00:00.000Z"); // a Wednesday, the anchor
const NOW = new Date("2026-06-12T10:00:00.000Z"); // Friday, 2 days + 2h later

function daily(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    rrule: "FREQ=DAILY;INTERVAL=1",
    dtstart: T0.toISOString(),
    nextOccurrence: null,
    ...overrides,
  };
}

function task(opts: Partial<Task> & { status?: TaskStatus } = {}): Task {
  const t = makeTask({ workspaceId: "w", bucketId: "b", title: "T", position: "p" });
  t.id = "t1";
  t.createdAt = T0.toISOString();
  t.updatedAt = T0.toISOString();
  return { ...t, ...opts };
}

describe("occurrence helpers", () => {
  it("occurrenceAfter is strictly after; currentOccurrence is latest ≤ now", () => {
    const rec = daily();
    expect(occurrenceAfter(rec, NOW)?.toISOString()).toBe("2026-06-13T08:00:00.000Z");
    expect(currentOccurrence(rec, NOW)?.toISOString()).toBe("2026-06-12T08:00:00.000Z");
    // exactly at an occurrence: after() skips it, before(inc) keeps it
    const at = new Date("2026-06-12T08:00:00.000Z");
    expect(occurrenceAfter(rec, at)?.toISOString()).toBe("2026-06-13T08:00:00.000Z");
    expect(currentOccurrence(rec, at)?.toISOString()).toBe("2026-06-12T08:00:00.000Z");
  });

  it("is defensive about malformed rules", () => {
    const bad = daily({ rrule: "not-an-rrule" });
    expect(occurrenceAfter(bad, NOW)).toBeNull();
    expect(currentOccurrence(bad, NOW)).toBeNull();
  });
});

describe("recurrenceOnStatusChange (advance-on-done)", () => {
  it("completing a drifted task advances from now — never backfills", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-12T08:00:00.000Z" });
    const rec = recurrenceOnStatusChange(t, "done", NOW);
    expect(rec?.nextOccurrence).toBe("2026-06-13T08:00:00.000Z");
  });

  it("completing early advances past the still-pending occurrence", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-13T08:00:00.000Z" });
    const rec = recurrenceOnStatusChange(t, "done", NOW);
    expect(rec?.nextOccurrence).toBe("2026-06-14T08:00:00.000Z");
  });

  it("un-completing refreshes the pointer; non-done transitions don't", () => {
    const t = task({
      recurrence: daily(),
      status: "done",
      scheduledAt: "2026-06-12T08:00:00.000Z",
    });
    expect(recurrenceOnStatusChange(t, "todo", NOW)?.nextOccurrence).toBe(
      "2026-06-13T08:00:00.000Z",
    );
    const open = task({ recurrence: daily() });
    expect(recurrenceOnStatusChange(open, "in_progress", NOW)).toBeNull();
    expect(recurrenceOnStatusChange(open, "archived", NOW)).toBeNull();
  });

  it("no-op without a rule or without a real transition", () => {
    expect(recurrenceOnStatusChange(task(), "done", NOW)).toBeNull();
    const t = task({ recurrence: daily(), status: "done" });
    expect(recurrenceOnStatusChange(t, "done", NOW)).toBeNull();
  });

  it("an exhausted rule advances to a null pointer (task stays done)", () => {
    const rec = daily({ rrule: "FREQ=DAILY;COUNT=2" }); // June 10 + 11 only
    const t = task({ recurrence: rec, scheduledAt: "2026-06-11T08:00:00.000Z" });
    expect(recurrenceOnStatusChange(t, "done", NOW)?.nextOccurrence).toBeNull();
  });
});

describe("catchUpPatch", () => {
  it("reopens a done task whose pointer has arrived, at the latest occurrence", () => {
    // Completed June 10; pointer June 11 08:00; opened June 12 10:00 — the
    // missed June 11 occurrence doesn't exist; it reopens at June 12 08:00.
    const t = task({
      status: "done",
      recurrence: daily({ nextOccurrence: "2026-06-11T08:00:00.000Z" }),
      scheduledAt: "2026-06-10T08:00:00.000Z",
      committedFor: "2026-06-10",
      commitOrder: 3,
    });
    const patch = catchUpPatch(t, NOW);
    expect(patch).toMatchObject({
      status: "todo",
      scheduledAt: "2026-06-12T08:00:00.000Z",
      committedFor: null,
      commitOrder: null,
    });
    expect(patch?.recurrence?.nextOccurrence).toBe("2026-06-13T08:00:00.000Z");
  });

  it("leaves a done task alone while its pointer is still in the future", () => {
    const t = task({
      status: "done",
      recurrence: daily({ nextOccurrence: "2026-06-13T08:00:00.000Z" }),
      scheduledAt: "2026-06-12T08:00:00.000Z",
    });
    expect(catchUpPatch(t, NOW)).toBeNull();
  });

  it("falls back to updatedAt for pre-engine done rows without a pointer", () => {
    const t = task({
      status: "done",
      recurrence: daily(),
      scheduledAt: "2026-06-10T08:00:00.000Z",
      updatedAt: "2026-06-10T09:00:00.000Z",
    });
    const patch = catchUpPatch(t, NOW);
    expect(patch?.status).toBe("todo");
    expect(patch?.scheduledAt).toBe("2026-06-12T08:00:00.000Z");
  });

  it("a done task with an exhausted rule stays done forever", () => {
    const t = task({
      status: "done",
      recurrence: daily({ rrule: "FREQ=DAILY;COUNT=2", nextOccurrence: null }),
      scheduledAt: "2026-06-11T08:00:00.000Z",
      updatedAt: "2026-06-11T09:00:00.000Z",
    });
    expect(catchUpPatch(t, NOW)).toBeNull();
  });

  it("collapses an open task that missed full occurrences — one drift, no pile", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-08T08:00:00.000Z" });
    const patch = catchUpPatch(t, NOW);
    expect(patch?.scheduledAt).toBe("2026-06-12T08:00:00.000Z");
    expect(patch?.recurrence?.nextOccurrence).toBe("2026-06-13T08:00:00.000Z");
    expect(patch?.status).toBeUndefined(); // stays open — no status write
  });

  it("does NOT catch up drift within the current occurrence", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-12T08:00:00.000Z" });
    expect(catchUpPatch(t, NOW)).toBeNull(); // 2h drifted — still actionable today
  });

  it("respects a scheduledAt deliberately pushed past the current occurrence", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-14T08:00:00.000Z" });
    expect(catchUpPatch(t, NOW)).toBeNull();
  });

  it("adopts the live occurrence for a recurring task with no scheduledAt", () => {
    const t = task({ recurrence: daily(), scheduledAt: null });
    expect(catchUpPatch(t, NOW)?.scheduledAt).toBe("2026-06-12T08:00:00.000Z");
  });

  it("adopts the first future occurrence when none has passed yet", () => {
    const future = daily({ dtstart: "2026-06-14T08:00:00.000Z" });
    const t = task({ recurrence: future, scheduledAt: null });
    expect(catchUpPatch(t, NOW)?.scheduledAt).toBe("2026-06-14T08:00:00.000Z");
  });

  it("skips non-recurring, archived, and deleted tasks", () => {
    expect(catchUpPatch(task(), NOW)).toBeNull();
    expect(catchUpPatch(task({ recurrence: daily(), status: "archived" }), NOW)).toBeNull();
    expect(
      catchUpPatch(
        task({ recurrence: daily(), scheduledAt: null, deletedAt: NOW.toISOString() }),
        NOW,
      ),
    ).toBeNull();
  });

  it("is idempotent: applying the patch yields no further patch", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-08T08:00:00.000Z" });
    const patch = catchUpPatch(t, NOW)!;
    expect(catchUpPatch({ ...t, ...patch }, NOW)).toBeNull();
  });
});

describe("skipOccurrencePatch", () => {
  it("skips a pending (or drifted) occurrence to the next one — no done-credit", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-12T08:00:00.000Z" });
    const patch = skipOccurrencePatch(t, NOW);
    expect(patch?.scheduledAt).toBe("2026-06-13T08:00:00.000Z");
    expect(patch?.recurrence?.nextOccurrence).toBe("2026-06-14T08:00:00.000Z");
    expect(patch?.status).toBeUndefined();
    expect(patch?.rescheduleCount).toBeUndefined(); // a decision, not a slip
  });

  it("skipping a future occurrence jumps past it", () => {
    const t = task({ recurrence: daily(), scheduledAt: "2026-06-13T08:00:00.000Z" });
    expect(skipOccurrencePatch(t, NOW)?.scheduledAt).toBe("2026-06-14T08:00:00.000Z");
  });

  it("releases today's commit when the new occurrence isn't today", () => {
    const t = task({
      recurrence: daily(),
      scheduledAt: "2026-06-12T08:00:00.000Z",
      committedFor: todayStr(NOW),
      commitOrder: 1,
    });
    const patch = skipOccurrencePatch(t, NOW);
    expect(patch?.committedFor).toBeNull();
    expect(patch?.commitOrder).toBeNull();
  });

  it("never offered on done tasks; null when the rule is exhausted", () => {
    expect(skipOccurrencePatch(task({ recurrence: daily(), status: "done" }), NOW)).toBeNull();
    const exhausted = daily({ rrule: "FREQ=DAILY;COUNT=2" });
    expect(
      skipOccurrencePatch(
        task({ recurrence: exhausted, scheduledAt: "2026-06-11T08:00:00.000Z" }),
        NOW,
      ),
    ).toBeNull();
  });
});

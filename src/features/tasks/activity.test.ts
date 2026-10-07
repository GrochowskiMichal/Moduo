// Activity-trail rendering (activity.ts) + the catch-up op item shaping
// (recurrence-engine catchUpItem) — the pure halves of Session 8's intent ops.

import { describe, expect, it } from "@rstest/core";

import { activityActorName, activityLine } from "./activity";
import type { ActivityEntry, RecurrenceRule, Task } from "./model";
import { catchUpItem } from "./recurrence-engine";

function entry(
  op: string,
  payload: Record<string, unknown> = {},
): Pick<ActivityEntry, "op" | "payload"> {
  return { op, payload };
}

describe("activityActorName", () => {
  const base = { actorType: "user" as const, actorId: "u1", actorLabel: "Maciej" };

  it("says You for the current user", () => {
    expect(activityActorName(base, "u1")).toBe("You");
  });

  it("uses the recorded label for someone else", () => {
    expect(activityActorName(base, "u2")).toBe("Maciej");
  });

  it("falls back quietly per actor type", () => {
    expect(activityActorName({ actorType: "user", actorId: null, actorLabel: null }, "u1")).toBe(
      "Someone",
    );
    expect(activityActorName({ actorType: "agent", actorId: null, actorLabel: null }, "u1")).toBe(
      "An agent",
    );
    expect(activityActorName({ actorType: "api_key", actorId: null, actorLabel: null }, "u1")).toBe(
      "An API client",
    );
  });
});

describe("activityLine", () => {
  it("renders commit with the queue date, and reorders as Do last", () => {
    expect(activityLine(entry("tasks.commit", { for: "2026-06-12", order: 3 }))).toMatch(
      /^committed this for /,
    );
    expect(activityLine(entry("tasks.commit", { for: "2026-06-12", reordered: true }))).toBe(
      "sent this to the end of the queue",
    );
  });

  it("maps status transitions to intent verbs", () => {
    expect(activityLine(entry("tasks.set_status", { from: "todo", to: "done" }))).toBe(
      "completed this",
    );
    expect(activityLine(entry("tasks.set_status", { from: "done", to: "todo" }))).toBe(
      "reopened this",
    );
    expect(activityLine(entry("tasks.set_status", { from: "todo", to: "archived" }))).toBe(
      "archived this",
    );
    expect(activityLine(entry("tasks.set_status", { from: "todo", to: "in_progress" }))).toBe(
      "started this",
    );
  });

  it("describes the recurrence ops factually", () => {
    expect(activityLine(entry("tasks.skip_occurrence", { to: "2099-06-14T07:00:00Z" }))).toMatch(
      /^skipped an occurrence — next /,
    );
    expect(
      activityLine(entry("tasks.catch_up", { kind: "reopen", to: "2099-06-13T07:00:00Z" })),
    ).toMatch(/^reopened this for .*recurrence/);
    expect(activityLine(entry("tasks.skip_today"))).toBe("skipped this for the day");
    expect(activityLine(entry("tasks.unschedule"))).toBe("cleared the scheduled time");
  });

  it("renders DF-9 spine notifications in the trail with a neutral, third-person voice", () => {
    // The trail is read by anyone, so it must NOT use the notification card's "…to you".
    expect(activityLine(entry("tasks.assigned"))).toBe("assigned this");
    expect(activityLine(entry("tasks.unblocked", { blocker_title: "Ship the API" }))).toBe(
      "finished “Ship the API”, unblocking this",
    );
    expect(activityLine(entry("tasks.unblocked"))).toBe("unblocked this");
  });

  it("never lies by omission — unknown ops fall back to the op name", () => {
    expect(activityLine(entry("tasks.future_op"))).toBe("tasks.future_op");
  });
});

describe("catchUpItem", () => {
  const rec: RecurrenceRule = {
    rrule: "FREQ=DAILY",
    dtstart: null,
    nextOccurrence: "2026-06-13T07:00:00Z",
  };

  it("shapes a reopen (status present ⇒ commit cleared)", () => {
    const task = { id: "t1", scheduledAt: "2026-06-10T07:00:00Z" } as Pick<
      Task,
      "id" | "scheduledAt"
    >;
    const item = catchUpItem(task, {
      status: "todo",
      scheduledAt: "2026-06-12T07:00:00Z",
      recurrence: rec,
      committedFor: null,
      commitOrder: null,
    });
    expect(item).toEqual({
      taskId: "t1",
      kind: "reopen",
      status: "todo",
      scheduledAt: "2026-06-12T07:00:00Z",
      recurrence: rec,
      clearCommit: true,
    });
  });

  it("shapes a collapse (open task moved forward, commit untouched)", () => {
    const task = { id: "t2", scheduledAt: "2026-06-10T07:00:00Z" } as Pick<
      Task,
      "id" | "scheduledAt"
    >;
    const item = catchUpItem(task, { scheduledAt: "2026-06-12T07:00:00Z", recurrence: rec });
    expect(item.kind).toBe("collapse");
    expect(item.status).toBeUndefined();
    expect(item.clearCommit).toBeUndefined();
  });

  it("shapes an adopt (no scheduled time yet)", () => {
    const task = { id: "t3", scheduledAt: null } as Pick<Task, "id" | "scheduledAt">;
    const item = catchUpItem(task, { scheduledAt: "2026-06-12T07:00:00Z", recurrence: rec });
    expect(item.kind).toBe("adopt");
  });
});

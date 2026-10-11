// Activity-trail rendering (activity.ts): one quiet sentence per intent op.

import { describe, expect, it } from "@rstest/core";

import { activityActorName, activityLine, isTrailEntry } from "./activity";
import type { ActivityEntry, RecurrenceRule, Task } from "./model";

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
      "marked this Won’t do",
    );
    expect(activityLine(entry("tasks.set_status", { from: "archived", to: "todo" }))).toBe(
      "reopened this",
    );
    expect(activityLine(entry("tasks.set_status", { from: "todo", to: "in_progress" }))).toBe(
      "started this",
    );
  });

  it("names the project's own status, by its category (TV-D9)", () => {
    const line = (payload: Record<string, unknown>) =>
      activityLine(entry("tasks.set_status", payload));
    // A backlog task stores "todo" in the legacy column: the name tells.
    expect(
      line({
        from: "todo",
        to: "todo",
        from_category: "todo",
        to_category: "backlog",
        to_name: "Backlog",
      }),
    ).toBe("set this to Backlog");
    expect(
      line({ from: "todo", to: "in_progress", to_category: "in_progress", to_name: "In review" }),
    ).toBe("set this to In review");
    expect(
      line({ from: "todo", to: "in_progress", to_category: "in_progress", to_name: "In progress" }),
    ).toBe("started this");
    expect(line({ to: "done", to_category: "done", to_name: "Published" })).toBe("completed this");
    expect(line({ to: "archived", to_category: "wont_do", to_name: "Canceled" })).toBe(
      "marked this Won’t do",
    );
    expect(
      line({
        from: "done",
        to: "todo",
        from_category: "done",
        to_category: "todo",
        to_name: "Todo",
      }),
    ).toBe("reopened this");
    expect(
      line({ from: "todo", to: "todo", to_category: "todo", to_name: "Todo", reason: "scheduled" }),
    ).toBe("scheduled this, so it moved to Todo");
  });

  it("describes personal-queue adds and removals in the actor's voice (TV-D2)", () => {
    expect(activityLine(entry("tasks.queue_add", { at: "end" }))).toBe("queued this");
    expect(activityLine(entry("tasks.queue_add", { at: "top" }))).toBe("queued this first");
    expect(activityLine(entry("tasks.queue_add"))).toBe("queued this");
    expect(activityLine(entry("tasks.queue_remove"))).toBe("removed this from the queue");
    expect(isTrailEntry(entry("tasks.queue_add"))).toBe(true);
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

  it("describes creates and field edits (TV-D8: every create and edit is an op)", () => {
    expect(activityLine(entry("tasks.create", { title: "Logo", number: 3 }))).toBe("created this");
    expect(activityLine(entry("tasks.delete"))).toBe("deleted this");
    expect(activityLine(entry("tasks.restore"))).toBe("restored this");
    expect(
      activityLine(
        entry("tasks.update", { fields: ["title"], title: { from: "Logo", to: "Logo v2" } }),
      ),
    ).toBe("renamed this to “Logo v2”");
    expect(activityLine(entry("tasks.update", { fields: ["description"] }))).toBe(
      "edited the description",
    );
    expect(
      activityLine(
        entry("tasks.update", { fields: ["due_date"], due_date: { from: null, to: null } }),
      ),
    ).toBe("cleared the due date");
    expect(
      activityLine(
        entry("tasks.update", {
          fields: ["due_date"],
          due_date: { from: null, to: "2099-03-04T00:00:00Z" },
        }),
      ),
    ).toMatch(/^set the due date to Mar \d/);
    expect(
      activityLine(
        entry("tasks.update", {
          fields: ["bucket_id"],
          bucket_id: { from: "b1", to: "b2" },
          subtasks_moved: 2,
        }),
      ),
    ).toBe("moved this and its 2 subtasks to another project");
    expect(
      activityLine(entry("tasks.update", { fields: ["priority"], priority: { to: "high" } })),
    ).toBe("set high priority");
    expect(activityLine(entry("tasks.update", { fields: ["title", "due_date", "priority"] }))).toBe(
      "changed the title, the due date and the priority",
    );
    expect(activityLine(entry("tasks.update", {}))).toBe("edited this");
  });

  it("renders DF-9 spine notifications in the trail with a neutral, third-person voice", () => {
    // The trail is read by anyone, so it must NOT use the notification card's "…to you".
    expect(activityLine(entry("tasks.assigned"))).toBe("assigned this");
    // TV-D1: every assignee change is in the trail, not only the notified ones.
    expect(activityLine(entry("tasks.assigned", { to: "u2", self: false }))).toBe("assigned this");
    expect(activityLine(entry("tasks.assigned", { from: "u2", to: null, self: false }))).toBe(
      "unassigned this",
    );
    expect(activityLine(entry("tasks.assigned", { to: "u1", self: true }))).toBe("took this");
    expect(activityLine(entry("tasks.unblocked", { blocker_title: "Ship the API" }))).toBe(
      "finished “Ship the API”, unblocking this",
    );
    expect(activityLine(entry("tasks.unblocked"))).toBe("unblocked this");
  });

  it("keeps the completed-by-someone-else notification out of the trail (TV-D1)", () => {
    // tasks.set_status already says "completed this" there; the notification
    // copy would repeat it.
    expect(isTrailEntry(entry("tasks.completed"))).toBe(false);
    expect(isTrailEntry(entry("tasks.set_status", { to: "done" }))).toBe(true);
    expect(isTrailEntry(entry("tasks.assigned"))).toBe(true);
    expect(activityLine(entry("tasks.completed"))).toBe("completed this");
  });

  it("names sections, teams, sessions and Waiting on (TV-D10)", () => {
    const update = (field: string, to: unknown) =>
      entry("tasks.update", { fields: [field], [field]: { from: null, to } });
    expect(activityLine(update("section_id", "s1"))).toBe("moved this to a section");
    expect(activityLine(update("section_id", null))).toBe("moved this to No section");
    expect(activityLine(update("team_id", "tm1"))).toBe("routed this to a team");
    expect(activityLine(update("estimate_minutes", 90))).toBe("changed the estimate");
    expect(activityLine(entry("tasks.session_add", { starts_at: null }))).toBe(
      "scheduled a session",
    );
    expect(activityLine(entry("tasks.session_remove"))).toBe("removed a session");
    expect(
      activityLine(entry("tasks.waiting_add", { kind: "text", label: "Client feedback" })),
    ).toBe("is waiting on “Client feedback”");
    // An email's subject never reaches the trail.
    expect(activityLine(entry("tasks.waiting_add", { kind: "email", ref: "e1" }))).toBe(
      "is waiting on an email",
    );
    expect(activityLine(entry("tasks.waiting_remove", { kind: "person", ref: "u2" }))).toBe(
      "stopped waiting on someone",
    );
  });

  it("never lies by omission — unknown ops fall back to the op name", () => {
    expect(activityLine(entry("tasks.future_op"))).toBe("tasks.future_op");
  });
});

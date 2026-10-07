// DF-21e AC9 — the opt-in overdue section: with the pref ON, drifted tasks become
// passive items; with it OFF, the section is empty; resolving a task drops it.

import { describe, expect, it } from "@rstest/core";

import { type OverdueTaskInput, selectOverdueTasks } from "./overdue-inbox";

const NOW = new Date("2026-07-14T12:00:00Z");
const past = "2026-07-13T09:00:00Z";
const older = "2026-07-10T09:00:00Z";
const future = "2026-07-20T09:00:00Z";

function task(over: Partial<OverdueTaskInput> & Pick<OverdueTaskInput, "id">): OverdueTaskInput {
  return { title: `Task ${over.id}`, scheduledAt: past, status: "todo", ownerId: "me", ...over };
}

const ON = { enabled: true, userId: "me", now: NOW } as const;

describe("selectOverdueTasks", () => {
  it("is EMPTY when the opt-in pref is off, regardless of drift (AC9)", () => {
    const tasks = [task({ id: "a", scheduledAt: past }), task({ id: "b", scheduledAt: older })];
    expect(selectOverdueTasks(tasks, { enabled: false, userId: "me", now: NOW })).toEqual([]);
  });

  it("surfaces drifted (past + still open) tasks when enabled", () => {
    const tasks = [
      task({ id: "drifted", scheduledAt: past }),
      task({ id: "future", scheduledAt: future }), // scheduled ahead — not drifted
      task({ id: "unscheduled", scheduledAt: null }), // no time — never drifts
    ];
    const items = selectOverdueTasks(tasks, ON);
    expect(items.map((i) => i.id)).toEqual(["drifted"]);
    expect(items[0]).toMatchObject({ id: "drifted", title: "Task drifted", scheduledAt: past });
  });

  it("scopes to the current user's own tasks — a teammate's drift is not my overdue", () => {
    const tasks = [
      task({ id: "mine", ownerId: "me", scheduledAt: past }),
      task({ id: "theirs", ownerId: "someone-else", scheduledAt: past }),
    ];
    expect(selectOverdueTasks(tasks, ON).map((i) => i.id)).toEqual(["mine"]);
    // No signed-in user → nothing (defensive).
    expect(selectOverdueTasks(tasks, { enabled: true, userId: null, now: NOW })).toEqual([]);
  });

  it("excludes done/archived tasks — resolving a task drops it from the section (AC9)", () => {
    const before = [task({ id: "x", scheduledAt: past, status: "todo" })];
    expect(selectOverdueTasks(before, ON).map((i) => i.id)).toEqual(["x"]);
    // Same task, now completed → gone (no stored row to clean up).
    const doneNow = [task({ id: "x", scheduledAt: past, status: "done" })];
    expect(selectOverdueTasks(doneNow, ON)).toEqual([]);
    const archived = [task({ id: "x", scheduledAt: past, status: "archived" })];
    expect(selectOverdueTasks(archived, ON)).toEqual([]);
  });

  it("orders most-overdue first (oldest scheduled time)", () => {
    const items = selectOverdueTasks(
      [task({ id: "recent", scheduledAt: past }), task({ id: "ancient", scheduledAt: older })],
      ON,
    );
    expect(items.map((i) => i.id)).toEqual(["ancient", "recent"]);
  });
});

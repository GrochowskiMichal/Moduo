import { describe, expect, it } from "@rstest/core";

import type { Task } from "../tasks/model";
import { groupPlanTasks, PLAN_GROUP_ROWS, planRows } from "./panel";

const ME = "me";
const NOW = new Date(2026, 6, 2, 11, 0); // Thu Jul 2 2026, local; a Monday week runs Jun 29 – Jul 5

let seq = 0;
function makePlanTask(overrides: Partial<Task> & { title: string }): Task {
  seq += 1;
  return {
    id: overrides.id ?? `t${seq}`,
    workspaceId: "ws",
    creatorId: ME,
    creatorUnknown: false,
    assigneeId: ME,
    bucketId: "b",
    parentId: null,
    description: "",
    dueDate: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: `p${seq}`,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    deletedAt: null,
    ...overrides,
  } as Task;
}

const due = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();
const titles = (list: Task[]) => list.map((t) => t.title);
const plan = (tasks: Task[], query?: string) =>
  groupPlanTasks({ tasks, me: ME, now: NOW, weekStartsOn: 1, query });

describe("Plan groups (CALR-5, AC24)", () => {
  it("lists From earlier, Due this week, Scheduled and No date", () => {
    const groups = plan([
      makePlanTask({ title: "slipped", dueDate: due(2026, 5, 24) }),
      makePlanTask({ title: "due friday", dueDate: due(2026, 6, 3) }),
      makePlanTask({ title: "placed", scheduledAt: new Date(2026, 6, 2, 15).toISOString() }),
      makePlanTask({ title: "someday" }),
    ]);
    expect(titles(groups.earlier)).toEqual(["slipped"]);
    expect(titles(groups.thisWeek)).toEqual(["due friday"]);
    expect(titles(groups.scheduled)).toEqual(["placed"]);
    expect(titles(groups.noDate)).toEqual(["someday"]);
    expect(groups.emptyBySearch).toBe(false);
  });

  it("only your tasks: assigned to you, or unassigned and yours", () => {
    const groups = plan([
      makePlanTask({ title: "mine" }),
      makePlanTask({ title: "unassigned, mine", assigneeId: null }),
      makePlanTask({ title: "Kai's", assigneeId: "kai" }),
      makePlanTask({ title: "unassigned, Kai's", assigneeId: null, creatorId: "kai" }),
      makePlanTask({ title: "mine but I'm not creator", creatorId: "kai" }),
    ]);
    expect(titles(groups.noDate)).toEqual(["mine", "unassigned, mine", "mine but I'm not creator"]);
  });

  it("From earlier runs oldest first, Due this week by date, Scheduled by time", () => {
    const groups = plan([
      makePlanTask({ title: "late two", dueDate: due(2026, 5, 30) }),
      makePlanTask({ title: "late one", dueDate: due(2026, 5, 12) }),
      makePlanTask({ title: "sunday", dueDate: due(2026, 6, 5) }),
      makePlanTask({ title: "today", dueDate: due(2026, 6, 2) }),
      makePlanTask({ title: "at four", scheduledAt: new Date(2026, 6, 3, 16).toISOString() }),
      makePlanTask({ title: "at nine", scheduledAt: new Date(2026, 6, 3, 9).toISOString() }),
    ]);
    expect(titles(groups.earlier)).toEqual(["late one", "late two"]);
    expect(titles(groups.thisWeek)).toEqual(["today", "sunday"]);
    expect(titles(groups.scheduled)).toEqual(["at nine", "at four"]);
  });

  it("a task placed today or later is Scheduled, even when it is due earlier", () => {
    const groups = plan([
      makePlanTask({
        title: "overdue, placed",
        dueDate: due(2026, 5, 20),
        scheduledAt: new Date(2026, 6, 2, 14).toISOString(),
      }),
    ]);
    expect(titles(groups.scheduled)).toEqual(["overdue, placed"]);
    expect(groups.earlier).toHaveLength(0);
  });

  it("due after this week is not in the four groups, only found by search (Later)", () => {
    const next = makePlanTask({ title: "next monday", dueDate: due(2026, 6, 6) });
    const quiet = plan([next]);
    expect(quiet.thisWeek).toHaveLength(0);
    expect(quiet.noDate).toHaveLength(0);
    expect(titles(quiet.later)).toEqual(["next monday"]);
  });

  it("a backlog-status task is never in a dated group: it waits in No date", () => {
    const parked = makePlanTask({
      title: "parked",
      dueDate: due(2026, 5, 24),
      statusCategory: "backlog",
    } as Partial<Task> & { title: string });
    const groups = plan([parked]);
    expect(groups.earlier).toHaveLength(0);
    expect(titles(groups.noDate)).toEqual(["parked"]);
  });

  it("done, archived, deleted and subtasks are left out", () => {
    const groups = plan([
      makePlanTask({ title: "done", status: "done" }),
      makePlanTask({ title: "archived", status: "archived" }),
      makePlanTask({ title: "gone", deletedAt: "2026-07-01T00:00:00Z" }),
      makePlanTask({ title: "sub", parentId: "parent-1" }),
    ]);
    const all = [
      ...groups.earlier,
      ...groups.thisWeek,
      ...groups.scheduled,
      ...groups.noDate,
      ...groups.later,
    ];
    expect(all).toHaveLength(0);
  });

  it("Find a task filters every group; a dry query says so", () => {
    const tasks = [
      makePlanTask({ title: "email Jan", dueDate: due(2026, 5, 24) }),
      makePlanTask({ title: "invoice run" }),
    ];
    const hit = plan(tasks, "EMAIL");
    expect(titles(hit.earlier)).toEqual(["email Jan"]);
    expect(hit.noDate).toHaveLength(0);
    expect(plan(tasks, "zzz").emptyBySearch).toBe(true);
  });

  it("due dates compare as local days (a local-midnight instant is today, not yesterday)", () => {
    const groups = plan([
      makePlanTask({ title: "due today", dueDate: new Date(2026, 6, 2, 0, 0).toISOString() }),
    ]);
    expect(titles(groups.thisWeek)).toEqual(["due today"]);
    expect(groups.earlier).toHaveLength(0);
  });

  it("six rows a group, then Show more", () => {
    expect(PLAN_GROUP_ROWS).toBe(6);
    const list = Array.from({ length: 9 }, (_, i) => i);
    expect(planRows(list, false)).toEqual({ rows: [0, 1, 2, 3, 4, 5], more: 3 });
    expect(planRows(list, true)).toEqual({ rows: list, more: 0 });
    expect(planRows([1, 2], false)).toEqual({ rows: [1, 2], more: 0 });
  });
});

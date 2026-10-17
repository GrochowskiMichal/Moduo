import { describe, expect, it } from "@rstest/core";
import type { Task } from "../tasks/model";
import { groupPanelTasks } from "./panel";

const NOW = new Date(2026, 6, 2, 11, 0); // Thu Jul 2, local

let seq = 0;
function makePanelTask(overrides: Partial<Task> & { title: string }): Task {
  seq += 1;
  return {
    id: overrides.id ?? `t${seq}`,
    workspaceId: "ws",
    creatorId: "u",
    creatorUnknown: false,
    assigneeId: "u",
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

describe("groupPanelTasks — the right panel's three groups (AC11)", () => {
  it("groups my queue → Queue, due-within-7d → Due soon, open unscheduled → Backlog", () => {
    const queued = makePanelTask({ title: "invoice run" });
    const dueSoon = makePanelTask({
      title: "offer draft",
      dueDate: new Date(2026, 6, 5, 0, 0).toISOString(),
    });
    const backlog = makePanelTask({ title: "someday thing" });
    const groups = groupPanelTasks({
      tasks: [dueSoon, backlog, queued],
      queuedTasks: [queued],
      now: NOW,
    });
    expect(groups.queue.map((t) => t.title)).toEqual(["invoice run"]);
    expect(groups.dueSoon.map((t) => t.title)).toEqual(["offer draft"]);
    expect(groups.backlog.map((t) => t.title)).toEqual(["someday thing"]);
    expect(groups.emptyBySearch).toBe(false);
  });

  it("OVERDUE open tasks stay visible under Due soon (graceful slippage)", () => {
    const overdue = makePanelTask({
      title: "slipped last week",
      dueDate: new Date(2026, 5, 25).toISOString(),
    });
    const groups = groupPanelTasks({ tasks: [overdue], queuedTasks: [], now: NOW });
    expect(groups.dueSoon.map((t) => t.title)).toEqual(["slipped last week"]);
    expect(groups.backlog).toHaveLength(0);
  });

  it("never lists a task twice: queued wins over due-soon; due beyond 7d isn't due-soon", () => {
    const both = makePanelTask({
      title: "queued and due",
      dueDate: new Date(2026, 6, 3).toISOString(),
    });
    const farDue = makePanelTask({
      title: "due in august",
      dueDate: new Date(2026, 7, 10).toISOString(),
    });
    const groups = groupPanelTasks({
      tasks: [both, farDue],
      queuedTasks: [both],
      now: NOW,
    });
    expect(groups.queue).toHaveLength(1);
    expect(groups.dueSoon).toHaveLength(0);
    // Far-due, unscheduled → backlog (still findable).
    expect(groups.backlog.map((t) => t.title)).toEqual(["due in august"]);
  });

  it("scheduled rows sort to the bottom of their group, never vanish", () => {
    const scheduled = makePanelTask({
      title: "already placed",
      scheduledAt: new Date(2026, 6, 2, 14, 0).toISOString(),
    });
    const unscheduled = makePanelTask({ title: "still loose" });
    const groups = groupPanelTasks({
      tasks: [scheduled, unscheduled],
      queuedTasks: [scheduled, unscheduled],
      now: NOW,
    });
    expect(groups.queue.map((t) => t.title)).toEqual(["still loose", "already placed"]);
  });

  it("scheduled non-backlog rules: a scheduled, unqueued, undated task appears nowhere but the grid", () => {
    const scheduledLoose = makePanelTask({
      title: "on the grid only",
      scheduledAt: new Date(2026, 6, 2, 9, 0).toISOString(),
    });
    const groups = groupPanelTasks({ tasks: [scheduledLoose], queuedTasks: [], now: NOW });
    expect(groups.backlog).toHaveLength(0);
  });

  it("done/archived/deleted/subtasks are excluded", () => {
    const done = makePanelTask({ title: "done", status: "done" });
    const archived = makePanelTask({ title: "archived", status: "archived" });
    const sub = makePanelTask({ title: "subtask", parentId: "parent-1" });
    const groups = groupPanelTasks({
      tasks: [done, archived, sub],
      queuedTasks: [],
      now: NOW,
    });
    expect(groups.queue).toHaveLength(0);
    expect(groups.dueSoon).toHaveLength(0);
    expect(groups.backlog).toHaveLength(0);
  });

  it("search filters every group; emptyBySearch flags a dry query", () => {
    const queued = makePanelTask({ title: "invoice run" });
    const backlog = makePanelTask({ title: "email Jan" });
    const hit = groupPanelTasks({
      tasks: [queued, backlog],
      queuedTasks: [queued],
      query: "email",
      now: NOW,
    });
    expect(hit.queue).toHaveLength(0);
    expect(hit.backlog.map((t) => t.title)).toEqual(["email Jan"]);
    const dry = groupPanelTasks({
      tasks: [queued, backlog],
      queuedTasks: [queued],
      query: "zzz",
      now: NOW,
    });
    expect(dry.emptyBySearch).toBe(true);
  });

  it("the backlog caps and due-date compare normalizes to LOCAL days (timestamptz gotcha)", () => {
    const many = Array.from({ length: 60 }, (_, i) => makePanelTask({ title: `backlog ${i}` }));
    const capped = groupPanelTasks({ tasks: many, queuedTasks: [], now: NOW });
    expect(capped.backlog).toHaveLength(50);
    // Due "today" stored as a UTC instant from local midnight must count as
    // due-soon even when the UTC date differs from the local date.
    const localMidnight = new Date(2026, 6, 2, 0, 0); // may be Jul 1 in UTC
    const dueToday = makePanelTask({ title: "due today", dueDate: localMidnight.toISOString() });
    const groups = groupPanelTasks({ tasks: [dueToday], queuedTasks: [], now: NOW });
    expect(groups.dueSoon.map((t) => t.title)).toEqual(["due today"]);
  });
});

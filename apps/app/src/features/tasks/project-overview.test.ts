// TV-U16 · The project overview's numbers and lists (AC6.6 "Done this month ·
// 14 · 22h", AC6.4's client rollup, AC5.6's departure words): sections,
// who's on it, completions in a month in the reader's zone, waiting,
// what happened recently, and what someone leaving hands on.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Bucket, Section, Task, TaskCompletion, TaskWaitingEntry } from "./model";
import {
  clientRollup,
  dayIn,
  departureLines,
  departureSummary,
  doneInRange,
  projectPeople,
  recentActivity,
  sectionProgress,
  waitingIn,
} from "./project-overview";
import { reportRange } from "./time-report";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position: id }),
    id,
    creatorId: "ann",
    statusCategory: "todo",
    createdAt: "2026-10-01T09:00:00.000Z",
    ...over,
  };
}

const section = (id: string, position: number, over: Partial<Section> = {}): Section => ({
  id,
  workspaceId: "w",
  projectId: "p1",
  name: id,
  position,
  startsOn: null,
  endsOn: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const completion = (taskId: string, at: string, over: Partial<TaskCompletion> = {}) =>
  ({
    id: `c-${taskId}-${at}`,
    workspaceId: "w",
    taskId,
    userId: "ann",
    completedAt: at,
    cycleKey: "once",
    updatedAt: at,
    deletedAt: null,
    ...over,
  }) satisfies TaskCompletion;

const project = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w",
  ownerId: "ann",
  name: id,
  isSystem: false,
  group: null,
  position: id,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
  ...over,
});

const waiting = (taskId: string, since: string): TaskWaitingEntry => ({
  id: `w-${taskId}-${since}`,
  workspaceId: "w",
  taskId,
  kind: "person",
  ref: "bob",
  label: null,
  since,
  createdBy: "ann",
  updatedAt: since,
});

describe("sectionProgress", () => {
  it("counts each section's done of total, leaving Backlog and Won't do out", () => {
    const tasks = [
      task("a", { sectionId: "s1", statusCategory: "done", status: "done" }),
      task("b", { sectionId: "s1" }),
      task("c", { sectionId: "s1", statusCategory: "wont_do", status: "archived" }),
      task("d", { sectionId: "s1", statusCategory: "backlog" }),
      task("e", { sectionId: "s2" }),
    ];
    const parts = sectionProgress(tasks, "p1", [section("s2", 1), section("s1", 0)]);
    expect(parts.map((p) => [p.section.id, p.done, p.total])).toEqual([
      ["s1", 1, 2],
      ["s2", 0, 1],
    ]);
  });
});

describe("projectPeople", () => {
  it("lists the lead first, then whoever has the most open work", () => {
    const tasks = [
      task("a", { assigneeId: "bob" }),
      task("b", { assigneeId: "cy" }),
      task("c", { assigneeId: "cy" }),
      task("d", { assigneeId: "dee", statusCategory: "done", status: "done" }),
    ];
    expect(projectPeople(tasks, "p1", "lea")).toEqual([
      { userId: "lea", open: 0, lead: true },
      { userId: "cy", open: 2, lead: false },
      { userId: "bob", open: 1, lead: false },
    ]);
  });
});

describe("doneInRange (Done this month)", () => {
  const month = { from: "2026-10-01", to: "2026-10-31" };
  it("counts every completion in the month, each repeat cycle too, and drops taken-back ones", () => {
    const tasks = [task("r"), task("once", { statusCategory: "done", status: "done" }), task("re")];
    const completions = [
      completion("r", "2026-10-03T10:00:00.000Z", { cycleKey: "2026-10-03" }),
      completion("r", "2026-10-10T10:00:00.000Z", { cycleKey: "2026-10-10" }),
      completion("once", "2026-10-12T10:00:00.000Z"),
      completion("re", "2026-10-12T10:00:00.000Z", { deletedAt: "2026-10-12T11:00:00.000Z" }),
      completion("r", "2026-09-30T10:00:00.000Z", { cycleKey: "2026-09-30" }),
    ];
    expect(doneInRange(tasks, completions, "p1", month, "UTC")).toBe(3);
  });

  it("dates a completion in the reader's zone, like the time report", () => {
    const tasks = [task("late")];
    // 23:30 on Sep 30 in New York is Oct 1 in UTC.
    const completions = [completion("late", "2026-10-01T03:30:00.000Z")];
    expect(doneInRange(tasks, completions, "p1", month, "UTC")).toBe(1);
    expect(doneInRange(tasks, completions, "p1", month, "America/New_York")).toBe(0);
    expect(dayIn("2026-10-01T03:30:00.000Z", "America/New_York")).toBe("2026-09-30");
  });

  it("counts the saved zone's month, the one the time report reads (MOD-110)", () => {
    const tasks = [task("a"), task("b")];
    // 23:30 UTC on Oct 31: Nov 1 in Auckland, Oct 31 in Los Angeles.
    const now = new Date("2026-10-31T23:45:00.000Z");
    const completions = [
      completion("a", "2026-10-31T23:30:00.000Z"),
      completion("b", "2026-10-15T12:00:00.000Z"),
    ];
    const doneIn = (zone: string) =>
      doneInRange(tasks, completions, "p1", reportRange("this_month", now, 1, null, zone), zone);
    expect(doneIn("Pacific/Auckland")).toBe(1);
    expect(doneIn("America/Los_Angeles")).toBe(2);
  });

  it("counts a done task with no completion rows by when it was finished", () => {
    const tasks = [
      task("old", { statusCategory: "done", status: "done", completedAt: "2026-10-05T10:00:00Z" }),
      task("other", {
        bucketId: "p2",
        statusCategory: "done",
        status: "done",
        completedAt: "2026-10-05T10:00:00Z",
      }),
    ];
    expect(doneInRange(tasks, [], "p1", month, "UTC")).toBe(1);
  });
});

describe("waitingIn", () => {
  it("lists the unfinished tasks that wait, the longest-waiting first", () => {
    const tasks = [task("a"), task("b"), task("c", { statusCategory: "done", status: "done" })];
    const entries = [
      waiting("a", "2026-10-10T00:00:00Z"),
      waiting("b", "2026-10-02T00:00:00Z"),
      waiting("c", "2026-10-01T00:00:00Z"),
    ];
    expect(waitingIn(tasks, entries, new Set(["p1"])).map((w) => w.task.id)).toEqual(["b", "a"]);
  });
});

describe("recentActivity", () => {
  it("merges finishes and additions, newest first", () => {
    const tasks = [
      task("a", { createdAt: "2026-10-01T09:00:00Z" }),
      task("b", { createdAt: "2026-10-03T09:00:00Z", creatorId: "bob" }),
    ];
    const lines = recentActivity(tasks, [completion("a", "2026-10-04T09:00:00Z")], "p1");
    expect(lines.map((l) => [l.kind, l.task.id, l.userId])).toEqual([
      ["done", "a", "ann"],
      ["added", "b", "bob"],
      ["added", "a", "ann"],
    ]);
  });
});

describe("clientRollup (AC6.4)", () => {
  it("rolls up a client's live projects: open work, what's next, what waits", () => {
    const buckets = [
      project("acme", { clientContactId: "anna" }),
      project("acme-old", { clientContactId: "anna", archivedAt: "2026-10-01T00:00:00Z" }),
      project("other"),
    ];
    const tasks = [
      task("t1", { bucketId: "acme", dueOn: "2026-10-20" }),
      task("t2", { bucketId: "acme", dueOn: "2026-10-15" }),
      task("t3", { bucketId: "acme", statusCategory: "done", status: "done" }),
      task("t4", { bucketId: "other" }),
    ];
    const r = clientRollup(buckets, tasks, [waiting("t1", "2026-10-02T00:00:00Z")], "anna");
    expect(r.projects.map((p) => [p.project.id, p.open])).toEqual([["acme", 2]]);
    expect(r.open).toBe(2);
    expect(r.next.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(r.waiting.map((w) => w.task.id)).toEqual(["t1"]);
  });
});

describe("departures (AC5.6)", () => {
  it("summarises what someone leaves: open tasks, team tasks, leads, teams", () => {
    const summary = departureSummary("bob", {
      tasks: [
        task("a", { assigneeId: "bob" }),
        task("b", { assigneeId: "bob", teamId: "design" }),
        task("c", { assigneeId: "bob", statusCategory: "done", status: "done" }),
      ],
      buckets: [project("site", { leadId: "bob" })],
      teams: [
        {
          id: "design",
          workspaceId: "w",
          name: "Design",
          mark: "DE",
          color: null,
          defaultProjectId: null,
          createdBy: "ann",
          createdAt: "",
          updatedAt: "",
        },
      ],
      teamMembers: [{ id: "m", workspaceId: "w", teamId: "design", userId: "bob", createdAt: "" }],
    });
    expect(summary).toEqual({ assigned: 2, teamTasks: 1, led: ["site"], teams: ["Design"] });
    expect(
      departureLines(summary, {
        first: "Bob",
        self: false,
        receiver: "you",
        owner: "the workspace owner",
        fromName: "Bob Ray",
      }),
    ).toEqual([
      "Tasks in their Inbox go back to the people who made them; the rest go to you.",
      "Bob’s 2 open tasks here become unassigned; 1 of them goes back to its team.",
      "“site” loses its lead.",
      "Bob leaves “Design”.",
      "Projects only Bob can see go to the workspace owner, named “From Bob Ray (archived) …”.",
    ]);
  });

  it("says 'becomes' for one task, and 'you' when the remover owns the workspace", () => {
    const lines = departureLines(
      { assigned: 1, teamTasks: 1, led: [], teams: [] },
      { first: "Bob", self: false, receiver: "you", owner: "you", fromName: "Bob" },
    );
    expect(lines).toContain("Bob’s 1 open task here becomes unassigned; it goes back to its team.");
    expect(lines).toContain("Projects only Bob can see go to you, named “From Bob (archived) …”.");
  });

  it("words it for someone leaving, and without numbers when Tasks can't be read", () => {
    expect(
      departureLines(null, {
        first: "Ann",
        self: true,
        receiver: "the workspace owner",
        owner: "the workspace owner",
        fromName: "Ann",
      }),
    ).toEqual([
      "Tasks in your Inbox go back to the people who made them; the rest go to the workspace owner.",
      "Your open tasks here become unassigned; a team’s go back to the team.",
      "Projects only you can see go to the workspace owner, named “From Ann (archived) …”.",
    ]);
  });
});

// TV-U15 · My tasks and All (AC5.2's unit half, call 84): My tasks keeps
// your Backlog for its folded line, orders by date then priority with waiting
// tasks last, and puts each of your teams' unclaimed tasks on top; All never
// lists an Inbox and follows the sidebar's order.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Task, Team } from "./model";
import {
  allProjectOrder,
  allView,
  myTasksView,
  orderMyTasks,
  startsFolded,
  teamBlocks,
} from "./my-tasks";

const ME = "me";
const at = (day: number) => new Date(2026, 9, day).toISOString();

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

const team = (id: string, name: string): Team => ({
  id,
  workspaceId: "w1",
  name,
  mark: name.slice(0, 2).toUpperCase(),
  color: null,
  defaultProjectId: null,
  createdBy: ME,
  createdAt: at(1),
  updatedAt: at(1),
});

describe("My tasks (call 84)", () => {
  it("is yours, Backlog in (for its folded line), Won't do out unless kept", () => {
    const tasks = [
      task("open"),
      task("parked", { statusCategory: "backlog" }),
      task("wont", { status: "archived", statusCategory: "wont_do" }),
      task("mike", { assigneeId: "mike" }),
    ];
    expect(myTasksView(tasks, ME).map((t) => t.id)).toEqual(["open", "parked"]);
    expect(myTasksView(tasks, ME, (t) => t.id === "wont").map((t) => t.id)).toEqual([
      "open",
      "parked",
      "wont",
    ]);
    expect(myTasksView(tasks, null)).toEqual([]);
  });

  it("orders by date, then priority; waiting tasks sink to the end", () => {
    const ordered = orderMyTasks(
      [
        task("nodate"),
        task("later", { dueDate: at(20) }),
        task("soon-low", { dueDate: at(15), priority: "low" }),
        task("soon-high", { dueDate: at(15), priority: "high" }),
        task("waits", { dueDate: at(14) }),
      ],
      new Set(["waits"]),
    );
    expect(ordered.map((t) => t.id)).toEqual(["soon-high", "soon-low", "later", "nodate", "waits"]);
  });

  it("puts each of your teams' unclaimed tasks on top, by team name", () => {
    const teams = [team("dev", "Development"), team("design", "Design"), team("ops", "Ops")];
    const members = [
      { teamId: "design", userId: ME },
      { teamId: "dev", userId: ME },
      { teamId: "ops", userId: "mike" },
    ];
    const blocks = teamBlocks(
      [
        task("d1", { assigneeId: null, teamId: "design", dueDate: at(16) }),
        task("d2", { assigneeId: null, teamId: "design", dueDate: at(15) }),
        task("taken", { assigneeId: "mike", teamId: "design" }),
        task("done", {
          assigneeId: null,
          teamId: "design",
          status: "done",
          statusCategory: "done",
        }),
        task("ops", { assigneeId: null, teamId: "ops" }),
        task("v1", { assigneeId: null, teamId: "dev" }),
      ],
      teams,
      members,
      ME,
    );
    expect(blocks.map((b) => [b.team.name, b.tasks.map((t) => t.id)])).toEqual([
      ["Design", ["d2", "d1"]],
      ["Development", ["v1"]],
    ]);
    expect(teamBlocks([], teams, [], ME)).toEqual([]);
  });
});

describe("All", () => {
  it("never lists your Inbox", () => {
    const tasks = [task("a"), task("in", { bucketId: "inbox" })];
    expect(allView(tasks, "inbox", () => true).map((t) => t.id)).toEqual(["a"]);
  });

  it("follows the sidebar: area by area, then projects with no area", () => {
    expect(
      allProjectOrder(
        [
          { id: "p1", areaId: null },
          { id: "p2", areaId: "school" },
          { id: "p3", areaId: "work" },
          { id: "p4", areaId: "school" },
          { id: "p5", areaId: "gone" },
        ],
        ["work", "school"],
      ),
    ).toEqual(["p3", "p2", "p4", "p1", "p5"]);
  });

  it("On hold and Done projects start folded", () => {
    expect(startsFolded({ status: "on_hold" })).toBe(true);
    expect(startsFolded({ status: "done" })).toBe(true);
    expect(startsFolded({ status: "active" })).toBe(false);
    expect(startsFolded(undefined)).toBe(false);
  });
});

// TV-D13 · Teams on the client: who's in which team, the "For Design · 2
// unclaimed" block's list (TV-U15 renders it), Upcoming's rule for other
// teams' work, and a team's stable colour (specs/tasks-v3.md §1, AC5.2,
// REPLAN 54, 95, default t).

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Task, Team, TeamMember } from "./model";
import { isOtherTeamsWork, isUnclaimed, teamHue, teamIdsOf, unclaimedForMe } from "./teams";

function team(id: string, name: string, color: string | null = null): Team {
  return {
    id,
    workspaceId: "w1",
    name,
    mark: name.slice(0, 2).toUpperCase(),
    color,
    defaultProjectId: null,
    createdBy: "u1",
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
  };
}

function member(teamId: string, userId: string): TeamMember {
  return { id: `${teamId}:${userId}`, workspaceId: "w1", teamId, userId, createdAt: "x" };
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    assigneeId: null,
    ...over,
  };
}

const DESIGN = team("ds", "Design");
const DEV = team("dv", "Development");
const MEMBERS = [member("ds", "me"), member("ds", "sam"), member("dv", "sam")];

describe("teamIdsOf", () => {
  it("lists the teams a person is in", () => {
    expect([...teamIdsOf(MEMBERS, "sam")].sort()).toEqual(["ds", "dv"]);
    expect([...teamIdsOf(MEMBERS, "me")]).toEqual(["ds"]);
    expect(teamIdsOf(MEMBERS, null).size).toBe(0);
  });
});

describe("unclaimed team tasks", () => {
  const tasks = [
    task("open", { teamId: "ds" }),
    task("taken", { teamId: "ds", assigneeId: "sam" }),
    task("done", { teamId: "ds", status: "done", statusCategory: "done" }),
    task("backlog", { teamId: "ds", statusCategory: "backlog" }),
    task("deleted", { teamId: "ds", deletedAt: "x" }),
    task("dev", { teamId: "dv" }),
    task("plain"),
  ];

  it("is a team task nobody took, still to do", () => {
    expect(tasks.filter(isUnclaimed).map((t) => t.id)).toEqual(["open", "dev"]);
  });

  it("groups mine by team, in name order, leaving out teams with none", () => {
    expect(
      unclaimedForMe(tasks, [DEV, DESIGN], MEMBERS, "me").map((g) => [
        g.team.name,
        g.tasks.map((t) => t.id),
      ]),
    ).toEqual([["Design", ["open"]]]);
    expect(unclaimedForMe(tasks, [DEV, DESIGN], MEMBERS, "sam").map((g) => g.team.name)).toEqual([
      "Design",
      "Development",
    ]);
    expect(unclaimedForMe(tasks, [DESIGN], MEMBERS, "nobody")).toEqual([]);
  });
});

describe("Upcoming leaves out other teams' unclaimed work (default t)", () => {
  const mine = teamIdsOf(MEMBERS, "me");
  it("hides an unassigned task routed to a team I'm not in", () => {
    expect(isOtherTeamsWork(task("x", { teamId: "dv" }), mine)).toBe(true);
    expect(isOtherTeamsWork(task("x", { teamId: "ds" }), mine)).toBe(false);
    expect(isOtherTeamsWork(task("x", { teamId: "dv", assigneeId: "me" }), mine)).toBe(false);
    expect(isOtherTeamsWork(task("x"), mine)).toBe(false);
  });
});

describe("teamHue (95: a stable colour)", () => {
  it("takes the colour picked for the team, else one from its id that never changes", () => {
    expect(teamHue(team("ds", "Design", "violet"))).toBe("violet");
    const auto = teamHue(team("ds", "Design"));
    expect(teamHue({ ...team("ds", "Renamed") })).toBe(auto);
    // Something that isn't one of the hues reads as automatic.
    expect(teamHue(team("ds", "Design", "red"))).toBe(auto);
  });
});

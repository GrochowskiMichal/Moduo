// TV-D1 D1-9: the MCP task shape names the assignee (null = Unassigned) and the
// creator, and the assignee list applies tasks_op_assign's rule.

import { describe, expect, it } from "@rstest/core";

import {
  assigneeCandidates,
  FORMER_MEMBER,
  resolveAssigneeArg,
  taskPeople,
} from "./task-people.ts";

const names = new Map([
  ["ada", "Ada"],
  ["bea", "Bea"],
]);

describe("taskPeople (shapeTask's assignee and creator)", () => {
  it("names the assignee and the creator separately", () => {
    expect(taskPeople({ owner_id: "ada", assignee_id: "bea", creator_unknown: false }, names)).toEqual(
      { assignee: { id: "bea", name: "Bea" }, creator: { id: "ada", name: "Ada" } },
    );
  });

  it("Unassigned is null, and the creator still shows", () => {
    expect(taskPeople({ owner_id: "ada", assignee_id: null, creator_unknown: false }, names)).toEqual(
      { assignee: null, creator: { id: "ada", name: "Ada" } },
    );
  });

  it("leaves the creator out when it isn't known", () => {
    expect(taskPeople({ owner_id: "bea", assignee_id: "bea", creator_unknown: true }, names)).toEqual(
      { assignee: { id: "bea", name: "Bea" } },
    );
  });

  it("someone who left reads as a former member", () => {
    expect(
      taskPeople({ owner_id: "gone", assignee_id: "gone", creator_unknown: false }, names).assignee,
    ).toEqual({ id: "gone", name: FORMER_MEMBER });
  });

  it("before the migration, owner_id is the assignee and no creator is claimed", () => {
    expect(taskPeople({ owner_id: "bea" }, names)).toEqual({ assignee: { id: "bea", name: "Bea" } });
  });
});

describe("resolveAssigneeArg (tasks_assign)", () => {
  it("null unassigns, \"me\" is the key's creator, an id passes through", () => {
    expect(resolveAssigneeArg(null, "ada")).toBeNull();
    expect(resolveAssigneeArg("me", "ada")).toBe("ada");
    expect(resolveAssigneeArg(" bea ", "ada")).toBe("bea");
  });

  it("refuses anything else instead of unassigning", () => {
    expect(() => resolveAssigneeArg(undefined, "ada")).toThrow();
    expect(() => resolveAssigneeArg("", "ada")).toThrow();
    expect(() => resolveAssigneeArg(42, "ada")).toThrow();
  });
});

describe("assigneeCandidates (tasks_list_assignees)", () => {
  it("lists the owner and members; only owners and tasks.edit members can be assigned", () => {
    const out = assigneeCandidates({
      members: [
        { user_id: "ada", perms: ["tasks.view", "tasks.edit"] },
        { user_id: "vera", perms: ["tasks.view"] },
      ],
      ownerId: "olga",
      names: new Map([
        ["ada", "Ada"],
        ["vera", "Vera"],
        ["olga", "Olga"],
      ]),
      me: "vera",
    });
    expect(out).toEqual([
      { id: "vera", name: "Vera", is_me: true, can_be_assigned: false },
      { id: "ada", name: "Ada", is_me: false, can_be_assigned: true },
      { id: "olga", name: "Olga", is_me: false, can_be_assigned: true },
    ]);
  });
});

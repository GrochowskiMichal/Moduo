// TV-D1 D1-8: every assignee picker offers Unassigned plus the members, a
// viewer can't be picked, and someone who left reads "Former member". (Who
// created the task is the feed's first line since MOD-129.)

import { describe, expect, it } from "@rstest/core";

import type { WorkspaceMember } from "../workspaces/types";
import { mapMember, withOwnName } from "../workspaces/workspace-mappers";
import {
  assigneeInSentence,
  assigneeLabel,
  assigneeListName,
  assigneeOptions,
  fromAssigneeValue,
  SELF_KEYWORDS,
  toAssignees,
  toAssigneeValue,
  UNASSIGNED,
} from "./assignee-options";
import { taskAttentionUserId } from "./model";

function member(
  userId: string,
  name: string,
  perms: string[],
  extra: Partial<WorkspaceMember> = {},
) {
  return {
    id: `m-${userId}`,
    workspaceId: "w1",
    userId,
    role: "editor",
    roleId: null,
    overrides: {},
    perms,
    joinedAt: null,
    isActive: true,
    removedAt: null,
    displayName: name,
    avatarUrl: null,
    ...extra,
  } as WorkspaceMember;
}

const MEMBERS = [
  member("me", "Maciej", ["tasks.view", "tasks.edit"]),
  member("mike", "Mike", ["tasks.view", "tasks.edit"]),
  member("vera", "Vera", ["tasks.view"]),
  member("gone", "Gone", ["tasks.view", "tasks.edit"], { isActive: false }),
];

const assignees = toAssignees(MEMBERS, "me");
const byId = (id: string | null | undefined) => assignees.find((a) => a.userId === id) ?? null;

describe("Unassigned option + former member", () => {
  it("lists Unassigned first, then active members (you first); viewers can't be picked", () => {
    const options = assigneeOptions(assignees);
    expect(options.map((o) => [o.value, o.label, o.disabled])).toEqual([
      [UNASSIGNED, "Unassigned", false],
      ["me", "Maciej (you)", false],
      ["mike", "Mike", false],
      ["vera", "Vera (view only)", true],
    ]);
  });

  it("marks you in a picker even when you can only view", () => {
    const viewer = toAssignees([member("me", "Maciej", ["tasks.view"])], "me");
    expect(assigneeOptions(viewer).map((o) => o.label)).toEqual([
      "Unassigned",
      "Maciej (you) (view only)",
    ]);
  });

  it("round-trips Unassigned through the picker value (Radix can't use an empty value)", () => {
    expect(toAssigneeValue(null)).toBe(UNASSIGNED);
    expect(fromAssigneeValue(UNASSIGNED)).toBeNull();
    expect(fromAssigneeValue(toAssigneeValue("mike"))).toBe("mike");
  });

  it("reads Unassigned, You, a member's name, or Former member for someone who left", () => {
    expect(assigneeLabel(null, byId)).toBe("Unassigned");
    expect(assigneeLabel("me", byId)).toBe("You");
    expect(assigneeLabel("mike", byId)).toBe("Mike");
    expect(assigneeLabel("gone", byId)).toBe("Former member");
  });
});

describe("one way to name you (MOD-137)", () => {
  const you = byId("me");
  const mike = byId("mike");

  it("never names you Me: You as a value, your name plus (you) in a list, you in a sentence", () => {
    if (!you || !mike) throw new Error("fixture");
    expect(you.name).toBe("You");
    expect(you.fullName).toBe("Maciej");
    expect(assigneeListName(you)).toBe("Maciej (you)");
    expect(assigneeInSentence(you)).toBe("you");
    expect(mike.name).toBe("Mike");
    expect(assigneeListName(mike)).toBe("Mike");
    expect(assigneeInSentence(mike)).toBe("Mike");
  });

  it("lists you as You while you have no name yet, never 'You (you)'", () => {
    const [nameless] = toAssignees([member("me", "", ["tasks.view", "tasks.edit"])], "me");
    if (!nameless) throw new Error("fixture");
    expect(nameless.name).toBe("You");
    expect(assigneeListName(nameless)).toBe("You");
  });

  it("finds you by me, mine or you in a picker's search", () => {
    expect(SELF_KEYWORDS).toEqual(["me", "mine", "you"]);
  });
});

describe("whose attention a task needs (D1-6)", () => {
  it("is the assignee, else the creator when known", () => {
    expect(
      taskAttentionUserId({ assigneeId: "mike", creatorId: "me", creatorUnknown: false }),
    ).toBe("mike");
    expect(taskAttentionUserId({ assigneeId: null, creatorId: "me", creatorUnknown: false })).toBe(
      "me",
    );
    expect(
      taskAttentionUserId({ assigneeId: null, creatorId: "me", creatorUnknown: true }),
    ).toBeNull();
  });
});

describe("profile photos reach Tasks (MOD-96)", () => {
  it("carries each member's photo from the listMembers row to the assignee", () => {
    // The exact `listMembers` row shape (`*, profiles(*)`), through the same
    // mappers the workspace provider runs, to what every Tasks avatar reads.
    const photo =
      "https://example.supabase.co/storage/v1/object/public/avatars/profiles/u-mike/avatar.png?v=1";
    const rows = [
      {
        id: "m1",
        workspace_id: "w1",
        user_id: "u-mike",
        role: "editor",
        is_active: true,
        perms: ["tasks.view", "tasks.edit"],
        profiles: { id: "u-mike", display_name: "Mike Grochowski", avatar_url: photo },
      },
      {
        id: "m2",
        workspace_id: "w1",
        user_id: "u-me",
        role: "owner",
        is_active: true,
        perms: ["tasks.view", "tasks.edit"],
        profiles: { id: "u-me", display_name: null, avatar_url: null },
      },
    ];
    const members = withOwnName(rows.map(mapMember), "u-me", "maciej@moduo.app");
    const people = toAssignees(members, "u-me");
    expect(people.map((p) => [p.userId, p.avatarUrl])).toEqual([
      ["u-me", null],
      ["u-mike", photo],
    ]);
    // Someone without a photo still has their own name for the initials.
    expect(people[0].fullName).toBe("maciej");
  });
});

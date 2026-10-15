// TV-D1 D1-8: every assignee picker offers Unassigned plus the members, a
// viewer can't be picked, someone who left reads "Former member", and the
// detail panel says who created the task when that's known.

import { describe, expect, it } from "@rstest/core";

import type { WorkspaceMember } from "../workspaces/types";
import { mapMember, withOwnName } from "../workspaces/workspace-mappers";
import {
  assigneeLabel,
  assigneeOptions,
  createdByLabel,
  fromAssigneeValue,
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
  it("lists Unassigned first, then active members (me first); viewers can't be picked", () => {
    const options = assigneeOptions(assignees);
    expect(options.map((o) => [o.value, o.label, o.disabled])).toEqual([
      [UNASSIGNED, "Unassigned", false],
      ["me", "Me", false],
      ["mike", "Mike", false],
      ["vera", "Vera (view only)", true],
    ]);
  });

  it("round-trips Unassigned through the picker value (Radix can't use an empty value)", () => {
    expect(toAssigneeValue(null)).toBe(UNASSIGNED);
    expect(fromAssigneeValue(UNASSIGNED)).toBeNull();
    expect(fromAssigneeValue(toAssigneeValue("mike"))).toBe("mike");
  });

  it("reads Unassigned, a member's name, or Former member for someone who left", () => {
    expect(assigneeLabel(null, byId)).toBe("Unassigned");
    expect(assigneeLabel("mike", byId)).toBe("Mike");
    expect(assigneeLabel("gone", byId)).toBe("Former member");
  });
});

describe("Created by", () => {
  it("names the creator, says you for yourself, and stays quiet when unknown", () => {
    expect(createdByLabel({ creatorId: "mike", creatorUnknown: false }, byId)).toBe("Mike");
    expect(createdByLabel({ creatorId: "me", creatorUnknown: false }, byId)).toBe("you");
    expect(createdByLabel({ creatorId: "gone", creatorUnknown: false }, byId)).toBe(
      "a former member",
    );
    expect(createdByLabel({ creatorId: "mike", creatorUnknown: true }, byId)).toBeNull();
    expect(createdByLabel({ creatorId: "", creatorUnknown: false }, byId)).toBeNull();
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

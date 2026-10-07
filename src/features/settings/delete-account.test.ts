import { describe, expect, it } from "@rstest/core";

import { blockingWorkspaces, matchesDeleteConfirm, type OwnedWorkspace } from "./delete-account";

describe("blockingWorkspaces (sole-owner block logic — AC5)", () => {
  const solo: OwnedWorkspace = { id: "a", name: "Solo", otherMemberCount: 0 };
  const shared: OwnedWorkspace = { id: "b", name: "Team", otherMemberCount: 2 };

  it("returns empty when every owned workspace is solo (safe to delete)", () => {
    expect(blockingWorkspaces([solo])).toEqual([]);
    expect(blockingWorkspaces([])).toEqual([]);
  });

  it("returns the owned workspaces that still have other members", () => {
    expect(blockingWorkspaces([solo, shared])).toEqual([shared]);
  });

  it("blocks on any shared owned workspace", () => {
    const shared2: OwnedWorkspace = { id: "c", name: "Team 2", otherMemberCount: 1 };
    expect(blockingWorkspaces([shared, shared2])).toEqual([shared, shared2]);
  });
});

describe("matchesDeleteConfirm (type-to-confirm gate — AC5)", () => {
  const email = "user@example.com";

  it("matches the literal word DELETE", () => {
    expect(matchesDeleteConfirm("DELETE", email)).toBe(true);
    expect(matchesDeleteConfirm("  DELETE  ", email)).toBe(true);
    expect(matchesDeleteConfirm("delete", email)).toBe(false); // case-sensitive for the keyword
  });

  it("matches the account email case-insensitively", () => {
    expect(matchesDeleteConfirm("user@example.com", email)).toBe(true);
    expect(matchesDeleteConfirm("USER@EXAMPLE.COM", email)).toBe(true);
    expect(matchesDeleteConfirm("  user@example.com ", email)).toBe(true);
  });

  it("rejects empty, wrong, or when there is no email", () => {
    expect(matchesDeleteConfirm("", email)).toBe(false);
    expect(matchesDeleteConfirm("   ", email)).toBe(false);
    expect(matchesDeleteConfirm("other@example.com", email)).toBe(false);
    expect(matchesDeleteConfirm("user@example.com", null)).toBe(false);
  });
});

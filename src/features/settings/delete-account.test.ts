import { describe, expect, it } from "@rstest/core";

import {
  ACCOUNT_DELETED_NOTICE,
  blockingWorkspaces,
  DANGER_ZONE_COPY,
  finishAccountDeletion,
  isAccountDeletedMarked,
  matchesDeleteConfirm,
  type OwnedWorkspace,
  validateAuthSearch,
} from "./delete-account";

describe("finishAccountDeletion (PRIV-2 AC11)", () => {
  it("leaves no marker behind when the sign-in page can't be reached", async () => {
    window.sessionStorage.clear();
    const signOut = async () => {};

    const failed = await finishAccountDeletion({
      forgetOnDevice: () => {},
      goToSignInWithNotice: () => Promise.reject(new Error("navigation failed")),
      signOut,
    }).then(
      () => false,
      () => true,
    );

    expect(failed).toBe(true);
    expect(isAccountDeletedMarked()).toBe(false);
  });

  it("forgets the account on this device, lands on the sign-in page with the notice, and only then signs out", async () => {
    const calls: string[] = [];
    let release: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      release = resolve;
    });

    window.sessionStorage.clear();
    const done = finishAccountDeletion({
      forgetOnDevice: () => calls.push("forget on device"),
      goToSignInWithNotice: async () => {
        // The sign-in page only shows the notice for a deletion this tab marked.
        calls.push(isAccountDeletedMarked() ? "go to /auth?deleted=1" : "unmarked");
        await landed;
        calls.push("landed");
      },
      signOut: async () => {
        calls.push("sign out");
      },
    });
    await Promise.resolve();
    expect(calls).toEqual(["forget on device", "go to /auth?deleted=1"]);

    release();
    await done;
    expect(calls).toEqual(["forget on device", "go to /auth?deleted=1", "landed", "sign out"]);
  });
});

describe("Danger zone copy (PRIV-2 AC10, AC11)", () => {
  it("says what goes, what stays and that the plan ends, in the approved words", () => {
    expect(DANGER_ZONE_COPY).toBe(
      "Permanently delete your account and your personal data. This also cancels your Moduo plan. Things you shared with others stay with them, without your name. This can't be undone.",
    );
  });

  it("confirms the deletion on the sign-in page", () => {
    expect(ACCOUNT_DELETED_NOTICE).toBe("Your account and your data were deleted.");
  });
});

describe("validateAuthSearch (/auth?deleted=1)", () => {
  it("keeps the deleted flag however the URL spelled it", () => {
    expect(validateAuthSearch({ deleted: 1 })).toEqual({ deleted: 1 });
    expect(validateAuthSearch({ deleted: "1" })).toEqual({ deleted: 1 });
  });

  it("drops anything else", () => {
    expect(validateAuthSearch({})).toEqual({});
    expect(validateAuthSearch({ deleted: 0 })).toEqual({});
    expect(validateAuthSearch({ deleted: "yes" })).toEqual({});
    expect(validateAuthSearch({ other: 1 })).toEqual({});
  });
});

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

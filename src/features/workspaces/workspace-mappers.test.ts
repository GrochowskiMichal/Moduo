import { describe, expect, it } from "vitest";
import {
  mapMember,
  mapWorkspace,
  normalizeMemberRole,
  toMemberPerm,
  toMemberRole,
} from "./workspace-mappers";

describe("mapMember", () => {
  it("surfaces display name and avatar from the joined profile (DF-24)", () => {
    // The exact `listMembers` row shape: `*, profiles(*)`.
    const row = {
      id: "m1",
      workspace_id: "ws1",
      user_id: "u1",
      role: "editor",
      is_active: true,
      profiles: {
        id: "u1",
        display_name: "Ada Lovelace",
        avatar_url: "https://example.com/ada.png",
      },
    };
    const member = mapMember(row);
    expect(member.displayName).toBe("Ada Lovelace");
    expect(member.avatarUrl).toBe("https://example.com/ada.png");
    expect(member.userId).toBe("u1");
    expect(member.role).toBe("editor");
  });

  it("falls back to null when the profile join is absent or empty", () => {
    const member = mapMember({ id: "m2", workspace_id: "ws1", user_id: "u2", role: "viewer" });
    expect(member.displayName).toBeNull();
    expect(member.avatarUrl).toBeNull();
    expect(member.isActive).toBe(true);
  });

  it("tolerates a profile row with a null display name", () => {
    const member = mapMember({
      id: "m3",
      workspace_id: "ws1",
      user_id: "u3",
      role: "admin",
      profiles: { id: "u3", display_name: null, avatar_url: null },
    });
    expect(member.displayName).toBeNull();
    expect(member.avatarUrl).toBeNull();
    expect(member.role).toBe("admin");
  });

  it("defaults role to viewer and isActive to true when missing", () => {
    const member = mapMember({ id: "m4", workspace_id: "ws1", user_id: "u4" });
    expect(member.role).toBe("viewer");
    expect(member.isActive).toBe(true);
    expect(member.removedAt).toBeNull();
  });

  it("maps the DB `member` role to the app `editor` role", () => {
    const member = mapMember({ id: "m5", workspace_id: "ws1", user_id: "u5", role: "member" });
    expect(member.role).toBe("editor");
  });
});

describe("normalizeMemberRole", () => {
  it("bridges the DB vocabulary to the app vocabulary", () => {
    expect(normalizeMemberRole("member")).toBe("editor");
    expect(normalizeMemberRole("owner")).toBe("owner");
    expect(normalizeMemberRole("admin")).toBe("admin");
    expect(normalizeMemberRole("viewer")).toBe("viewer");
    expect(normalizeMemberRole("editor")).toBe("editor");
    expect(normalizeMemberRole(undefined)).toBe("viewer");
    expect(normalizeMemberRole("bogus")).toBe("viewer");
  });
});

describe("mapWorkspace", () => {
  const row = {
    id: "ws1",
    name: "Team",
    workspace_members: [
      { user_id: "owner1", role: "owner", permissions_notes: "write", permissions_tasks: "write" },
      { user_id: "u2", role: "member", permissions_notes: "write", permissions_tasks: "read" },
      { user_id: "u3", role: "viewer", permissions_notes: "read", permissions_tasks: "read" },
    ],
  };

  it("derives the caller's role/permissions from their membership row (DF-24)", () => {
    const asMember = mapWorkspace(row, "u2");
    expect(asMember.role).toBe("editor"); // DB `member` → `editor`
    expect(asMember.permissions.tasks).toBe("view"); // DB `read` → `view`
    expect(asMember.permissions.notes).toBe("edit"); // DB `write` → `edit`

    const asViewer = mapWorkspace(row, "u3");
    expect(asViewer.role).toBe("viewer");
    expect(asViewer.permissions.notes).toBe("view");

    const asOwner = mapWorkspace(row, "owner1");
    expect(asOwner.role).toBe("owner");
    expect(asOwner.permissions.notes).toBe("edit");
  });

  it("trusts owner_id over a drifted membership role string", () => {
    const drifted = {
      id: "ws2",
      name: "Owned",
      owner_id: "boss",
      workspace_members: [
        { user_id: "boss", role: "member", permissions_notes: "write", permissions_tasks: "write" },
      ],
    };
    // Even though the owner's member row says `member`, owner_id wins → owner.
    expect(mapWorkspace(drifted, "boss").role).toBe("owner");
  });

  it("falls back to owner/edit for a bare row with no membership (create() result)", () => {
    const created = mapWorkspace({ id: "ws9", name: "Fresh" });
    expect(created.role).toBe("owner");
    expect(created.permissions.notes).toBe("edit");
    expect(created.permissions.tasks).toBe("edit");
  });

  it("does not leak another member's role when currentUserId isn't in the roster", () => {
    const unknown = mapWorkspace(row, "nobody");
    expect(unknown.role).toBe("owner"); // safe fallback, not a random member
  });
});

describe("write-side bridges (toMemberRole / toMemberPerm)", () => {
  // The values below are the ONLY ones the workspace_members CHECK constraints
  // accept — verified live against the DB (DF-24). A regression here silently
  // breaks every invite redemption with a 400.
  it("maps app roles to the members CHECK vocabulary", () => {
    expect(toMemberRole("editor")).toBe("member");
    expect(toMemberRole("owner")).toBe("owner");
    expect(toMemberRole("admin")).toBe("admin");
    expect(toMemberRole("viewer")).toBe("viewer");
    expect(toMemberRole(undefined)).toBe("member");
    for (const r of ["editor", "owner", "admin", "viewer", "member"]) {
      expect(["owner", "admin", "member", "viewer"]).toContain(toMemberRole(r));
    }
  });

  it("maps app permissions to the members CHECK vocabulary", () => {
    expect(toMemberPerm("edit")).toBe("write");
    expect(toMemberPerm("admin")).toBe("write");
    expect(toMemberPerm("view")).toBe("read");
    expect(toMemberPerm("read")).toBe("read");
    expect(toMemberPerm("none")).toBe("none");
    expect(toMemberPerm(undefined)).toBe("write");
    for (const p of ["view", "edit", "admin", "none", "read", "write"]) {
      expect(["read", "write", "none"]).toContain(toMemberPerm(p));
    }
  });

  it("round-trips role and permission through write→read bridges", () => {
    // editor → member (DB) → editor (app); edit → write (DB) → edit (app)
    expect(normalizeMemberRole(toMemberRole("editor"))).toBe("editor");
    expect(normalizeMemberRole(toMemberRole("viewer"))).toBe("viewer");
    expect(normalizeMemberRole(toMemberRole("admin"))).toBe("admin");
  });
});

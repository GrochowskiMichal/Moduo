import { describe, expect, it } from "vitest";
import {
  accessSummary,
  canManageMember,
  cellState,
  explainCell,
  grantRefusal,
  type PermissionKey,
  resolvePermissions,
  sanitizeOverrides,
  toggleOverride,
} from "./access";

const MEMBER: PermissionKey[] = [
  "notes.view",
  "notes.create",
  "notes.edit",
  "notes.delete",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.delete",
  "ws.publish",
];
const member = { permissions: MEMBER, readOnly: false };
const viewer = { permissions: ["notes.view", "tasks.view"] as PermissionKey[], readOnly: true };

describe("resolvePermissions (≙ perm_resolve)", () => {
  it("applies allow and block exceptions on top of the role", () => {
    const out = resolvePermissions(MEMBER, false, { "tasks.delete": false, "ws.invite": true });
    expect(out).toContain("ws.invite");
    expect(out).not.toContain("tasks.delete");
  });

  it("drops create/edit/delete for a module the person can't see", () => {
    const out = resolvePermissions(MEMBER, false, { "notes.view": false });
    expect(out.filter((k) => k.startsWith("notes."))).toEqual([]);
  });

  it("keeps read-only roles to view keys whatever is allowed", () => {
    const out = resolvePermissions(viewer.permissions, true, {
      "notes.edit": true,
      "ws.invite": true,
    });
    expect(out).toEqual(["notes.view", "tasks.view"]);
  });

  it("ignores unknown keys and returns matrix order", () => {
    const out = resolvePermissions(["tasks.view", "bogus.key", "notes.view"], false, {});
    expect(out).toEqual(["notes.view", "tasks.view"]);
  });
});

describe("cells and exceptions", () => {
  it("one click flips the role's answer, a second click resets it", () => {
    const once = toggleOverride("tasks.delete", member, {});
    expect(once).toEqual({ "tasks.delete": false });
    expect(toggleOverride("tasks.delete", member, once)).toEqual({});
    expect(toggleOverride("ws.invite", member, {})).toEqual({ "ws.invite": true });
  });

  it("reports ceiling and needs-view states", () => {
    expect(cellState("notes.edit", viewer, { "notes.edit": true }).ceiling).toBe(true);
    const hidden = cellState("notes.edit", member, { "notes.view": false });
    expect(hidden.effective).toBe(false);
    expect(hidden.needsView).toBe(true);
  });

  it("explains where an answer comes from", () => {
    const blocked = cellState("tasks.delete", member, { "tasks.delete": false });
    expect(explainCell("Anna", "Member", blocked)).toBe(
      "Anna can't delete tasks: blocked for Anna personally, though Member can.",
    );
    const inherited = cellState("notes.edit", member, {});
    expect(explainCell("Anna", "Member", inherited)).toBe(
      "Anna can edit notes: from the Member role.",
    );
    const allowed = cellState("ws.invite", member, { "ws.invite": true });
    expect(explainCell("Anna", "Member", allowed)).toBe(
      "Anna can invite people: allowed for Anna personally, though Member can't.",
    );
  });

  it("sanitizes stored exceptions", () => {
    expect(sanitizeOverrides({ "notes.view": true, "x.y": true, "tasks.edit": "no" })).toEqual({
      "notes.view": true,
    });
    expect(sanitizeOverrides(null)).toEqual({});
  });
});

describe("who can manage whom (≙ perm_can_manage_member)", () => {
  const admin = resolvePermissions(
    [...MEMBER, "ws.invite", "ws.manage_members", "ws.manage_roles"],
    false,
    {},
  );

  it("never touches the owner or yourself", () => {
    expect(
      canManageMember({
        actorIsOwner: true,
        actorPerms: [],
        targetIsOwner: false,
        targetPerms: [],
        isSelf: true,
      }),
    ).toBe(false);
    expect(
      canManageMember({
        actorIsOwner: true,
        actorPerms: [],
        targetIsOwner: true,
        targetPerms: [],
        isSelf: false,
      }),
    ).toBe(false);
  });

  it("lets a member manager handle weaker people but not other managers", () => {
    const base = { actorIsOwner: false, actorPerms: admin, targetIsOwner: false, isSelf: false };
    expect(canManageMember({ ...base, targetPerms: MEMBER })).toBe(true);
    expect(canManageMember({ ...base, targetPerms: admin })).toBe(false);
    expect(canManageMember({ ...base, targetPerms: [...MEMBER, "ws.api_keys"] })).toBe(false);
  });

  it("refuses grants beyond your own and management grants for non-owners", () => {
    expect(grantRefusal(false, admin, MEMBER)).toBeNull();
    expect(grantRefusal(false, MEMBER, [...MEMBER, "ws.invite"])).toMatch(/don't have/);
    expect(grantRefusal(false, admin, ["ws.manage_members"])).toMatch(/Only the owner/);
    expect(grantRefusal(true, [], ["ws.manage_members"])).toBeNull();
  });
});

describe("accessSummary", () => {
  it("summarizes a person's reach", () => {
    expect(accessSummary(viewer.permissions, 0)).toBe("Read-only");
    expect(accessSummary(["tasks.view", "tasks.edit"], 2)).toBe("Tasks · 2 exceptions");
    expect(accessSummary([], 0)).toBe("No modules");
  });
});

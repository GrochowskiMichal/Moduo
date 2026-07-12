import { describe, expect, it } from "vitest";
import {
  assignableRolesFor,
  canManageMember,
  canTransferOwnership,
  modulePermissionFor,
} from "./member-permissions";

describe("canManageMember", () => {
  it("owner manages everyone below them, including admins", () => {
    expect(canManageMember("owner", "admin", false)).toBe(true);
    expect(canManageMember("owner", "editor", false)).toBe(true);
    expect(canManageMember("owner", "viewer", false)).toBe(true);
  });

  it("admin manages only members below admin — never another admin", () => {
    expect(canManageMember("admin", "admin", false)).toBe(false);
    expect(canManageMember("admin", "editor", false)).toBe(true);
    expect(canManageMember("admin", "viewer", false)).toBe(true);
  });

  it("no one manages the owner or themselves", () => {
    expect(canManageMember("owner", "owner", false)).toBe(false);
    expect(canManageMember("admin", "owner", false)).toBe(false);
    expect(canManageMember("owner", "admin", true)).toBe(false); // self
    expect(canManageMember("admin", "editor", true)).toBe(false); // self
  });

  it("editors and viewers manage no one", () => {
    expect(canManageMember("editor", "viewer", false)).toBe(false);
    expect(canManageMember("viewer", "editor", false)).toBe(false);
  });
});

describe("assignableRolesFor", () => {
  it("owner can grant admin; admin cannot", () => {
    expect(assignableRolesFor("owner")).toEqual(["viewer", "editor", "admin"]);
    expect(assignableRolesFor("admin")).toEqual(["viewer", "editor"]);
    expect(assignableRolesFor("editor")).toEqual([]);
    expect(assignableRolesFor("viewer")).toEqual([]);
  });
});

describe("canTransferOwnership", () => {
  it("only the owner can hand off, and only to another member", () => {
    expect(canTransferOwnership("owner", "admin", false)).toBe(true);
    expect(canTransferOwnership("owner", "editor", false)).toBe(true);
    expect(canTransferOwnership("owner", "owner", false)).toBe(false); // target is owner
    expect(canTransferOwnership("owner", "admin", true)).toBe(false); // self
    expect(canTransferOwnership("admin", "editor", false)).toBe(false); // caller not owner
  });
});

describe("modulePermissionFor", () => {
  it("maps each role to its per-module permission (invite / role change)", () => {
    expect(modulePermissionFor("viewer")).toBe("view");
    expect(modulePermissionFor("editor")).toBe("edit");
    expect(modulePermissionFor("admin")).toBe("admin");
    expect(modulePermissionFor("owner")).toBe("admin");
  });
});

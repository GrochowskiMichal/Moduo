import { describe, expect, it } from "@rstest/core";

import {
  assignWarning,
  CHAT_CAP_DEFAULTS,
  canBeAssignee,
  ceilingRank,
  effectiveRank,
  intersectSlotIso,
  noteIsPrivate,
  rankAllows,
  sameContactEmail,
} from "./rules";

describe("sharing rules", () => {
  it("caps a stored edit grant at view when the role is view-only", () => {
    const ceiling = ceilingRank({ view: true, edit: false, delete: false });
    expect(effectiveRank("edit", ceiling)).toBe(2);
    expect(rankAllows(effectiveRank("edit", ceiling), "view")).toBe(true);
    expect(rankAllows(effectiveRank("edit", ceiling), "edit")).toBe(false);
  });

  it("treats a note with no workspace grant as private, and a child as inheriting that", () => {
    const notes = [
      { id: "root", parentId: null, shareMode: "custom" as const, workspaceShared: false },
      { id: "child", parentId: "root", shareMode: "inherit" as const, workspaceShared: false },
      { id: "shared", parentId: null, shareMode: "custom" as const, workspaceShared: true },
    ];
    expect(noteIsPrivate("root", notes)).toBe(true);
    expect(noteIsPrivate("child", notes)).toBe(true);
    expect(noteIsPrivate("shared", notes)).toBe(false);
  });

  it("keeps only times every host is free", () => {
    expect(
      intersectSlotIso([
        ["2026-10-07T09:00:00.000Z", "2026-10-07T10:00:00.000Z"],
        ["2026-10-07T10:00:00.000Z", "2026-10-07T11:00:00.000Z"],
      ]),
    ).toEqual(["2026-10-07T10:00:00.000Z"]);
  });

  it("matches contacts by email and refuses viewer assignees", () => {
    expect(sameContactEmail("Jan@Example.com", "jan@example.com")).toBe(true);
    expect(sameContactEmail("", "a@b.c")).toBe(false);
    expect(canBeAssignee(["tasks.view"])).toBe(false);
    expect(canBeAssignee(["tasks.view", "tasks.edit"])).toBe(true);
    expect(assignWarning("Finance", "Maciej")).toContain("Finance");
  });

  it("leaves viewer chat posting off", () => {
    expect(CHAT_CAP_DEFAULTS.viewer.post).toBe(false);
    expect(CHAT_CAP_DEFAULTS.member.post).toBe(true);
    expect(CHAT_CAP_DEFAULTS.admin.manage_any).toBe(true);
  });
});

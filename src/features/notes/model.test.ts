import { describe, expect, it } from "@rstest/core";
import {
  isTrashExpired,
  noteRowToModel,
  noteUpdateRowToModel,
  trashDaysLeft,
  trashWindowCutoffIso,
} from "./model";

const FULL_ROW = {
  id: "n1",
  workspace_id: "ws1",
  created_by: "u1",
  parent_id: "n0",
  title: "Weekly plan",
  icon: "📒",
  kind: "note",
  tags: [],
  is_pinned: true,
  position: "0i00000000",
  is_archived: false,
  published_at: "2026-07-01T10:00:00.000Z",
  publish_token: "abc123",
  doc_version: 4,
  body_text: "should never leak into meta",
  created_at: "2026-06-01T08:00:00.000Z",
  updated_at: "2026-07-02T09:00:00.000Z",
  deleted_at: null,
};

describe("noteRowToModel", () => {
  it("maps a full v2 row", () => {
    const n = noteRowToModel(FULL_ROW);
    expect(n).toEqual({
      id: "n1",
      workspaceId: "ws1",
      createdBy: "u1",
      parentId: "n0",
      title: "Weekly plan",
      icon: "📒",
      isPinned: true,
      position: "0i00000000",
      isArchived: false,
      publishedAt: "2026-07-01T10:00:00.000Z",
      publishToken: "abc123",
      docVersion: 4,
      createdAt: "2026-06-01T08:00:00.000Z",
      updatedAt: "2026-07-02T09:00:00.000Z",
      deletedAt: null,
      shareMode: "custom",
      workspaceShared: false,
    });
  });

  it("defaults the v2 columns on a pre-migration (legacy) row", () => {
    const legacy = {
      id: "n2",
      workspace_id: "ws1",
      title: "Old note",
      is_pinned: 0,
      position: "0100000000",
      is_archived: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    const n = noteRowToModel(legacy);
    expect(n.publishedAt).toBeNull();
    expect(n.publishToken).toBeNull();
    expect(n.docVersion).toBe(0);
    expect(n.parentId).toBeNull();
    expect(n.createdBy).toBeNull();
    expect(n.icon).toBeNull();
    expect(n.isPinned).toBe(false);
    expect(n.isArchived).toBe(true);
    expect(n.deletedAt).toBeNull();
    expect(n.title).toBe("Old note");
  });

  it("maps a trashed row's deletedAt", () => {
    const n = noteRowToModel({ ...FULL_ROW, deleted_at: "2026-07-01T00:00:00.000Z" });
    expect(n.deletedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("noteUpdateRowToModel", () => {
  it("maps and coerces numeric fields", () => {
    expect(
      noteUpdateRowToModel({ id: "42", client_id: "c1", client_seq: "7", update_b64: "QQ==" }),
    ).toEqual({ id: 42, clientId: "c1", clientSeq: 7, updateB64: "QQ==" });
  });
});

describe("trash window (30 days)", () => {
  const now = new Date("2026-07-03T12:00:00.000Z");

  it("counts whole days left, rounding up", () => {
    expect(trashDaysLeft("2026-07-03T00:00:00.000Z", now)).toBe(30);
    expect(trashDaysLeft("2026-06-13T12:00:00.000Z", now)).toBe(10);
    // 29.999… days elapsed → still 1 day shown, not 0
    expect(trashDaysLeft("2026-06-03T12:00:00.001Z", now)).toBe(1);
  });

  it("clamps at zero once expired", () => {
    expect(trashDaysLeft("2026-05-01T00:00:00.000Z", now)).toBe(0);
  });

  it("expires strictly after 30 days", () => {
    expect(isTrashExpired("2026-06-03T12:00:00.000Z", now)).toBe(false); // exactly 30d
    expect(isTrashExpired("2026-06-03T11:59:59.999Z", now)).toBe(true);
  });

  it("cutoff ISO is exactly now minus the window", () => {
    expect(trashWindowCutoffIso(now)).toBe("2026-06-03T12:00:00.000Z");
  });
});

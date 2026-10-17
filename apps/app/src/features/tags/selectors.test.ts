// Create-or-attach dedupes by name: case-insensitive, trimmed, live tags only.

import { describe, expect, it } from "@rstest/core";
import type { Tag } from "../tasks/model";
import { findTagByName } from "./selectors";

function tag(id: string, name: string, deletedAt: string | null = null): Tag {
  return {
    id,
    workspaceId: "w1",
    ownerId: "u1",
    name,
    color: "blue",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt,
  };
}

const TAGS = [tag("t1", "client"), tag("t2", "vip"), tag("t3", "old", "2026-02-01T00:00:00Z")];

describe("findTagByName", () => {
  it("matches case-insensitively and trims", () => {
    expect(findTagByName(TAGS, "  CLIENT ")?.id).toBe("t1");
  });

  it("never matches a soft-deleted tag, and empty input matches nothing", () => {
    expect(findTagByName(TAGS, "old")).toBeUndefined();
    expect(findTagByName(TAGS, "   ")).toBeUndefined();
  });
});

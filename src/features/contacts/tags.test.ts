// FX-2 AC3 — tag-row selectors: attached tags resolve through links (skipping
// soft-deleted tags), and create-dedupe matches names case-insensitively.

import { describe, expect, it } from "@rstest/core";
import type { Tag, TagLink } from "../tasks/model";
import { attachedTags, findTagByName } from "./tags";

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

function link(tagId: string, entityId = "c1"): TagLink {
  return {
    id: `l-${tagId}`,
    workspaceId: "w1",
    tagId,
    entityType: "contact",
    entityId,
    createdAt: "2026-01-02T00:00:00Z",
  };
}

const TAGS = [tag("t1", "client"), tag("t2", "vip"), tag("t3", "old", "2026-02-01T00:00:00Z")];

describe("attachedTags", () => {
  it("returns only the linked tags, name-sorted (matches Tasks)", () => {
    // vip links first, but "client" < "vip" by name.
    expect(attachedTags(TAGS, [link("t2"), link("t1")]).map((t) => t.name)).toEqual([
      "client",
      "vip",
    ]);
  });

  it("skips soft-deleted tags even when a stale link remains", () => {
    expect(attachedTags(TAGS, [link("t3")])).toEqual([]);
  });

  it("is empty with no links", () => {
    expect(attachedTags(TAGS, [])).toEqual([]);
  });
});

describe("findTagByName", () => {
  it("matches case-insensitively and trims", () => {
    expect(findTagByName(TAGS, "  CLIENT ")?.id).toBe("t1");
  });

  it("never matches a soft-deleted tag, and empty input matches nothing", () => {
    expect(findTagByName(TAGS, "old")).toBeUndefined();
    expect(findTagByName(TAGS, "   ")).toBeUndefined();
  });
});

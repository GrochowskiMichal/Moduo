import { describe, expect, it } from "@rstest/core";

import { bucketGroupNames, bucketSections } from "./helpers";
import type { Bucket } from "./model";

function bucket(id: string, group: string | null = null, position = id): Bucket {
  return {
    id,
    workspaceId: "w",
    ownerId: "u",
    name: id.toUpperCase(),
    isSystem: false,
    group,
    position,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

describe("bucketSections", () => {
  it("keeps ungrouped buckets flat and first", () => {
    const { ungrouped, sections } = bucketSections([bucket("a"), bucket("b")]);
    expect(ungrouped.map((b) => b.id)).toEqual(["a", "b"]);
    expect(sections).toHaveLength(0);
  });

  it("groups buckets into sections in first-appearance order", () => {
    const { ungrouped, sections } = bucketSections([
      bucket("a"),
      bucket("b", "Work"),
      bucket("c", "Life"),
      bucket("d", "Work"),
    ]);
    expect(ungrouped.map((b) => b.id)).toEqual(["a"]);
    expect(sections.map((s) => s.name)).toEqual(["Work", "Life"]);
    expect(sections[0].buckets.map((b) => b.id)).toEqual(["b", "d"]);
    expect(sections[1].buckets.map((b) => b.id)).toEqual(["c"]);
  });

  it("treats blank / whitespace groups as ungrouped", () => {
    const { ungrouped, sections } = bucketSections([bucket("a", "   "), bucket("b", "")]);
    expect(ungrouped.map((b) => b.id)).toEqual(["a", "b"]);
    expect(sections).toHaveLength(0);
  });

  it("exposes section names for the move-to-section menu", () => {
    expect(
      bucketGroupNames([bucket("a", "Work"), bucket("b", "Life"), bucket("c", "Work")]),
    ).toEqual(["Work", "Life"]);
  });
});

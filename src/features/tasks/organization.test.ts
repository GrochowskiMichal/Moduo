import { describe, expect, it } from "@rstest/core";

import { bucketGroupNames, bucketSections, taskMatchesTagFilter } from "./helpers";
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

describe("taskMatchesTagFilter", () => {
  it("matches everything when the filter is empty", () => {
    expect(taskMatchesTagFilter([], [])).toBe(true);
    expect(taskMatchesTagFilter(["t1"], [])).toBe(true);
  });

  it("matches a task carrying any selected tag (union)", () => {
    expect(taskMatchesTagFilter(["t1", "t2"], ["t2"])).toBe(true);
    expect(taskMatchesTagFilter(["t1", "t2"], ["t3", "t1"])).toBe(true);
  });

  it("excludes a task carrying none of the selected tags", () => {
    expect(taskMatchesTagFilter(["t1"], ["t2"])).toBe(false);
    expect(taskMatchesTagFilter([], ["t2"])).toBe(false);
  });
});

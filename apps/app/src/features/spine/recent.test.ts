// Proves the "Recently linked" shaper (AC12 widget data): newest-first, both
// endpoints resolved from the registry, missing/empty labels fall back to the
// type, and tombstoned endpoints are flagged (never dropped).

import { describe, expect, it } from "@rstest/core";
import type { EntityLink, EntityRecord } from "../../lib/entity-links";
import { shapeRecentLinks } from "./recent";

let seq = 0;
function link(over: Partial<EntityLink> = {}): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w",
    sourceType: "task",
    sourceId: "t1",
    targetType: "contact",
    targetId: "c1",
    relationKind: "references",
    origin: "manual",
    createdBy: "u1",
    createdAt: `2026-06-27T00:00:0${seq}Z`,
    deletedAt: null,
    ...over,
  };
}
function rec(type: string, id: string, label: string, deleted = false): EntityRecord {
  return {
    workspaceId: "w",
    type,
    id,
    label,
    icon: null,
    deletedAt: deleted ? "2026-06-27T01:00:00Z" : null,
  };
}

describe("shapeRecentLinks", () => {
  it("resolves both endpoints from the registry and sorts newest first", () => {
    const links = [
      link({ id: "old", createdAt: "2026-06-27T00:00:01Z" }),
      link({ id: "new", createdAt: "2026-06-27T00:00:09Z" }),
    ];
    const byKey = new Map([
      ["task:t1", rec("task", "t1", "Ship it")],
      ["contact:c1", rec("contact", "c1", "Acme")],
    ]);
    const out = shapeRecentLinks(links, byKey);
    expect(out.map((r) => r.id)).toEqual(["new", "old"]);
    expect(out[0].source.label).toBe("Ship it");
    expect(out[0].target.label).toBe("Acme");
  });

  it("falls back to the type when a label is missing, and never drops the row", () => {
    const out = shapeRecentLinks([link()], new Map());
    expect(out).toHaveLength(1);
    expect(out[0].source.label).toBe("task");
    expect(out[0].target.label).toBe("contact");
  });

  it("flags a tombstoned endpoint", () => {
    const byKey = new Map([["contact:c1", rec("contact", "c1", "Acme", true)]]);
    const out = shapeRecentLinks([link()], byKey);
    expect(out[0].target.tombstoned).toBe(true);
    expect(out[0].source.tombstoned).toBe(false);
  });
});

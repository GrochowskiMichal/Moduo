import { describe, expect, it } from "@rstest/core";
import {
  coerceRelationKind,
  DEFAULT_LINK_ORIGIN,
  DEFAULT_RELATION_KIND,
  deriveLinkKey,
  deriveLinkUniquenessKey,
  type EntityRef,
  isLinkOrigin,
  isRelationKind,
  isSelfLink,
  LINK_ORIGINS,
  RELATION_KINDS,
} from "./entity-links";

const task: EntityRef = { type: "task", id: "11111111-1111-1111-1111-111111111111" };
const note: EntityRef = { type: "note", id: "22222222-2222-2222-2222-222222222222" };
// Same id, different type — must NOT collapse with `note`.
const sameIdContact: EntityRef = { type: "contact", id: note.id };

describe("relation kinds (AC1)", () => {
  it("rejects kinds outside the closed set", () => {
    for (const kind of RELATION_KINDS) {
      expect(isRelationKind(kind)).toBe(true);
    }
    expect(isRelationKind("related-to")).toBe(false); // not in the set
    expect(isRelationKind("REFERENCES")).toBe(false); // case-sensitive wire token
    expect(isRelationKind("")).toBe(false);
    expect(isRelationKind(null)).toBe(false);
    expect(isRelationKind(undefined)).toBe(false);
    expect(isRelationKind(42)).toBe(false);
  });

  it("locks the exact alpha set of eight kinds", () => {
    expect([...RELATION_KINDS]).toEqual([
      "references",
      "spawned-from",
      "blocks",
      "attachment",
      "mentions",
      "works-at",
      "follow-up",
      "paid-by",
    ]);
    expect(DEFAULT_RELATION_KIND).toBe("references");
  });

  it("coerces unknown kinds to the default but preserves valid ones", () => {
    expect(coerceRelationKind("not-a-kind")).toBe("references");
    expect(coerceRelationKind(null)).toBe("references");
    expect(coerceRelationKind("blocks")).toBe("blocks");
  });
});

describe("link origins", () => {
  it("accepts only the closed origin set", () => {
    for (const origin of LINK_ORIGINS) {
      expect(isLinkOrigin(origin)).toBe(true);
    }
    expect(isLinkOrigin("import")).toBe(false);
    expect(isLinkOrigin("")).toBe(false);
    expect(DEFAULT_LINK_ORIGIN).toBe("manual");
  });
});

describe("direction-agnostic dedupe key (AC2)", () => {
  it("derives the same key regardless of source/target order", () => {
    expect(deriveLinkKey(task, note)).toBe(deriveLinkKey(note, task));
  });

  it("derives the same uniqueness key (pair + kind) in either direction", () => {
    expect(deriveLinkUniquenessKey(task, note, "references")).toBe(
      deriveLinkUniquenessKey(note, task, "references"),
    );
  });

  it("separates different pairs and different kinds", () => {
    expect(deriveLinkKey(task, note)).not.toBe(deriveLinkKey(task, sameIdContact));
    expect(deriveLinkUniquenessKey(task, note, "references")).not.toBe(
      deriveLinkUniquenessKey(task, note, "blocks"),
    );
  });

  it("does not collapse two entities that share an id but differ in type", () => {
    // note and sameIdContact have the same uuid but different types.
    expect(deriveLinkKey(note, sameIdContact)).not.toBe(deriveLinkKey(note, note));
    expect(isSelfLink(note, sameIdContact)).toBe(false);
  });

  it("is stable: the key is the unordered `type:id` pair joined by a separator", () => {
    // task token < note token lexicographically ("note:" > "task:"? compare).
    const key = deriveLinkKey(task, note);
    expect(key).toContain(`${task.type}:${task.id}`);
    expect(key).toContain(`${note.type}:${note.id}`);
    expect(key).toContain("|");
  });
});

describe("self-links (AC2)", () => {
  it("flags an entity linked to itself", () => {
    expect(isSelfLink(task, { ...task })).toBe(true);
    expect(isSelfLink(task, note)).toBe(false);
  });
});

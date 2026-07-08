import { describe, expect, it } from "vitest";
import {
  asDragPayload,
  asDropLinkTarget,
  entityDrag,
  isSelfDrop,
  linkTarget,
  resolveKind,
  targetAccepts,
} from "./drag-payload";

describe("resolveKind matrix (AC7)", () => {
  it("maps known source→target pairs", () => {
    expect(resolveKind("email", "project")).toBe("spawned-from");
    expect(resolveKind("email", "task")).toBe("spawned-from");
    expect(resolveKind("payment", "contact")).toBe("paid-by");
    expect(resolveKind("invoice", "company")).toBe("paid-by");
    expect(resolveKind("contact", "company")).toBe("works-at");
    expect(resolveKind("company", "contact")).toBe("works-at");
  });

  it("treats a file on either end as an attachment", () => {
    expect(resolveKind("file", "task")).toBe("attachment");
    expect(resolveKind("note", "file")).toBe("attachment");
  });

  it("defaults to references for unspecified pairs", () => {
    expect(resolveKind("task", "note")).toBe("references");
    expect(resolveKind("note", "contact")).toBe("references");
    expect(resolveKind("whatever", "thing")).toBe("references");
  });

  it("resolves a person-on-person drag to references, never attachment (FX-5)", () => {
    expect(resolveKind("contact", "contact")).toBe("references");
  });

  it("only ever returns kinds from the closed set", () => {
    // resolveKind never invents a kind; spot-check the matrix outputs are valid.
    const outputs = [
      resolveKind("email", "project"),
      resolveKind("payment", "contact"),
      resolveKind("file", "x"),
      resolveKind("a", "b"),
    ];
    for (const k of outputs) {
      expect(["spawned-from", "paid-by", "attachment", "references"]).toContain(k);
    }
  });
});

describe("asDragPayload type guard + legacy adapter", () => {
  it("accepts a universal entity-drag payload", () => {
    const p = entityDrag({ type: "task", id: "t1" }, { label: "Ship it", from: "board" });
    expect(asDragPayload(p)).toEqual(p);
  });

  it("adapts a legacy TaskDragData into an entity payload", () => {
    const legacy = { type: "task", taskId: "t1", from: "queue" };
    expect(asDragPayload(legacy)).toEqual({
      kind: "entity-drag",
      entityType: "task",
      entityId: "t1",
      from: "queue",
    });
  });

  it("rejects non-payloads", () => {
    expect(asDragPayload(null)).toBeNull();
    expect(asDragPayload(undefined)).toBeNull();
    expect(asDragPayload({})).toBeNull();
    expect(asDragPayload({ type: "column", value: "x" })).toBeNull();
    expect(asDragPayload({ kind: "entity-drag" })).toBeNull(); // missing ids
    expect(asDragPayload("task")).toBeNull();
  });
});

describe("asDropLinkTarget type guard", () => {
  it("accepts a link target and rejects others", () => {
    const t = linkTarget({ type: "contact", id: "c1" }, ["email", "task"]);
    expect(asDropLinkTarget(t)).toEqual(t);
    expect(asDropLinkTarget({ type: "onto-task", taskId: "t1" })).toBeNull();
    expect(asDropLinkTarget(null)).toBeNull();
  });
});

describe("targetAccepts + isSelfDrop", () => {
  const contact = linkTarget({ type: "contact", id: "c1" }, ["email", "task"]);
  const anyTarget = linkTarget({ type: "note", id: "n1" });

  it("accepts payloads whose type is in the allow-list", () => {
    expect(targetAccepts(contact, entityDrag({ type: "email", id: "e1" }))).toBe(true);
    expect(targetAccepts(contact, entityDrag({ type: "task", id: "t1" }))).toBe(true);
  });

  it("rejects payloads outside the allow-list", () => {
    expect(targetAccepts(contact, entityDrag({ type: "note", id: "n1" }))).toBe(false);
  });

  it("accepts any type when the target declares no allow-list", () => {
    expect(targetAccepts(anyTarget, entityDrag({ type: "payment", id: "p1" }))).toBe(true);
  });

  it("always rejects a self-drop, even with no allow-list", () => {
    const selfPayload = entityDrag({ type: "note", id: "n1" });
    expect(isSelfDrop(selfPayload, anyTarget)).toBe(true);
    expect(targetAccepts(anyTarget, selfPayload)).toBe(false);
  });
});

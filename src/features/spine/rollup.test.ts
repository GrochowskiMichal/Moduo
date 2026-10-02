import { describe, expect, it } from "vitest";
import type { EntityLink, EntityRecord, EntityRef, RelationKind } from "@/lib/entity-links";
import {
  entityRefKey,
  HUB_SECTIONS,
  isSectionTruncated,
  rollupSections,
  SECTION_ROW_CAP,
  sectionForType,
  totalRows,
  visibleRows,
} from "./rollup";

const FOCUS: EntityRef = { type: "contact", id: "c0" };

let seq = 0;
function link(
  other: EntityRef,
  kind: RelationKind = "references",
  opts: { focusAsTarget?: boolean } = {},
): EntityLink {
  seq += 1;
  const focusEnd = { type: FOCUS.type, id: FOCUS.id };
  const source = opts.focusAsTarget ? other : focusEnd;
  const target = opts.focusAsTarget ? focusEnd : other;
  return {
    id: `l${seq}`,
    workspaceId: "w1",
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt: `2026-06-25T00:00:${String(seq).padStart(2, "0")}Z`,
    deletedAt: null,
  };
}

function record(ref: EntityRef, label: string, deleted = false): EntityRecord {
  return {
    workspaceId: "w1",
    type: ref.type,
    id: ref.id,
    label,
    icon: null,
    deletedAt: deleted ? "2026-06-25T01:00:00Z" : null,
  };
}

function registry(...records: EntityRecord[]): Map<string, EntityRecord> {
  return new Map(records.map((r) => [entityRefKey({ type: r.type, id: r.id }), r]));
}

describe("sectionForType", () => {
  it("maps each known type into its fixed section", () => {
    expect(sectionForType("task")).toBe("open-work");
    expect(sectionForType("project")).toBe("open-work");
    expect(sectionForType("payment")).toBe("money");
    expect(sectionForType("invoice")).toBe("money");
    expect(sectionForType("email")).toBe("conversations");
    expect(sectionForType("comment")).toBe("conversations");
    expect(sectionForType("note")).toBe("notes");
    expect(sectionForType("company")).toBe("other");
    expect(sectionForType("anything-unknown")).toBe("other");
  });
});

describe("rollupSections (AC6)", () => {
  it("groups links into the fixed section order, regardless of input order", () => {
    const task: EntityRef = { type: "task", id: "t1" };
    const note: EntityRef = { type: "note", id: "n1" };
    const payment: EntityRef = { type: "payment", id: "p1" };
    // Deliberately out of section order: note, payment, task.
    const links = [link(note, "references"), link(payment, "paid-by"), link(task, "blocks")];
    const recs = registry(
      record(task, "Ship launch"),
      record(note, "Spec"),
      record(payment, "Invoice #1043"),
    );

    const sections = rollupSections(FOCUS, links, recs);
    expect(sections.map((s) => s.key)).toEqual(["open-work", "money", "notes"]);
    expect(sections.map((s) => s.label)).toEqual(["Open work", "Money", "Notes"]);
  });

  it("projects the registry label as the row title and carries the relation kind", () => {
    const task: EntityRef = { type: "task", id: "t1" };
    const sections = rollupSections(
      FOCUS,
      [link(task, "blocks")],
      registry(record(task, "Ship launch")),
    );
    const row = sections[0].rows[0];
    expect(row.title).toBe("Ship launch");
    expect(row.relationKind).toBe("blocks");
    expect(row.other).toEqual(task);
    expect(row.tombstoned).toBe(false);
  });

  it("resolves the OTHER endpoint whether the focus is the source or the target", () => {
    const task: EntityRef = { type: "task", id: "t1" };
    const asSource = rollupSections(FOCUS, [link(task)], registry(record(task, "A")));
    const asTarget = rollupSections(
      FOCUS,
      [link(task, "references", { focusAsTarget: true })],
      registry(record(task, "A")),
    );
    expect(asSource[0].rows[0].other).toEqual(task);
    expect(asTarget[0].rows[0].other).toEqual(task);
  });

  it("flags tombstoned targets and titles them 'Deleted [type]' with no snippet", () => {
    const note: EntityRef = { type: "note", id: "n1" };
    const sections = rollupSections(FOCUS, [link(note)], registry(record(note, "Gone", true)));
    const row = sections[0].rows[0];
    expect(row.tombstoned).toBe(true);
    expect(row.title).toBe("Deleted note");
    expect(row.snippet).toBeNull();
  });

  it("falls back to a humanized title when the registry record is missing (mid-sync)", () => {
    const email: EntityRef = { type: "email", id: "e1" };
    const sections = rollupSections(FOCUS, [link(email, "attachment")], registry());
    expect(sections[0].rows[0].title).toBe("Untitled email");
  });

  it("skips links that do not touch the focus entity", () => {
    const stray: EntityLink = {
      ...link({ type: "task", id: "t1" }),
      sourceType: "task",
      sourceId: "x",
      targetType: "note",
      targetId: "y",
    };
    expect(rollupSections(FOCUS, [stray], registry())).toEqual([]);
  });

  it("omits empty sections and counts rows per section", () => {
    const t1: EntityRef = { type: "task", id: "t1" };
    const t2: EntityRef = { type: "task", id: "t2" };
    const sections = rollupSections(
      FOCUS,
      [link(t1), link(t2)],
      registry(record(t1, "A"), record(t2, "B")),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("open-work");
    expect(sections[0].count).toBe(2);
    expect(totalRows(sections)).toBe(2);
  });
});

describe("section capping (Show all N)", () => {
  it("truncates a section past the cap but keeps the full count", () => {
    const refs = Array.from(
      { length: SECTION_ROW_CAP + 3 },
      (_, i): EntityRef => ({ type: "task", id: `t${i}` }),
    );
    const links = refs.map((r) => link(r));
    const recs = registry(...refs.map((r, i) => record(r, `Task ${i}`)));
    const [section] = rollupSections(FOCUS, links, recs);

    expect(section.count).toBe(SECTION_ROW_CAP + 3);
    expect(isSectionTruncated(section)).toBe(true);
    expect(visibleRows(section, false)).toHaveLength(SECTION_ROW_CAP);
    expect(visibleRows(section, true)).toHaveLength(SECTION_ROW_CAP + 3);
  });

  it("does not truncate a section at or under the cap", () => {
    const refs = Array.from({ length: 3 }, (_, i): EntityRef => ({ type: "task", id: `t${i}` }));
    const [section] = rollupSections(
      FOCUS,
      refs.map((r) => link(r)),
      registry(...refs.map((r, i) => record(r, `Task ${i}`))),
    );
    expect(isSectionTruncated(section)).toBe(false);
    expect(visibleRows(section, false)).toHaveLength(3);
  });
});

describe("HUB_SECTIONS", () => {
  it("locks the fixed section order", () => {
    expect(HUB_SECTIONS.map((s) => s.key)).toEqual([
      "open-work",
      "money",
      "conversations",
      "notes",
      "other",
    ]);
  });
});

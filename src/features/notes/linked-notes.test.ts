import { describe, expect, it } from "vitest";

import type { EntityLink, EntityRef } from "../../lib/entity-links";
import type { HubRow, HubSection } from "../spine/rollup";
import { newLinkedNoteLinkArgs, selectLinkedNotes } from "./linked-notes";

function link(overrides: Partial<EntityLink> = {}): EntityLink {
  return {
    id: "l1",
    workspaceId: "ws",
    sourceType: "contact",
    sourceId: "c1",
    targetType: "note",
    targetId: "n1",
    relationKind: "references",
    origin: "manual",
    createdBy: null,
    createdAt: "2026-07-04T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function row(overrides: Partial<HubRow> & { other: EntityRef }): HubRow {
  return {
    link: link(),
    relationKind: "references",
    title: "A note",
    snippet: null,
    icon: "note",
    tombstoned: false,
    ...overrides,
  };
}

function section(key: HubSection["key"], rows: HubRow[]): HubSection {
  return { key, label: key, rows, count: rows.length };
}

describe("selectLinkedNotes", () => {
  it("pulls only note-typed rows across all sections, newest-first", () => {
    const sections: HubSection[] = [
      section("open-work", [row({ other: { type: "task", id: "t1" }, title: "A task" })]),
      section("notes", [
        row({ other: { type: "note", id: "n1" }, title: "First" }),
        row({ other: { type: "note", id: "n2" }, title: "Second" }),
      ]),
      section("other", [row({ other: { type: "company", id: "co1" }, title: "Acme" })]),
    ];
    const rows = selectLinkedNotes(sections);
    expect(rows.map((r) => r.noteId)).toEqual(["n1", "n2"]);
    expect(rows.every((r) => !r.tombstoned)).toBe(true);
  });

  it("de-duplicates a note linked by two kinds, keeping the first (most recent) edge", () => {
    const sections: HubSection[] = [
      section("notes", [
        row({ other: { type: "note", id: "n1" }, relationKind: "references", link: link({ id: "la" }) }),
        row({ other: { type: "note", id: "n1" }, relationKind: "mentions", link: link({ id: "lb", relationKind: "mentions" }) }),
      ]),
    ];
    const rows = selectLinkedNotes(sections);
    expect(rows).toHaveLength(1);
    expect(rows[0].link.id).toBe("la");
  });

  it("normalizes a blank live title to Untitled but keeps a tombstone title verbatim", () => {
    const sections: HubSection[] = [
      section("notes", [
        row({ other: { type: "note", id: "n1" }, title: "" }),
        row({ other: { type: "note", id: "n2" }, title: "Deleted note", tombstoned: true }),
      ]),
    ];
    const rows = selectLinkedNotes(sections);
    expect(rows[0].title).toBe("Untitled");
    expect(rows[1].title).toBe("Deleted note");
    expect(rows[1].tombstoned).toBe(true);
  });

  it("returns [] when nothing is linked", () => {
    expect(selectLinkedNotes([])).toEqual([]);
  });
});

describe("newLinkedNoteLinkArgs", () => {
  it("references the new note from the focus entity, manual origin", () => {
    const focus: EntityRef = { type: "contact", id: "c1" };
    const args = newLinkedNoteLinkArgs(focus, { id: "n9", title: "Kickoff" });
    expect(args).toEqual({
      source: { type: "contact", id: "c1" },
      target: { type: "note", id: "n9" },
      relationKind: "references",
      origin: "manual",
      targetLabel: "Kickoff",
    });
  });

  it("labels a title-less note Untitled", () => {
    const args = newLinkedNoteLinkArgs({ type: "event", id: "e1" }, { id: "n1", title: "" });
    expect(args.targetLabel).toBe("Untitled");
    expect(args.source).toEqual({ type: "event", id: "e1" });
  });
});

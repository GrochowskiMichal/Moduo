// DF-10 — the palette entity-search grouping. Verifies the fixed group order,
// type→group folding, empty-group dropping, and that un-navigable kinds vanish.

import { describe, expect, it } from "vitest";
import { groupPaletteResults, PALETTE_ENTITY_TYPES } from "./palette-search";
import type { EntityRecord } from "./entity-links";

function rec(type: string, id: string, label: string): EntityRecord {
  return { workspaceId: "w1", type, id, label, icon: null, deletedAt: null };
}

describe("groupPaletteResults", () => {
  it("folds each registry type into its group", () => {
    const groups = groupPaletteResults([
      rec("task", "t1", "Water plants"),
      rec("project", "p1", "Launch"),
      rec("note", "n1", "Meeting notes"),
      rec("contact", "c1", "Ada"),
      rec("company", "co1", "Acme"),
      rec("email", "e1", "Re: invoice"),
      rec("event", "ev1", "Standup"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["tasks", "notes", "contacts", "email", "events"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["t1", "p1"]); // task + project under Tasks
    expect(groups[2].items.map((i) => i.id)).toEqual(["c1", "co1"]); // contact + company under Contacts
  });

  it("keeps the fixed display order regardless of input order", () => {
    const groups = groupPaletteResults([
      rec("event", "ev1", "Standup"),
      rec("contact", "c1", "Ada"),
      rec("task", "t1", "Water plants"),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["tasks", "contacts", "events"]);
  });

  it("drops empty groups", () => {
    const groups = groupPaletteResults([rec("note", "n1", "Only a note")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("notes");
  });

  it("routes email_thread into the Email group", () => {
    const groups = groupPaletteResults([rec("email_thread", "r1", "Thread")]);
    expect(groups).toEqual([
      { key: "email", heading: "Email", items: [rec("email_thread", "r1", "Thread")] },
    ]);
  });

  it("drops un-navigable kinds the route map can't resolve", () => {
    const groups = groupPaletteResults([
      rec("payment", "pay1", "$50"),
      rec("invoice", "inv1", "INV-1"),
      rec("comment", "cm1", "nice"),
      rec("file", "f1", "deck.pdf"),
    ]);
    expect(groups).toEqual([]);
  });

  it("returns nothing for an empty result set", () => {
    expect(groupPaletteResults([])).toEqual([]);
  });

  it("exposes the searchable types as the union of every group", () => {
    expect(PALETTE_ENTITY_TYPES).toEqual([
      "task",
      "project",
      "note",
      "contact",
      "company",
      "email",
      "email_thread",
      "event",
    ]);
  });
});

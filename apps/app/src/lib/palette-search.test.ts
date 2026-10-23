// DF-10 — the palette entity-search grouping. Verifies the fixed group order,
// type→group folding, empty-group dropping, and that un-navigable kinds vanish.

import { describe, expect, it } from "@rstest/core";

import type { EntityRecord } from "./entity-links";
import { groupPaletteResults, PALETTE_ENTITY_TYPES, withHandleHit } from "./palette-search";

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

describe("withHandleHit — a task named by its ID leads (MOD-144)", () => {
  it("puts the task first in Tasks, once", () => {
    const hit = rec("task", "t99", "Fix the login");
    const merged = withHandleHit(
      [rec("task", "t990", "Found by its handle's start"), rec("task", "t99", "Fix the login")],
      hit,
    );
    expect(merged.map((r) => r.id)).toEqual(["t99", "t990"]);
    expect(groupPaletteResults(merged)[0].items[0].id).toBe("t99");
  });

  it('adds the task when the registry found nothing ("mod 99" never reaches it)', () => {
    const merged = withHandleHit([], rec("task", "t99", "Fix the login"));
    expect(merged.map((r) => r.id)).toEqual(["t99"]);
  });

  it("leaves the results as they are without one", () => {
    const results = [rec("note", "n1", "Meeting notes")];
    expect(withHandleHit(results, null)).toBe(results);
  });
});

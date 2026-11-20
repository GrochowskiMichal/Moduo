// GS-9 — Email in the ⌘K palette (specs/global-search.md AC12, Assumption 15,
// Q17, Q17b). Desktop: this device's own mail search joins the Email group,
// newest first, inbox-only and only for accounts connected here. Web: only the
// `email_refs` threads `search_all` already returned, untouched.

import type { SearchAllRow } from "@contracts/search";
import { describe, expect, it } from "@rstest/core";

import { buildPaletteView } from "../../lib/palette-search";
import { mergeMailRows } from "./search-palette";

function serverRow(id: string, extra: Partial<SearchAllRow> = {}): SearchAllRow {
  return {
    entity_type: "email_thread",
    entity_id: id,
    title: id,
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0.5,
    updated_at: "2026-10-01T00:00:00Z",
    archived: false,
    score: 0.5,
    type_total: 1,
    top: false,
    ...extra,
  };
}

describe("desktop mail group, web pulled-in only", () => {
  it("desktop: merged into the server's answer, the Email group is newest first, 3 rows and Show all", () => {
    // The engine's rows; t-3 is pulled in, so it carries its email_refs id.
    const local = [1, 2, 3, 4, 5].map((d) =>
      serverRow(d === 3 ? "ref-3" : `t-${d}`, { updated_at: `2026-10-0${d}T00:00:00Z` }),
    );
    const task: SearchAllRow = {
      ...serverRow("task-1", { entity_type: "task", top: true, score: 0.9 }),
    };
    // The server already knows t-3 (pulled in) and one thread this device lacks.
    const server = [
      task,
      serverRow("ref-3", { updated_at: "2026-09-01T00:00:00Z", type_total: 2 }),
      serverRow("ref-elsewhere", { updated_at: "2026-10-04T12:00:00Z", type_total: 2 }),
    ];
    const merged = mergeMailRows(server, local);
    const mail = merged.filter((r) => r.entity_type === "email_thread");
    expect(mail.map((r) => r.entity_id)).toEqual([
      "t-5",
      "ref-elsewhere",
      "t-4",
      "ref-3",
      "t-2",
      "t-1",
    ]);
    // A thread both sources found is one row.
    expect(mail.filter((r) => r.entity_id === "ref-3")).toHaveLength(1);
    // The other groups pass through untouched.
    expect(merged.filter((r) => r.entity_type === "task")).toEqual([task]);

    const view = buildPaletteView(merged, { chip: "all" });
    const email = view.groups.find((g) => g.key === "email");
    expect(email?.rows.map((r) => r.entity_id)).toEqual(["t-5", "ref-elsewhere", "t-4"]);
    expect(email?.total).toBe(6);
    expect(email?.more).toBe(true);
    expect(view.top?.entity_id).toBe("task-1");
  });

  it("desktop: the server still counts mail it didn't send in Show all", () => {
    const local = [serverRow("t-1")];
    const server = [serverRow("ref-a", { type_total: 12 }), serverRow("ref-b", { type_total: 12 })];
    const merged = mergeMailRows(server, local);
    const view = buildPaletteView(merged, { chip: "all" });
    expect(view.groups.find((g) => g.key === "email")?.total).toBe(13);
  });

  it("desktop: a pulled-in thread the server ranked Top stays Top", () => {
    const local = [serverRow("ref-1")];
    const merged = mergeMailRows([serverRow("ref-1", { top: true })], local);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.top).toBe(true);
    expect(buildPaletteView(merged, { chip: "all" }).top?.entity_id).toBe("ref-1");
  });

  it("desktop: offline, the device's mail still answers on its own", () => {
    const local = [serverRow("t-1")];
    const view = buildPaletteView(mergeMailRows([], local), { chip: "email" });
    expect(view.groups.map((g) => g.key)).toEqual(["email"]);
    expect(view.groups[0]?.rows.map((r) => r.entity_id)).toEqual(["t-1"]);
  });

  it("web: no local mail, only the email_refs threads search_all returned, untouched", () => {
    const server = [
      serverRow("task-1", { entity_type: "task", top: true }),
      serverRow("ref-b", { updated_at: "2026-09-01T00:00:00Z", rank: 0.9 }),
      serverRow("ref-a", { updated_at: "2026-10-01T00:00:00Z", rank: 0.4 }),
    ];
    expect(mergeMailRows(server, null)).toEqual(server);
    const view = buildPaletteView(mergeMailRows(server, null), { chip: "all" });
    expect(view.groups.find((g) => g.key === "email")?.rows.map((r) => r.entity_id)).toEqual([
      "ref-b",
      "ref-a",
    ]);
  });
});

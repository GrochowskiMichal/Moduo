import { describe, expect, it } from "vitest";

import { SETTINGS_GROUPS, SETTINGS_SECTION_IDS } from "./settings-events";

describe("SETTINGS_GROUPS (grouped nav — DF-19a)", () => {
  it("renders three groups in order: Personal, Workspace, App", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual(["Personal", "Workspace", "App"]);
  });

  it("orders sections within each group per the spec", () => {
    const byLabel = Object.fromEntries(SETTINGS_GROUPS.map((g) => [g.label, g.ids]));
    expect(byLabel.Personal).toEqual(["account", "billing", "appearance", "preferences", "focus"]);
    expect(byLabel.Workspace).toEqual(["workspace", "integrations", "apikeys"]);
    expect(byLabel.App).toEqual(["advanced", "about"]);
  });

  it("covers every section id exactly once — no orphan tabs, no duplicates", () => {
    const grouped = SETTINGS_GROUPS.flatMap((g) => g.ids);
    // No section may sit in two groups (or twice in one).
    expect(new Set(grouped).size).toBe(grouped.length);
    // Every registered section is reachable from the nav, and the nav lists
    // nothing that isn't a real section.
    expect([...grouped].sort()).toEqual([...SETTINGS_SECTION_IDS].sort());
  });
});

import { describe, expect, it } from "@rstest/core";

import { HOTKEYS } from "@/lib/hotkeys/registry";

import { formatMailKey, mailKeyHint, mailLegend, mailPaletteActions } from "./keys";

const registryMailIds = Object.entries(HOTKEYS)
  .filter(([, def]) => def.scope === "email")
  .map(([id]) => id)
  .sort();

describe("mail keys (AC42)", () => {
  it("legend from registry", () => {
    const ids = mailLegend()
      .flatMap((g) => g.entries.map((e) => e.id))
      .sort();
    expect(ids).toEqual(registryMailIds);
    expect(new Set(ids).size).toBe(ids.length);
    const done = mailLegend()
      .flatMap((g) => g.entries)
      .find((e) => e.id === "email.archive");
    expect(done).toEqual({
      id: "email.archive",
      label: HOTKEYS["email.archive"].label,
      keys: ["e"],
    });
  });

  it("⌘K lists exactly the registry's acting mail keys", () => {
    const ids = mailPaletteActions().map((a) => a.id);
    const acting = registryMailIds.filter(
      (id) => !["email.legend", "email.search", "email.clear-selection"].includes(id),
    );
    expect(ids.sort()).toEqual(acting);
    for (const a of mailPaletteActions()) expect(a.shortcut).not.toBe("");
  });

  it("formats chords the way the legend shows them", () => {
    expect(formatMailKey("Shift+3")).toBe("#");
    expect(formatMailKey("Shift+/")).toBe("?");
    expect(formatMailKey("Mod+A")).toBe("⌘a");
    expect(formatMailKey("Shift+J")).toBe("⇧J");
    expect(formatMailKey("E")).toBe("e");
    expect(mailKeyHint("email.snooze")).toBe("s");
  });
});

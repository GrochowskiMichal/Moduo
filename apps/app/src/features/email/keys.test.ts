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
      .flatMap((g) => g.rows.flatMap((r) => r.ids))
      .sort();
    expect(ids).toEqual(registryMailIds);
    expect(new Set(ids).size).toBe(ids.length);
    const done = mailLegend()
      .flatMap((g) => g.rows)
      .find((r) => r.ids.includes("email.archive"));
    expect(done).toEqual({
      ids: ["email.archive", "email.undone"],
      label: "Done · not done",
      keys: ["e", "⇧E"],
    });
  });

  it("the ? sheet: Move, Act, Connect columns, a Write group, next · previous pairs", () => {
    const legend = mailLegend(true);
    const firstOf = (column: number) => legend.find((g) => g.column === column)?.title;
    expect([firstOf(0), firstOf(1), firstOf(2)]).toEqual(["Move", "Act", "Connect"]);
    const keysIn = (title: string) =>
      legend.find((g) => g.title === title)!.rows.map((r) => r.keys.join(" "));
    expect(keysIn("Connect")).toEqual(["⌥1 ⌥2 ⌥3", "t", "l", "n"]);
    expect(keysIn("Write")).toEqual(expect.arrayContaining(["⌘↵", ";;", "Esc"]));
    expect(keysIn("Move")).toEqual(
      expect.arrayContaining(["j k", "] [", "↵", "gi gf gs", "ga gt gd"]),
    );
    expect(keysIn("Act")).toEqual(expect.arrayContaining(["m # ⌫", "z ⌘z"]));
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
    expect(formatMailKey(["G", "I"])).toBe("gi");
    expect(formatMailKey("Backspace")).toBe("⌫");
  });
});

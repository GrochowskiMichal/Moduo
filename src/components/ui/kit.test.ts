// DS-6 (tasks-v3 AC14.1): every north-star kit primitive exists in
// src/components/ui with a Storybook story that shows it at the three density
// steps. tests/visual/kit.spec.ts opens each story in Storybook and reads the
// density tokens; this half runs in `bun run verify`.
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";
import { KIT, kitStoryId } from "./kit";
import { DENSITIES } from "./kit-densities";

const UI = path.join(process.cwd(), "src/components/ui");

describe("the north-star kit (DS-6)", () => {
  it("names every primitive of the re-plan's kit table", () => {
    expect(KIT.map((k) => k.name)).toEqual([
      "Row",
      "Card",
      "GroupHeader",
      "MetaCount",
      "PropertyRow / PropertyValue",
      "CollectionHeader",
      "NavRow",
      "Toolbar",
      "FilterBar",
      "DisplayMenu",
      "Chip",
      "Picker pill",
      "EmptyState",
      "Feed",
      "DateField",
      "Progress",
      "Avatar",
    ]);
  });

  it("each one has a story at the three densities", async () => {
    for (const entry of KIT) {
      const component = path.join(UI, `${entry.file}.tsx`);
      const stories = path.join(UI, `${entry.file}.stories.tsx`);
      await expect(fs.access(component), entry.name).resolves.toBeUndefined();
      const source = await fs.readFile(stories, "utf8");
      expect(source, entry.name).toContain(`title: "Components/ui/${entry.file}"`);
      const exportAt = source.indexOf(`export const ${entry.story}: Story`);
      expect(exportAt, `${entry.name}: export ${entry.story}`).toBeGreaterThan(-1);
      // The story body (up to the next export) renders through the helper.
      const next = source.indexOf("\nexport const ", exportAt + 1);
      const body = source.slice(exportAt, next === -1 ? undefined : next);
      expect(body, `${entry.name}: ${entry.story} uses AtThreeDensities`).toContain(
        "<AtThreeDensities",
      );
    }
  });

  it("story ids follow Storybook's naming", () => {
    expect(kitStoryId({ name: "x", file: "chip", story: "PickerPillDensities" })).toBe(
      "components-ui-chip--picker-pill-densities",
    );
    expect(kitStoryId({ name: "x", file: "row", story: "Densities" })).toBe(
      "components-ui-row--densities",
    );
  });

  it("the helper covers the three density steps the tokens define", async () => {
    expect(DENSITIES.map((d) => d.value)).toEqual(["comfortable", "compact", "dense"]);
    const tokens = await fs.readFile(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");
    for (const { value } of DENSITIES) expect(tokens).toContain(`[data-density="${value}"]`);
  });
});

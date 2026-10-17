// MOD-121 (dogfood call #28) — the shell's panel frame (tokens.css §10). Density
// changes row and control heights, never the frame: --panel-pad (a panel's
// edge → a fill at it) and --panel-inset (→ the text column) are fixed and live
// on :root only. The centre's top, --panel-title-top, is derived from --row-h,
// and a custom property that uses var() is computed where it is declared, so
// it is re-declared on every density scope. jsdom can't resolve var(), so the
// derived numbers are worked out here from the density blocks and checked live
// with getBoundingClientRect (the MOD-121 canvas's "after" numbers).
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";

import { blocksWithSelectors, type CssBlock, cssBlocks, declarations } from "./css-blocks";

const tokenBlocks = async (): Promise<CssBlock[]> =>
  cssBlocks(await fs.readFile(path.join(process.cwd(), "src/styles/tokens.css"), "utf8"));

const remPx = (value: string | undefined) => {
  const match = /^([\d.]+)rem$/.exec(value ?? "");
  if (!match) throw new Error(`not a rem value: ${value}`);
  return Number(match[1]) * 16;
};

const DENSITIES = ["comfortable", "compact", "dense"] as const;

describe("the panel frame (MOD-121)", () => {
  it("is 8 to a fill and 16 to the text column, on :root", async () => {
    const blocks = await tokenBlocks();
    const declaring = blocks.filter((b) => declarations(b).has("--panel-pad"));
    expect(declaring.map((b) => b.prelude)).toEqual([":root"]);
    const decls = declarations(declaring[0]);
    expect(remPx(decls.get("--panel-pad"))).toBe(8);
    expect(remPx(decls.get("--panel-inset"))).toBe(16);
  });

  it("never moves with density", async () => {
    const blocks = await tokenBlocks();
    const strays = blocks
      .filter((b) => /data-density/.test(b.prelude))
      .flatMap((b) =>
        ["--panel-pad", "--panel-inset"]
          .filter((t) => declarations(b).has(t))
          .map((t) => `${t} in "${b.prelude}"`),
      );
    expect(strays).toEqual([]);
  });

  it("derives the centre's top on every density scope, so its title centres on the first row", async () => {
    const blocks = await tokenBlocks();
    const declaring = blocks.filter((b) => declarations(b).has("--panel-title-top"));
    expect(declaring.map((b) => b.prelude)).toEqual([":root, [data-density]"]);
    expect(declarations(declaring[0]).get("--panel-title-top")).toBe(
      "calc(var(--panel-pad) + (var(--row-h) - 1.75rem) / 2)",
    );

    // 8 + (row − 28) / 2: the 28 px title line's centre sits on the side
    // panels' first-row centre (8 + row / 2) at every density.
    const tops = DENSITIES.map((density) => {
      const block = blocksWithSelectors(
        blocks,
        density === "comfortable"
          ? [":root", '[data-density="comfortable"]']
          : [`[data-density="${density}"]`],
      );
      expect(block).toHaveLength(1);
      const row = remPx(declarations(block[0]).get("--row-h"));
      return 8 + (row - 28) / 2;
    });
    expect(tops).toEqual([12, 10, 8]);
  });
});

// MOD-162 (Maciej, 2026-10-16): half the space between two panels, the same
// 16 px from the window's edge. The gap is a frame token, so density never
// moves it either.
describe("the space between panels (MOD-162)", () => {
  it("is 8, on :root only", async () => {
    const blocks = await tokenBlocks();
    const declaring = blocks.filter((b) => declarations(b).has("--panel-gap"));
    expect(declaring.map((b) => b.prelude)).toEqual([":root"]);
    expect(remPx(declarations(declaring[0]).get("--panel-gap"))).toBe(8);
  });
});

describe("a wrapping row's first line (MOD-153)", () => {
  it("is derived on every density scope, so a one-line row stays the small rung tall", async () => {
    const blocks = await tokenBlocks();
    const declaring = blocks.filter((b) => declarations(b).has("--row-first-line-pad"));
    expect(declaring.map((b) => b.prelude)).toEqual([":root, [data-density]"]);
    expect(declarations(declaring[0]).get("--row-first-line-pad")).toBe(
      "calc((var(--ctrl-h-sm) - 1lh) / 2)",
    );

    // Worked out from the density blocks, as above (jsdom resolves neither
    // var() nor lh; measured live in the MOD-153 report): the overview's rows
    // set 14 px text on a 21 px line, so 1lh + 2 × pad is the rung (26 / 24 /
    // 22), the height a one-line row had before.
    const pads = DENSITIES.map((density) => {
      const block = blocksWithSelectors(
        blocks,
        density === "comfortable"
          ? [":root", '[data-density="comfortable"]']
          : [`[data-density="${density}"]`],
      );
      return (remPx(declarations(block[0]).get("--ctrl-h-sm")) - 21) / 2;
    });
    expect(pads).toEqual([2.5, 1.5, 0.5]);
  });
});

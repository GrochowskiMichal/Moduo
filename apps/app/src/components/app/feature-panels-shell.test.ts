// SH-1 (tasks-v3 call 89, AC11.7) — the right panel is never narrower than
// 280 px, in every module, resizable or fixed. jsdom can't lay the panels out,
// so this pins the constraint where FeaturePanelsShell declares it; the live
// clamp (a saved 168 px layout opens at 280) is in docs/testing/t-maciej-sh-1-shell.md.
// It reads the source text on purpose: if a rename or reformat breaks it,
// re-point the match, don't drop the floor.
import { promises as fs } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

const read = () =>
  fs.readFile(path.join(process.cwd(), "src/components/app/feature-panels-shell.tsx"), "utf8");

describe("the right panel's floor", () => {
  it("is 280 px", async () => {
    expect(await read()).toMatch(/const RIGHT_MIN = "280px";/);
  });

  it("bounds the right panel in both modes", async () => {
    const source = await read();
    const right = source.slice(source.indexOf("-right`}"));
    const props = right.slice(0, right.indexOf(">"));
    expect(props).toMatch(/minSize=\{RIGHT_MIN\}/);
    expect(props).toMatch(/maxSize=\{resizable \? "40%" : RIGHT_MIN\}/);
  });
});

// MOD-121 (dogfood call #28): one frame for the three panels, which density
// never moves. The token values and where they live are pinned in
// src/styles/panel-frame.test.ts.
describe("the panels' padding", () => {
  it("holds the side panels' fills --panel-pad from the edge", async () => {
    expect(await read()).toMatch(/const RAIL_PAD = \{ padding: "var\(--panel-pad\)" \} as const;/);
  });

  it("puts the centre's text column --panel-inset in, under the derived title top", async () => {
    expect(await read()).toMatch(
      /const CENTER_PAD = \{\s*padding: "var\(--panel-title-top\) var\(--panel-inset\) var\(--panel-inset\)",\s*\} as const;/,
    );
  });

  it("reads no density padding (--pad-*) for the frame", async () => {
    expect(await read()).not.toMatch(/var\(--pad-/);
  });

  it("puts the bottom bar on the panels' 16 px edge line, and keeps the top bar at 20", async () => {
    const chrome = await fs.readFile(
      path.join(process.cwd(), "src/components/app/app-chrome.tsx"),
      "utf8",
    );
    expect(chrome).toMatch(/"relative flex flex-row items-center bg-background px-4"/);
    expect(chrome).toMatch(/"relative grid w-full items-center bg-background px-5"/);
  });
});

// MOD-162 (Maciej, 2026-10-16): 8 px between panels, 16 at the window's edges.
// The gap is the resize handle's width; the handle still grabs over 16 px,
// which the library does by growing the separator's box to a minimum (it
// hit-tests by geometry, so a wider pseudo-element would do nothing). Checked
// live: a grab 7 px either side of the gap's centre resizes, 10 px does not.
describe("the space between panels (MOD-162)", () => {
  const resizable = () =>
    fs.readFile(path.join(process.cwd(), "src/components/ui/resizable.tsx"), "utf8");

  it("makes the handle the --panel-gap wide, with its line centred", async () => {
    const source = await resizable();
    expect(source).toMatch(/"relative flex w-\(--panel-gap\) items-center/);
    expect(source).toMatch(/before:left-1\/2 before:w-px before:-translate-x-1\/2/);
  });

  it("keeps a 16 px drag target on every group", async () => {
    const source = await resizable();
    expect(source).toMatch(/const RESIZE_TARGET = \{ fine: 16, coarse: 20 \} as const;/);
    expect(source).toMatch(/resizeTargetMinimumSize=\{RESIZE_TARGET\}/);
  });

  it("keeps 16 px at the window's edges", async () => {
    const shell = await read();
    expect(shell).toMatch(/"flex h-full min-h-0 bg-background px-4"/);
    expect(shell).toMatch(/"flex h-full min-h-0 flex-col bg-background px-4"/);
  });
});

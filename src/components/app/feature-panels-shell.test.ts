// SH-1 (tasks-v3 call 89, AC11.7) — the right panel is never narrower than
// 280 px, in every module, resizable or fixed. jsdom can't lay the panels out,
// so this pins the constraint where FeaturePanelsShell declares it; the live
// clamp (a saved 168 px layout opens at 280) is in docs/testing/t-maciej-sh-1-shell.md.
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

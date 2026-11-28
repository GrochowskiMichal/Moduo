import { describe, expect, it } from "bun:test";

import { exportTokens } from "./export-tokens";

// What the export refuses rather than drop or mis-read (validator pass on NF-3).
describe("the export refuses what it would lose", () => {
  it.each([
    ["!important", ":root { --x: 1px !important; }", /!important/],
    ["a nested rule", ':root { --x: 1px; [data-theme="light"] { --x: 2px; } }', /nested rule/],
    [
      "an at-rule inside @media",
      "@media (min-width: 1px) { @supports (x: y) { :root { --x: 1px; } } }",
      /inside @media/,
    ],
    ["a channel in an unknown unit", ":root { --x: rgb(100% 0% 0%); }", /channel 1/],
    ["a hue method", ":root { --x: color-mix(in oklch longer hue, red, blue); }", /in <space>/],
    [
      "an axis the app does not have",
      '[data-thme="light"] { --x: 1px; }',
      /not an appearance axis/,
    ],
    [
      "a later, outranked override",
      '[data-theme="dark"] { --x: 1px; } :where(:root) { --x: 2px; }',
      /outranked/,
    ],
  ])("%s", (_, css, error) => {
    expect(() => exportTokens(css)).toThrow(error);
  });

  it("reads a percentage lightness as 0–1 and a hue in degrees", () => {
    const { layers } = exportTokens(":root { --x: oklch(50% 0.1 200deg / 0.5); }");
    expect(layers[0]!.set.x).toEqual({ oklch: [0.5, 0.1, 200, 0.5] });
  });

  it("lets a later layer of equal or higher rank override", () => {
    expect(() =>
      exportTokens(':root { --x: 1px; } [data-theme="light"] { --x: 2px; }'),
    ).not.toThrow();
  });
});

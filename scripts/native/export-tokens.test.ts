import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { exportTokens, TOKENS_CSS, TOKENS_JSON } from "./export-tokens";

// NF-3 (specs/native-foundation.md): the native app reads its design values from a committed
// export of tokens.css. These tests are what keeps the two from drifting.
const root = join(import.meta.dir, "../..");
const css = readFileSync(join(root, TOKENS_CSS), "utf8");

type Layer = {
  when: Record<string, unknown>[];
  media?: Record<string, string>;
  set: Record<string, unknown>;
};

describe("tokens.json", () => {
  it("the committed tokens.json matches tokens.css", () => {
    const committed = JSON.parse(readFileSync(join(root, TOKENS_JSON), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(exportTokens(css))));
  });

  it("every custom property is exported", () => {
    // Everything above the Tailwind mapping block; the @theme block is Tailwind's, not ours.
    const ours = css.slice(0, css.indexOf("@theme inline"));
    const declared = new Set([...ours.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!.slice(2)));
    const exported = new Set(exportTokens(css).layers.flatMap((l: Layer) => Object.keys(l.set)));
    expect([...declared].filter((n) => !exported.has(n))).toEqual([]);
    expect([...exported].filter((n) => !declared.has(n))).toEqual([]);
    // A floor against an export that silently reads nothing: 238 names today (456 definitions).
    expect(declared.size).toBeGreaterThan(200);
  });

  it("keeps layers in source order, so a later layer wins", () => {
    const layers = exportTokens(css).layers as Layer[];
    const firstDark = layers.findIndex((l) => l.when.some((w) => w.theme === "dark"));
    const firstLight = layers.findIndex((l) => l.when.some((w) => w.theme === "light"));
    expect(firstDark).toBeGreaterThanOrEqual(0);
    expect(firstLight).toBeGreaterThan(firstDark);
  });

  it("reads a value into its expression", () => {
    const { layers } = exportTokens(`:root {
      --a: oklch(0.5 0.1 200 / 0.4);
      --b: color-mix(in oklab, var(--a) 13%, transparent);
      --c: calc(var(--d) * 5);
      --d: 1.25rem;
      --e: 180ms;
      --f: cubic-bezier(0.16, 1, 0.3, 1);
    }`);
    expect(layers).toEqual([
      {
        when: [{}],
        set: {
          a: { oklch: [0.5, 0.1, 200, 0.4] },
          b: {
            mix: {
              space: "oklab",
              a: { var: "a" },
              pa: 13,
              b: { keyword: "transparent" },
              pb: null,
            },
          },
          c: { calc: { op: "*", l: { var: "d" }, r: { num: 5, unit: "" } } },
          d: { num: 1.25, unit: "rem" },
          e: { num: 180, unit: "ms" },
          f: { bezier: [0.16, 1, 0.3, 1] },
        },
      },
    ]);
  });

  it("maps selectors and media queries to appearance conditions", () => {
    const { layers } = exportTokens(`
      :root, [data-theme="dark"] { --x: 1px; }
      [data-shade="warm"]:not([data-theme="light"]) { --x: 2px; }
      [data-theme="light"] [data-accent="mono"] { --x: 3px; }
      @media (prefers-reduced-motion: reduce) { :root:not([data-motion="full"]) { --x: 4px; } }
    `);
    expect(layers.map((l: Layer) => [l.when, l.media])).toEqual([
      [[{}, { theme: "dark" }], undefined],
      [[{ shade: "warm", theme: { not: "light" } }], undefined],
      [[{ theme: "light", accent: "mono" }], undefined],
      [[{ motion: { not: "full" } }], { "prefers-reduced-motion": "reduce" }],
    ]);
  });

  it("an unknown function fails the export", () => {
    expect(() => exportTokens(":root { --x: frob(1px); }")).toThrow(/frob/);
  });

  it("an unmapped selector fails the export", () => {
    expect(() => exportTokens(".card { --x: 1px; }")).toThrow(/\.card/);
  });
});

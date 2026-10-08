// The design-system tests (tokens.test.ts, global-css.test.ts) read our
// stylesheets through this helper; a silently-wrong reader would make those
// gates pass on anything, so it gets its own checks.
import { describe, expect, it } from "@rstest/core";

import { blocksWithSelectors, cssBlocks, declarations, selectors } from "./css-blocks";

describe("cssBlocks", () => {
  it("records nesting, selector lists and own declarations", () => {
    const blocks = cssBlocks(`
      /* a comment with { braces } and ; */
      :root, [data-theme="light"] [data-accent] { --a: 1; --b: color-mix(in oklab, red 5%, transparent); }
      @layer base {
        * { scrollbar-width: thin; }
        ::-webkit-scrollbar-thumb:hover { background-color: var(--x); }
      }
    `);
    const root = blocksWithSelectors(blocks, ['[data-theme="light"] [data-accent]', ":root"]);
    expect(root).toHaveLength(1);
    expect(selectors(root[0])).toEqual([":root", '[data-theme="light"] [data-accent]']);
    expect(Object.fromEntries(declarations(root[0]))).toEqual({
      "--a": "1",
      "--b": "color-mix(in oklab, red 5%, transparent)",
    });

    const star = blocks.find((b) => b.prelude === "*");
    expect(star?.parents).toEqual(["@layer base"]);
    const layer = blocks.find((b) => b.prelude === "@layer base");
    expect(layer && [...declarations(layer)]).toEqual([]);
  });

  it("ignores braces and semicolons inside strings and parentheses", () => {
    const blocks = cssBlocks(`
      .icon { background: url("data:image/svg+xml;utf8,<svg>{}</svg>"); content: "}"; }
      .after { color: var(--y); }
    `);
    expect(blocks.map((b) => b.prelude)).toEqual([".icon", ".after"]);
    expect(declarations(blocks[0]).get("content")).toBe('"}"');
    expect(declarations(blocks[1]).get("color")).toBe("var(--y)");
  });

  it("fails loudly on unbalanced input", () => {
    expect(() => cssBlocks(".a { color: red; } }")).toThrow(/Unbalanced/);
    expect(() => cssBlocks(".a { color: red;")).toThrow(/Unclosed/);
  });
});

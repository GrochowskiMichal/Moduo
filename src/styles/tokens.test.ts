// DS-1 — the state layer (tokens.css §5b). These pin where the tokens are
// declared, because WHERE decides whether they resolve correctly: a custom
// property that uses var() is computed on the element that declares it, so
// the layer is re-declared on every appearance scope (scoped accents, swatches)
// instead of living on :root alone. jsdom neither inherits custom properties
// nor substitutes var(), so the resolution itself is checked live in a browser
// (docs/testing/t-maciej-ds-1-state-tokens.md); here we check the structure
// and what Tailwind actually emits for the utilities.
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";
import { compile } from "tailwindcss";

import { blocksWithSelectors, type CssBlock, cssBlocks, declarations } from "./css-blocks";

const read = (rel: string) => fs.readFile(path.join(process.cwd(), rel), "utf8");

const STATE_LAYER: Record<string, string> = {
  "--state-hover": "color-mix(in oklab, var(--foreground) 5%, transparent)",
  "--state-active": "color-mix(in oklab, var(--foreground) 9%, transparent)",
  "--state-active-hover": "color-mix(in oklab, var(--foreground) 14%, transparent)",
  "--state-selected": "color-mix(in oklab, var(--primary) 13%, transparent)",
  "--state-selected-ring": "color-mix(in oklab, var(--primary) 32%, transparent)",
  // Hovering a selected row or card (DS-6).
  "--state-selected-hover": "color-mix(in oklab, var(--primary) 18%, transparent)",
  // The tertiary text level (DS-6, call 38).
  "--subtle-foreground": "color-mix(in oklab, var(--muted-foreground) 86%, transparent)",
  // The tint-only vs tint + hairline switch (DS-2): on by default.
  "--state-selected-edge": "var(--state-selected-ring)",
  "--hairline": "color-mix(in oklab, var(--foreground) 10%, transparent)",
  "--control-raised": "color-mix(in oklab, var(--foreground) 14%, var(--muted))",
  "--scroll-thumb": "color-mix(in oklab, var(--foreground) 16%, transparent)",
  "--scroll-thumb-hover": "color-mix(in oklab, var(--foreground) 32%, transparent)",
};

// The legacy selection recipe rides the same scopes so it re-resolves too.
const LEGACY_SELECTION: Record<string, string> = {
  "--selected-bg": "color-mix(in oklab, var(--primary) 14%, var(--card))",
  "--selected-border": "var(--primary)",
};

// Zero specificity on purpose: a theme override (the light --control-raised)
// must win no matter where the two blocks sit in the file.
const SCOPES = [":where(:root, [data-theme], [data-shade], [data-accent])"];
const LIGHT_SCOPES = [
  '[data-theme="light"]',
  '[data-theme="light"] [data-shade]',
  '[data-theme="light"] [data-accent]',
];

async function tokenBlocks(): Promise<CssBlock[]> {
  return cssBlocks(await read("src/styles/tokens.css"));
}

function onlyBlock(blocks: CssBlock[], list: string[]): CssBlock {
  const found = blocksWithSelectors(blocks, list);
  expect(found.map((b) => b.prelude)).toHaveLength(1);
  return found[0];
}

describe("tokens.css state layer (DS-1)", () => {
  it("state layer defined for every theme scope", async () => {
    const scope = onlyBlock(await tokenBlocks(), SCOPES);
    expect(scope.parents).toEqual([]);
    const decls = declarations(scope);
    for (const [token, value] of Object.entries({ ...STATE_LAYER, ...LEGACY_SELECTION })) {
      expect({ token, value: decls.get(token) }).toEqual({ token, value });
    }
  });

  it("declares each derived token in that scope block only, so nothing pins it to :root", async () => {
    const blocks = await tokenBlocks();
    const scope = onlyBlock(blocks, SCOPES);
    const light = onlyBlock(blocks, LIGHT_SCOPES);
    const derived = [...Object.keys(STATE_LAYER), ...Object.keys(LEGACY_SELECTION)];
    const strays = blocks
      .filter((b) => b !== scope && b !== light)
      .flatMap((b) =>
        derived.filter((t) => declarations(b).has(t)).map((t) => `${t} in "${b.prelude}"`),
      );
    expect(strays).toEqual([]);
  });

  it("lifts the raised plate on light: the white card plus a shadow", async () => {
    const blocks = await tokenBlocks();
    const light = declarations(onlyBlock(blocks, LIGHT_SCOPES));
    expect([...light]).toEqual([["--control-raised", "var(--card)"]]);

    const darkShadows = onlyShadowBlock(blocks, ":root");
    expect(darkShadows.get("--shadow-control-raised")).toBe("0 0 0 0 transparent");
    const lightShadows = onlyShadowBlock(blocks, '[data-theme="light"]');
    expect(lightShadows.get("--shadow-control-raised")).toBe("var(--shadow-sm)");
  });

  it("maps the utilities through @theme inline", async () => {
    const theme = (await tokenBlocks()).filter((b) => b.prelude === "@theme inline");
    expect(theme).toHaveLength(1);
    const decls = declarations(theme[0]);
    expect(Object.fromEntries([...decls].filter(([k]) => /state|hairline|raised/.test(k)))).toEqual(
      {
        "--color-state-hover": "var(--state-hover)",
        "--color-state-active": "var(--state-active)",
        "--color-state-active-hover": "var(--state-active-hover)",
        "--color-state-selected": "var(--state-selected)",
        "--color-state-selected-hover": "var(--state-selected-hover)",
        "--ring-color-state-selected": "var(--state-selected-ring)",
        "--ring-color-state-selected-edge": "var(--state-selected-edge)",
        "--color-hairline": "var(--hairline)",
        "--color-control-raised": "var(--control-raised)",
        "--shadow-control-raised": "var(--shadow-control-raised)",
      },
    );
  });

  it("emits utilities that read the tokens on the element (scoped accents included)", async () => {
    const tokens = await read("src/styles/tokens.css");
    const compiler = await compile(`@tailwind utilities;\n${tokens}`, { base: process.cwd() });
    const css = compiler.build([
      "bg-state-hover",
      "bg-state-active",
      "bg-state-active-hover",
      "bg-state-selected",
      "ring-state-selected",
      "ring-state-selected-edge",
      "border-hairline",
      "bg-control-raised",
      "shadow-control-raised",
    ]);
    const utility = (name: string) => {
      const block = cssBlocks(css).find((b) => b.prelude === `.${name}`);
      expect({ name, found: Boolean(block) }).toEqual({ name, found: true });
      return declarations(block as CssBlock);
    };
    expect(utility("bg-state-hover").get("background-color")).toBe("var(--state-hover)");
    expect(utility("bg-state-active").get("background-color")).toBe("var(--state-active)");
    expect(utility("bg-state-active-hover").get("background-color")).toBe(
      "var(--state-active-hover)",
    );
    expect(utility("bg-state-selected").get("background-color")).toBe("var(--state-selected)");
    expect(utility("ring-state-selected-edge").get("--tw-ring-color")).toBe(
      "var(--state-selected-edge)",
    );
    // The ring namespace wins over --color-*: the selected ring is the 32% mix.
    expect(utility("ring-state-selected").get("--tw-ring-color")).toBe(
      "var(--state-selected-ring)",
    );
    expect(utility("border-hairline").get("border-color")).toBe("var(--hairline)");
    expect(utility("bg-control-raised").get("background-color")).toBe("var(--control-raised)");
    expect(utility("shadow-control-raised").get("--tw-shadow")).toBe(
      "var(--shadow-control-raised)",
    );
  });

  it("keeps preWorkspace()'s scoped accent a data-accent wrapper, which the scope block covers", async () => {
    // The [data-accent] scope above is what makes the derived tokens follow the
    // mono wrapper. If the wrapper stops being a data-accent element, they
    // silently fall back to the person's own accent on auth/onboarding/book.
    const routeTree = await read("src/app/router/route-tree.tsx");
    expect(routeTree).toMatch(/function preWorkspace[\s\S]*?<div data-accent="mono"/);
  });
});

/** The shadow block (§11) for a theme: the one declaring --shadow-xs. */
function onlyShadowBlock(blocks: CssBlock[], firstSelector: string): Map<string, string> {
  const found = blocks.filter(
    (b) => b.prelude.startsWith(firstSelector) && declarations(b).has("--shadow-xs"),
  );
  expect(found.map((b) => b.prelude)).toHaveLength(1);
  return declarations(found[0]);
}

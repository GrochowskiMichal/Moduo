// SH-1 (tasks-v3 call 81, AC14.2) — the motion foundations: three durations,
// one easing family, four shared patterns, reduced motion leaving opacity only,
// and no blur. jsdom runs no animations, so this pins the structure the browser
// relies on; tests/visual/motion.spec.ts reads the computed styles in Storybook.
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";

import { type CssBlock, cssBlocks, declarations, selectors } from "./css-blocks";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFile(path.join(ROOT, rel), "utf8");

const REDUCED = ':root[data-motion="reduced"]';
const OS_REDUCED = ':root:not([data-motion="full"])';
const OS_REDUCE_MEDIA = "@media (prefers-reduced-motion: reduce)";

/** The pattern classes and the animation each state runs. */
const PATTERNS = [
  ".motion-panel",
  '.motion-pop[data-state="open"]',
  '.motion-pop[data-state="closed"]',
  ".motion-row",
  ".motion-row[data-leaving]",
  ".motion-view",
] as const;

// Durations a pattern may use. Movement runs on fast/base/slow (zeroed under
// reduced motion); opacity on --motion-fade (kept short under reduced motion).
const DURATIONS = new Set([
  "var(--motion-fast)",
  "var(--motion-base)",
  "var(--motion-slow)",
  "var(--motion-fade)",
]);

function only(blocks: CssBlock[], selector: string, parents: string[] = []): CssBlock {
  const hits = blocks.filter(
    (b) => b.prelude === selector && b.parents.join("|") === parents.join("|"),
  );
  expect(hits.length, `${selector} in ${parents.join(" ") || "the top level"}`).toBe(1);
  return hits[0];
}

/** `name duration easing [fill]` for each comma-separated animation. */
function animations(value: string): Array<{ name: string; duration: string; easing: string }> {
  return value.split(/,(?![^(]*\))/).map((part) => {
    const [name, duration, easing] = part.trim().split(/\s+/);
    return { name, duration, easing };
  });
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(rel)));
    else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("motion tokens (tokens.css §12)", () => {
  it("declares the three durations, the fade and both easings", async () => {
    const blocks = cssBlocks(await read("src/styles/tokens.css"));
    const root = blocks.filter((b) => b.prelude === ":root" && b.parents.length === 0);
    const decls = new Map(root.flatMap((b) => [...declarations(b)]));
    expect(decls.get("--motion-fast")).toBe("100ms");
    expect(decls.get("--motion-base")).toBe("180ms");
    expect(decls.get("--motion-slow")).toBe("280ms");
    expect(decls.get("--motion-fade")).toBe("100ms");
    expect(decls.get("--ease-out")).toMatch(/^cubic-bezier\(/);
    expect(decls.get("--ease-in")).toMatch(/^cubic-bezier\(/);
    expect(decls.get("--motion-shift")).toBe("0.5rem");
    expect(decls.get("--motion-grow")).toBe("0.96");
  });

  it("zeroes movement and neutralises the pattern amounts on both reduce paths", async () => {
    const blocks = cssBlocks(await read("src/styles/tokens.css"));
    for (const block of [only(blocks, REDUCED), only(blocks, OS_REDUCED, [OS_REDUCE_MEDIA])]) {
      const decls = declarations(block);
      for (const token of ["--motion-fast", "--motion-base", "--motion-slow"]) {
        expect(decls.get(token), `${token} in ${block.prelude}`).toBe("0ms");
      }
      expect(decls.get("--motion-fade")).toBe("80ms");
      expect(decls.get("--motion-shift")).toBe("0");
      expect(decls.get("--motion-grow")).toBe("1");
    }
  });
});

describe("the four motion patterns (global.css)", () => {
  it("each state animates on motion tokens only, arriving with ease-out and leaving with ease-in", async () => {
    const blocks = cssBlocks(await read("src/global.css"));
    for (const selector of PATTERNS) {
      const value = declarations(only(blocks, selector)).get("animation");
      expect(value, `${selector} animation`).toBeTruthy();
      const leaving = selector.includes("closed") || selector.includes("leaving");
      for (const anim of animations(value ?? "")) {
        expect(DURATIONS.has(anim.duration), `${selector}: ${anim.duration}`).toBe(true);
        expect(anim.easing).toBe(leaving ? "var(--ease-in)" : "var(--ease-out)");
      }
    }
  });

  it("opacity always runs on the fade token, so reduced motion keeps a soft fade", async () => {
    const blocks = cssBlocks(await read("src/global.css"));
    for (const selector of PATTERNS.filter((s) => s !== ".motion-view")) {
      const anims = animations(declarations(only(blocks, selector)).get("animation") ?? "");
      const fades = anims.filter((a) => a.name.startsWith("motion-fade-"));
      expect(fades.length, `${selector} fades`).toBe(1);
      expect(fades[0].duration).toBe("var(--motion-fade)");
    }
    // The crossfade is all opacity, so both reduce paths swap its zeroed
    // --motion-slow for the fade token instead of cutting it.
    for (const [selector, parents] of [
      [`${REDUCED} .motion-view`, []],
      [`${OS_REDUCED} .motion-view`, [OS_REDUCE_MEDIA]],
    ] as const) {
      expect(declarations(only(blocks, selector, [...parents])).get("animation-duration")).toBe(
        "var(--motion-fade)",
      );
    }
  });

  it("movement travels only the neutralisable amounts", async () => {
    const blocks = cssBlocks(await read("src/global.css"));
    const frames = (name: string) =>
      blocks
        .filter((b) => b.parents[0] === `@keyframes ${name}`)
        .map((b) => declarations(b).get("transform") ?? "")
        .join(" ");
    expect(frames("motion-slide-in")).toContain("var(--motion-shift)");
    expect(frames("motion-grow-in")).toContain("var(--motion-grow)");
    expect(frames("motion-grow-out")).toContain("var(--motion-grow)");
    // The popover exit's movement shares the fade's duration: Radix unmounts on
    // the first animationend, and a zeroed movement half would cut the fade.
    const exit = animations(
      declarations(only(blocks, '.motion-pop[data-state="closed"]')).get("animation") ?? "",
    );
    expect(exit.every((a) => a.duration === "var(--motion-fade)")).toBe(true);
  });

  it("the floating primitives grow from their origin", async () => {
    for (const file of ["popover", "dropdown-menu", "select", "dialog"]) {
      expect(await read(`src/components/ui/${file}.tsx`), file).toMatch(/\bmotion-pop\b/);
    }
    const blocks = cssBlocks(await read("src/global.css"));
    const pop = blocks.find((b) => selectors(b).includes(".motion-pop"));
    expect(pop && declarations(pop).get("transform-origin")).toBe(
      "var(--radix-popper-transform-origin, center)",
    );
  });
});

describe("no blur (call 81)", () => {
  it("motion uses no filter and the old blur veil is gone", async () => {
    const tokens = await read("src/styles/tokens.css");
    const global = await read("src/global.css");
    expect(tokens).not.toMatch(/--blur-veil/);
    expect(global).not.toMatch(/--blur-veil/);
    const keyframes = cssBlocks(global).filter((b) => b.parents[0]?.startsWith("@keyframes"));
    for (const frame of keyframes) {
      expect(frame.own, frame.parents[0]).not.toMatch(/filter|blur\(/);
    }
  });

  it("nothing in the app uses a backdrop filter", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles("src")) {
      if (/backdrop-blur|backdrop-filter/.test(await read(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

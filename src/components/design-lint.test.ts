// DF-18 — `lint:tw` had a blind spot: it caught `bg-[#f87171]` but not
// `text-red-400`, which bypasses the token layer just as hard (and already
// slipped through). A regex that silently stops matching reads exactly like a
// clean codebase, so the patterns get their own test.
import { describe, expect, it } from "vitest";

import { PATTERNS, scanFile } from "../../scripts/check-arbitrary-tw";

const patternsFor = (source: string) =>
  scanFile(source, "probe.tsx").map((hit) => `${hit.pattern}:${hit.match}`);

describe("lint:tw — named-palette coverage (DF-18)", () => {
  it("flags Tailwind palette utilities, including side variants and opacity", () => {
    const hits = patternsFor(
      'const c = "text-red-400 bg-red-500/10 border-t-emerald-500 hover:text-rose-300 dark:bg-sky-950 ring-indigo-600";',
    );
    expect(hits).toEqual([
      "color-palette:text-red-400",
      "color-palette:bg-red-500/10",
      "color-palette:border-t-emerald-500",
      "color-palette:text-rose-300",
      "color-palette:bg-sky-950",
      "color-palette:ring-indigo-600",
    ]);
  });

  it("catches side variants of arbitrary colours too, not just of palette ones", () => {
    const hits = patternsFor('const c = "border-t-[#161616] border-l-[rgb(1,2,3)]";');
    expect(hits).toEqual(["color-[#hex]:border-t-[#161616", "color-[fn]:border-l-[rgb("]);
  });

  it("flags absolute black/white — they are theme-blind by definition", () => {
    expect(patternsFor('const c = "bg-white text-black/50";')).toEqual([
      "color-absolute:bg-white",
      "color-absolute:text-black/50",
    ]);
  });

  it("leaves the semantic token surface alone", () => {
    expect(
      patternsFor(
        'const c = "bg-background text-foreground border-border ring-ring/50 text-2xs bg-primary/90 bg-current to-transparent text-muted-foreground/70";',
      ),
    ).toEqual([]);
  });

  it("still catches what it caught before", () => {
    const hits = patternsFor('const c = "bg-[#161616] text-[13px] rounded-[6px] duration-200 gap-[7px]";');
    // The hex pattern deliberately stops at the digits, not the closing bracket.
    expect(hits).toContain("color-[#hex]:bg-[#161616");
    expect(hits).toContain("text-[size]:text-[13px]");
    expect(hits).toContain("rounded-[size]:rounded-[6px]");
    expect(hits).toContain("duration-NNN:duration-200");
    expect(hits).toContain("spacing-[size]:gap-[7px]");
  });

  it("every pattern is global — a non-global regex would report one hit per line", () => {
    for (const { name, regex } of PATTERNS) {
      expect(regex.flags, name).toContain("g");
    }
  });
});

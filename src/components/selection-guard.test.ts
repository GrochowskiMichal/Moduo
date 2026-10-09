// DS-2 — selection is tint-only (R5): the accent tint (bg-state-selected) plus,
// on list rows, the hairline switch (ring-state-selected-edge). This guard keeps
// the two retired recipes from coming back, the way eyebrow.test.tsx guards
// the eyebrow:
//   1. the legacy tokens --selected-bg / --selected-border (any form);
//   2. a vertical accent BAR: an absolutely positioned strip pinned to a side
//      (`absolute … left-…/right-… w-px|w-0.5|w-1 … bg-primary`).
// Accent edges that are STATUS, not selection, are allowlisted with a reason.
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";

const ROOT = process.cwd();

// file → why its accent strip is allowed (never a selection marker).
const BAR_ALLOWLIST: Record<string, string> = {
  "src/features/calendar/ui/task-block-chip.tsx":
    "calendar focus edge: the leading progress edge of the block being focused",
  "src/features/chat/ui/message-item.tsx":
    "chat attention bar: marks a message that mentions you (status)",
};

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(rel)));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every quoted string in a file that contains `needle` (class lists, mostly). */
function stringsWith(source: string, needle: RegExp): string[] {
  return [...source.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)]
    .map((m) => m[2])
    .filter((s) => needle.test(s));
}

/** True when a class list draws a vertical accent strip pinned to one side. */
function isAccentBar(classes: string): boolean {
  const list = classes.split(/\s+/);
  const has = (re: RegExp) => list.some((c) => re.test(c));
  return (
    has(/^absolute$/) &&
    has(/^(left|right|start|end)-/) &&
    has(/^w-(px|0\.5|1)$/) &&
    has(/^bg-primary(\/\d+)?$/)
  );
}

describe("selection guard (DS-2)", () => {
  it("no selection bars", async () => {
    const offenders: string[] = [];
    for (const rel of await sourceFiles("src")) {
      const source = await fs.readFile(path.join(ROOT, rel), "utf8");
      if (/--selected-(bg|border)\b/.test(source)) {
        offenders.push(`${rel}: uses the retired --selected-* recipe (use bg-state-selected)`);
      }
      if (rel in BAR_ALLOWLIST) continue;
      for (const classes of stringsWith(source, /\bbg-primary\b/)) {
        if (isAccentBar(classes)) offenders.push(`${rel}: accent bar "${classes}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects the bar recipe it is guarding against", () => {
    // The exact strip DF-14 shipped on five lists, so the guard can't go blind.
    expect(isAccentBar("absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-primary")).toBe(true);
    expect(isAccentBar("absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-primary/80")).toBe(
      true,
    );
    // Horizontal drop lines and the "now" line are not bars.
    expect(isAccentBar("pointer-events-none absolute inset-x-1 top-0 h-0.5 bg-primary")).toBe(
      false,
    );
    expect(isAccentBar("before:absolute before:left-0 before:w-px before:bg-primary")).toBe(false);
  });

  it("keeps the allowlist honest: every entry still holds a status edge", async () => {
    for (const [rel, reason] of Object.entries(BAR_ALLOWLIST)) {
      const source = await fs.readFile(path.join(ROOT, rel), "utf8");
      const bars = stringsWith(source, /\bbg-primary\b/).filter(isAccentBar);
      expect({ rel, reason, bars: bars.length > 0 }).toEqual({ rel, reason, bars: true });
    }
  });
});

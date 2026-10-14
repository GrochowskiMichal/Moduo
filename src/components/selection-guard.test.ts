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

/**
 * The string literals in a source file, read the way the parser reads them:
 * comments are skipped, and a quote or apostrophe that doesn't close on its
 * own line isn't a string (prose in a comment or in JSX text, "month's").
 * Pairing quotes across the whole file instead read a comment's apostrophe
 * as the start of a string and reported the code after it (the false
 * positive in task-timeline-view.tsx, tasks-v3 TV-U2).
 */
function stringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") {
          text += source.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (c !== "`" && source[j] === "\n") break;
        text += source[j];
        j += 1;
      }
      if (source[j] === c) {
        out.push(text);
        i = j + 1;
      } else {
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out;
}

/** Every string literal in a file that contains `needle` (class lists, mostly). */
function stringsWith(source: string, needle: RegExp): string[] {
  return stringLiterals(source).filter((s) => needle.test(s));
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

  it("reads strings, not prose: an apostrophe in a comment opens nothing", () => {
    const source = [
      "{/* stays at the month's left edge */}",
      '<span className="absolute bottom-0.5 left-2 w-1 rounded-full bg-primary px-1.5" />',
      "<p>Don't</p>",
      'const a = "https://example.com"; // it\'s a link',
    ].join("\n");
    expect(stringLiterals(source)).toEqual([
      "absolute bottom-0.5 left-2 w-1 rounded-full bg-primary px-1.5",
      "https://example.com",
    ]);
  });

  it("keeps the allowlist honest: every entry still holds a status edge", async () => {
    for (const [rel, reason] of Object.entries(BAR_ALLOWLIST)) {
      const source = await fs.readFile(path.join(ROOT, rel), "utf8");
      const bars = stringsWith(source, /\bbg-primary\b/).filter(isAccentBar);
      expect({ rel, reason, bars: bars.length > 0 }).toEqual({ rel, reason, bars: true });
    }
  });
});

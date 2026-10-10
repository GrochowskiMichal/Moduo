// DS-6 (tasks-v3 AC14.3): one floating-surface recipe. Every floating primitive
// spells its surface through FLOATING_SURFACE, and no caller re-skins one back
// into the second recipe (`rounded-lg`, an opaque `border-border`, a card fill).
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";

import { CONTEXT_MENU_SCROLL, DROPDOWN_MENU_SCROLL, FLOATING_SURFACE } from "./surface";

const ROOT = process.cwd();

const PRIMITIVES = ["popover", "dropdown-menu", "context-menu", "select", "tooltip", "hover-card"];

const FLOATING_TAGS = [
  "PopoverContent",
  "DropdownMenuContent",
  "DropdownMenuSubContent",
  "ContextMenuContent",
  "ContextMenuSubContent",
  "SelectContent",
  "TooltipContent",
  "HoverCardContent",
];

/** A second surface recipe smuggled in through a caller's className. */
const RESKIN = /\b(?:rounded-(?:lg|xl|2xl)|border-border|bg-card|bg-background)\b/;

/** The opening tag starting at `start`, braces and strings respected. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** Every floating tag in a file whose className re-skins the surface. */
function reskinnedSurfaces(source: string): string[] {
  const hits: string[] = [];
  const tag = new RegExp(`<(${FLOATING_TAGS.join("|")})\\b`, "g");
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex-drain idiom
  while ((match = tag.exec(source))) {
    const open = openingTag(source, match.index);
    const className = /className=(?:"([^"]*)"|\{([\s\S]*?)\}\s*(?:\w+=|\/?>))/.exec(open);
    const value = className ? (className[1] ?? className[2] ?? "") : "";
    const hit = RESKIN.exec(value);
    if (hit) hits.push(`${match[1]}: ${hit[0]}`);
  }
  return hits;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (rel === path.join("src", "tw")) continue;
      out.push(...(await sourceFiles(rel)));
    } else if (entry.name.endsWith(".tsx") && !/\.(test|stories)\.tsx$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe("one floating-surface recipe (DS-6)", () => {
  it("the recipe is the hairline popover surface that grows from its origin", () => {
    for (const part of ["motion-pop", "rounded-md", "border-hairline", "bg-popover"]) {
      expect(FLOATING_SURFACE.split(" ")).toContain(part);
    }
  });

  it("every floating primitive uses it", async () => {
    for (const name of PRIMITIVES) {
      const source = await fs.readFile(path.join(ROOT, `src/components/ui/${name}.tsx`), "utf8");
      expect(source, name).toMatch(/\bFLOATING_SURFACE\b/);
      expect(source, name).not.toMatch(/\bborder-border\b/);
      // tw-animate entrances are the second motion recipe (the old tooltip).
      expect(source, name).not.toMatch(/\b(?:animate-in|zoom-in-95|slide-in-from-)/);
    }
  });

  it("menus cap at the room on their side and scroll inside", async () => {
    const pairs: Array<[string, string]> = [
      ["dropdown-menu", "DROPDOWN_MENU_SCROLL"],
      ["context-menu", "CONTEXT_MENU_SCROLL"],
    ];
    for (const [file, token] of pairs) {
      const source = await fs.readFile(path.join(ROOT, `src/components/ui/${file}.tsx`), "utf8");
      const base = /const contentBase = cn\(([^)]*)\)/.exec(source)?.[1] ?? "";
      expect(base, file).toContain(token);
    }
    expect(DROPDOWN_MENU_SCROLL).toContain(
      "max-h-(--radix-dropdown-menu-content-available-height)",
    );
    expect(DROPDOWN_MENU_SCROLL).toContain("overflow-y-auto");
    expect(CONTEXT_MENU_SCROLL).toContain("max-h-(--radix-context-menu-content-available-height)");
  });

  it("no caller re-skins a floating surface", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles("src")) {
      const source = await fs.readFile(path.join(ROOT, file), "utf8");
      for (const hit of reskinnedSurfaces(source)) offenders.push(`${file}  ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the guard can fail", () => {
    expect(
      reskinnedSurfaces(
        `<PopoverContent align="start"\n className={cn("w-64 rounded-lg border-hairline", x)} onOpenAutoFocus={(e) => e.preventDefault()}>`,
      ),
    ).toEqual(["PopoverContent: rounded-lg"]);
    expect(reskinnedSurfaces(`<TooltipContent className="border-border">`)).toEqual([
      "TooltipContent: border-border",
    ]);
    expect(reskinnedSurfaces(`<PopoverContent className="w-auto p-0" align="start">`)).toEqual([]);
  });
});

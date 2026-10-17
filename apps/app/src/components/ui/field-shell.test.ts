// MOD-160 — one focus language. A text field matches `:focus-visible` on every
// click, so it marks focus on its own edge (the border turning `--ring` at 50%),
// never with the 2 px ring the keyboard puts on buttons, rows and menu triggers
// (that ring on fields was shadcn's input default). `bare` has no edge, so it
// keeps the ring. And no focus ring is offset from its control: shadcn's
// `ring-offset-*` gap is gone from the app. The looks were compared live
// (before/after crops of the settings field, the toolbar search, the comment
// box and Home's quick capture).
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";

import { FIELD_FOCUS_WITHIN, fieldShellVariants } from "./field-shell";

const ROOT = process.cwd();
const classes = (variant: "filled" | "ghost" | "bare") =>
  fieldShellVariants({ variant }).split(/\s+/);

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

describe("a field's focus (MOD-160)", () => {
  it("is the field's own edge in the focus colour, with no ring, when it has an edge", () => {
    for (const variant of ["filled", "ghost"] as const) {
      const c = classes(variant);
      expect({ variant, edge: c.includes("focus-visible:border-ring/50") }).toEqual({
        variant,
        edge: true,
      });
      expect(c.filter((x) => x.startsWith("focus-visible:ring"))).toEqual([]);
    }
  });

  it("is the controls' ring on a bare field, which has no edge", () => {
    const c = classes("bare");
    expect(c).toContain("focus-visible:ring-2");
    expect(c).toContain("focus-visible:ring-ring/50");
  });

  it("uses the state layer on ghost, not the old muted fill", () => {
    const c = classes("ghost");
    expect(c).toContain("hover:bg-state-hover");
    expect(c.some((x) => x.includes("bg-muted"))).toBe(false);
  });

  it("is the same edge on a composite field's box, while its text has focus", async () => {
    expect(FIELD_FOCUS_WITHIN).toBe("has-[:is(input,textarea):focus]:border-ring/50");
    for (const rel of ["src/components/ui/feed.tsx", "src/components/ui/tag-input.tsx"]) {
      expect({
        rel,
        uses: (await fs.readFile(path.join(ROOT, rel), "utf8")).includes("FIELD_FOCUS_WITHIN"),
      }).toEqual({
        rel,
        uses: true,
      });
    }
  });
});

describe("no offset focus rings (MOD-160)", () => {
  // tag-picker.tsx belongs to the tags lane in flight; its swatches move to the
  // offset-less ring with that work. Remove the entry then.
  const ALLOWED = new Set(["src/components/tag-picker.tsx"]);

  it("draws every focus ring flush with its control", async () => {
    const offenders: string[] = [];
    for (const rel of await sourceFiles("src")) {
      if (ALLOWED.has(rel)) continue;
      if (/\bring-offset-/.test(await fs.readFile(path.join(ROOT, rel), "utf8"))) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps no focus-shadow token (it drew an offset ring)", async () => {
    const tokens = await fs.readFile(path.join(ROOT, "src/styles/tokens.css"), "utf8");
    expect(tokens).not.toMatch(/--shadow-focus\s*:/);
  });
});

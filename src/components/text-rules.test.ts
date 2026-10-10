// DS-6 (tasks-v3 AC14.1) — the lint guards for rotated text (call 46a) and
// small caps on people's words (call 40). `lint:tw` runs scanTextRules over
// src; `lint:css` carries the same rules for CSS through stylelint. A guard
// that silently stops matching reads exactly like a clean codebase, so each
// shape has a probe here (in `bun run verify`).
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@rstest/core";
import stylelint from "stylelint";

import { scanFile } from "../../scripts/check-arbitrary-tw";
import {
  isNotWords,
  SMALL_CAPS_CHROME,
  SMALL_CAPS_DEBT,
  scanTextRules,
} from "../../scripts/check-text-rules";

const ROOT = process.cwd();
const hits = (source: string, file = "src/features/probe/probe.tsx") =>
  scanTextRules(source, file).map((h) => `${h.pattern}:${h.match}`);

describe("text is never rotated (call 46a)", () => {
  it("fails a turned label, whichever way it is written", () => {
    expect(hits(`<span className="-rotate-90 text-xs">Backlog</span>`)).toEqual([
      "rotated-text:-rotate-90",
    ]);
    expect(hits(`<div className={cn("truncate", folded && "rotate-90")}>{name}</div>`)).toEqual([
      "rotated-text:rotate-90",
    ]);
    expect(hits(`<p className="rotate-[270deg]">Lane</p>`)).toEqual([
      "rotated-text:rotate-[270deg]",
    ]);
    expect(hits(`<span style={{ transform: "rotate(-90deg)" }}>Axis</span>`)).toEqual([
      "rotated-text:rotate(-90deg)",
    ]);
    expect(hits(`<span style={{ writingMode: "vertical-rl" }}>Done</span>`)).toEqual([
      "rotated-text:writingMode:",
      "rotated-text:vertical-rl",
    ]);
    expect(hits(`<span className="[writing-mode:vertical-lr]">Done</span>`)).toEqual([
      "rotated-text:[writing-mode:vertical-lr]",
    ]);
  });

  it("lets an icon turn: a lucide import, an <svg>, an …Icon / Chevron… tag", () => {
    const lucide = `import { ChevronRight, Folder } from "lucide-react";
      <ChevronRight className={cn("size-icon-xs", open && "rotate-90")} aria-hidden />
      <Folder className="-rotate-90" />`;
    expect(hits(lucide)).toEqual([]);
    expect(hits(`<svg className="rotate-90" viewBox="0 0 8 8" />`)).toEqual([]);
    expect(hits(`<CaretIcon className="-rotate-90" />`)).toEqual([]);
    // Not a quarter turn: not this rule's business.
    expect(hits(`<span className="rotate-45">x</span>`)).toEqual([]);
  });
});

describe("small caps never carry people's words (call 40)", () => {
  it("fails an eyebrow or menu label showing a name", () => {
    expect(hits(`<Eyebrow>{project.name}</Eyebrow>`)).toEqual([
      "small-caps-user-words:<Eyebrow>{project.name}",
    ]);
    expect(
      hits(`<DropdownMenuLabel className="px-2">\n  {bucket.name}\n</DropdownMenuLabel>`),
    ).toEqual(["small-caps-user-words:<DropdownMenuLabel>{bucket.name}"]);
    expect(hits(`<Eyebrow as="h3"><span>{person.name}</span></Eyebrow>`)).toEqual([
      "small-caps-user-words:<Eyebrow>{person.name}",
    ]);
  });

  it("passes fixed chrome, counts and literals", () => {
    expect(hits(`<Eyebrow>Projects</Eyebrow>`)).toEqual([]);
    expect(hits(`<Eyebrow>People · {members.length}</Eyebrow>`)).toEqual([]);
    expect(hits(`<Eyebrow>{open ? "Hide" : "Show"}</Eyebrow>`)).toEqual([]);
    expect(hits("<Eyebrow>{`(${selected.length})`}</Eyebrow>")).toEqual([]);
    expect(hits(`<Eyebrow asChild><label htmlFor={\`d-\${id}\`}>Depth</label></Eyebrow>`)).toEqual(
      [],
    );
    expect(isNotWords("total")).toBe(true);
    expect(isNotWords("task.title")).toBe(false);
  });

  it("fails the recipe outside the primitives, capitalize, and font-variant small caps", () => {
    expect(hits(`<button className={cn(eyebrowVariants(), "h-7")}>{name}</button>`)).toEqual([
      "small-caps-user-words:eyebrowVariants()",
    ]);
    expect(hits(`const c = cn(eyebrowVariants(), "px-2");`, "src/components/ui/probe.tsx")).toEqual(
      [],
    );
    expect(hits(`<span className="text-xs capitalize">{tag}</span>`)).toEqual([
      "small-caps:capitalize",
    ]);
    expect(hits(`const t = capitalize(label);`)).toEqual([]);
    // Prose in a comment is not a class name.
    expect(hits("// we never capitalize people's words or use writing-mode: vertical-rl")).toEqual(
      [],
    );
    expect(hits(`<span className="[font-variant:small-caps]">{tag}</span>`)).toEqual([
      "small-caps:[font-variant:small-caps]",
    ]);
  });

  it("the allowlists stay honest", async () => {
    // Debt is other modules' only (the retired DS-5 sweep), never Tasks.
    for (const file of Object.keys(SMALL_CAPS_DEBT)) {
      expect(file.startsWith("src/features/tasks/"), file).toBe(false);
    }
    // Every allowlisted value still exists where it is listed; a stale entry
    // would quietly excuse the next name written there.
    for (const list of [SMALL_CAPS_CHROME, SMALL_CAPS_DEBT]) {
      for (const [file, exprs] of Object.entries(list)) {
        const source = (await fs.readFile(path.join(ROOT, file), "utf8")).replace(/\s+/g, " ");
        for (const expr of exprs) expect(source, `${file}: ${expr}`).toContain(expr);
      }
    }
  });

  it("lint:tw reports the text rules through scanFile", () => {
    expect(scanFile(`<Eyebrow>{area.name}</Eyebrow>`, "src/x.tsx").map((h) => h.pattern)).toEqual([
      "small-caps-user-words",
    ]);
  });
});

describe("lint:css carries the same rules", () => {
  it("fails vertical writing, a quarter turn and small caps in CSS", async () => {
    const result = await stylelint.lint({
      code: [
        ".a { writing-mode: vertical-rl; }",
        ".b { transform: translateX(2px) rotate(-90deg); }",
        ".c { font-variant: small-caps; }",
        ".d { text-transform: uppercase; }",
        ".e { transform: rotate(45deg); }",
      ].join("\n"),
      codeFilename: path.join(ROOT, "src/probe.css"),
      configFile: path.join(ROOT, ".stylelintrc.json"),
    });
    const lines = result.results[0].warnings
      .filter((w) => w.rule === "declaration-property-value-disallowed-list")
      .map((w) => w.line);
    expect(lines).toEqual([1, 2, 3, 4]);
  });
});

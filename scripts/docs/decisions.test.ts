import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  DecisionsError,
  parseArea,
  readAreas,
  renderCurrent,
  renderIndex,
  validate,
} from "./decisions.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FLAT = `# Decisions: Things

Preamble, not an entry.

- **2026-10-20 · New rule wins.** Replaces the old one.
  - status: current · supersedes: 2026-10-01 "Old rule"
  - *Why:* reasons.

- **2026-10-05 · A rule partly replaced.** Mostly still true.
  - status: current · by: sections 2026-10-20 "A heading entry"

- **2026-10-03 · A rule nobody touched.** Still true.
  - status: current

- **2026-10-01 · Old rule.** The way it used to be.
  - status: superseded · by: 2026-10-20 "New rule wins"

- **Undated principle.** Kept as it is.
  - status: dropped
`;

const SECTIONS = `# Decisions: Sections

## 2026-10-20 · A heading entry (supersedes part of a rule)

status: current · supersedes: things 2026-10-05 "A rule partly"

- **A part, not an entry.** Body.
  - status: dropped

## Earlier entries

- **2026-07-01 · A bullet entry under an undated heading.** Body.
  - status: current
`;

const both = () => [parseArea("things", FLAT), parseArea("sections", SECTIONS)];

describe("parseArea", () => {
  it("reads bullet entries with their status and references", () => {
    const area = parseArea("things", FLAT);
    expect(area.title).toBe("Things");
    expect(area.entries.map((e) => [e.date, e.title, e.status])).toEqual([
      ["2026-10-20", "New rule wins.", "current"],
      ["2026-10-05", "A rule partly replaced.", "current"],
      ["2026-10-03", "A rule nobody touched.", "current"],
      ["2026-10-01", "Old rule.", "superseded"],
      [null, "Undated principle.", "dropped"],
    ]);
    expect(area.entries[0].supersedes).toEqual([
      { area: null, date: "2026-10-01", prefix: "Old rule" },
    ]);
    expect(area.entries[3].by).toEqual([
      { area: null, date: "2026-10-20", prefix: "New rule wins" },
    ]);
    expect(area.entries[0].line).toBe(5);
  });

  it("treats dated headings as entries and their bullets as parts", () => {
    const area = parseArea("sections", SECTIONS);
    expect(area.entries.map((e) => [e.kind, e.title, e.status])).toEqual([
      ["heading", "A heading entry (supersedes part of a rule)", "current"],
      ["bullet", "A bullet entry under an undated heading.", "current"],
    ]);
    expect(area.entries[0].supersedes).toEqual([
      { area: "things", date: "2026-10-05", prefix: "A rule partly" },
    ]);
  });

  it("leaves status null when the line is missing, and rejects unknown values", () => {
    expect(parseArea("x", "- **2026-01-01 · No status.** Body.\n").entries[0].status).toBeNull();
    expect(() => parseArea("x", "- **2026-01-01 · Bad.** Body.\n  - status: maybe\n")).toThrow(
      DecisionsError,
    );
    expect(() =>
      parseArea("x", "- **2026-01-01 · Bad.** Body.\n  - status: current · because: x\n"),
    ).toThrow(/unknown field/);
  });
});

describe("validate", () => {
  it("accepts mirrored references across areas", () => {
    expect(validate(both())).toEqual([]);
  });

  it("flags a missing status, a successor-less supersession, dangling and one-way references", () => {
    const broken = FLAT.replace(
      '  - status: superseded · by: 2026-10-20 "New rule wins"',
      "  - status: superseded",
    )
      .replace("Still true.\n  - status: current\n", "Still true.\n")
      .replace('supersedes: 2026-10-01 "Old rule"', 'supersedes: 2026-10-01 "Gone"');
    const problems = validate([parseArea("things", broken), parseArea("sections", SECTIONS)]).join(
      "\n",
    );
    expect(problems).toMatch(/no status line under things 2026-10-03/);
    expect(problems).toMatch(/superseded but names no successor/);
    expect(problems).toMatch(/supersedes: 2026-10-01 "Gone" matches no entry/);

    const oneWay = SECTIONS.replace(' · supersedes: things 2026-10-05 "A rule partly"', "");
    expect(validate([parseArea("things", FLAT), parseArea("sections", oneWay)]).join("\n")).toMatch(
      /by: sections 2026-10-20 "A heading entry.*" doesn't link back/,
    );
  });
});

describe("edge cases", () => {
  it("doesn't let a part lend its status to a heading entry", () => {
    const area = parseArea(
      "x",
      "## 2026-01-01 · Heading.\n\n- **A part.** Body.\n  - status: dropped\n",
    );
    expect(area.entries[0].status).toBeNull();
  });

  it("reads a title with a backticked ** and a quoted ` · ` in a reference", () => {
    const area = parseArea(
      "x",
      '- **2026-01-02 · Globs like `landing/**` stay.** Body.\n  - status: current · supersedes: 2026-01-01 "A · B"\n\n- **2026-01-01 · A · B rule.** Body.\n  - status: superseded · by: 2026-01-02 "Globs like"\n',
    );
    expect(area.entries[0].title).toBe("Globs like `landing/**` stay.");
    expect(area.entries[0].supersedes).toEqual([
      { area: null, date: "2026-01-01", prefix: "A · B" },
    ]);
    expect(validate([area])).toEqual([]);
  });

  it("flags ambiguous, self, one-way and dropped-with-by references", () => {
    const area = parseArea(
      "x",
      [
        "- **2026-01-03 · Same start one.** Body.",
        '  - status: current · supersedes: "Same start"',
        "",
        "- **2026-01-02 · Same start two.** Body.",
        '  - status: current · supersedes: 2026-01-02 "Same start two"',
        "",
        "- **2026-01-01 · Old.** Body.",
        '  - status: dropped · by: 2026-01-03 "Same start one"',
        "",
        "- **2026-01-00 · Lonely.** Body.",
        '  - status: current · supersedes: 2026-01-01 "Old"',
      ].join("\n"),
    );
    const problems = validate([area]).join("\n");
    expect(problems).toMatch(/supersedes: "Same start" matches 2 entries/);
    expect(problems).toMatch(/points at the entry itself/);
    expect(problems).toMatch(/by: is for superseded/);
    expect(problems).toMatch(/supersedes: x 2026-01-01 "Old\." doesn't link back/);
  });
});

describe("the current view", () => {
  it("hides superseded and dropped entries unless --all", () => {
    const area = parseArea("things", FLAT);
    const current = renderCurrent(area);
    expect(current).toContain("New rule wins.");
    expect(current).toContain("A rule partly replaced.");
    expect(current).not.toContain("Old rule.**");
    expect(current).not.toContain("Undated principle");
    expect(current).toContain("3 of 5, 2 superseded or dropped hidden");
    expect(renderCurrent(area, { all: true })).toContain("Old rule.");
    expect(renderCurrent(area, { titles: true })).toContain(
      "- 2026-10-20 · New rule wins.  (docs/decisions/things.md:5)",
    );
  });

  it("lists only current entries in the index and marks partly superseded ones", () => {
    const index = renderIndex([parseArea("things", FLAT)]);
    expect(index).toContain("## Things → [decisions/things.md](decisions/things.md)");
    expect(index).toContain("- 2026-10-20 · New rule wins.\n");
    expect(index).toContain("- 2026-10-05 · A rule partly replaced. *(partly superseded)*");
    expect(index).not.toContain("Old rule");
    expect(index).toContain("2 superseded or dropped entries are left out");
  });
});

describe("docs/decisions (the real files)", () => {
  const areas = readAreas();

  it("gives every entry a status and resolves every reference", () => {
    expect(areas.length).toBeGreaterThan(10);
    expect(validate(areas)).toEqual([]);
  });

  it("matches the generated index", () => {
    expect(fs.readFileSync(path.join(ROOT, "docs/decisions.md"), "utf8")).toBe(renderIndex(areas));
  });
});

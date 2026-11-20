import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import { checkFixtures, compare, type Match, scan, snippetOf } from "./lint";

const match = (over: Partial<Match> = {}): Match => ({
  rule: "r",
  file: "a.ts",
  line: 1,
  snippet: "x",
  message: "",
  ...over,
});

describe("lint:ast", () => {
  it("every rule flags its bad fixture and passes its good one", () => {
    expect(checkFixtures()).toEqual([]);
  });

  it("baselined matches pass, new ones fail, unused entries are stale", () => {
    const entry = { rule: "r", file: "a.ts", snippet: "x", why: "known" };
    const gone = { rule: "r", file: "b.ts", snippet: "y", why: "fixed since" };
    const { fresh, stale } = compare([match(), match({ snippet: "z" })], [entry, gone]);
    expect(fresh.map((m) => m.snippet)).toEqual(["z"]);
    expect(stale).toEqual([gone]);
  });

  it("one entry covers one match, so a second identical match is new", () => {
    const entry = { rule: "r", file: "a.ts", snippet: "x", why: "known" };
    expect(compare([match(), match({ line: 9 })], [entry]).fresh).toHaveLength(1);
  });

  it("keys on the code, not the line", () => {
    expect(snippetOf("  const { data } =\n    await sb.from('t')  ")).toBe(
      "const { data } = await sb.from('t')",
    );
  });

  it("scans only the files a rule covers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lint-ast-"));
    try {
      const file = path.join(dir, "x.tsx");
      writeFileSync(file, "export const X = () => <DndContext />;\n");
      // Outside apps/app/src: the dnd rule's `files` scope leaves it alone.
      expect(scan([file])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

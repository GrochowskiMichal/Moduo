import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import { detect, parseDiff } from "./test-weakening";

// Real `git diff -M --unified=0` output from a throwaway repo, so the parser sees what CI sees.
function diffOf(before: Record<string, string>, after: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weakening-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  const write = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(dir, file), text);
    }
  };
  try {
    git("init", "-q");
    write(before);
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", "before");
    git("rm", "-rq", "--ignore-unmatch", ".");
    write(after);
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", "after");
    return git("diff", "--no-color", "-M", "--unified=0", "HEAD~1", "HEAD");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SUITE = `import { add } from "./add";

describe("add", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
    expect(add(0, 0)).toBe(0);
  });

  it("handles negatives", () => {
    expect(add(-1, 1)).toBe(0);
  });
});
`;

const kinds = (diff: string) => detect(diff).map((f) => [f.file, f.kind, f.count]);

describe("test-weakening detector", () => {
  it("flags deleted assertions", () => {
    const weaker = SUITE.replace("    expect(add(0, 0)).toBe(0);\n", "");
    expect(kinds(diffOf({ "src/add.test.ts": SUITE }, { "src/add.test.ts": weaker }))).toEqual([
      ["src/add.test.ts", "deleted-assertions", 1],
    ]);
  });

  it("flags a deleted test file", () => {
    expect(
      kinds(diffOf({ "src/add.test.ts": SUITE, "src/add.ts": "x" }, { "src/add.ts": "x" })),
    ).toEqual([["src/add.test.ts", "deleted-assertions", 3]]);
  });

  it("does not flag an assertion that was only changed", () => {
    const changed = SUITE.replace("expect(add(1, 2)).toBe(3)", "expect(add(2, 2)).toBe(4)");
    expect(kinds(diffOf({ "src/add.test.ts": SUITE }, { "src/add.test.ts": changed }))).toEqual([]);
  });

  it("flags new .skip, .todo and xit as warnings and .only as an error", () => {
    const skipped = SUITE.replace('it("adds"', 'it.skip("adds"').replace(
      'it("handles negatives"',
      'it.only("handles negatives"',
    );
    const findings = detect(diffOf({ "src/add.test.ts": SUITE }, { "src/add.test.ts": skipped }));
    expect(findings.map((f) => [f.kind, f.severity])).toEqual([
      ["skip", "warning"],
      ["only", "error"],
    ]);
    const x = SUITE.replace('it("adds"', 'xit("adds"').replace("describe(", "describe.todo(");
    expect(kinds(diffOf({ "e2e/add.spec.ts": SUITE }, { "e2e/add.spec.ts": x }))).toEqual([
      ["e2e/add.spec.ts", "skip", 2],
    ]);
  });

  it("does not flag an existing .skip that is removed or kept", () => {
    const skipped = SUITE.replace('it("adds"', 'it.skip("adds"');
    expect(kinds(diffOf({ "src/add.test.ts": skipped }, { "src/add.test.ts": SUITE }))).toEqual([]);
    const both = skipped.replace("expect(add(1, 2))", "expect(add(1, 2)) ");
    expect(kinds(diffOf({ "src/add.test.ts": skipped }, { "src/add.test.ts": both }))).toEqual([]);
  });

  it("flags new mocks in lib/sync tests only", () => {
    const mocked = SUITE.replace(
      'import { add } from "./add";',
      'import { add } from "./add";\nrs.mock("./outbox");\nconst push = rs.fn();',
    );
    const sync = "apps/app/src/lib/sync/kernel/kernel.test.ts";
    expect(kinds(diffOf({ [sync]: SUITE }, { [sync]: mocked }))).toEqual([[sync, "sync-mock", 2]]);
    const other = "apps/app/src/features/tasks/model.test.ts";
    expect(kinds(diffOf({ [other]: SUITE }, { [other]: mocked }))).toEqual([]);
  });

  it("does not flag a renamed test file, with or without small edits", () => {
    expect(kinds(diffOf({ "src/add.test.ts": SUITE }, { "src/math/add.test.ts": SUITE }))).toEqual(
      [],
    );
    const edited = SUITE.replace('from "./add"', 'from "../add"');
    expect(
      parseDiff(diffOf({ "src/add.test.ts": SUITE }, { "src/math/add.test.ts": edited })),
    ).toEqual([
      {
        file: "src/math/add.test.ts",
        oldFile: "src/add.test.ts",
        added: ['import { add } from "../add";'],
        removed: ['import { add } from "./add";'],
      },
    ]);
    expect(kinds(diffOf({ "src/add.test.ts": SUITE }, { "src/math/add.test.ts": edited }))).toEqual(
      [],
    );
  });

  it("ignores non-test files and commented-out code", () => {
    const code = "export const f = () => { expect(1); };\n";
    expect(kinds(diffOf({ "src/f.ts": code }, { "src/f.ts": "" }))).toEqual([]);
    const commented = SUITE.replace(
      "    expect(add(0, 0)).toBe(0);\n",
      "    // expect(add(0, 0)).toBe(0);\n",
    );
    const back = diffOf({ "src/add.test.ts": commented }, { "src/add.test.ts": SUITE });
    expect(kinds(back)).toEqual([]);
  });

  it("ignores code quoted in strings, like this file's own fixtures", () => {
    const quoting = SUITE.replace(
      '  it("handles negatives", () => {',
      '  it("handles negatives", () => {\n    const src = \'it.only("x"); it.skip("y"); expect(1)\';',
    );
    expect(kinds(diffOf({ "src/add.test.ts": SUITE }, { "src/add.test.ts": quoting }))).toEqual([]);
  });

  it("does not flag a test file split in two", () => {
    const [head, second] = SUITE.split('\n  it("handles negatives"');
    const first = `${head}\n});\n`;
    const rest = `import { add } from "./add";\n\ndescribe("add", () => {\n  it("handles negatives"${second}`;
    expect(
      kinds(
        diffOf({ "src/add.test.ts": SUITE }, { "src/add.test.ts": first, "src/neg.test.ts": rest }),
      ),
    ).toEqual([]);
  });

  it("counts pgTAP assertions in supabase/tests", () => {
    const sql =
      "select plan(2);\nselect ok(true, 'a');\nselect is(1, 1, 'b');\nselect * from finish();\n";
    const weaker = sql.replace("select is(1, 1, 'b');\n", "");
    expect(
      kinds(diffOf({ "supabase/tests/x.test.sql": sql }, { "supabase/tests/x.test.sql": weaker })),
    ).toEqual([["supabase/tests/x.test.sql", "deleted-assertions", 1]]);
  });
});

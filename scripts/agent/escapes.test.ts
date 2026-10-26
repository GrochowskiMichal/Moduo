import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keeps benchmarks/escapes honest: every escape names a fix commit and tests
// that still exist where it says (HV-15).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "benchmarks/escapes");

type Escape = {
  id: string;
  mechanism: string;
  fixCommit: string;
  sites: string[];
  tests: { lang: "ts" | "rust"; file: string; name: string; run: string }[];
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Any of the three quote styles a test title can use.
const quoted = (name: string) => `(["'\`])${escapeRegex(name)}\\1`;

const escapes = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("benchmarks/escapes", () => {
  it("has the five #509 seeds", () => {
    expect(escapes.filter((id) => id.startsWith("509-"))).toHaveLength(5);
  });

  it.each(escapes)("%s names its mechanism, fix commit, sites and live tests", (id) => {
    expect(existsSync(path.join(DIR, id, "README.md"))).toBe(true);
    const escape = JSON.parse(readFileSync(path.join(DIR, id, "escape.json"), "utf8")) as Escape;
    expect(escape.id).toBe(id);
    expect(escape.mechanism).toMatch(/^[a-z-]+$/);
    expect(escape.fixCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(escape.sites.length).toBeGreaterThan(0);
    for (const site of escape.sites) expect(existsSync(path.join(ROOT, site)), site).toBe(true);
    expect(escape.tests.length).toBeGreaterThan(0);
    for (const test of escape.tests) {
      const file = path.join(ROOT, test.file);
      expect(existsSync(file), test.file).toBe(true);
      const source = readFileSync(file, "utf8");
      // The test's own declaration, not a mention in a comment.
      const named =
        test.lang === "rust"
          ? source.includes(`fn ${test.name}(`)
          : new RegExp(`\\b(?:it|test)\\(\\s*${quoted(test.name)}`).test(source);
      expect(named, `${test.file} no longer has "${test.name}"`).toBe(true);
      const target = test.lang === "rust" ? test.name : path.basename(test.file);
      expect(test.run, `the run command for "${test.name}"`).toContain(target);
    }
  });
});

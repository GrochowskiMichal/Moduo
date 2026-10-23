import { failuresOf, judge, parseKnown } from "./db-test";

describe("parseKnown", () => {
  it("groups labels by file and skips comments and blank lines", () => {
    const known = parseKnown(
      ["# why", "", "a.test.sql: one", "a.test.sql: ERROR: two: three", "b.test.sql: four "].join(
        "\n",
      ),
    );
    expect(known.get("a.test.sql")).toEqual(["one", "ERROR: two: three"]);
    expect(known.get("b.test.sql")).toEqual(["four"]);
  });

  it("refuses a line without a file", () => {
    expect(() => parseKnown("just a label")).toThrow(/not "<file>: <label>"/);
  });
});

describe("failuresOf", () => {
  it("names FAIL labels without their detail, and SQL errors, but not the finish summary", () => {
    const output = [
      "psql:/x/t.test.sql:12: NOTICE:  PASS: fine",
      "psql:/x/t.test.sql:12: NOTICE:  FAIL: a check  [ok 1]",
      "psql:/x/t.test.sql:13: NOTICE:  FAIL: another check ",
      "psql:/x/t.test.sql:14: ERROR:  more than one row returned",
      "psql:/x/_finish.sql:20: ERROR:  FAILED (2 of 3 checks):",
    ].join("\n");
    expect(failuresOf(output)).toEqual([
      "a check",
      "another check",
      "ERROR: more than one row returned",
    ]);
  });
});

describe("judge", () => {
  it("passes known failures, flags new ones, and flags known ones that pass again", () => {
    expect(judge(["a", "b"], ["a", "c"])).toEqual({ unknown: ["b"], known: ["a"], stale: ["c"] });
    expect(judge([], ["a"])).toEqual({ unknown: [], known: [], stale: ["a"] });
    expect(judge(["a"], [])).toEqual({ unknown: ["a"], known: [], stale: [] });
  });
});

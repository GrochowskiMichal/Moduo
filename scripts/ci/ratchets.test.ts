import { describe, expect, it } from "@rstest/core";

import {
  type Baseline,
  check,
  COMPLEXITY_LIMIT,
  complexityChecked,
  measure,
  scoreFunctions,
  SIZE_LIMIT,
  sizeChecked,
  tighten,
} from "./ratchets";

const scores = (source: string, file = "src/x.ts") =>
  Object.fromEntries(scoreFunctions(file, source).map((f) => [f.name, f.score]));

describe("cognitive complexity", () => {
  it("scores SonarSource's sumOfPrimes example as 7", () => {
    const src = `function sumOfPrimes(max) {
      let total = 0;
      OUT: for (let i = 1; i <= max; ++i) {
        for (let j = 2; j < i; ++j) {
          if (i % j == 0) {
            continue OUT;
          }
        }
        total += i;
      }
      return total;
    }`;
    expect(scores(src)).toEqual({ sumOfPrimes: 7 });
  });

  it("scores a switch once and else-if / else flat", () => {
    expect(
      scores(`function words(n) { switch (n) { case 1: return "one"; default: return "many"; } }`),
    ).toEqual({
      words: 1,
    });
    expect(scores(`function f(a, b) { if (a) {} else if (b) {} else {} }`)).toEqual({ f: 3 });
  });

  it("adds nesting for nested structures, catch and ternaries", () => {
    const src = `const f = (xs) => {
      try {
        for (const x of xs) {
          if (x) { while (x.next) {} }
        }
      } catch (e) {
        return e ? 1 : 2;
      }
    };`;
    // for +1, if +2, while +3, catch +1, ternary inside catch +2
    expect(scores(src)).toEqual({ f: 9 });
  });

  it("counts one per run of like logical operators", () => {
    expect(scores(`function f(a, b, c, d) { return a && b && c || d; }`)).toEqual({ f: 2 });
    expect(scores(`function f(a, b, c) { return a ?? b ?? c; }`)).toEqual({ f: 1 });
  });

  it("scores nested functions on their own, named by where they sit", () => {
    const src = `export function Row({ a }) {
      useEffect(() => { if (a) {} }, [a]);
      const onKey = (e) => { if (e) { if (a) {} } };
      return a ? 1 : 2;
    }
    class Store { load() { if (this.x) {} } }
    export default function () { if (1) {} }
    const g = () => {};
    const h = function () {};
    obj.handler = () => {};
    [1].map(() => 1);
    [2].map(() => 2);`;
    expect(scores(src, "src/row.tsx")).toEqual({
      Row: 1,
      "Row>useEffect(cb)": 1,
      "Row>onKey": 3,
      "Store.load": 1,
      default: 1,
      g: 0,
      h: 0,
      "obj.handler": 0,
      "map(cb)": 0,
      "map(cb)#2": 0,
    });
  });
});

const BIG = "x".repeat(SIZE_LIMIT + 1);
const complex = (name: string, ifs: number) =>
  `function ${name}(a) {${Array.from({ length: ifs }, () => " if (a) {}").join("")} }`;

describe("ratchets", () => {
  const baseline: Baseline = {
    sizeLimit: SIZE_LIMIT,
    complexityLimit: COMPLEXITY_LIMIT,
    size: { "src/big.ts": SIZE_LIMIT + 100 },
    complexity: { "src/old.ts": { legacy: 20 } },
  };

  it("passes frozen values that held or shrank", () => {
    const m = measure([
      { path: "src/big.ts", source: "y".repeat(SIZE_LIMIT + 100) },
      { path: "src/old.ts", source: complex("legacy", 18) },
    ]);
    expect(check(m, baseline)).toEqual([]);
  });

  it("fails a frozen file or function that grew", () => {
    const m = measure([
      { path: "src/big.ts", source: "y".repeat(SIZE_LIMIT + 101) },
      { path: "src/old.ts", source: complex("legacy", 21) },
    ]);
    expect(check(m, baseline).map((v) => [v.kind, v.file, v.value, v.frozen])).toEqual([
      ["size", "src/big.ts", SIZE_LIMIT + 101, SIZE_LIMIT + 100],
      ["complexity", "src/old.ts", 21, 20],
    ]);
  });

  it("fails new violations and leaves code under the limits alone", () => {
    const m = measure([
      { path: "src/new.ts", source: BIG },
      { path: "src/old.ts", source: `${complex("legacy", 20)}\n${complex("fresh", 16)}` },
      { path: "src/fine.ts", source: complex("fine", COMPLEXITY_LIMIT) },
    ]);
    expect(check(m, baseline).map((v) => [v.kind, v.file, v.fn, v.frozen])).toEqual([
      ["size", "src/new.ts", undefined, null],
      ["complexity", "src/old.ts", "fresh", null],
    ]);
  });

  it("skips generated, history and test files where they don't apply", () => {
    expect(sizeChecked("supabase/migrations/2026_x.sql")).toBe(false);
    expect(sizeChecked("apps/app/src/types/supabase.ts")).toBe(false);
    expect(sizeChecked("supabase/functions/_shared/notes-doc/notes-doc.bundle.js")).toBe(false);
    expect(sizeChecked("apps/app/src/lib/sync/store.test.ts")).toBe(true);
    expect(sizeChecked("apps/desktop/src-tauri/src/lib.rs")).toBe(true);
    expect(complexityChecked("apps/app/src/lib/sync/store.test.ts")).toBe(false);
    expect(complexityChecked("apps/app/src/lib/sync/store.ts")).toBe(true);
    expect(complexityChecked("docs/README.md")).toBe(false);
  });

  it("tightens to today's values and never raises one", () => {
    const m = measure([
      { path: "src/big.ts", source: "y".repeat(SIZE_LIMIT + 50) },
      { path: "src/old.ts", source: complex("legacy", 25) },
      { path: "src/new.ts", source: BIG },
    ]);
    expect(tighten(m, baseline)).toEqual({
      ...baseline,
      size: { "src/big.ts": SIZE_LIMIT + 50 },
      complexity: { "src/old.ts": { legacy: 20 } },
    });
    expect(tighten(measure([]), baseline)).toEqual({ ...baseline, size: {}, complexity: {} });
  });
});

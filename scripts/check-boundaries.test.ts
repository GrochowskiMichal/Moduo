import { checkFile, compare, importsOf, resolveSpec } from "./check-boundaries";

describe("importsOf", () => {
  it("finds static, type, re-export, side-effect and dynamic imports, not comments", () => {
    const src = [
      'import { a } from "./a";',
      'import type {\n  B,\n} from "../b";',
      'export { c } from "@/c";',
      'import "./side";',
      'const d = await import("./d");',
      '// import { e } from "./e";',
      '/* import { f } from "./f"; */',
    ].join("\n");
    expect(importsOf(src)).toEqual(["./a", "../b", "@/c", "./side", "./d"]);
  });
});

describe("resolveSpec", () => {
  it("resolves relative and @/ specifiers to app paths without extension", () => {
    expect(resolveSpec("src/features/x/y.ts", "../../lib/runtime.web")).toBe("src/lib/runtime.web");
    expect(resolveSpec("src/lib/a.ts", "@/features/tasks/model.ts")).toBe(
      "src/features/tasks/model",
    );
    expect(resolveSpec("src/lib/a.ts", "./sync/index")).toBe("src/lib/sync");
    expect(resolveSpec("src/lib/a.ts", "@contracts/rows")).toBeNull();
  });
});

describe("checkFile", () => {
  it("flags the Supabase client outside lib/runtime*", () => {
    const src = 'import { supabaseClient } from "../../lib/runtime.web";';
    expect(checkFile("src/features/x/y.ts", src)).toEqual([
      { rule: "runtime", file: "src/features/x/y.ts", target: "src/lib/runtime.web" },
    ]);
    expect(
      checkFile("src/lib/notices/n.ts", 'import type { Db } from "../runtime.db";'),
    ).toHaveLength(1);
    expect(
      checkFile("src/components/c.tsx", 'import type { X } from "@supabase/supabase-js";'),
    ).toEqual([{ rule: "runtime", file: "src/components/c.tsx", target: "@supabase/supabase-js" }]);
  });

  it("lets runtime files, other runtime modules and tests through", () => {
    expect(
      checkFile("src/lib/runtime.focus.web.ts", 'import { supabaseClient } from "./runtime.web";'),
    ).toEqual([]);
    expect(
      checkFile("src/features/x/y.ts", 'import type { A } from "../../lib/runtime.web.agents";'),
    ).toEqual([]);
    expect(checkFile("src/features/x/y.test.ts", 'import "../../lib/runtime.web";')).toEqual([]);
  });

  it("flags lib importing features", () => {
    expect(
      checkFile("src/lib/sync/store.ts", 'import type { T } from "../../features/tasks/live";'),
    ).toEqual([
      { rule: "layers", file: "src/lib/sync/store.ts", target: "src/features/tasks/live" },
    ]);
    expect(checkFile("src/features/a/b.ts", 'import { x } from "../../lib/sync/stamps";')).toEqual(
      [],
    );
  });
});

describe("compare", () => {
  const v = (file: string, target = "src/lib/runtime.web") =>
    ({ rule: "runtime", file, target }) as const;

  it("passes grandfathered files and reports new ones", () => {
    const { fresh, stale } = compare([v("src/a.ts"), v("src/b.ts")], {
      runtime: ["src/a.ts"],
      layers: [],
    });
    expect(fresh.map((x) => x.file)).toEqual(["src/b.ts"]);
    expect(stale).toEqual([]);
  });

  it("reports an entry that no longer breaks the rule as stale", () => {
    const { stale } = compare([], {
      runtime: ["src/gone.ts"],
      layers: ["src/lib/a.ts -> src/features/b"],
    });
    expect(stale).toEqual([
      { rule: "runtime", entry: "src/gone.ts" },
      { rule: "layers", entry: "src/lib/a.ts -> src/features/b" },
    ]);
  });

  it("grandfathers lib -> features per target, so a new target in an old file fails", () => {
    const layer = { rule: "layers", file: "src/lib/a.ts", target: "src/features/new" } as const;
    const { fresh } = compare([layer], {
      runtime: [],
      layers: ["src/lib/a.ts -> src/features/old"],
    });
    expect(fresh).toEqual([layer]);
  });
});

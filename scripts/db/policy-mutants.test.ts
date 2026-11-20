import { conjuncts, type Grants, mutantsFor, type Policy, unwrap } from "./policy-mutants";

const open = { SELECT: true, INSERT: true, UPDATE: true, DELETE: true, ALL: true };
const closed = { SELECT: true, INSERT: false, UPDATE: false, DELETE: false, ALL: false };

describe("unwrap", () => {
  it("drops parentheses around the whole expression, not around its first term", () => {
    expect(unwrap("((a AND b))")).toBe("a AND b");
    expect(unwrap("(a) OR (b)")).toBe("(a) OR (b)");
    expect(unwrap("(f(')') AND g())")).toBe("f(')') AND g()");
  });
});

describe("conjuncts", () => {
  it("splits top-level AND terms and leaves nested ones and strings alone", () => {
    expect(conjuncts("((can_access('task', id) OR x) AND tasks__ok(id, ' AND '))")).toEqual([
      "(can_access('task', id) OR x)",
      "tasks__ok(id, ' AND ')",
    ]);
    expect(conjuncts("(a OR (b AND c))")).toEqual(["a OR (b AND c)"]);
  });
});

describe("mutantsFor", () => {
  const policies: Policy[] = [
    { table: "t", name: "t_read", permissive: true, cmd: "SELECT", qual: "(a AND b)", check: null },
    { table: "t", name: "t_insert", permissive: true, cmd: "INSERT", qual: null, check: "true" },
    {
      table: "t",
      name: "lockout",
      permissive: false,
      cmd: "ALL",
      qual: "(x IS NULL)",
      check: "(x IS NULL)",
    },
    { table: "u", name: "u_read", permissive: true, cmd: "SELECT", qual: "c", check: null },
  ];
  const grants: Grants = { anon: closed, authenticated: open };

  it("makes RLS off, each clause true and each AND term dropped, restrictive policies dropped, and closed commands opened", () => {
    const ids = mutantsFor("t", policies, grants).map((m) => m.id);
    expect(ids).toEqual([
      "t: RLS off",
      "t: t_read USING true",
      "t: t_read USING without term 1 of 2",
      "t: t_read USING without term 2 of 2",
      // t_insert's WITH CHECK is already true: nothing to loosen.
      "t: drop restrictive lockout",
      "t: UPDATE opened to everyone",
      "t: DELETE opened to everyone",
    ]);
  });

  it("grants a command, and every function, before opening it", () => {
    const m = mutantsFor("t", policies, grants).find(
      (x) => x.id === "t: UPDATE opened to everyone",
    );
    expect(m?.sql).toBe(
      'GRANT UPDATE ON public."t" TO anon, authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated; ' +
        'CREATE POLICY hv16_mutant ON public."t" AS PERMISSIVE FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);',
    );
  });

  it("keeps the other term when dropping one", () => {
    const m = mutantsFor("t", policies, grants).find(
      (x) => x.id === "t: t_read USING without term 1 of 2",
    );
    expect(m?.sql).toBe('ALTER POLICY "t_read" ON public."t" USING (b);');
  });
});

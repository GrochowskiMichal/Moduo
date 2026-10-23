import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  ANON_DEFINER_ALLOWED,
  clientCallableDefinerQuery,
  dedupeDecls,
  liveBodies,
  normalizeBody,
  parseDeclarations,
  parseFunctionBodies,
  signatureArgs,
  sqlQuote,
  stripComments,
} from "./db-reconcile-core";

// OPS-2 guard. The reconciliation's whole value is that a clean result means
// something — so a silently-broken extractor is worse than no tool at all: fewer
// declared objects means fewer MISSING rows, i.e. a BETTER-looking report.
// These cases pin the behaviour that makes the output trustworthy.
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

describe("normalizeBody", () => {
  it("erases the cosmetic spacing that made 19 of 110 functions look drifted", () => {
    expect(normalizeBody("SET x = now(), y = 1;")).toBe(normalizeBody("SET x=now(),y=1;"));
    expect(normalizeBody("NOT IN ('edit', 'admin')")).toBe(
      normalizeBody("NOT IN ('edit','admin')"),
    );
  });

  it("strips comments and collapses newlines, so comment-only edits are not drift", () => {
    expect(normalizeBody("BEGIN -- a note\n  RETURN 1;\nEND")).toBe(
      normalizeBody("/* different note */ BEGIN RETURN 1; END"),
    );
  });

  it("still distinguishes genuinely different SQL", () => {
    expect(normalizeBody("RETURN a;")).not.toBe(normalizeBody("RETURN b;"));
    // The EM-6 shape: one predicate branch present vs absent.
    expect(normalizeBody("SELECT x OR y;")).not.toBe(normalizeBody("SELECT x;"));
  });
});

describe("parseDeclarations", () => {
  it("does NOT count a CREATE inside a comment", () => {
    const sql = `-- CREATE FUNCTION public.ghost(p uuid)\n/* CREATE TABLE public.ghost_tbl */\nCREATE TABLE public.real_tbl (id uuid);`;
    const names = parseDeclarations(sql, "f.sql").map((d) => d.name);
    expect(names).toEqual(["real_tbl"]);
  });

  it("reads every kind it claims to, including bare and quoted policy names", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION public.fn_a(p uuid) RETURNS void AS $$ BEGIN END; $$;
      CREATE TABLE IF NOT EXISTS public.tbl_a (id uuid);
      ALTER TABLE public.tbl_a ADD COLUMN IF NOT EXISTS col_a text, ADD COLUMN col_b text;
      CREATE TRIGGER trg_a AFTER INSERT ON public.tbl_a FOR EACH ROW EXECUTE FUNCTION public.fn_a();
      CREATE POLICY bare_pol ON public.tbl_a FOR SELECT USING (true);
      CREATE POLICY "quoted pol" ON public.tbl_a FOR SELECT USING (true);
      CREATE OR REPLACE VIEW public.view_a AS SELECT 1;`;
    const byKind = (k: string) =>
      parseDeclarations(sql, "f.sql")
        .filter((d) => d.kind === k)
        .map((d) => d.name);
    expect(byKind("function")).toEqual(["fn_a"]);
    expect(byKind("table")).toEqual(["tbl_a"]);
    expect(byKind("column")).toEqual(["tbl_a.col_a", "tbl_a.col_b"]);
    expect(byKind("trigger")).toEqual(["trg_a"]);
    expect(byKind("policy")).toEqual(["tbl_a::bare_pol", "tbl_a::quoted pol"]);
    expect(byKind("view")).toEqual(["view_a"]);
  });
});

// A drop must take an object off the "should exist" list, or every legacy cleanup
// reads as a MISSING row on the next run, and real drift hides in that noise.
describe("drops", () => {
  const live = (...files: string[]) =>
    dedupeDecls(files.flatMap((sql, i) => parseDeclarations(sql, `${i}.sql`))).map(
      (d) => `${d.kind}:${d.name}`,
    );
  const fn = (name: string) =>
    `CREATE OR REPLACE FUNCTION public.${name} RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`;

  it("a later DROP removes the object; a CREATE after it brings it back", () => {
    expect(live(`CREATE VIEW public.v AS SELECT 1;`, `DROP VIEW IF EXISTS public.v;`)).toEqual([]);
    expect(live(`DROP VIEW IF EXISTS public.v; CREATE VIEW public.v AS SELECT 2;`)).toEqual([
      "view:v",
    ]);
    expect(live(fn("f(p uuid)"), `DROP FUNCTION IF EXISTS public.f(uuid);`)).toEqual([]);
    expect(
      live(
        `CREATE TABLE public.t (id uuid); CREATE POLICY p ON public.t USING (true);`,
        `DROP POLICY IF EXISTS p ON public.t; DROP TABLE public.t;`,
      ),
    ).toEqual([]);
    expect(
      live(
        `CREATE POLICY "own" ON storage.objects USING (true);`,
        `DROP POLICY "own" ON storage.objects;`,
      ),
    ).toEqual([]);
    expect(
      live(
        `ALTER TABLE public.t ADD COLUMN a text, ADD COLUMN b text;`,
        `ALTER TABLE public.t DROP COLUMN IF EXISTS a;`,
      ),
    ).toEqual(["column:t.b"]);
  });

  it("dropping an old overload keeps the live one, even with the same argument count", () => {
    // The chat_op_mark_read shape: (uuid, timestamptz) dropped, (uuid, uuid) live.
    expect(
      live(
        fn("f(p_channel uuid, p_upto uuid)"),
        `DROP FUNCTION IF EXISTS public.f(uuid, timestamptz);`,
      ),
    ).toEqual(["function:f"]);
    expect(
      live(
        fn("f(p_channel uuid, p_at timestamp with time zone DEFAULT now())"),
        `DROP FUNCTION public.f(uuid, timestamptz);`,
      ),
    ).toEqual([]);
    expect(live(fn("f(a uuid)"), fn("f(a uuid, b text)"), `DROP FUNCTION public.f;`)).toEqual([]);
  });

  it("ignores a DROP inside a DO block or function body: it is conditional or rebuilt by EXECUTE", () => {
    const rebuilt = `DO $g$ BEGIN DROP TRIGGER gate ON public.t; EXECUTE v_def; END $g$;`;
    expect(
      live(
        `CREATE TRIGGER gate AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION public.g();`,
        rebuilt,
      ),
    ).toEqual(["trigger:gate"]);
  });

  it("drops a dropped function's body from the drift comparison", () => {
    const decls = dedupeDecls(
      parseDeclarations(`${fn("a()")} ${fn("b()")} DROP FUNCTION public.b();`, "f.sql"),
    );
    const bodies = parseFunctionBodies(`${fn("a()")} ${fn("b()")}`, "f.sql");
    expect(liveBodies(bodies, decls).map((b) => b.name)).toEqual(["a"]);
  });
});

describe("signatureArgs", () => {
  it("keeps only the argument types, normalized", () => {
    expect(
      signatureArgs("p_a uuid DEFAULT NULL, OUT x int, p_t timestamptz, VARIADIC p_ids int[]"),
    ).toBe("uuid,timestamp with time zone,integer[]");
    expect(signatureArgs("timestamp with time zone, numeric(10,2), public.tasks")).toBe(
      "timestamp with time zone,numeric,tasks",
    );
    expect(signatureArgs("")).toBe("");
  });
});

describe("parseFunctionBodies", () => {
  it("extracts the body between the dollar tags", () => {
    const sql = `CREATE FUNCTION public.f(p uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;`;
    expect(parseFunctionBodies(sql, "f.sql")[0]).toMatchObject({ name: "f" });
    expect(parseFunctionBodies(sql, "f.sql")[0].body.trim()).toBe("BEGIN RETURN; END;");
  });

  it("ignores a commented-out CREATE FUNCTION, so it cannot emit a phantom drift row", () => {
    const sql = `-- CREATE FUNCTION public.ghost(p uuid) AS $$ BEGIN END; $$;\nCREATE FUNCTION public.real(p uuid) AS $$ BEGIN RETURN; END; $$;`;
    expect(parseFunctionBodies(sql, "f.sql").map((f) => f.name)).toEqual(["real"]);
  });
});

describe("sqlQuote", () => {
  it("escapes embedded quotes so a policy name cannot break the generated SQL", () => {
    expect(sqlQuote("user's own")).toBe("'user''s own'");
  });
});

describe("clientCallableDefinerQuery (query 4)", () => {
  it("escapes the `__` LIKE pattern, so `_` is not a one-character wildcard", () => {
    const sql = clientCallableDefinerQuery();
    expect(sql).toContain("proname like '%\\_\\_%'");
    expect(sql).toContain("proname not like '%\\_\\_%'");
    expect(sql).not.toContain("'%__%'");
  });

  it("allows by signature, not by name, so a new overload is still reported", () => {
    const sql = clientCallableDefinerQuery({ "f(uuid)": "why" });
    expect(sql).toContain("array['f(uuid)']::text[]");
    expect(sql).toContain("sig not in (select sig from allow)");
    expect(sql).not.toContain("proname not in");
  });

  it("skips trigger functions in both branches, `__` helpers included", () => {
    const sql = clientCallableDefinerQuery();
    const defs = sql.slice(sql.indexOf("defs as ("), sql.indexOf("select 'CLIENT-EXECUTABLE"));
    expect(defs).toContain("p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)");
  });

  it("quotes signatures, and an empty allowlist is still valid SQL", () => {
    expect(clientCallableDefinerQuery({ "it's(text)": "x" })).toContain("'it''s(text)'");
    expect(clientCallableDefinerQuery({})).toContain("array[]::text[]");
  });

  it("keys every allowed entry by a full signature and gives a reason", () => {
    for (const [sig, why] of Object.entries(ANON_DEFINER_ALLOWED)) {
      expect(sig).toMatch(/^[a-z0-9_]+\([\w, [\]]*\)$/);
      expect(why.length).toBeGreaterThan(0);
    }
  });
});

describe("against the real migrations directory", () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const decls = dedupeDecls(
    files.flatMap((f) => parseDeclarations(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"), f)),
  );
  const count = (k: string) => decls.filter((d) => d.kind === k).length;

  // Floors, not exact counts — this must not fail every time a migration lands. It
  // catches the failure that matters: an extractor that silently stops finding a
  // whole category, which would read as a cleaner reconciliation.
  it("finds a plausible number of every declared kind", () => {
    expect(count("function")).toBeGreaterThanOrEqual(100);
    expect(count("table")).toBeGreaterThanOrEqual(20);
    expect(count("column")).toBeGreaterThanOrEqual(25);
    expect(count("trigger")).toBeGreaterThanOrEqual(4);
    expect(count("policy")).toBeGreaterThanOrEqual(25);
    expect(count("view")).toBeGreaterThanOrEqual(1);
  });

  it("extracts a body for every declared function", () => {
    const bodies = new Set(
      files
        .flatMap((f) => parseFunctionBodies(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8"), f))
        .map((b) => b.name),
    );
    const missing = decls
      .filter((d) => d.kind === "function" && !bodies.has(d.name))
      .map((d) => d.name);
    expect(missing).toEqual([]);
  });

  it("leaves out what a later migration dropped, and keeps what it only rebuilt", () => {
    const has = (k: string, n: string) => decls.some((d) => d.kind === k && d.name === n);
    expect(has("view", "tasks_with_drift")).toBe(false);
    expect(has("function", "chat__convert_v1")).toBe(false);
    // An old overload was dropped; the live one stays declared.
    expect(has("function", "chat_op_mark_read")).toBe(true);
    // Dropped inside a DO block and re-created with EXECUTE.
    expect(has("trigger", "module_activity_gate_recipients")).toBe(true);
  });

  it("strips comments without eating real SQL", () => {
    const sample = readFileSync(`${MIGRATIONS_DIR}/${files[0]}`, "utf8");
    expect(stripComments(sample)).not.toContain("--");
    expect(stripComments(sample).length).toBeGreaterThan(0);
  });
});

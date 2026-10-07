import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  dedupeDecls,
  normalizeBody,
  parseDeclarations,
  parseFunctionBodies,
  sqlQuote,
  stripComments,
} from "./db-reconcile-core";

// OPS-2 guard. The reconciliation's whole value is that a clean result means
// something — so a silently-broken extractor is worse than no tool at all: fewer
// declared objects means fewer MISSING rows, i.e. a BETTER-looking report.
// These cases pin the behaviour that makes the output trustworthy.
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
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

  it("strips comments without eating real SQL", () => {
    const sample = readFileSync(`${MIGRATIONS_DIR}/${files[0]}`, "utf8");
    expect(stripComments(sample)).not.toContain("--");
    expect(stripComments(sample).length).toBeGreaterThan(0);
  });
});

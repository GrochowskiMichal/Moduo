#!/usr/bin/env bun
// `bun run db:mutants [table…]` — policy mutants for the RLS access matrix
// (HV-16, supabase/tests/rls_matrix.md). Each mutant loosens one thing on one
// matrix table and runs that table's rls_matrix_<table>.test.sql against it.
// It counts as caught when a check fails that doesn't fail without it; one
// that every check survives means a cell is missing from the matrix.
//
// Mutants, per table: RLS off; every policy's USING and WITH CHECK set to
// true, and each of their top-level AND terms dropped; every RESTRICTIVE
// policy dropped; and, for a command no permissive policy allows, the command
// granted to anon and authenticated behind a policy that lets everything in
// (with EXECUTE on every function in public, which generated columns and CHECK
// constraints call: without it the opened write fails on them by accident).
// A mutant listed under `## Equivalent mutants` in the markdown, with why it
// can't change an outcome, may survive; listed and caught fails the run, so
// the list stays true.
//
// Each run is _setup.sql + the mutant + the test + _finish.sql in one psql
// session: one transaction that ends in ROLLBACK, so the shared local stack
// never keeps a mutant (the table is locked while it runs, about a second).
// MODUO_DB_URL points it at another database, as for db:test.
//
//   bun run db:mutants              every matrix table
//   bun run db:mutants tasks notes  just these
//   bun run db:mutants --list       print the mutants, run nothing

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { failuresOf } from "../db-test";
import { parseMatrix, TESTS_DIR } from "./rls-matrix";

export type Policy = {
  table: string;
  name: string;
  permissive: boolean;
  cmd: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  qual: string | null;
  check: string | null;
};

/** Which commands a role may run on a table at all (table privileges). */
export type Grants = Record<"anon" | "authenticated", Record<Policy["cmd"], boolean>>;

export type Mutant = { id: string; table: string; sql: string };

const CMDS = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Each character's parenthesis depth, or -1 inside a quoted string or name. */
function depths(e: string): number[] {
  const out: number[] = [];
  let depth = 0;
  let quote = "";
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (quote || c === "'" || c === '"') {
      quote = quote === "" ? c : c === quote ? "" : quote;
      out.push(-1);
      continue;
    }
    if (c === ")") depth--;
    out.push(depth);
    if (c === "(") depth++;
  }
  return out;
}

/** Drops each pair of parentheses that wraps the whole expression. */
export function unwrap(expr: string): string {
  const e = expr.trim();
  if (!e.startsWith("(") || !e.endsWith(")")) return e;
  const inner = depths(e).slice(1, -1);
  return inner.includes(0) ? e : unwrap(e.slice(1, -1));
}

/** The expression's top-level AND terms (one term when it has none). */
export function conjuncts(expr: string): string[] {
  const e = unwrap(expr);
  const d = depths(e);
  const cuts = d.flatMap((depth, i) =>
    depth === 0 && /^\sAND\s/.test(e.slice(i, i + 5)) ? [i] : [],
  );
  const bounds = [0, ...cuts.flatMap((i) => [i, i + 5]), e.length];
  const out: string[] = [];
  for (let k = 0; k < bounds.length; k += 2) out.push(e.slice(bounds[k], bounds[k + 1]).trim());
  return out.filter((t) => t.length > 0);
}

/** One permissive policy's mutants: each clause set to true, each AND term dropped. */
function clauseMutants(table: string, p: Policy): Mutant[] {
  const on = `${ident(p.name)} ON public.${ident(table)}`;
  const out: Mutant[] = [];
  for (const [clause, expr] of [
    ["USING", p.qual],
    ["WITH CHECK", p.check],
  ] as const) {
    if (expr === null || unwrap(expr) === "true") continue;
    out.push({
      id: `${table}: ${p.name} ${clause} true`,
      table,
      sql: `ALTER POLICY ${on} ${clause} (true);`,
    });
    const terms = conjuncts(expr);
    if (terms.length < 2) continue;
    terms.forEach((_, i) => {
      const kept = terms.filter((__, j) => j !== i).join(" AND ");
      out.push({
        id: `${table}: ${p.name} ${clause} without term ${i + 1} of ${terms.length}`,
        table,
        sql: `ALTER POLICY ${on} ${clause} (${kept});`,
      });
    });
  }
  return out;
}

const OPEN_CLAUSES: Record<(typeof CMDS)[number], string> = {
  SELECT: "USING (true)",
  INSERT: "WITH CHECK (true)",
  UPDATE: "USING (true) WITH CHECK (true)",
  DELETE: "USING (true)",
};

/** A command no permissive policy allows, opened to everyone. */
function openMutant(table: string, cmd: (typeof CMDS)[number], grants: Grants): Mutant {
  const t = `public.${ident(table)}`;
  const grant =
    grants.anon[cmd] && grants.authenticated[cmd]
      ? ""
      : `GRANT ${cmd} ON ${t} TO anon, authenticated; `;
  return {
    id: `${table}: ${cmd} opened to everyone`,
    table,
    sql:
      `${grant}GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated; ` +
      `CREATE POLICY hv16_mutant ON ${t} AS PERMISSIVE FOR ${cmd} TO anon, authenticated ${OPEN_CLAUSES[cmd]};`,
  };
}

/** Every mutant for one table. */
export function mutantsFor(table: string, policies: Policy[], grants: Grants): Mutant[] {
  const own = policies.filter((p) => p.table === table);
  const permissive = own.filter((p) => p.permissive);
  return [
    {
      id: `${table}: RLS off`,
      table,
      sql: `ALTER TABLE public.${ident(table)} DISABLE ROW LEVEL SECURITY;`,
    },
    ...own.flatMap((p) =>
      p.permissive
        ? clauseMutants(table, p)
        : [
            {
              id: `${table}: drop restrictive ${p.name}`,
              table,
              sql: `DROP POLICY ${ident(p.name)} ON public.${ident(table)};`,
            },
          ],
    ),
    ...CMDS.filter((cmd) => !permissive.some((p) => p.cmd === cmd || p.cmd === "ALL")).map((cmd) =>
      openMutant(table, cmd, grants),
    ),
  ];
}

const DB_URL =
  process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";

function psql(args: string[]) {
  const run = spawnSync("psql", [DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
  if (run.error) {
    console.error(`psql couldn't run (${run.error.message}). Install it: brew install libpq.`);
    process.exit(1);
  }
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function query<T>(sql: string): T {
  const run = psql(["-At", "-c", sql]);
  if (run.status !== 0) throw new Error(`Query failed: ${run.output}`);
  return JSON.parse(run.output.trim()) as T;
}

function loadPolicies(tables: string[]): Policy[] {
  const list = tables.map((t) => `'${t}'`).join(", ");
  return (
    query<Policy[] | null>(
      `SELECT json_agg(json_build_object('table', tablename, 'name', policyname, 'permissive', permissive = 'PERMISSIVE',
         'cmd', cmd, 'qual', qual, 'check', with_check) ORDER BY tablename, policyname)
       FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${list})`,
    ) ?? []
  );
}

function loadGrants(table: string): Grants {
  const cols = CMDS.map(
    (c) =>
      `'${c}', json_build_object('anon', has_table_privilege('anon', 'public.${table}', '${c}'),` +
      ` 'authenticated', has_table_privilege('authenticated', 'public.${table}', '${c}'))`,
  ).join(", ");
  const byCmd = query<Record<string, { anon: boolean; authenticated: boolean }>>(
    `SELECT json_build_object(${cols})`,
  );
  const g: Grants = {
    anon: { SELECT: false, INSERT: false, UPDATE: false, DELETE: false, ALL: false },
    authenticated: { SELECT: false, INSERT: false, UPDATE: false, DELETE: false, ALL: false },
  };
  for (const c of CMDS) {
    g.anon[c] = byCmd[c].anon;
    g.authenticated[c] = byCmd[c].authenticated;
  }
  return g;
}

/** One table's matrix file, with an optional mutant applied first. */
function runTable(table: string, mutantFile?: string) {
  return psql([
    "-f",
    join(TESTS_DIR, "_setup.sql"),
    ...(mutantFile ? ["-f", mutantFile] : []),
    "-f",
    join(TESTS_DIR, `rls_matrix_${table}.test.sql`),
    "-f",
    join(TESTS_DIR, "_finish.sql"),
  ]);
}

type Outcome = "caught" | "survived" | "equivalent" | "stale" | "broken";

/** Runs one mutant and says what became of it, printing a line. */
function judge(m: Mutant, file: string, before: string[], why: string | undefined): Outcome {
  // A mutant waits at most 5 s for its lock: the stack is shared with other sessions.
  writeFileSync(file, `SET LOCAL lock_timeout = '5s';\n${m.sql}\n`);
  const run = runTable(m.table, file);
  const fresh = failuresOf(run.output).filter((f) => !before.includes(f));
  // Only a persona's cell catches a mutant. An SQL error (the mutant's own, the
  // world's or a helper's) or a failed sanity run means the run proved nothing.
  const broken = fresh.find(
    (f) => f.startsWith("ERROR:") || f.endsWith("reaches its row as owner without RLS"),
  );
  if (broken !== undefined) {
    console.log(`! ${m.id} — the run broke instead of judging: ${broken}`);
    return "broken";
  }
  const caught = fresh;
  if (why !== undefined) {
    if (caught.length > 0)
      console.log(
        `✗ ${m.id} — listed as equivalent, but caught by ${caught[0]}: remove it from the list`,
      );
    else console.log(`≡ ${m.id} — equivalent: ${why}`);
    return caught.length > 0 ? "stale" : "equivalent";
  }
  if (caught.length === 0) {
    console.log(`✗ ${m.id} — survived\n  ${m.sql}`);
    return "survived";
  }
  console.log(
    `✓ ${m.id} — caught by ${caught[0]}${caught.length > 1 ? ` (+${caught.length - 1})` : ""}`,
  );
  return "caught";
}

/** Each table's failures without a mutant (known ones); exits if a file errors. */
function baselines(tables: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tables) {
    const failures = failuresOf(runTable(t).output);
    if (failures.some((f) => f.startsWith("ERROR:"))) {
      console.error(
        `rls_matrix_${t}.test.sql errors without a mutant; fix it first (bun run db:test rls_matrix_${t}).`,
      );
      process.exit(1);
    }
    out.set(t, failures);
  }
  return out;
}

/** The tables asked for, or every matrix table; exits on a name the matrix doesn't have. */
function pickTables(wanted: string[], all: string[]): string[] {
  const unknown = wanted.filter((w) => !all.includes(w));
  if (unknown.length > 0) {
    console.error(
      `Not a matrix table: ${unknown.join(", ")} (rls_matrix.md has ${all.join(", ")}).`,
    );
    process.exit(1);
  }
  return wanted.length > 0 ? wanted : all;
}

function main() {
  const args = process.argv.slice(2);
  const wanted = args.filter((a) => !a.startsWith("--"));
  const matrix = parseMatrix(readFileSync(join(TESTS_DIR, "rls_matrix.md"), "utf8"));
  const all = matrix.tables.map((t) => t.name);
  const tables = pickTables(wanted, all);
  const equivalent = new Map(matrix.equivalent.map((e) => [e.id, e.why]));
  const policies = loadPolicies(tables);
  const mutants = tables.flatMap((t) => mutantsFor(t, policies, loadGrants(t)));
  const ids = new Set(mutants.map((m) => m.id));
  const unmatched = wanted.length > 0 ? [] : [...equivalent.keys()].filter((id) => !ids.has(id));
  if (unmatched.length > 0) {
    console.error(
      `rls_matrix.md lists equivalent mutants that don't exist any more: ${unmatched.join("; ")}.`,
    );
    process.exit(1);
  }
  if (args.includes("--list")) {
    for (const m of mutants) console.log(`${m.id}\n  ${m.sql}`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "policy-mutants-"));
  const outcomes: Outcome[] = [];
  try {
    const before = baselines(tables);
    const file = join(dir, "mutant.sql");
    for (const m of mutants)
      outcomes.push(judge(m, file, before.get(m.table) ?? [], equivalent.get(m.id)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const count = (o: Outcome) => outcomes.filter((x) => x === o).length;
  const listed = count("equivalent") + count("stale");
  console.log(
    `\n${count("caught")} of ${mutants.length - listed} policy mutants caught (${count("equivalent")} equivalent, listed in rls_matrix.md).`,
  );
  if (count("survived") + count("broken") + count("stale") > 0) {
    console.log(
      "A survivor is a cell the matrix is missing: add an operation or a persona row to rls_matrix.md.",
    );
    process.exit(1);
  }
}

if (import.meta.main) main();

#!/usr/bin/env bun
// `bun run db:matrix` — turns supabase/tests/rls_matrix.md (HV-16) into the
// SQL tests next to it: _rls_world.sql (the ## World fixture),
// rls_matrix_<table>.test.sql (one per `## Table:` section) and
// rls_matrix_rpcs.test.sql (the RPC probe, with the markdown's allow list).
// Each starts with the hand-written _rls_matrix.sql (the cell helpers, which
// include the world); the probe's calls are the hand-written _rls_probe.sql.
// `bun run db:test rls_matrix` runs them.
//
//   bun run db:matrix            write the files
//   bun run db:matrix --check    exit 1 if a file is out of step with the markdown

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PERSONAS = [
  "owner",
  "admin",
  "editor",
  "viewer",
  "capped",
  "member",
  "outsider",
  "anon",
  "app",
] as const;
export type Persona = (typeof PERSONAS)[number];

/** ✓ reaches the row, ✗ refused, – not tested. */
export type Cell = "allow" | "deny" | "skip";

export type Op = {
  sql: string;
  /** Runs with the write triggers standing aside (share.bypass), so RLS alone decides. */
  rlsAlone: boolean;
};

export type Table = {
  name: string;
  /** Operation name → its SQL, in the order the markdown lists them. */
  ops: Map<string, Op>;
  cells: Map<Persona, Map<string, Cell>>;
};

export type RpcAllow = { fn: string; as: string; why: string };

/** A mutant `bun run db:mutants` may let live, with the reason it changes nothing. */
export type Equivalent = { id: string; why: string };

export type Matrix = {
  world: string;
  tables: Table[];
  rpcAllow: RpcAllow[];
  equivalent: Equivalent[];
};

const CELL: Record<string, Cell> = { "✓": "allow", "✗": "deny", "–": "skip" };

/** `test.id(name)` from _setup.sql: md5('db-test:' || name)::uuid. */
export function testId(name: string): string {
  const h = createHash("md5").update(`db-test:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** An operation's SQL with each `{Name}` swapped for its fixture id. */
export function renderOp(sql: string): string {
  return sql.replace(/\{([A-Za-z0-9_:-]+)\}/g, (_, name: string) => `'${testId(name)}'::uuid`);
}

function row(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

type Block = { name: string; rlsAlone: boolean; sql: string };

function fail(message: string): never {
  throw new Error(`rls_matrix.md: ${message}`);
}

function parseOps(table: string, blocks: Block[]): Map<string, Op> {
  const ops = new Map<string, Op>();
  for (const b of blocks) {
    if (ops.has(b.name)) fail(`${table} lists ${b.name} twice`);
    ops.set(b.name, { sql: b.sql, rlsAlone: b.rlsAlone });
  }
  return ops;
}

/** The persona table's columns, each matched to an operation and back. */
function parseColumns(table: string, header: string[], ops: Map<string, Op>): string[] {
  if (header[0] !== "persona") fail(`${table} has no persona table`);
  const columns = header.slice(1);
  for (const c of columns) {
    if (!ops.has(c)) fail(`${table} has a column ${c} with no sql ${c} block`);
  }
  for (const op of ops.keys()) {
    if (!columns.includes(op)) fail(`${table}'s ${op} has no column`);
  }
  return columns;
}

function parseRow(table: string, columns: string[], line: string): [Persona, Map<string, Cell>] {
  const [who, ...marks] = row(line);
  if (!(PERSONAS as readonly string[]).includes(who))
    fail(`${table} has an unknown persona ${who}`);
  if (marks.length !== columns.length) {
    fail(`${table}'s ${who} row has ${marks.length} cells, not ${columns.length}`);
  }
  const byOp = new Map<string, Cell>();
  marks.forEach((m, i) => {
    const cell = CELL[m];
    if (!cell) fail(`${table} · ${columns[i]} · ${who} is "${m}", not ✓, ✗ or –`);
    byOp.set(columns[i], cell);
  });
  return [who as Persona, byOp];
}

function parseTable(heading: string, blocks: Block[], lines: string[]): Table {
  const name = heading.slice("Table: ".length).trim();
  if (!/^[a-z_]+$/.test(name)) fail(`"${name}" is not a table name`);
  const ops = parseOps(name, blocks);
  const columns = parseColumns(name, lines.length > 0 ? row(lines[0]) : [], ops);
  const cells = new Map(lines.slice(2).map((line) => parseRow(name, columns, line)));
  for (const p of PERSONAS) {
    if (!cells.has(p)) fail(`${name} has no row for ${p}`);
  }
  return { name, ops, cells };
}

/** A list table's rows (after its header), each with `width` non-empty cells. */
function parseList(lines: string[], width: number, what: string): string[][] {
  return lines.slice(2).map((line) => {
    const cells = row(line).map((c) => c.replace(/^`|`$/g, ""));
    if (cells.length < width || cells.slice(0, width).some((c) => !c))
      fail(`${what} "${line}" is incomplete`);
    return cells;
  });
}

/** The markdown's sections: world, tables (ops + cells), equivalent mutants and the RPC allow list. */
export function parseMatrix(md: string): Matrix {
  const m: Matrix = { world: "", tables: [], rpcAllow: [], equivalent: [] };
  for (const section of md.split(/^## /m).slice(1)) {
    const heading = section.slice(0, section.indexOf("\n")).trim();
    const blocks = [...section.matchAll(/^```sql ([a-z_]+)( rls-alone)?\n([\s\S]*?)^```$/gm)].map(
      (b) => ({ name: b[1], rlsAlone: b[2] !== undefined, sql: b[3].trim() }),
    );
    const lines = section.split("\n").filter((l) => l.trim().startsWith("|"));
    if (heading === "World") m.world = blocks.find((b) => b.name === "world")?.sql ?? "";
    else if (heading.startsWith("Table: ")) m.tables.push(parseTable(heading, blocks, lines));
    else if (heading === "RPC probe") {
      m.rpcAllow = parseList(lines, 3, "RPC allow line").map(([fn, as, why]) => ({ fn, as, why }));
    } else if (heading === "Equivalent mutants") {
      m.equivalent = parseList(lines, 2, "equivalent mutant line").map(([id, why]) => ({
        id,
        why,
      }));
    }
  }
  if (!m.world) fail("no ```sql world block under ## World");
  if (m.tables.length === 0) fail("no ## Table: sections");
  return m;
}

/** A dollar quote no operation's SQL contains. */
function quote(sql: string): string {
  return `$op$${sql}$op$`;
}

function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const HEADER = (what: string) =>
  `-- Generated by scripts/db/rls-matrix.ts from rls_matrix.md (${what}).\n-- Edit the markdown, then run \`bun run db:matrix\`; never this file.\n`;

export function renderTable(t: Table): string {
  const out = [HEADER(`Table: ${t.name}`), "\\ir _rls_matrix.sql", "", "DO $mx$", "BEGIN"];
  for (const [name, op] of t.ops) {
    const body = quote(renderOp(op.sql));
    const cell = (who: string, allowed: boolean) =>
      `  PERFORM test.mx_cell(${lit(t.name)}, ${lit(name)}, ${lit(who)}, ${allowed}, ${body}${op.rlsAlone ? ", true" : ""});`;
    out.push(cell("sys", true));
    for (const p of PERSONAS) {
      const mark = t.cells.get(p)?.get(name);
      if (mark === "skip" || mark === undefined) continue;
      out.push(cell(p, mark === "allow"));
    }
  }
  out.push("END", "$mx$;", "");
  return out.join("\n");
}

export function renderRpcs(allow: RpcAllow[]): string {
  const values = allow.map((a) => `  (${lit(a.fn)}, ${lit(a.as)}, ${lit(a.why)})`);
  return [
    HEADER("RPC probe"),
    "\\ir _rls_matrix.sql",
    "",
    "CREATE TABLE test.mx_allow (fn text NOT NULL, persona text NOT NULL, why text NOT NULL);",
    ...(values.length > 0
      ? ["INSERT INTO test.mx_allow (fn, persona, why) VALUES", `${values.join(",\n")};`]
      : []),
    "",
    "\\ir _rls_probe.sql",
    "",
  ].join("\n");
}

export function renderWorld(world: string): string {
  return [HEADER("## World"), world, ""].join("\n");
}

/** Every generated file, by name. */
export function generate(md: string): Map<string, string> {
  const m = parseMatrix(md);
  const files = new Map<string, string>();
  files.set("_rls_world.sql", renderWorld(m.world));
  for (const t of m.tables) files.set(`rls_matrix_${t.name}.test.sql`, renderTable(t));
  files.set("rls_matrix_rpcs.test.sql", renderRpcs(m.rpcAllow));
  return files;
}

/** Generated files that differ from what's on disk, or that the markdown no longer makes. */
export function stale(dir: string, files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [name, text] of files) {
    const path = join(dir, name);
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) out.push(name);
  }
  for (const name of readdirSync(dir)) {
    if (/^rls_matrix_.*\.test\.sql$/.test(name) && !files.has(name)) out.push(name);
  }
  return out;
}

export const TESTS_DIR = fileURLToPath(new URL("../../supabase/tests", import.meta.url));

export function generateFromDisk(dir = TESTS_DIR): Map<string, string> {
  return generate(readFileSync(join(dir, "rls_matrix.md"), "utf8"));
}

function main() {
  const files = generateFromDisk();
  const off = stale(TESTS_DIR, files);
  if (process.argv.includes("--check")) {
    if (off.length > 0) {
      console.error(`Out of step with rls_matrix.md: ${off.join(", ")}. Run bun run db:matrix.`);
      process.exit(1);
    }
    console.log("The matrix files match rls_matrix.md.");
    return;
  }
  for (const name of off) {
    const text = files.get(name);
    if (text === undefined) unlinkSync(join(TESTS_DIR, name));
    else writeFileSync(join(TESTS_DIR, name), text);
  }
  console.log(off.length > 0 ? `Wrote ${off.join(", ")}.` : "Nothing to write.");
}

if (import.meta.main) main();

#!/usr/bin/env bun
// `bun run db:test [name…]` — the SQL tests in supabase/tests/*.test.sql, run
// against the local stack (docs/local-dev.md; `bun run local:up` first, with
// the repo's migrations applied). Each file runs in one psql session as
// _setup.sql + the test + _finish.sql: one transaction that ends in ROLLBACK,
// so nothing is left behind. A FAIL, a SQL error or a test with no checks
// fails the run. MODUO_DB_URL points it at another database.
//
// supabase/tests/known-failures.txt lists failures that are already red on a
// prod-faithful stack (checks.yml's db-test job), each with its reason: they
// print as known and don't fail the run, any other failure does, and a listed
// one that passes again fails the run until its line is removed.
//
//   bun run db:test                 every test
//   bun run db:test tasks_ops       just supabase/tests/tasks_ops.test.sql

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** `file: label` pairs from known-failures.txt (`#` comments and blank lines skipped). */
export function parseKnown(text: string): Map<string, string[]> {
  const known = new Map<string, string[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf(": ");
    if (at < 0) throw new Error(`known-failures.txt: "${line}" is not "<file>: <label>"`);
    const file = line.slice(0, at);
    known.set(file, [...(known.get(file) ?? []), line.slice(at + 2).trim()]);
  }
  return known;
}

/**
 * What failed in one file's psql output: each FAIL check's label (its detail
 * in `[…]` dropped) and each SQL error, as `ERROR: <message>`. _finish.sql's
 * own "FAILED (n of m checks)" summary is not a failure of its own.
 */
export function failuresOf(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split("\n")) {
    const fail = line.match(/NOTICE: {2}FAIL: (.*)$/);
    if (fail) {
      out.push(fail[1].split(" [")[0].replace(/\s+$/, ""));
      continue;
    }
    const error = line.match(/ERROR: {2}(.*)$/);
    if (error && !/_finish\.sql:\d+:/.test(line)) out.push(`ERROR: ${error[1].trim()}`);
  }
  return out;
}

export type Verdict = { unknown: string[]; known: string[]; stale: string[] };

/** Splits a file's failures into known and unknown, and lists known ones that no longer fail. */
export function judge(failures: string[], known: string[]): Verdict {
  const unknown = failures.filter((f) => !known.includes(f));
  return {
    unknown,
    known: failures.filter((f) => known.includes(f)),
    stale: known.filter((k) => !failures.includes(k)),
  };
}

function main() {
  const ROOT = resolve(import.meta.dir, "..");
  const DIR = join(ROOT, "supabase", "tests");
  const DB_URL =
    process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
  const KNOWN_FILE = join(DIR, "known-failures.txt");
  const knownAll = existsSync(KNOWN_FILE)
    ? parseKnown(readFileSync(KNOWN_FILE, "utf8"))
    : new Map<string, string[]>();

  const wanted = process.argv.slice(2);
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".test.sql"))
    .filter((f) => wanted.length === 0 || wanted.some((w) => f.startsWith(w)))
    .sort();

  if (files.length === 0) {
    console.error(`No tests match ${wanted.join(", ") || "supabase/tests/*.test.sql"}.`);
    process.exit(1);
  }
  if (!existsSync(join(DIR, "_setup.sql")) || !existsSync(join(DIR, "_finish.sql"))) {
    console.error("supabase/tests/_setup.sql and _finish.sql are missing.");
    process.exit(1);
  }
  for (const file of knownAll.keys()) {
    if (!existsSync(join(DIR, file))) {
      console.error(`known-failures.txt names ${file}, which doesn't exist: remove its lines.`);
      process.exit(1);
    }
  }

  let failed = 0;
  let knownCount = 0;
  for (const file of files) {
    const run = spawnSync(
      "psql",
      [
        DB_URL,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        join(DIR, "_setup.sql"),
        "-f",
        join(DIR, file),
        "-f",
        join(DIR, "_finish.sql"),
      ],
      { encoding: "utf8" },
    );
    if (run.error) {
      console.error(`psql couldn't run (${run.error.message}). Install it: brew install libpq.`);
      process.exit(1);
    }
    const output = `${run.stdout}\n${run.stderr}`;
    const lines = output.split("\n");
    const passes = lines.filter((l) => /NOTICE: {2}PASS: (?!all)/.test(l)).length;
    const verdict = judge(run.status === 0 ? [] : failuresOf(output), knownAll.get(file) ?? []);
    // A non-zero exit with nothing to name (a crash, a test with no checks) is a failure too.
    const unexplained = run.status !== 0 && verdict.unknown.length + verdict.known.length === 0;
    if (run.status === 0 && verdict.stale.length === 0) {
      console.log(`✓ ${file} — ${passes} checks`);
      continue;
    }
    if (verdict.unknown.length === 0 && verdict.stale.length === 0 && !unexplained) {
      knownCount += 1;
      console.log(`◌ ${file} — known failures only (supabase/tests/known-failures.txt)`);
      for (const k of verdict.known) console.log(`  known: ${k}`);
      continue;
    }
    failed += 1;
    console.log(`✗ ${file}`);
    for (const s of verdict.stale) {
      console.log(`  passes now, remove from known-failures.txt: ${file}: ${s}`);
    }
    if (verdict.unknown.length > 0 || unexplained) {
      // PASS notices also start with "psql:"; leave them out so a failure shows.
      const errors = lines.filter((l) => /ERROR|FAIL|psql:/.test(l) && !/NOTICE: {2}PASS/.test(l));
      for (const line of errors.slice(0, 40)) console.log(`  ${line}`);
    }
  }

  const knownNote = knownCount > 0 ? ` (${knownCount} with known failures only)` : "";
  if (failed > 0) {
    console.log(`\n${failed} of ${files.length} SQL test files failed${knownNote}.`);
    process.exit(1);
  }
  console.log(`\nAll ${files.length} SQL test files passed${knownNote}.`);
}

if (import.meta.main) main();

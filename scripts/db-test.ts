#!/usr/bin/env bun
// `bun run db:test [name…]` — the SQL tests in supabase/tests/*.test.sql, run
// against the local stack (docs/local-dev.md; `bun run local:up` first, with
// the repo's migrations applied). Each file runs in one psql session as
// _setup.sql + the test + _finish.sql: one transaction that ends in ROLLBACK,
// so nothing is left behind. A FAIL, a SQL error or a test with no checks
// fails the run. MODUO_DB_URL points it at another database.
//
//   bun run db:test                 every test
//   bun run db:test tasks_ops       just supabase/tests/tasks_ops.test.sql

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIR = join(ROOT, "supabase", "tests");
const DB_URL =
  process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";

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

let failed = 0;
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
  const lines = `${run.stdout}\n${run.stderr}`.split("\n");
  const fails = lines.filter((l) => /FAIL/.test(l));
  const passes = lines.filter((l) => /NOTICE: {2}PASS: (?!all)/.test(l)).length;
  if (run.status === 0) {
    console.log(`✓ ${file} — ${passes} checks`);
  } else {
    failed += 1;
    console.log(`✗ ${file}`);
    const errors = lines.filter((l) => /ERROR|FAIL|psql:/.test(l));
    for (const line of (errors.length ? errors : fails).slice(0, 40)) console.log(`  ${line}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed} of ${files.length} SQL test files failed.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} SQL test files passed.`);

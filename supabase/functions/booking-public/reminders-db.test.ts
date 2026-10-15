import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@rstest/core";

// TX-6's reminders and host cancel live in Postgres triggers, so they are
// proven against the local stack: supabase/tests/booking_reminders.test.sql, in
// one rolled-back transaction (the way `bun run db:test booking_reminders`
// runs it). Runs from `bun run verify` whenever the stack is up and carries the
// migration, and says so when it can't.

const DB_URL =
  process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
const MIGRATION = "20261014170000_tx6_booking_reminders.sql";
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TESTS = `${ROOT}supabase/tests/`;

function stackState(): "ready" | string {
  const probe = spawnSync(
    "psql",
    [DB_URL, "-X", "-At", "-c", "select to_regprocedure('public.booking__queue_reminders(uuid)') is not null"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (probe.error) return `psql is not installed (${probe.error.message})`;
  if (probe.status !== 0) return "the local stack is not answering (bun run local:up)";
  if (probe.stdout.trim() !== "t") {
    return `the local stack lacks ${MIGRATION} (psql <local db url> -f supabase/migrations/${MIGRATION})`;
  }
  return "ready";
}

const state = stackState();
const run = state === "ready" ? it : it.skip;
if (state !== "ready") console.warn(`booking reminders: not checked here — ${state}`);

describe("booking reminders + host cancel (supabase/tests/booking_reminders.test.sql)", () => {
  run(
    "reminders queue, move and cancel; a host delete releases and emails after 2 minutes; undo sends nothing",
    () => {
      const result = spawnSync(
        "psql",
        [
          DB_URL,
          "-X",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-f",
          `${TESTS}_setup.sql`,
          "-f",
          `${TESTS}booking_reminders.test.sql`,
          "-f",
          `${TESTS}_finish.sql`,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.status !== 0 || /FAIL/.test(output)) {
        throw new Error(
          `supabase/tests/booking_reminders.test.sql did not pass:\n${output
            .split("\n")
            .filter((l) => /ERROR|FAIL/.test(l))
            .join("\n")}`,
        );
      }
      expect(output).toMatch(/PASS: all \(\d+ checks\)/);
    },
    60_000,
  );
});

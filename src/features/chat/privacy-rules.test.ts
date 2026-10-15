import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@rstest/core";

// Chat's read rules live in Postgres (RLS and SECURITY DEFINER ops), so they
// are proven against the local stack: supabase/tests/chat_privacy.test.sql, in
// one rolled-back transaction, the same way `bun run db:test chat_privacy`
// runs it. This file runs that check from `bun run verify` whenever the stack
// is up and carries the rules' migration, and says so when it can't.

const DB_URL =
  process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
// The newest migration whose behaviour chat_privacy.test.sql expects (typing for
// members only, the ops' error codes: CV-2a; conversations registered when made,
// leaving logged, General as is_default: CV-2b), found by a function it adds.
const MIGRATION = "20261014160000_chat_v2_conversation_ops.sql";
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TESTS = `${ROOT}supabase/tests/`;

function stackState(): "ready" | string {
  const probe = spawnSync(
    "psql",
    [DB_URL, "-X", "-At", "-c", "select to_regprocedure('public.chat_people(uuid)') is not null"],
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
if (state !== "ready") console.warn(`chat read rules: not checked here — ${state}`);

describe("chat read rules (supabase/tests/chat_privacy.test.sql)", () => {
  run(
    "activity, registry, caps, announcement and typing follow the conversation's read rule",
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
          `${TESTS}chat_privacy.test.sql`,
          "-f",
          `${TESTS}_finish.sql`,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.status !== 0 || /FAIL/.test(output)) {
        throw new Error(
          `supabase/tests/chat_privacy.test.sql did not pass:\n${output
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

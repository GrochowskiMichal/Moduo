# Manual test checklist — TX-3 outbox worker + deliverability

> Generated 2026-10-09 · branch `t/maciej/tx-3-outbox-worker` · **Live-verified:** partial. The SQL was run end to end on a local Postgres 17 replica (87 checks + a two-session claim, below); the worker and webhook logic by unit tests. On prod (Maciej's OK, 2026-10-09): both functions deployed, the migration applied and checked, and one outbox test sent end to end. The Resend webhook waits for Maciej's dashboard step (docs/email-runbook.md §TX-3 step 4).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Done in the session (agent)

- [x] **Do:** `bun run verify` → **Expect:** green. _(2,420+ tests: worker claim/send/backoff/fail-after-5, idempotency key, pacing, batch budget; Svix signature + hard/soft bounce, complaint, Resend-suppressed, delivered; ops alert copy; worker request auth)_
- [x] **Do:** the replica round trip in [`supabase/probes/email-outbox.probe.sql`](../../supabase/probes/email-outbox.probe.sql) (header has the command; the TX-3 migration runs twice) → **Expect:** 87 `PASS` lines and `ALL PASSED`. Covers: one Vault secret and three jobs after a re-run; service_role-only grants on all 14 functions, `email_suppressions` and the run lease (with a control showing the stub hands anon EXECUTE on a fresh function, as Supabase does); enqueue de-duplication; one kick per transaction, none for scheduled rows, sign-in log rows, a missing secret or a broken pg_net; claim skips scheduled, cancelled and leased rows; a scheduled row is claimed once due; finish sent/retry/failed and its idempotence; 5 attempts then failed; a lost lease is claimed again (once more beyond the 5th attempt, idempotently), and failed after that; suppression of due rows; delivered_at; the run lease (one run at a time, a crashed run's lease frees itself, a stale token can't release it); the health alert's thresholds (failed rows and rows retrying after two failures, not a first-try blip), 30-minute gap and blanked addresses; the purge's keep/delete rules.
- [x] **Do:** two sessions on the replica, six due rows; session A `begin; select … from email_outbox__claim(3); select pg_sleep(3); commit;`, session B `select … from email_outbox__claim(10)` one second later → **Expect:** A and B get disjoint rows (two runs on 2026-10-09: A `cc:1,cc:3,cc:4` / B `cc:2,cc:5,cc:6`, then A `cc:2,cc:5,cc:6` / B `cc:1,cc:3,cc:4`), all six `sending` once, attempts 1.

## Live, after the prod steps (runbook §TX-3 steps 1–3)

- [x] **Do (agent, 2026-10-09):** outside probes of both functions → **Expect:** `GET` 405; unsigned `POST` 401 (`unauthorized` / `invalid_signature`); a malformed worker secret 401 without a database call.
- [x] **Do (agent, 2026-10-09):** catalog checks after the apply → **Expect:** 14 functions, none executable by anon or authenticated; `email_suppressions`, `email_outbox_runner` and `email_outbox` closed to both (SELECT/INSERT/TRUNCATE); RLS on; one 64-hex Vault secret; the kick trigger; jobs `email-outbox-worker` `* * * * *`, `email-outbox-health` `*/5 * * * *`, `email-outbox-purge` `17 3 * * *` (now `SELECT public.email_outbox__purge()`); history row `20261008233000 email_outbox_worker`. All as expected.
- [x] **Do (agent, 2026-10-09):** queue the outbox test (runbook step 3) → **Seen:** the row went `sent` on attempt 1 with a Resend id 2.6 s after the insert; pg_net's kick got `202 {"accepted":true}`; the run lease was released. `bun run functions:reconcile` OK.
- [ ] **Do (Maciej):** look in hello@moduo.app → **Expect:** "Email test: the outbox works", in light and dark _(the inbox)_
- [ ] **Do:** queue a test with `send_after` two minutes ahead → **Expect:** it arrives about two minutes later, not before (AC15) _(inbox)_
- [ ] **Do:** queue a test with `send_after` five minutes ahead, then `select public.email_cancel('<its key>');` → **Expect:** returns 1; nothing arrives; the row reads `cancelled` (AC15)
- [ ] **Do:** queue the same dedupe key twice → **Expect:** one row, one email (AC14)
- [ ] **Do:** `select jobname, schedule, active from cron.job where jobname like 'email-outbox-%';` → **Expect:** worker `* * * * *`, health `*/5 * * * *`, purge `17 3 * * *`, all active
- [ ] **Do:** Edge Functions → email-worker → Logs after a send → **Expect:** a `run` line with `sent: 1`; no `unauthorized` lines

## Resend webhook (runbook §TX-3 step 4, after the policy line)

- [ ] **Do:** send any outbox test after the webhook is set → **Expect:** the row's `delivered_at` fills within a minute (AC17's plumbing)
- [ ] **Do:** queue a test to `bounced@resend.dev` (Resend's test address) → **Expect:** `email_suppressions` gets the address with reason `bounce`; a second test to it ends `suppressed`, not sent (AC17)
- [ ] **Do:** queue a test to `complained@resend.dev` → **Expect:** suppressed with reason `complaint` (AC17)
- [ ] **Do:** clean up: `delete from public.email_suppressions where email in ('bounced@resend.dev', 'complained@resend.dev');`

## Edge cases

- [ ] **Do:** Resend refuses temporarily (hard to force live; covered by unit tests) → **Expect:** the row goes back to `queued` with `send_after` 1, 5, 15, 60 minutes later, then `failed` after the 5th attempt (AC16)
- [ ] **Do:** three failures within 10 minutes (covered on the replica) → **Expect:** one "Email alert: 3 emails failed in 10 minutes" to hello@, no second one for 30 minutes (AC19)

## Migrations / data

- [ ] **Do:** after the apply, `select count(*) from vault.secrets where name = 'email_worker_secret';` and `select has_function_privilege('anon', 'public.email_enqueue(text, text, uuid, jsonb, text, timestamptz)', 'EXECUTE');` → **Expect:** `1` and `false`
- [ ] **Do:** `select indexname from pg_indexes where tablename = 'email_outbox';` → **Expect:** the four new indexes (`queued`, `sending`, `provider`, `failed_at`) next to TX-2's

## Known gaps / not-yet-testable

- The purge (AC18) and the health alert (AC19) are proven on the replica only; on prod they run on their schedule.
- A real crash mid-send can't be staged on prod; the replica proves a lost lease is claimed again, and the worker always sends with `Idempotency-Key = dedupe_key`, which Resend answers with the first send for 24 hours.
- No feature queues email yet: TX-4 onwards add the kinds. Until then only `ops_alert` goes through the queue.

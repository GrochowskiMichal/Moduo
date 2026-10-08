-- Probe for supabase/migrations/20261008233000_email_outbox_worker.sql (TX-3,
-- specs/transactional-email.md AC14–AC19). Run it on a throwaway Postgres 17
-- database that holds nothing else, in one psql session (LANG=C LC_ALL=C, or
-- the server refuses to start on macOS):
--
--   createdb -h /tmp -p 54331 -U postgres tx3_probe
--   psql -h /tmp -p 54331 -U postgres -d tx3_probe -v ON_ERROR_STOP=1 -q \
--     -f supabase/probes/email-outbox.stub.sql \
--     -f supabase/migrations/20261008160000_email_outbox.sql \
--     -f supabase/migrations/20261008233000_email_outbox_worker.sql \
--     -f supabase/migrations/20261008233000_email_outbox_worker.sql \
--     -f supabase/probes/email-outbox.probe.sql
--
-- The TX-3 migration runs twice on purpose: a re-run must change nothing (one
-- Vault secret, one trigger, three jobs). Every check stops the run with the
-- failing check's message. A clean run prints one PASS line per check and ends
-- with "ALL PASSED". Two workers claiming at once (FOR UPDATE SKIP LOCKED) needs
-- two sessions; the recipe is in docs/testing/t-maciej-tx-3-outbox-worker.md.

\set ON_ERROR_STOP 1
\set QUIET 1
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF;
  RAISE NOTICE 'PASS: %', msg;
END $$;

-- Raises unless the statement fails with the given SQLSTATE (or any, when null).
CREATE FUNCTION pg_temp.fails(stmt text, state text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF state IS NULL OR SQLSTATE = state THEN
      RAISE NOTICE 'PASS: % (%: %)', msg, SQLSTATE, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error %: %)', msg, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (no error)', msg;
END $$;

-- ===== Migration re-run is safe; one secret; jobs =====
SELECT pg_temp.ok((SELECT count(*) FROM vault.secrets WHERE name = 'email_worker_secret') = 1, 'migration applied twice: one Vault secret');
SELECT pg_temp.ok((SELECT secret FROM vault.secrets WHERE name = 'email_worker_secret') ~ '^[0-9a-f]{64}$', 'the secret is 64 lower-case hex characters (WORKER_SECRET_SHAPE in email-worker/handler.ts)');
SELECT pg_temp.ok((SELECT count(*) FROM cron.job) = 3, 'three email jobs');
SELECT pg_temp.ok((SELECT command FROM cron.job WHERE jobname = 'email-outbox-purge') = 'SELECT public.email_outbox__purge()', 'purge job now calls email_outbox__purge');
SELECT pg_temp.ok((SELECT schedule FROM cron.job WHERE jobname = 'email-outbox-worker') = '* * * * *', 'worker kick every minute');
SELECT pg_temp.ok((SELECT schedule FROM cron.job WHERE jobname = 'email-outbox-health') = '*/5 * * * *', 'health every 5 minutes');
SELECT pg_temp.ok((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.email_outbox'::regclass AND NOT tgisinternal) = 1, 'one kick trigger');

-- ===== Grants =====
-- Control: the stub hands a fresh public function to anon, as Supabase does, so
-- the checks below test the migration's revokes, not the stub.
CREATE FUNCTION public.probe_control() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SELECT pg_temp.ok(has_function_privilege('anon', 'public.probe_control()', 'EXECUTE'), 'control: anon can run a fresh public function in this stub');
DROP FUNCTION public.probe_control();
SELECT pg_temp.ok(bool_and(NOT has_function_privilege('anon', f, 'EXECUTE') AND NOT has_function_privilege('authenticated', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'every TX-3 function (14): service_role only')
FROM unnest(ARRAY[
  'public.email_enqueue(text, text, uuid, jsonb, text, timestamptz)', 'public.email_cancel(text)',
  'public.email_outbox__kick()', 'public.email_outbox__after_insert()', 'public.email_outbox__tick()',
  'public.email_outbox__authorize(text)', 'public.email_outbox__run_start(integer)', 'public.email_outbox__run_stop(uuid)',
  'public.email_outbox__claim(integer, integer)',
  'public.email_outbox__finish(uuid, text, text, text, timestamptz)', 'public.email_suppression__add(text, text, text)',
  'public.email_outbox__delivered(text, timestamptz)', 'public.email_outbox__health()', 'public.email_outbox__purge()'
]) AS f;
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.email_suppressions', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.email_suppressions', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.email_suppressions', 'SELECT')
  AND has_table_privilege('service_role', 'public.email_suppressions', 'INSERT'), 'email_suppressions: service_role only');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_suppressions'::regclass), 'email_suppressions has RLS on');

-- ===== authorize =====
SELECT pg_temp.ok(public.email_outbox__authorize((SELECT secret FROM vault.secrets WHERE name = 'email_worker_secret')), 'authorize: the Vault secret passes');
SELECT pg_temp.ok(NOT public.email_outbox__authorize(repeat('0', 64)), 'authorize: a wrong secret fails');
SELECT pg_temp.ok(NOT public.email_outbox__authorize('short'), 'authorize: a short secret fails');
SELECT pg_temp.ok(NOT public.email_outbox__authorize(NULL), 'authorize: no secret fails');

-- ===== enqueue + the insert kick (AC14) =====
TRUNCATE net.calls;
SELECT public.email_enqueue('ops_alert', ' Hello@Moduo.app ', NULL, '{"reason":"test"}', 't:1', NULL);
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 1, 'a due enqueue kicks the worker once');
SELECT pg_temp.ok((SELECT headers ->> 'x-email-worker-secret' FROM net.calls) = (SELECT secret FROM vault.secrets WHERE name = 'email_worker_secret'), 'the kick carries the Vault secret');
SELECT pg_temp.ok((SELECT url FROM net.calls) = 'https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/email-worker', 'the kick posts to email-worker');
SELECT pg_temp.ok((SELECT to_email FROM public.email_outbox WHERE dedupe_key = 't:1') = 'hello@moduo.app', 'the address is stored trimmed and lower-cased');
SELECT pg_temp.ok((SELECT stream FROM public.email_outbox WHERE dedupe_key = 't:1') = 'account', 'ops_alert is on the account stream');
SELECT pg_temp.ok(public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 't:1', NULL) = (SELECT id FROM public.email_outbox WHERE dedupe_key = 't:1'), 'a duplicate key returns the first row''s id');
SELECT pg_temp.ok((SELECT count(*) FROM public.email_outbox WHERE dedupe_key = 't:1') = 1, 'a duplicate key inserts once');
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 1, 'a duplicate key does not kick again');

TRUNCATE net.calls;
BEGIN;
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'tx:a', NULL);
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'tx:b', NULL);
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'tx:c', NULL);
COMMIT;
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 1, 'three due enqueues in one transaction kick once');

TRUNCATE net.calls;
SELECT public.email_enqueue('build_update', 'tom@becker.studio', NULL, '{}', 'future:1', now() + interval '1 hour');
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status) VALUES ('auth_code', 'tom@becker.studio', 'auth_code:x:0', 'sent');
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 0, 'a scheduled row and a sign-in log row do not kick');
SELECT pg_temp.ok((SELECT stream FROM public.email_outbox WHERE dedupe_key = 'future:1') = 'updates', 'build_update goes on the updates stream');

BEGIN;
DELETE FROM vault.secrets WHERE name = 'email_worker_secret';
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'nosecret:1', NULL);
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 0 AND public.email_outbox__kick() IS NULL, 'without the Vault secret the kick is a no-op and the enqueue still works');
ROLLBACK;

BEGIN;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'pg_net is down'; END $$;
SELECT pg_temp.ok(public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'netdown:1', NULL) IS NOT NULL, 'a failing kick never fails the enqueue');
ROLLBACK;

SELECT pg_temp.fails($$SELECT public.email_enqueue('auth_code', 'a@b.co', NULL, '{}', 'k', NULL)$$, '22023', 'auth_code is never queued');
SELECT pg_temp.fails($$SELECT public.email_enqueue('ops_alert', 'not an address', NULL, '{}', 'k', NULL)$$, '22023', 'an invalid address is refused');
SELECT pg_temp.fails($$SELECT public.email_enqueue('ops_alert', 'a@b.co', NULL, '{}', '  ', NULL)$$, '22023', 'an empty dedupe key is refused');
SELECT pg_temp.fails($$SELECT public.email_enqueue('nope', 'a@b.co', NULL, '{}', 'k', NULL)$$, '23514', 'an unknown kind fails the CHECK');
SELECT pg_temp.fails($$SELECT public.email_enqueue('ops_alert', 'a@b.co', NULL, '[]', 'k', NULL)$$, '23514', 'a non-object payload fails the CHECK');

-- ===== tick =====
TRUNCATE net.calls;
SELECT public.email_outbox__tick();
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 1, 'tick kicks when rows are due');

-- ===== claim / cancel (AC14, AC15) =====
DELETE FROM public.email_outbox;
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'c:1', now() - interval '1 second');
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'c:2', now() - interval '2 seconds');
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'c:3', now() + interval '10 minutes');
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'c:4x', now() - interval '3 seconds');
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'c:4y', now() + interval '1 day');
SELECT pg_temp.fails($$SELECT public.email_cancel('c:')$$, '22023', 'a cancel prefix under 3 characters is refused');
SELECT pg_temp.ok(public.email_cancel('c:4') = 2, 'email_cancel cancels every queued row with the prefix, due or scheduled');

CREATE TEMP TABLE claimed AS SELECT * FROM public.email_outbox__claim(10);
SELECT pg_temp.ok((SELECT array_agg(dedupe_key ORDER BY dedupe_key) FROM claimed) = ARRAY['c:1', 'c:2'], 'claim returns only due queued rows (not scheduled, not cancelled)');
SELECT pg_temp.ok((SELECT bool_and(attempts = 1) FROM claimed), 'claim counts the attempt');
SELECT pg_temp.ok((SELECT bool_and(status = 'sending' AND locked_until > now() + interval '290 seconds' AND last_attempt_at IS NOT NULL) FROM public.email_outbox WHERE dedupe_key IN ('c:1', 'c:2')), 'claimed rows are sending with a 5-minute lease');
SELECT pg_temp.ok((SELECT count(*) FROM public.email_outbox__claim(10)) = 0, 'a leased row is not claimed twice');
SELECT pg_temp.ok((SELECT status FROM public.email_outbox WHERE dedupe_key = 'c:4x') = 'cancelled', 'a cancelled row is never claimed');
SELECT pg_temp.ok(public.email_cancel('c:1') = 0, 'cancel does not recall a row already sending');
TRUNCATE net.calls;
SELECT public.email_outbox__tick();
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 0, 'tick stays quiet when nothing is due');
UPDATE public.email_outbox SET send_after = now() - interval '1 second' WHERE dedupe_key = 'c:3';
SELECT pg_temp.ok((SELECT array_agg(dedupe_key) FROM public.email_outbox__claim(10)) = ARRAY['c:3'], 'a scheduled row is claimed once its time comes (AC15)');

-- ===== finish (AC16) =====
SELECT pg_temp.ok(public.email_outbox__finish((SELECT id FROM public.email_outbox WHERE dedupe_key = 'c:1'), 'sent', 're_1') = 'sent', 'finish sent');
SELECT pg_temp.ok((SELECT provider_id = 're_1' AND sent_at IS NOT NULL AND locked_until IS NULL AND last_error IS NULL FROM public.email_outbox WHERE dedupe_key = 'c:1'), 'a sent row keeps Resend''s id and its time');
SELECT pg_temp.ok(public.email_outbox__finish((SELECT id FROM public.email_outbox WHERE dedupe_key = 'c:1'), 'sent', 're_9') IS NULL, 'finishing a row twice changes nothing');
SELECT pg_temp.ok((SELECT provider_id FROM public.email_outbox WHERE dedupe_key = 'c:1') = 're_1', 'the first outcome stands');
SELECT pg_temp.ok(public.email_outbox__finish((SELECT id FROM public.email_outbox WHERE dedupe_key = 'c:2'), 'retry', NULL, 'timeout', now() + interval '1 minute') = 'queued', 'a temporary failure goes back to the queue');
SELECT pg_temp.ok((SELECT send_after > now() + interval '50 seconds' AND last_error = 'timeout' FROM public.email_outbox WHERE dedupe_key = 'c:2'), 'a retry waits until its time and keeps the error');
SELECT pg_temp.fails($$SELECT public.email_outbox__finish(gen_random_uuid(), 'maybe')$$, '22023', 'an unknown outcome is refused');

DO $$
DECLARE
  v_id uuid := (SELECT id FROM public.email_outbox WHERE dedupe_key = 'c:2');
  v_status text;
  v_attempts int;
BEGIN
  FOR i IN 2..5 LOOP
    UPDATE public.email_outbox SET send_after = now() - interval '1 second' WHERE id = v_id;
    SELECT c.attempts INTO v_attempts FROM public.email_outbox__claim(10) c WHERE c.id = v_id;
    IF v_attempts <> i THEN RAISE EXCEPTION 'FAIL: attempt % claimed as %', i, v_attempts; END IF;
    v_status := public.email_outbox__finish(v_id, 'retry', NULL, 'resend_http_503', now() + interval '1 minute');
    IF i < 5 AND v_status <> 'queued' THEN RAISE EXCEPTION 'FAIL: attempt % ended %', i, v_status; END IF;
    IF i = 5 AND v_status <> 'failed' THEN RAISE EXCEPTION 'FAIL: attempt 5 ended %', v_status; END IF;
  END LOOP;
  RAISE NOTICE 'PASS: retried up to 5 attempts, then failed (AC16)';
END $$;

-- ===== a crashed run's lease =====
SELECT public.email_enqueue('ops_alert', 'hello@moduo.app', NULL, '{"reason":"test"}', 'l:1', NULL);
SELECT count(*) FROM public.email_outbox__claim(10);
UPDATE public.email_outbox SET locked_until = now() - interval '1 second' WHERE dedupe_key = 'l:1';
SELECT pg_temp.ok((SELECT c.attempts FROM public.email_outbox__claim(10) c WHERE c.dedupe_key = 'l:1') = 2, 'a row whose lease ended is claimed again (same dedupe key, so Resend sends it once)');
UPDATE public.email_outbox SET locked_until = now() - interval '1 second', attempts = 5 WHERE dedupe_key = 'l:1';
SELECT pg_temp.ok((SELECT c.attempts FROM public.email_outbox__claim(10) c WHERE c.dedupe_key = 'l:1') = 6, 'a row lost on its 5th attempt gets one more (idempotent) claim');
UPDATE public.email_outbox SET locked_until = now() - interval '1 second' WHERE dedupe_key = 'l:1';
SELECT pg_temp.ok((SELECT count(*) FROM public.email_outbox__claim(10)) = 0, 'a row lost again after that is not claimed');
SELECT pg_temp.ok((SELECT status = 'failed' AND last_error = 'worker_lost' FROM public.email_outbox WHERE dedupe_key = 'l:1'), 'it is marked failed (worker_lost)');

-- ===== suppressions (AC17) =====
SELECT pg_temp.ok(public.email_suppression__add(' Tom@Becker.Studio ', 'bounce', 'msg_1'), 'a hard bounce suppresses the address');
SELECT pg_temp.ok(NOT public.email_suppression__add('tom@becker.studio', 'complaint', 'msg_2'), 'suppressing again is a no-op');
SELECT pg_temp.ok((SELECT reason FROM public.email_suppressions WHERE email = 'tom@becker.studio') = 'bounce', 'the first reason stays');
SELECT pg_temp.fails($$SELECT public.email_suppression__add('nope', 'bounce', NULL)$$, '22023', 'an invalid address is refused');
SELECT pg_temp.fails($$SELECT public.email_suppression__add('x@y.co', 'spam', NULL)$$, '23514', 'an unknown reason fails the CHECK');
SELECT public.email_enqueue('ops_alert', 'tom@becker.studio', NULL, '{"reason":"test"}', 's:1', NULL);
SELECT pg_temp.ok((SELECT count(*) FROM public.email_outbox__claim(10) c WHERE c.dedupe_key = 's:1') = 0, 'a due email to a suppressed address is not claimed');
SELECT pg_temp.ok((SELECT status FROM public.email_outbox WHERE dedupe_key = 's:1') = 'suppressed', 'it is marked suppressed');

-- ===== delivered =====
SELECT pg_temp.ok(public.email_outbox__delivered('re_1', '2026-10-16T12:00:05Z') = 1, 'delivered stamps the row with that Resend id');
SELECT public.email_outbox__delivered('re_1', '2026-10-17T00:00:00Z');
SELECT pg_temp.ok((SELECT delivered_at FROM public.email_outbox WHERE dedupe_key = 'c:1') = '2026-10-16T12:00:05Z', 'the first delivery time stays');
SELECT pg_temp.ok(public.email_outbox__delivered('', NULL) = 0, 'an empty id stamps nothing');

-- ===== one run at a time =====
SELECT pg_temp.ok(public.email_outbox__run_start() IS NOT NULL, 'the first run takes the lease');
SELECT pg_temp.ok(public.email_outbox__run_start() IS NULL, 'a second run while it holds the lease gets nothing');
SELECT public.email_outbox__run_stop((SELECT token FROM public.email_outbox_runner));
SELECT pg_temp.ok(public.email_outbox__run_start() IS NOT NULL, 'after it stops, the next run takes the lease');
UPDATE public.email_outbox_runner SET locked_until = now() - interval '1 second';
SELECT pg_temp.ok(public.email_outbox__run_start() IS NOT NULL, 'a crashed run''s lease frees itself when it ends');
SELECT public.email_outbox__run_stop(gen_random_uuid());
SELECT pg_temp.ok((SELECT locked_until > now() FROM public.email_outbox_runner), 'a stale token can''t release another run''s lease');
SELECT public.email_outbox__run_stop((SELECT token FROM public.email_outbox_runner));
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.email_outbox_runner', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.email_outbox_runner', 'UPDATE'), 'the run lease is service_role only');

-- ===== health (AC19) =====
DELETE FROM public.email_outbox;
TRUNCATE net.calls;
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, last_attempt_at, last_error) VALUES
  ('welcome', 'a@b.co', 'h:1', 'failed', now() - interval '1 minute', 'Invalid `to` field: tom@becker.studio'),
  ('welcome', 'a@b.co', 'h:2', 'failed', now() - interval '2 minutes', 'resend_http_500'),
  ('welcome', 'a@b.co', 'h:old', 'failed', now() - interval '11 minutes', 'resend_http_500'),
  ('ops_alert', 'hello@moduo.app', 'h:alert-failed', 'failed', now() - interval '1 minute', 'resend_http_500');
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, attempts, last_attempt_at, last_error, send_after) VALUES
  ('welcome', 'a@b.co', 'h:blip', 'queued', 1, now() - interval '1 minute', 'resend_http_503', now() + interval '1 minute');
SELECT pg_temp.ok(public.email_outbox__health() IS NULL, 'two recent failures (plus an old one, a failed alert and a first-try blip) raise no alert');
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, last_attempt_at, last_error) VALUES
  ('welcome', 'a@b.co', 'h:3', 'failed', now() - interval '3 minutes', 'resend_http_500');
SELECT pg_temp.ok(public.email_outbox__health() IS NOT NULL, 'three failures in 10 minutes queue an alert');
SELECT pg_temp.ok((SELECT count(*) FROM public.email_outbox WHERE kind = 'ops_alert' AND status = 'queued') = 1, 'one alert, queued');
SELECT pg_temp.ok((SELECT to_email = 'hello@moduo.app' AND payload ->> 'reason' = 'failures' AND (payload ->> 'other_failed')::int = 3 AND (payload ->> 'auth_code_failed')::int = 0 FROM public.email_outbox WHERE kind = 'ops_alert' AND status = 'queued'), 'the alert goes to hello@ with the counts');
SELECT pg_temp.ok((SELECT payload -> 'errors' FROM public.email_outbox WHERE kind = 'ops_alert' AND status = 'queued') = '[{"count": 2, "error": "resend_http_500"}, {"count": 1, "error": "Invalid `to` field: [address]"}]'::jsonb, 'the commonest errors, addresses blanked');
SELECT pg_temp.ok((SELECT count(*) FROM net.calls) = 1, 'the alert kicks the worker');
SELECT pg_temp.ok(public.email_outbox__health() IS NULL, 'a second check within 30 minutes queues nothing');
UPDATE public.email_outbox SET created_at = now() - interval '31 minutes', dedupe_key = 'ops_alert:older' WHERE kind = 'ops_alert' AND status = 'queued';
SELECT pg_temp.ok(public.email_outbox__health() IS NOT NULL, 'after 30 minutes a still-failing system alerts again');

DELETE FROM public.email_outbox;
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, last_error) VALUES
  ('auth_code', 'tom@becker.studio', 'auth_code:w:0', 'failed', 'resend_http_500');
SELECT pg_temp.ok(public.email_outbox__health() IS NOT NULL, 'one failed sign-in code is enough for an alert');
SELECT pg_temp.ok((SELECT (payload ->> 'auth_code_failed')::int FROM public.email_outbox WHERE kind = 'ops_alert') = 1, 'the alert counts the sign-in code (before)');
DELETE FROM public.email_outbox;
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, attempts, last_attempt_at, last_error, send_after) VALUES
  ('welcome', 'a@b.co', 'r:1', 'queued', 2, now() - interval '1 minute', 'resend_http_503', now() + interval '4 minutes'),
  ('welcome', 'a@b.co', 'r:2', 'queued', 3, now() - interval '2 minutes', 'resend_http_503', now() + interval '13 minutes'),
  ('welcome', 'a@b.co', 'r:3', 'queued', 2, now() - interval '3 minutes', 'timeout', now() + interval '2 minutes');
SELECT pg_temp.ok(public.email_outbox__health() IS NOT NULL, 'three emails still retrying after failing twice raise an alert (an outage alerts in minutes)');
SELECT pg_temp.ok((SELECT (payload ->> 'other_failed')::int FROM public.email_outbox WHERE kind = 'ops_alert') = 3, 'retrying failures are counted');
DELETE FROM public.email_outbox;
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, last_error) VALUES
  ('auth_code', 'tom@becker.studio', 'auth_code:w:0', 'failed', 'resend_http_500');
SELECT public.email_outbox__health();
SELECT pg_temp.ok((SELECT (payload ->> 'auth_code_failed')::int FROM public.email_outbox WHERE kind = 'ops_alert') = 1, 'the alert counts the sign-in code');

-- ===== purge (AC18) =====
DELETE FROM public.email_outbox;
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.email_outbox (kind, to_email, dedupe_key, status, created_at, sent_at, last_attempt_at, send_after, to_user_id) VALUES
  ('welcome', 'a@b.co', 'p:sent-31d', 'sent', now() - interval '31 days', now() - interval '31 days', now() - interval '31 days', now() - interval '31 days', NULL),
  ('welcome', 'a@b.co', 'p:sent-29d', 'sent', now() - interval '29 days', now() - interval '29 days', now() - interval '29 days', now() - interval '29 days', NULL),
  ('welcome', 'a@b.co', 'p:queued-old', 'queued', now() - interval '40 days', NULL, NULL, now() + interval '30 days', NULL),
  ('welcome', 'a@b.co', 'p:sent-late', 'sent', now() - interval '45 days', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', NULL),
  ('welcome', 'a@b.co', 'p:failed-31d', 'failed', now() - interval '35 days', NULL, now() - interval '31 days', now() - interval '35 days', NULL),
  ('welcome', 'a@b.co', 'p:gone-user', 'sent', now() - interval '2 hours', now() - interval '2 hours', NULL, now() - interval '2 hours', '00000000-0000-0000-0000-0000000000b2'),
  ('welcome', 'a@b.co', 'p:gone-user-queued', 'queued', now() - interval '2 hours', NULL, NULL, now() + interval '5 days', '00000000-0000-0000-0000-0000000000b2'),
  ('welcome', 'a@b.co', 'p:gone-user-fresh', 'sent', now() - interval '10 minutes', now() - interval '10 minutes', NULL, now() - interval '10 minutes', '00000000-0000-0000-0000-0000000000b2'),
  ('welcome', 'a@b.co', 'p:live-user', 'sent', now() - interval '2 hours', now() - interval '2 hours', NULL, now() - interval '2 hours', '00000000-0000-0000-0000-0000000000a1'),
  ('auth_code', 'a@b.co', 'p:auth-failed-new-user', 'failed', now() - interval '2 hours', NULL, NULL, now() - interval '2 hours', NULL);
SELECT pg_temp.ok(public.email_outbox__purge() = 4, 'purge deletes 4 rows');
SELECT pg_temp.ok((SELECT array_agg(dedupe_key ORDER BY dedupe_key) FROM public.email_outbox) = ARRAY['p:auth-failed-new-user', 'p:gone-user-fresh', 'p:live-user', 'p:queued-old', 'p:sent-29d', 'p:sent-late'],
  'kept: sent < 30 days ago, still queued, a deleted account''s row inside the hour, a live account''s, a new user''s failed code');

SELECT 'ALL PASSED' AS result;

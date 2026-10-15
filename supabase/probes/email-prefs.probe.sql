-- Probe for supabase/migrations/20261015153000_tx8_email_preferences.sql (TX-8,
-- specs/transactional-email.md AC40–AC42). Runs on the local stack
-- (docs/local-dev.md) after `bun run local:reset` has applied the migration.
-- One transaction, rolled back at the end, so it leaves nothing behind:
--
--   psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -q -f supabase/probes/email-prefs.probe.sql
--
-- Every check stops the run with its message on failure. A clean run prints one
-- PASS line per check and ends with "ALL PASSED". Queued rows kick the worker
-- through pg_net, which only sends after commit, so the rollback sends nothing.
-- AC43 (erasure + A2 on account deletion) is delete-account's, tested in
-- supabase/functions/_shared/account-erasure.test.ts.

\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = notice;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.headers', '{}', true);

CREATE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF;
  RAISE NOTICE 'PASS: %', msg;
END $$;

CREATE FUNCTION pg_temp.id(name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('email-prefs-probe:' || name)::uuid
$$;

-- Runs one statement as a signed-in user (authenticated role, through PostgREST's
-- claims) and returns 'ok' or '<sqlstate> <message>'.
CREATE FUNCTION pg_temp.as_user(who text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_msg text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN coalesce(v_state || ' ' || v_msg, 'ok');
END $$;

CREATE FUNCTION pg_temp.prefs(who text) RETURNS TABLE (bookings boolean, trial_billing boolean, build_updates boolean)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(who), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  RETURN QUERY SELECT * FROM public.email_prefs();
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
END $$;

CREATE FUNCTION pg_temp.queue(kind text, who text, key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT public.email_enqueue(kind, 'email-prefs-' || lower(who) || '@example.com',
    CASE WHEN who = '-' THEN NULL ELSE pg_temp.id(who) END, '{}'::jsonb, 'probe:' || key, now())
$$;

CREATE FUNCTION pg_temp.status_of(key text) RETURNS text LANGUAGE sql AS $$
  SELECT o.status FROM public.email_outbox o WHERE o.dedupe_key = 'probe:' || key
$$;

-- Two confirmed accounts (A, B) and one whose address isn't confirmed (U).
INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', pg_temp.id(n), 'authenticated', 'authenticated',
       'email-prefs-' || lower(n) || '@example.com',
       CASE WHEN n = 'U' THEN NULL ELSE now() END, now(), now()
FROM unnest(ARRAY['A', 'B', 'U']) AS n;

-- Nothing else in the queue may be due, so each claim below sees only the probe's rows.
UPDATE public.email_outbox o SET send_after = now() + interval '1 day'
 WHERE o.status = 'queued' AND o.send_after <= now();

-- ── Access ────────────────────────────────────────────────────────────────────

SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.email_preferences', 'SELECT')
                  AND NOT has_table_privilege('anon', 'public.email_preferences', 'SELECT')
                  AND NOT has_table_privilege('authenticated', 'public.email_preferences', 'INSERT'),
  'email_preferences: no direct table access for clients');
SELECT pg_temp.ok(
  NOT has_function_privilege('anon', 'public.email_prefs()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.email_prefs_set(boolean, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.email_build_updates_set(boolean)', 'EXECUTE'),
  'anon cannot call the email settings functions');
SELECT pg_temp.ok(
  has_function_privilege('authenticated', 'public.email_prefs()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.email_prefs_set(boolean, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.email_build_updates_set(boolean)', 'EXECUTE'),
  'signed-in users can call the email settings functions');
SELECT pg_temp.ok(
  NOT has_function_privilege('authenticated', 'public.email_outbox__claim(integer, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.email_outbox__claim(integer, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.email_outbox__claim(integer, integer)', 'EXECUTE'),
  'the claim stays service role only');
SELECT pg_temp.ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     FROM pg_proc p WHERE p.oid = 'public.email_build_updates_set(boolean)'::regprocedure),
  'email_build_updates_set is SECURITY DEFINER with an empty search_path');

-- Signed out: refused.
DO $$
DECLARE r text;
BEGIN
  BEGIN
    PERFORM * FROM public.email_prefs();
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE;
  END;
  PERFORM pg_temp.ok(r = '42501', 'email_prefs refuses a caller who is not signed in');
END $$;

-- An API key (the MCP connector: service_role + x-moduo-key-id) can't change them.
DO $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('A'), 'role', 'service_role')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', pg_temp.id('key'))::text, true);
  BEGIN
    PERFORM * FROM public.email_prefs_set(false, NULL);
    r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := SQLSTATE;
  END;
  PERFORM set_config('request.headers', '{}', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM pg_temp.ok(r = '42501', 'an API key cannot change email settings');
END $$;

-- ── AC40: defaults and partial writes ─────────────────────────────────────────

SELECT pg_temp.ok((SELECT bookings AND trial_billing AND NOT build_updates FROM pg_temp.prefs('A')),
  'AC40: with no row, Bookings and Trial are on and Build updates is off');

SELECT pg_temp.ok(pg_temp.as_user('A', 'SELECT * FROM public.email_prefs_set(p_bookings => false)') = 'ok',
  'A turns Bookings off');
SELECT pg_temp.ok((SELECT NOT bookings AND trial_billing FROM pg_temp.prefs('A')),
  'AC40: Bookings off, Trial untouched');
SELECT pg_temp.ok(pg_temp.as_user('A', 'SELECT * FROM public.email_prefs_set(p_trial_billing => false)') = 'ok',
  'A turns Trial and billing off');
SELECT pg_temp.ok((SELECT NOT bookings AND NOT trial_billing FROM pg_temp.prefs('A')),
  'AC40: a write that names one switch never resets the other');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.email_preferences WHERE user_id = pg_temp.id('A')),
  'one row per person');
SELECT pg_temp.ok((SELECT bookings AND trial_billing FROM pg_temp.prefs('B')),
  'B''s switches are their own (still on)');

-- ── AC41: the worker's filter ─────────────────────────────────────────────────

SELECT pg_temp.queue('booking_host_new', 'A', 'a-c3');
SELECT pg_temp.queue('booking_host_guest_cancelled', 'A', 'a-c4');
SELECT pg_temp.queue('trial_ending', 'A', 'a-d2');
SELECT pg_temp.queue('trial_ended', 'A', 'a-d3');
SELECT pg_temp.queue('founder_access_ending', 'A', 'a-d5');
SELECT pg_temp.queue('booking_guest_confirmed', 'A', 'a-c1');   -- always sends
SELECT pg_temp.queue('waitlist_invite', 'A', 'a-b1');           -- always sends
SELECT pg_temp.queue('founder_access', 'A', 'a-d4');            -- always sends
SELECT pg_temp.queue('booking_host_new', 'B', 'b-c3');          -- B has defaults
SELECT pg_temp.queue('booking_host_new', '-', 'none-c3');       -- no account id

SET LOCAL ROLE service_role;
SELECT count(*) FROM public.email_outbox__claim(50, 300);
RESET ROLE;

SELECT pg_temp.ok(pg_temp.status_of('a-c3') = 'skipped_pref' AND pg_temp.status_of('a-c4') = 'skipped_pref',
  'AC41: Bookings off skips C3 and C4');
SELECT pg_temp.ok(pg_temp.status_of('a-d2') = 'skipped_pref' AND pg_temp.status_of('a-d3') = 'skipped_pref'
                  AND pg_temp.status_of('a-d5') = 'skipped_pref',
  'AC41: Trial and billing off skips D2, D3 and D5');
SELECT pg_temp.ok(pg_temp.status_of('a-c1') = 'sending' AND pg_temp.status_of('a-b1') = 'sending'
                  AND pg_temp.status_of('a-d4') = 'sending',
  'AC41: always-send kinds ignore the switches');
SELECT pg_temp.ok(pg_temp.status_of('b-c3') = 'sending',
  'AC41: an account without a row gets C3 (default on)');
SELECT pg_temp.ok(pg_temp.status_of('none-c3') = 'sending',
  'a row with no account id is never filtered');
SELECT pg_temp.ok((SELECT locked_until IS NULL FROM public.email_outbox WHERE dedupe_key = 'probe:a-c3'),
  'a skipped row holds no lease');

-- A switch turned back on applies to the next due row.
SELECT pg_temp.as_user('A', 'SELECT * FROM public.email_prefs_set(true, true)');
SELECT pg_temp.queue('booking_host_new', 'A', 'a-c3-again');
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.email_outbox__claim(50, 300);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.status_of('a-c3-again') = 'sending',
  'Bookings back on: the next C3 is claimed');

-- A queued row whose lease ran out is filtered too (it isn't sent again).
SELECT pg_temp.as_user('A', 'SELECT * FROM public.email_prefs_set(p_bookings => false)');
UPDATE public.email_outbox SET locked_until = now() - interval '1 minute'
 WHERE dedupe_key = 'probe:a-c3-again';
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.email_outbox__claim(50, 300);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.status_of('a-c3-again') = 'skipped_pref',
  'a lost lease on a switched-off kind ends as skipped_pref');

-- Suppression still wins (a suppressed address is 'suppressed', not 'skipped_pref').
INSERT INTO public.email_suppressions (email, reason) VALUES ('email-prefs-a@example.com', 'manual');
SELECT pg_temp.queue('trial_ending', 'A', 'a-d2-suppressed');
SET LOCAL ROLE service_role;
SELECT count(*) FROM public.email_outbox__claim(50, 300);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.status_of('a-d2-suppressed') = 'suppressed',
  'a suppressed address stays suppressed');
DELETE FROM public.email_suppressions WHERE email = 'email-prefs-a@example.com';

-- ── AC42: Build updates ───────────────────────────────────────────────────────

SELECT pg_temp.ok(pg_temp.as_user('A', 'SELECT public.email_build_updates_set(true)') = 'ok',
  'A turns Build updates on');
SELECT pg_temp.ok(
  (SELECT s.status = 'subscribed' AND s.source = 'settings' AND s.user_id = pg_temp.id('A')
          AND s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL
     FROM public.email_subscriptions s WHERE s.email = 'email-prefs-a@example.com'),
  'AC42: on subscribes the account address at once');
SELECT pg_temp.ok((SELECT build_updates FROM pg_temp.prefs('A')), 'email_prefs reads Build updates on');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.email_outbox o
                               WHERE o.to_email = 'email-prefs-a@example.com' AND o.kind = 'updates_confirm'),
  'AC42: no confirmation email is queued');

SELECT pg_temp.ok(pg_temp.as_user('A', 'SELECT public.email_build_updates_set(false)') = 'ok',
  'A turns Build updates off');
SELECT pg_temp.ok(
  (SELECT s.status = 'unsubscribed' AND s.unsubscribed_at IS NOT NULL
     FROM public.email_subscriptions s WHERE s.email = 'email-prefs-a@example.com'),
  'AC42: off unsubscribes');
SELECT pg_temp.ok((SELECT NOT build_updates FROM pg_temp.prefs('A')), 'email_prefs reads Build updates off');

-- A pending waitlist request (TX-4) reads as off, and turning it on keeps its source.
INSERT INTO public.email_subscriptions (email, topic, status, user_id, source, requested_at)
VALUES ('email-prefs-b@example.com', 'build_updates', 'pending', pg_temp.id('B'), 'waitlist', now() - interval '3 days');
SELECT pg_temp.ok((SELECT NOT build_updates FROM pg_temp.prefs('B')), 'a pending waitlist request reads as off');
SELECT pg_temp.as_user('B', 'SELECT public.email_build_updates_set(true)');
SELECT pg_temp.ok(
  (SELECT s.status = 'subscribed' AND s.source = 'waitlist' AND s.confirmed_at IS NOT NULL
     FROM public.email_subscriptions s WHERE s.email = 'email-prefs-b@example.com'),
  'turning it on confirms the pending row and keeps its source');

-- Off with no row does nothing.
DELETE FROM public.email_subscriptions WHERE email = 'email-prefs-a@example.com';
SELECT pg_temp.as_user('A', 'SELECT public.email_build_updates_set(false)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.email_subscriptions WHERE email = 'email-prefs-a@example.com'),
  'off with no subscription creates nothing');

-- An unconfirmed address can't be subscribed.
SELECT pg_temp.ok(pg_temp.as_user('U', 'SELECT public.email_build_updates_set(true)') LIKE '22023 %',
  'an unconfirmed address is refused');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.email_subscriptions WHERE email = 'email-prefs-u@example.com'),
  'and nothing is subscribed for it');

-- ── Deletion: the preferences go with the account (AC43's DB half) ────────────

DELETE FROM auth.users WHERE id = pg_temp.id('A');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.email_preferences WHERE user_id = pg_temp.id('A')),
  'AC43: email_preferences goes with the auth user (FK cascade)');

DO $$ BEGIN RAISE NOTICE 'ALL PASSED'; END $$;
ROLLBACK;

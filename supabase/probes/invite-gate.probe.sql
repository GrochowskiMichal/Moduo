-- Probe for supabase/migrations/20261010150000_tx4_invite_only_gate.sql (TX-4,
-- specs/transactional-email.md AC20–AC23). Runs on the local stack
-- (docs/local-dev.md) after the migration is applied there (`bun run
-- local:reset` applies repo migrations newer than the snapshot). One
-- transaction, rolled back at the end, so it leaves nothing behind:
--
--   psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -q -f supabase/probes/invite-gate.probe.sql
--
-- Every check stops the run with its message on failure. A clean run prints one
-- PASS line per check and ends with "ALL PASSED". Queued B1 rows kick the
-- worker through pg_net, which only sends after commit, so the rollback sends
-- nothing. Whether Auth itself calls the hook for an OTP sign-up is checked
-- against a real Auth server: docs/testing/t-maciej-tx-4-invite-only-gate.md.

\set ON_ERROR_STOP 1
\set QUIET 1
BEGIN;
SET LOCAL client_min_messages = notice;

CREATE FUNCTION pg_temp.ok(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF;
  RAISE NOTICE 'PASS: %', msg;
END $$;

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

CREATE FUNCTION pg_temp.hook(email text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.hook_before_user_created(jsonb_build_object(
    'metadata', jsonb_build_object('name', 'before-user-created'),
    'user', jsonb_build_object('email', email)))
$$;

CREATE FUNCTION pg_temp.b1_rows(addr text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.email_outbox o WHERE o.kind = 'waitlist_invite' AND o.to_email = addr
$$;

CREATE FUNCTION pg_temp.new_user(addr text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', addr, '{}', now(), now());
  RETURN v_id;
END $$;

-- A clean slate for the addresses used here.
DELETE FROM public.waitlist WHERE email LIKE '%@probe.test';
DELETE FROM public.email_outbox WHERE to_email LIKE '%@probe.test';
DELETE FROM public.email_suppressions WHERE email LIKE '%@probe.test';

-- ---------------------------------------------------------------------------
-- The gate (AC20)
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok(
  pg_temp.hook('stranger@probe.test') = '{"error": {"message": "invite_only", "http_code": 403}}'::jsonb,
  'an address nobody invited is refused with invite_only / 403');
SELECT pg_temp.ok(pg_temp.hook('') ? 'error', 'no email (phone, anonymous) is refused');
SELECT pg_temp.ok((public.hook_before_user_created('{}'::jsonb)) ? 'error', 'an event without a user is refused');

INSERT INTO public.waitlist (email, source, created_at) VALUES
  ('pending@probe.test', 'hero', now() - interval '3 days');
SELECT pg_temp.ok(pg_temp.hook('pending@probe.test') ? 'error', 'a pending waitlist row does not let anyone in');

UPDATE public.waitlist SET status = 'invited' WHERE email = 'pending@probe.test';
SELECT pg_temp.ok(pg_temp.hook('pending@probe.test') = '{}'::jsonb, 'an invited waitlist row lets that address in');
SELECT pg_temp.ok(pg_temp.hook('  Pending@PROBE.test ') = '{}'::jsonb, 'the match ignores case and outer spaces');

-- Workspace invites. Set-up only: skip FKs and the invite validator.
SET LOCAL session_replication_role = replica;
INSERT INTO public.workspace_invites (workspace_id, email, status, expires_at) VALUES
  (gen_random_uuid(), 'Ws.Pending@probe.test', 'pending', now() + interval '7 days'),
  (gen_random_uuid(), 'ws.expired@probe.test', 'pending', now() - interval '1 minute'),
  (gen_random_uuid(), 'ws.revoked@probe.test', 'revoked', now() + interval '7 days'),
  (gen_random_uuid(), 'ws.accepted@probe.test', 'accepted', now() + interval '7 days');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.ok(pg_temp.hook('ws.pending@probe.test') = '{}'::jsonb, 'a pending, unexpired workspace invite lets that address in');
SELECT pg_temp.ok(pg_temp.hook('ws.expired@probe.test') ? 'error', 'an expired workspace invite does not');
SELECT pg_temp.ok(pg_temp.hook('ws.revoked@probe.test') ? 'error', 'a revoked workspace invite does not');
SELECT pg_temp.ok(pg_temp.hook('ws.accepted@probe.test') ? 'error', 'an accepted workspace invite does not');

INSERT INTO public.founder_emails (email, note) VALUES ('founder@probe.test', 'probe');
SELECT pg_temp.ok(pg_temp.hook('founder@probe.test') = '{}'::jsonb, 'a founder address is let in');

-- Who may call it.
SELECT pg_temp.ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'EXECUTE'),
  'Auth (supabase_auth_admin) may call the hook');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'EXECUTE'),
  'anon and authenticated may not call the hook (it would reveal who is invited)');
SET LOCAL ROLE supabase_auth_admin;
SELECT pg_temp.ok(pg_temp.hook('pending@probe.test') = '{}'::jsonb, 'the hook reads its sources when Auth calls it');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- B1 once per invite (AC21)
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok(pg_temp.b1_rows('pending@probe.test') = 1, 'setting status invited queued one B1');
SELECT pg_temp.ok((SELECT invited_at IS NOT NULL FROM public.waitlist WHERE email = 'pending@probe.test'), 'invited_at fills itself');
SELECT pg_temp.ok((
  SELECT o.payload = jsonb_build_object('email', 'pending@probe.test', 'joined_at',
           to_char(w.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'manual', false)
     AND o.stream = 'account' AND o.status = 'queued' AND o.to_user_id IS NULL
     AND o.dedupe_key LIKE 'B1:' || w.id || ':%'
    FROM public.email_outbox o JOIN public.waitlist w ON w.email = o.to_email
   WHERE o.to_email = 'pending@probe.test'), 'the B1 row carries the address and the join date, keyed to the row');

UPDATE public.waitlist SET status = 'invited' WHERE email = 'pending@probe.test';
UPDATE public.waitlist SET user_agent = 'edited' WHERE email = 'pending@probe.test';
SELECT pg_temp.ok(pg_temp.b1_rows('pending@probe.test') = 1, 'saving an invited row again sends nothing more');

-- invite_next: oldest pending first, skipping suppressed addresses and existing users.
INSERT INTO public.waitlist (email, source, created_at) VALUES
  ('first@probe.test', 'hero', now() - interval '30 days'),
  ('bounced@probe.test', 'hero', now() - interval '29 days'),
  ('member@probe.test', 'hero', now() - interval '28 days'),
  ('second@probe.test', 'nav', now() - interval '27 days'),
  ('third@probe.test', 'footer', now() - interval '26 days');
INSERT INTO public.email_suppressions (email, reason) VALUES ('bounced@probe.test', 'bounce');
SELECT pg_temp.new_user('member@probe.test');
-- The new member's own row went at sign-up; put it back to test the skip.
INSERT INTO public.waitlist (email, source, created_at) VALUES ('member@probe.test', 'hero', now() - interval '28 days');

-- Older local rows would be picked first; park them for the test.
CREATE TEMP TABLE parked AS SELECT id FROM public.waitlist WHERE status = 'pending' AND email NOT LIKE '%@probe.test';
UPDATE public.waitlist SET status = 'cancelled' WHERE id IN (SELECT id FROM parked);

SELECT pg_temp.ok(
  (SELECT array_agg(address ORDER BY address) FROM public.waitlist_invite_next(2)) = ARRAY['first@probe.test', 'second@probe.test'],
  'invite_next(2) invites the two oldest pending rows that can get email');
SELECT pg_temp.ok((SELECT status FROM public.waitlist WHERE email = 'bounced@probe.test') = 'pending'
  AND (SELECT status FROM public.waitlist WHERE email = 'member@probe.test') = 'pending',
  'a suppressed address and an existing user stay pending');
SELECT pg_temp.ok(pg_temp.b1_rows('first@probe.test') = 1 AND pg_temp.b1_rows('second@probe.test') = 1
  AND pg_temp.b1_rows('third@probe.test') = 0, 'each invited row got one B1, the rest none');
SELECT pg_temp.fails($$SELECT * FROM public.waitlist_invite_next(0)$$, '22023', 'invite_next(0) is refused');
SELECT pg_temp.ok(public.waitlist_invite_email('third@probe.test') = 'invited' AND pg_temp.b1_rows('third@probe.test') = 1,
  'invite_email on a pending row invites it');

INSERT INTO public.waitlist (email, source, created_at)
SELECT 'bulk' || g || '@probe.test', 'hero', now() - interval '1 day' + g * interval '1 second'
  FROM generate_series(1, 55) g;
SELECT pg_temp.ok((SELECT count(*) FROM public.waitlist_invite_next(60)) = 50, 'invite_next caps a call at 50');

-- invite_email
SELECT pg_temp.ok(public.waitlist_invite_email(' New.Person@Probe.test ') = 'invited', 'invite_email invites an address not on the list');
SELECT pg_temp.ok((SELECT source = 'manual' AND status = 'invited' FROM public.waitlist WHERE email = 'new.person@probe.test'),
  'it is added as source manual');
SELECT pg_temp.ok((SELECT (payload ->> 'manual')::boolean FROM public.email_outbox WHERE to_email = 'new.person@probe.test'),
  'its B1 knows it was a manual invite');
SELECT pg_temp.ok(public.waitlist_invite_email('new.person@probe.test') = 'already_invited'
  AND pg_temp.b1_rows('new.person@probe.test') = 1, 'inviting it again sends nothing and says so');
SELECT pg_temp.ok(public.waitlist_invite_email('bounced@probe.test') = 'suppressed'
  AND pg_temp.b1_rows('bounced@probe.test') = 0, 'a suppressed address is refused');
SELECT pg_temp.ok(public.waitlist_invite_email('member@probe.test') = 'already_a_user', 'an existing user is refused');
SELECT pg_temp.fails($$SELECT public.waitlist_invite_email('not an address')$$, '22023', 'a malformed address is refused');

-- resend
SELECT pg_temp.ok(public.waitlist_resend_invite('first@probe.test') = 'already_queued'
  AND pg_temp.b1_rows('first@probe.test') = 1, 'resend while the first B1 is still queued sends nothing more');
UPDATE public.email_outbox SET status = 'sent', sent_at = now() WHERE to_email = 'first@probe.test';
SELECT pg_temp.ok(public.waitlist_resend_invite('First@probe.test') = 'queued'
  AND pg_temp.b1_rows('first@probe.test') = 2, 'resend after it went out queues it again');
SELECT pg_temp.ok((SELECT count(DISTINCT dedupe_key) FROM public.email_outbox WHERE to_email = 'first@probe.test') = 2,
  'with a new dedupe key');
SELECT pg_temp.ok(public.waitlist_resend_invite('bulk52@probe.test') = 'not_invited', 'resend to a pending row is refused');
SELECT pg_temp.ok(public.waitlist_resend_invite('nobody@probe.test') = 'not_invited', 'resend to an unknown address is refused');

-- Leaving and re-entering invited is a new invite.
UPDATE public.waitlist SET status = 'pending' WHERE email = 'second@probe.test';
SELECT pg_temp.ok((SELECT invited_at IS NULL FROM public.waitlist WHERE email = 'second@probe.test'), 'back to pending clears invited_at');
UPDATE public.waitlist SET status = 'invited' WHERE email = 'second@probe.test';
SELECT pg_temp.ok(pg_temp.b1_rows('second@probe.test') = 2, 'inviting it again is a new B1');

-- Who may call the helpers.
SELECT pg_temp.ok(
  NOT has_function_privilege('anon', 'public.waitlist_invite_next(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.waitlist_invite_email(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.waitlist_resend_invite(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.waitlist__queue_invite(uuid, text, text, timestamptz, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.waitlist_invite_next(integer)', 'EXECUTE'),
  'the helpers are service-role only');
SELECT pg_temp.ok(NOT has_table_privilege('anon', 'public.email_subscriptions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.email_subscriptions', 'SELECT'),
  'email_subscriptions is closed to clients');

-- ---------------------------------------------------------------------------
-- Sign-up deletes the row, keeps a build-updates request (AC22)
-- ---------------------------------------------------------------------------

UPDATE public.waitlist SET updates_requested = true, updates_requested_at = now() - interval '2 days'
 WHERE email = 'pending@probe.test';
SELECT pg_temp.new_user('pending@probe.test') AS keen \gset
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.waitlist WHERE email = 'pending@probe.test'), 'sign-up deletes the waitlist row');
SELECT pg_temp.ok((
  SELECT s.status = 'pending' AND s.source = 'waitlist' AND s.topic = 'build_updates' AND s.user_id = :'keen'::uuid
         AND s.requested_at < now() - interval '1 day'
    FROM public.email_subscriptions s WHERE s.email = 'pending@probe.test'),
  'the build-updates request moves to email_subscriptions as pending, with its date');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.profiles WHERE id = :'keen'::uuid), 'the profile is still created');

SELECT pg_temp.new_user('THIRD@probe.test') AS plain \gset
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.waitlist WHERE email = 'third@probe.test')
  AND NOT EXISTS (SELECT 1 FROM public.email_subscriptions WHERE email = 'third@probe.test'),
  'without a request, the row goes and nothing is subscribed');

DELETE FROM auth.users WHERE id = :'keen'::uuid;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.email_subscriptions WHERE email = 'pending@probe.test'),
  'deleting the account deletes its subscription row');

-- ---------------------------------------------------------------------------
-- 12-month purge (AC23)
-- ---------------------------------------------------------------------------

UPDATE public.waitlist SET invited_at = now() - interval '12 months 1 day' WHERE email = 'second@probe.test';
UPDATE public.waitlist SET invited_at = now() - interval '11 months' WHERE email = 'first@probe.test';
UPDATE public.waitlist SET created_at = now() - interval '2 years' WHERE email = 'bulk55@probe.test';
SELECT pg_temp.ok(public.waitlist__purge() >= 1, 'the purge deletes something');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.waitlist WHERE email = 'second@probe.test'), 'an invite unused for 12 months is deleted');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.waitlist WHERE email = 'first@probe.test'), 'an 11-month-old invite stays');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.waitlist WHERE email = 'bulk55@probe.test'), 'an old pending row stays');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waitlist-purge' AND schedule = '29 3 * * *'), 'the purge runs daily');

SELECT 'ALL PASSED' AS result;
ROLLBACK;

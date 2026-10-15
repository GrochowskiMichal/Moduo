-- TX-9a · Welcome and trial emails (specs/transactional-email.md AC44–AC46;
-- supabase/migrations/20261015173736_tx9a_welcome_trial.sql).
--
--   bun run db:test trial_emails
--
-- Trials are driven the way prod drives them: a row in the Stripe mirror
-- (stripe.subscriptions) → sync_entitlement → recompute_entitlement → profiles.
-- Cast: U starts a trial and makes their first workspace; L makes theirs before
-- the trial is mirrored; E had a workspace before TX-9a; N is a founder; C has
-- a card on file; P's trial ends later; D's trial ends by deleting the
-- account; Q pays; V's subscription disappears. Queued emails kick the worker
-- through pg_net, which only sends after commit, so the rollback sends nothing.

SELECT test.person(n) FROM unnest(ARRAY['U', 'L', 'E', 'N', 'C', 'P', 'D', 'Q', 'V', 'K', 'B', 'G']) AS n;
UPDATE public.profiles SET display_name = 'Tom Becker' WHERE id = test.id('U');
INSERT INTO public.user_preferences (user_id, time_zone) VALUES (test.id('U'), 'Europe/Warsaw')
ON CONFLICT (user_id) DO UPDATE SET time_zone = excluded.time_zone;

INSERT INTO stripe.accounts (_raw_data) VALUES ('{"id": "acct_dbtest"}') ON CONFLICT DO NOTHING;
INSERT INTO stripe.prices (_raw_data, _account_id)
VALUES ('{"id": "price_dbtest_pro", "metadata": {"plan_tier": "pro"}}', 'acct_dbtest') ON CONFLICT DO NOTHING;

-- A subscription for p_who in the mirror (insert or replace), as the sync engine writes it.
CREATE FUNCTION test.sub(p_who text, p_status text, p_end timestamptz, p_extra jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_raw jsonb := jsonb_build_object(
    'id', 'sub_dbtest_' || lower(p_who),
    'customer', 'cus_dbtest_' || lower(p_who),
    'status', p_status,
    'created', extract(epoch FROM now())::bigint,
    'trial_end', floor(extract(epoch FROM p_end))::bigint,
    'trial_start', floor(extract(epoch FROM p_end - interval '14 days'))::bigint,
    'current_period_end', floor(extract(epoch FROM p_end))::bigint,
    'metadata', jsonb_build_object('supabase_user_id', test.id(p_who)),
    'items', '{"data": [{"price": {"id": "price_dbtest_pro"}}]}'::jsonb
  ) || p_extra;
BEGIN
  INSERT INTO stripe.subscriptions (_raw_data, _account_id) VALUES (v_raw, 'acct_dbtest')
  ON CONFLICT (id) DO UPDATE SET _raw_data = excluded._raw_data;
END;
$$;
CREATE FUNCTION test.outbox(p_key text) RETURNS public.email_outbox LANGUAGE sql STABLE AS $$
  SELECT * FROM public.email_outbox WHERE dedupe_key = p_key
$$;
CREATE FUNCTION test.mails(p_kind text, p_who text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.email_outbox WHERE kind = p_kind AND to_user_id = test.id(p_who)
$$;
CREATE FUNCTION test.day(p_at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
$$;
CREATE FUNCTION test.iso(p_at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- ── setup checks ─────────────────────────────────────────────────────────────

SELECT test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-trial-ending' AND schedule = '41 * * * *'),
  'the D2 sweep runs hourly');
SELECT test.ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspaces_enqueue_welcome'
                        AND tgrelid = 'public.workspaces'::regclass),
  'workspaces carry the welcome trigger');

SELECT test.sub('U', 'trialing', now() + interval '14 days');
SELECT test.ok((SELECT subscription_status = 'trialing' AND plan_tier::text = 'pro' FROM public.profiles WHERE id = test.id('U')),
  'a mirrored trial puts the profile on a Pro trial (the path every trial email reads)');

-- ── AC44 · D1 once, 5 minutes after the first workspace ──────────────────────

INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WU'), test.id('U'), 'Northwind Studio');
SELECT test.ok(test.mails('welcome', 'U') = 1, 'the first workspace queues one welcome');
SELECT test.ok((test.outbox('D1:' || test.id('U'))).send_after = now() + interval '5 minutes',
  'D1 waits 5 minutes');
SELECT test.ok((test.outbox('D1:' || test.id('U'))).to_email = 'db-test-u@example.com', 'D1 goes to the owner');
SELECT test.ok(
  (test.outbox('D1:' || test.id('U'))).payload @> jsonb_build_object(
    'name', 'Tom Becker',
    'workspace_name', 'Northwind Studio',
    'zone', 'Europe/Warsaw',
    'trial_ends_at', test.iso(date_trunc('second', now() + interval '14 days'))),
  'D1 carries the name, the workspace, the zone and the trial end',
  (test.outbox('D1:' || test.id('U'))).payload::text);
SELECT test.ok((SELECT welcome_email_at IS NOT NULL FROM public.profiles WHERE id = test.id('U')),
  'the profile remembers the welcome');

INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WU2'), test.id('U'), 'Second');
SELECT test.ok(test.mails('welcome', 'U') = 1, 'a second workspace queues nothing');

-- Once ever, after the outbox purge and with every workspace gone.
DELETE FROM public.email_outbox WHERE dedupe_key = 'D1:' || test.id('U');
DELETE FROM public.workspaces WHERE owner_id = test.id('U');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WU3'), test.id('U'), 'Again');
SELECT test.ok(test.mails('welcome', 'U') = 0,
  'no second welcome once the first row is purged and the workspaces are gone');

-- Someone who had a workspace before TX-9a shipped.
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WE'), test.id('E'), 'Old');
DELETE FROM public.email_outbox WHERE to_user_id = test.id('E');
UPDATE public.profiles SET welcome_email_at = NULL WHERE id = test.id('E');
UPDATE public.workspaces SET deleted_at = now() WHERE id = test.id('WE');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WE2'), test.id('E'), 'New');
SELECT test.ok(test.mails('welcome', 'E') = 0, 'owning another workspace (even trashed) means it isn''t the first');

-- The workspace comes first, the trial a minute later: the waiting D1 catches up.
UPDATE public.profiles SET display_name = '' WHERE id = test.id('L');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WL'), test.id('L'), 'My workspace');
SELECT test.ok((test.outbox('D1:' || test.id('L'))).payload @> '{"name": "", "trial_ends_at": null, "zone": "UTC"}',
  'without a name, a trial or a zone: empty name, no trial date, UTC',
  (test.outbox('D1:' || test.id('L'))).payload::text);
SELECT test.sub('L', 'trialing', now() + interval '14 days');
UPDATE public.profiles SET display_name = 'Anna Carter' WHERE id = test.id('L');
SELECT test.ok(
  (test.outbox('D1:' || test.id('L'))).payload @> jsonb_build_object(
    'name', 'Anna Carter', 'workspace_name', 'My workspace',
    'trial_ends_at', test.iso(date_trunc('second', now() + interval '14 days'))),
  'a waiting D1 picks up the mirrored trial and the new name',
  (test.outbox('D1:' || test.id('L'))).payload::text);
UPDATE public.email_outbox SET attempts = 1 WHERE dedupe_key = 'D1:' || test.id('L');
UPDATE public.profiles SET display_name = 'Someone Else' WHERE id = test.id('L');
SELECT test.ok((test.outbox('D1:' || test.id('L'))).payload ->> 'name' = 'Anna Carter',
  'after a first attempt the body stays what Resend has');

-- A founder has no trial to mention.
UPDATE public.profiles SET plan_tier = 'founder', subscription_status = 'active' WHERE id = test.id('N');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WN'), test.id('N'), 'Founder');
SELECT test.ok((test.outbox('D1:' || test.id('N'))).payload -> 'trial_ends_at' = 'null'::jsonb,
  'a founder''s welcome has no trial date');

-- A workspace insert never fails on the email: an owner without an address just gets none.
UPDATE auth.users SET email = NULL WHERE id = test.id('K');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WK'), test.id('K'), 'No address');
SELECT test.ok(EXISTS (SELECT 1 FROM public.workspaces WHERE id = test.id('WK')) AND test.mails('welcome', 'K') = 0,
  'an owner without an address still gets the workspace, and no email');

-- An email the outbox refuses rolls back the marker and never the workspace.
UPDATE auth.users SET email = 'not-an-address' WHERE id = test.id('B');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WB'), test.id('B'), 'Refused');
SELECT test.ok(EXISTS (SELECT 1 FROM public.workspaces WHERE id = test.id('WB'))
               AND (SELECT welcome_email_at IS NULL FROM public.profiles WHERE id = test.id('B'))
               AND test.mails('welcome', 'B') = 0,
  'a refused address keeps the workspace, queues nothing and leaves the person unwelcomed');

-- Deleting the account cancels a welcome still waiting.
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('WG'), test.id('G'), 'Gone soon');
DELETE FROM public.profiles WHERE id = test.id('G');
SELECT test.ok((test.outbox('D1:' || test.id('G'))).status = 'cancelled', 'a deleted account''s waiting D1 is cancelled');

-- ── AC45 · D2 once, about 3 days before a no-card trial ends ─────────────────

SELECT test.sub('U', 'trialing', now() + interval '48 hours');
SELECT test.sub('C', 'trialing', now() + interval '48 hours');
INSERT INTO stripe.payment_methods (_raw_data, _account_id)
VALUES ('{"id": "pm_dbtest_c", "customer": "cus_dbtest_c", "type": "card"}', 'acct_dbtest');
SELECT test.sub('P', 'trialing', now() + interval '100 hours');
-- E's trial was stretched to 30 days by a card the mirror never saw.
SELECT test.sub('E', 'trialing', now() + interval '48 hours',
  jsonb_build_object('trial_start', floor(extract(epoch FROM now() + interval '48 hours' - interval '30 days'))::bigint));
SELECT test.sub('Q', 'trialing', now() + interval '48 hours', '{"default_payment_method": "pm_dbtest_q"}');

SELECT test.ok(public.email__trial_ending_sweep(now()) >= 1, 'the sweep queues D2s');
SELECT test.ok(test.mails('trial_ending', 'U') = 1, 'a no-card trial ending within 3 days gets D2');
SELECT test.ok(
  (test.outbox('D2:' || test.id('U') || ':' || test.day(now() + interval '48 hours'))).payload @> jsonb_build_object(
    'ends_at', test.iso(date_trunc('second', now() + interval '48 hours')), 'zone', 'Europe/Warsaw'),
  'D2 is keyed by the trial''s end day and carries the end and the zone');
SELECT test.ok((test.outbox('D2:' || test.id('U') || ':' || test.day(now() + interval '48 hours'))).send_after <= now(),
  'D2 goes out right away');
SELECT public.email__trial_ending_sweep(now());
SELECT public.email__trial_ending_sweep(now() + interval '1 hour');
SELECT test.ok(test.mails('trial_ending', 'U') = 1, 'the next hours'' sweeps queue no second D2');
SELECT test.ok(test.mails('trial_ending', 'C') = 0, 'a trial with a card saved gets no D2');
SELECT test.ok(test.mails('trial_ending', 'Q') = 0, 'a trial with its own payment method gets no D2');
SELECT test.ok(test.mails('trial_ending', 'E') = 0, 'a trial longer than 14 days (extended by a card) gets no D2');
SELECT test.ok(test.mails('trial_ending', 'P') = 0, 'a trial ending in more than 3 days gets no D2 yet');
SELECT public.email__trial_ending_sweep(now() + interval '30 hours');
SELECT test.ok(test.mails('trial_ending', 'P') = 1, '… and gets it once inside the 3 days');
SELECT test.ok(test.mails('trial_ending', 'N') = 0, 'a founder gets no D2');

-- ── AC46 · D3 when the trial ends without a plan ─────────────────────────────

SELECT test.sub('U', 'canceled', now() + interval '48 hours');
SELECT test.ok((SELECT subscription_status = 'canceled' AND plan_tier::text = 'free' FROM public.profiles WHERE id = test.id('U')),
  'Stripe ending the trial moves the profile to Free');
SELECT test.ok(test.mails('trial_ended', 'U') = 1, 'a trial that ends without a plan queues D3');
SELECT test.ok(
  (test.outbox('D3:' || test.id('U') || ':' || test.day(now() + interval '48 hours'))).payload @> jsonb_build_object(
    'ended_at', test.iso(date_trunc('second', now() + interval '48 hours')), 'zone', 'Europe/Warsaw'),
  'D3 is keyed by the trial''s end day');
SELECT test.ok((test.outbox('D2:' || test.id('U') || ':' || test.day(now() + interval '48 hours'))).status = 'cancelled',
  'a D2 still waiting is dropped when the trial ends');
SELECT test.sub('U', 'trialing', now() + interval '48 hours');
SELECT test.sub('U', 'canceled', now() + interval '48 hours');
SELECT test.ok(test.mails('trial_ended', 'U') = 1, 'the same trial ending twice sends one D3');

SELECT test.sub('D', 'trialing', now() + interval '48 hours');
SELECT test.sub('D', 'canceled', now() + interval '48 hours',
  '{"cancellation_details": {"comment": "Moduo account deleted"}}');
SELECT test.ok((SELECT subscription_status FROM public.profiles WHERE id = test.id('D')) = 'canceled'
               AND test.mails('trial_ended', 'D') = 0,
  'a trial ended by deleting the account sends no D3');

SELECT test.sub('Q', 'active', now() + interval '30 days');
SELECT test.ok((SELECT subscription_status FROM public.profiles WHERE id = test.id('Q')) = 'active'
               AND test.mails('trial_ended', 'Q') = 0,
  'a trial that turns into a paid plan sends no D3');

SELECT test.sub('V', 'trialing', now() + interval '48 hours');
DELETE FROM stripe.subscriptions WHERE id = 'sub_dbtest_v';
SELECT test.ok((SELECT subscription_status FROM public.profiles WHERE id = test.id('V')) = 'inactive'
               AND test.mails('trial_ended', 'V') = 0,
  'a subscription that disappears (inactive) sends no D3');

-- ── grants ───────────────────────────────────────────────────────────────────

SELECT test.ok(NOT has_function_privilege(r, f, 'EXECUTE'), r || ' can''t call ' || f)
FROM unnest(ARRAY['anon', 'authenticated']) AS r,
     unnest(ARRAY['public.email__trial_ending_sweep(timestamptz)', 'public.email__user_zone(uuid)',
                  'public.email__iso_time(timestamptz)',
                  'public.email__welcome_profile(public.profiles)', 'public.workspaces__enqueue_welcome()',
                  'public.profiles__trial_emails()']) AS f;
SELECT test.ok(NOT has_column_privilege(r, 'public.profiles', 'welcome_email_at', p), r || ' can''t ' || p || ' welcome_email_at')
FROM unnest(ARRAY['anon', 'authenticated']) AS r, unnest(ARRAY['INSERT', 'UPDATE']) AS p;
SELECT test.ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
  'people can still rename themselves');
SELECT test.ok(test.as_user('U', $q$UPDATE public.profiles SET welcome_email_at = NULL WHERE id = auth.uid()$q$) LIKE '42501%',
  'a signed-in update of welcome_email_at is refused');

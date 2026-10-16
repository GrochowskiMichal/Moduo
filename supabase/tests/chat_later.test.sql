-- Chat v2 Later and Remind me (CV-11: supabase/migrations/…_chat_v2_later.sql).
-- "Later and Remind me" (AC3.4, AC5.4): Later puts a Catch up item off (gone
-- from Catch up, its count and the bell) until its time; the minute job brings
-- it back on top with exactly one notice; Remind me on any message writes a
-- reminder item; /remind reminds about the conversation and brings back its
-- newest message; beyond a year, the past, a key and a conversation you can't
-- read are refused; clearing works; reading closes a put-off item but never a
-- reminder.
--
-- Cast: O owns workspace W (Duo); A and B are members; X is in no workspace;
-- K is A's API key with Chat at Edit. A makes the public channel L (B), the
-- public channel G (B: a chain) and the private channel P (A alone). Messages
-- are sent through the ops, then moved to fixed minutes on 1 Oct. A check
-- never shares a statement with the op it looks at.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Later');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv11-later'),
        '{"chat": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.at(p_n int) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT '2026-10-01 09:00:00+00'::timestamptz + make_interval(mins => p_n)
$$;
CREATE FUNCTION test.send(p_who text, p_conv text, p_msg text, p_body text, p_n int, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_msg), test.ref(p_conv), p_body, CASE WHEN p_reply IS NOT NULL THEN test.mid(p_reply) END));
  UPDATE public.chat_messages SET created_at = test.at(p_n) WHERE id = test.mid(p_msg);
  RETURN v;
END;
$$;
CREATE FUNCTION test.remind(p_who text, p_msg text, p_conv text, p_at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_remind(%L::uuid, %L::uuid, %L::timestamptz)$q$,
    CASE WHEN p_msg IS NOT NULL THEN test.mid(p_msg) END, CASE WHEN p_conv IS NOT NULL THEN test.ref(p_conv) END, p_at))
$$;
-- A person's item about a message: 'open' / 'later' (put off) / 'back' (came
-- back) / 'done:<how>', '+bell' with a twin, '-hidden' when the twin is dismissed.
CREATE FUNCTION test.item(p_who text, p_msg text, p_reason text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((
    SELECT CASE WHEN k.done_at IS NOT NULL THEN 'done:' || k.done_how
                WHEN k.later_notified_at IS NOT NULL THEN 'back'
                WHEN k.later_until IS NOT NULL THEN 'later'
                ELSE 'open' END
           || CASE WHEN k.activity_id IS NOT NULL THEN '+bell' ELSE '' END
           || CASE WHEN EXISTS (SELECT 1 FROM public.notification_state ns
                                 WHERE ns.user_id = k.user_id AND ns.activity_id = k.activity_id
                                   AND ns.dismissed_at IS NOT NULL) THEN '-hidden' ELSE '' END
      FROM public.chat_catchup k
     WHERE k.user_id = test.id(p_who) AND k.message_id = test.mid(p_msg) AND k.reason = p_reason), 'none')
$$;
CREATE FUNCTION test.notices(p_who text, p_msg text) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.notice_deliveries d
   WHERE d.user_id = test.id(p_who) AND d.kind = 'chat_reminder' AND d.message_id = test.mid(p_msg)
$$;
CREATE FUNCTION test.catchup(p_who text, p_conv text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce((SELECT catchup::text FROM public.chat_unread_counts(%L) WHERE channel_id = %L), 'none')$q$,
    test.id('W'), test.ref(p_conv)))
$$;
-- Time passes: every put-off item of W comes p_by closer (the job then runs at now()).
CREATE FUNCTION test.elapse(p_by interval) RETURNS void LANGUAGE sql AS $$
  UPDATE public.chat_catchup SET later_until = later_until - p_by
   WHERE workspace_id = test.id('W') AND done_at IS NULL AND later_notified_at IS NULL AND later_until IS NOT NULL
$$;
CREATE FUNCTION test.fire(p_by interval) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test.elapse(p_by);
  RETURN public.chat__fire_later(now());
END;
$$;
-- Whether Catch up's list shows a person's item about a message.
CREATE FUNCTION test.listed(p_who text, p_msg text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(reason, ',' ORDER BY reason), '') FROM public.chat_catchup_open(%L) WHERE message_id = %L$q$,
    test.id('W'), test.mid(p_msg)))
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Plans', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel L with B', v);
  INSERT INTO test.ids SELECT 'L', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Logo', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel G with B', v);
  INSERT INTO test.ids SELECT 'G', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Logo';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Secret', '', true, ARRAY[]::uuid[])$q$,
    test.id('W')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the private channel P alone', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Secret';
  UPDATE public.chat_members SET last_read_id = NULL, last_read_at = test.at(-1)
   WHERE workspace_id = test.id('W');
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
SELECT test.ok(
  has_function_privilege('authenticated', 'public.chat_op_remind(uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.chat_op_remind(uuid, uuid, timestamptz)', 'EXECUTE'),
  'grants: chat_op_remind is for signed-in people, never anon');
SELECT test.ok(
  has_function_privilege('authenticated', 'public.chat_catchup_open(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.chat_catchup_open(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.chat_catchup_open(uuid)', 'EXECUTE'),
  'grants: chat_catchup_open answers people only (no anon, no key)');
SELECT test.ok(
  has_function_privilege('service_role', 'public.chat__fire_later(timestamptz, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.chat__fire_later(timestamptz, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.chat__fire_later(timestamptz, integer)', 'EXECUTE'),
  'grants: the minute job is server-only');
SELECT test.ok(
  NOT has_function_privilege('authenticated', 'public.chat__catchup_snoozed_twin()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.chat__catchup_snoozed_twin()', 'EXECUTE'),
  'grants: the trigger''s function is server-only');
SELECT test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-fire-later' AND schedule = '* * * * *'),
  'job: chat-fire-later runs every minute');

-- ── Later on a Catch up item (AC5.4) ────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'L', 'm1', 'can you check this, ' || 'moduo://person/' || test.id('B'), 1);
  PERFORM test.ok(v = 'ok 1', 'setup: A mentions B in L', v);
END;
$$;
SELECT test.ok(test.item('B', 'm1', 'mention') = 'open+bell' AND test.catchup('B', 'L') = '1'
               AND test.listed('B', 'm1') = 'mention',
  'before: B''s mention is open, counted, listed, in the bell');
SELECT test.ok(test.remind('B', 'm1', NULL, now() + interval '1 hour') = 'ok 1', 'Later: B puts the mention off an hour');
SELECT test.ok(test.item('B', 'm1', 'mention') = 'later+bell-hidden' AND test.catchup('B', 'L') = '0'
               AND test.listed('B', 'm1') = '',
  'Later: the item leaves Catch up, its count and the bell until it returns');
SELECT test.ok(test.fire(interval '30 minutes') = 0 AND test.notices('B', 'm1') = 0,
  'job: nothing returns before its time');
SELECT test.ok(test.fire(interval '31 minutes') = 1, 'job: at its time the item returns');
SELECT test.ok(test.item('B', 'm1', 'mention') = 'back+bell' AND test.catchup('B', 'L') = '1'
               AND test.listed('B', 'm1') = 'mention' AND test.notices('B', 'm1') = 1,
  'job: back in Catch up, counted, in the bell again, with exactly one notice');
SELECT test.ok((SELECT d.title LIKE 'Reminder · A · #Plans · Later' AND d.url = '/chat?c=' || test.ref('L') || '&m=' || test.mid('m1')
                       AND d.tag LIKE 'chat:' || test.ref('L') || ':remind:%' AND NOT d.held_for_focus
                  FROM public.notice_deliveries d WHERE d.user_id = test.id('B') AND d.kind = 'chat_reminder'),
  'job: the notice names the reminder, the sender, the channel and the workspace, and links the message');
SELECT test.ok(test.fire(interval '3 hours') = 0 AND test.notices('B', 'm1') = 1,
  'job: a second run sends nothing more (once)');
SELECT test.ok(test.value_as('B', format($q$SELECT at::text FROM public.chat_catchup_open(%L) WHERE message_id = %L$q$,
                 test.id('W'), test.mid('m1')))::timestamptz = now(),
  'list: a returned item sorts at when it came back (on top)');

-- ── Remind me on any message (AC3.4) ────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'L', 'm2', 'the plan for tomorrow', 2);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm2', 'reminder') = 'none', 'setup: A posts m2, not addressed to B', v);
END;
$$;
SELECT test.ok(test.remind('B', 'm2', NULL, now() + interval '1 day') = 'ok 1'
               AND test.item('B', 'm2', 'reminder') = 'later' AND test.listed('B', 'm2') = '',
  'Remind me: a message not addressed to B gets a reminder item, hidden until its time');
SELECT test.ok(test.fire(interval '1 day 1 minute') = 1
               AND test.item('B', 'm2', 'reminder') = 'back' AND test.notices('B', 'm2') = 1
               AND test.listed('B', 'm2') = 'reminder',
  'Remind me tomorrow: it comes back once, with one notice');
SELECT test.ok(test.remind('B', 'm2', NULL, NULL) = 'ok 1' AND test.item('B', 'm2', 'reminder') = 'done:done'
               AND test.listed('B', 'm2') = '',
  'clear: clearing a reminder closes it');
SELECT test.ok(test.remind('B', 'm2', NULL, now() + interval '2 days') = 'ok 1' AND test.item('B', 'm2', 'reminder') = 'later',
  'Remind me again on the same message: the reminder opens again (one row per message)');

-- ── Refusals ────────────────────────────────────────────────────────────────
SELECT test.ok(test.remind('B', 'm2', NULL, now() + interval '1 year 1 day') = '22023 Pick a time within a year.',
  'refused: beyond a year');
SELECT test.ok(test.remind('B', 'm2', NULL, now() - interval '1 minute') = '22023 Pick a time in the future.',
  'refused: a time in the past');
SELECT test.ok(test.remind('B', NULL, NULL, now() + interval '1 hour') = '22023 Name a message or a conversation.'
               AND test.remind('B', 'm2', 'L', now() + interval '1 hour') = '22023 Name a message or a conversation.',
  'refused: a message or a conversation, exactly one');
SELECT test.ok(test.as_key('K', format($q$SELECT public.chat_op_remind(%L::uuid, NULL, %L::timestamptz)$q$,
                 test.mid('m2'), now() + interval '1 hour')) = '42501 Sign in first.',
  'refused: a key (no person)');
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'P', 'p1', 'secret', 3);
  PERFORM test.ok(v = 'ok 1', 'setup: A posts in the private channel P', v);
END;
$$;
SELECT test.ok(test.remind('B', 'p1', NULL, now() + interval '1 hour') = 'P0002 That message no longer exists.'
               AND test.remind('B', NULL, 'P', now() + interval '1 hour') = 'P0002 That conversation isn''t available.'
               AND test.remind('X', 'm1', NULL, now() + interval '1 hour') = 'P0002 That message no longer exists.',
  'refused: a message or conversation you can''t read answers like one that isn''t there');
SELECT test.ok(test.item('B', 'p1', 'reminder') = 'none', 'refused: nothing was written');

-- ── /remind: the conversation ───────────────────────────────────────────────
SELECT test.ok(test.remind('B', NULL, 'L', now() + interval '2 hours') = 'ok 1'
               AND test.remind('B', NULL, 'L', now() + interval '3 hours') = 'ok 1',
  '/remind: B asks twice about L');
SELECT test.ok((SELECT count(*) FROM public.chat_catchup k WHERE k.user_id = test.id('B')
                      AND k.channel_id = test.ref('L') AND k.reason = 'reminder' AND k.message_id IS NULL
                      AND k.done_at IS NULL AND k.later_until = now() + interval '3 hours') = 1,
  '/remind: one open reminder per conversation, moved to the newer time');
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'L', 'm3', 'newest thing', 4);
  PERFORM test.ok(v = 'ok 1', 'setup: A posts m3, now L''s newest', v);
END;
$$;
SELECT test.ok(test.fire(interval '3 hours 1 minute') >= 1
               AND test.item('B', 'm3', 'reminder') = 'back' AND test.notices('B', 'm3') = 1
               AND test.listed('B', 'm3') = 'reminder',
  '/remind: at its time it brings back the conversation''s newest message, with one notice');

-- ── Reading: a put-off item closes, a reminder doesn't ──────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'L', 'm4', 'another for ' || 'moduo://person/' || test.id('B'), 5);
  PERFORM test.ok(v = 'ok 1', 'setup: A mentions B again (m4)', v);
  v := test.send('A', 'L', 'm5', 'just words', 6);
  PERFORM test.ok(v = 'ok 1', 'setup: A posts m5', v);
END;
$$;
SELECT test.ok(test.remind('B', 'm4', NULL, now() + interval '1 hour') = 'ok 1'
               AND test.remind('B', 'm5', NULL, now() + interval '1 hour') = 'ok 1',
  'setup: B puts m4''s mention off and sets a reminder on m5');
SELECT test.ok(test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('L'), test.mid('m5'))) = 'ok 1',
  'read: B reads L to its end');
SELECT test.ok(test.item('B', 'm4', 'mention') = 'done:read+bell-hidden' AND test.item('B', 'm5', 'reminder') = 'later',
  'read: reading closes the put-off mention, never the reminder');

-- ── A put-off chain keeps its bell hidden when a reply moves it ─────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('B', 'G', 'r1', 'logo question', 10);
  PERFORM test.ok(v = 'ok 1', 'setup: B starts a chain in G', v);
  v := test.send('A', 'G', 'a1', 'first answer', 11, 'r1');
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'a1', 'reply') = 'open+bell', 'setup: A replies; B has the chain item', v);
END;
$$;
SELECT test.ok(test.remind('B', 'a1', NULL, now() + interval '1 hour') = 'ok 1'
               AND test.item('B', 'a1', 'reply') = 'later+bell-hidden',
  'Later on a chain: put off with its bell row');
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'G', 'a2', 'second answer', 12, 'r1');
  PERFORM test.ok(v = 'ok 1', 'setup: A replies again', v);
END;
$$;
SELECT test.ok(test.item('B', 'a2', 'reply') = 'later+bell-hidden' AND test.listed('B', 'a2') = '',
  'Later on a chain: a newer reply moves it, still put off, its new bell row hidden too');
SELECT test.ok(test.fire(interval '61 minutes') >= 1
               AND test.item('B', 'a2', 'reply') = 'back+bell' AND test.notices('B', 'a2') = 1,
  'Later on a chain: it returns with its newest bell row and one notice');

-- ── Clearing Later on an item ───────────────────────────────────────────────
SELECT test.ok(test.remind('B', 'a2', NULL, now() + interval '5 hours') = 'ok 1'
               AND test.remind('B', 'a2', NULL, NULL) = 'ok 1'
               AND test.item('B', 'a2', 'reply') = 'open+bell' AND test.listed('B', 'a2') = 'reply',
  'clear: an item put off shows again at once, with its bell row');
SELECT test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.chat_catchup_open(%L)$q$, test.id('W'))) = '0',
  'list: someone else sees none of B''s items');

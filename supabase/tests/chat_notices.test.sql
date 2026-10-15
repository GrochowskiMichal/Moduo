-- Chat v2 device notices and the email after an hour (CV-6a:
-- supabase/migrations/…_chat_v2_device_notices.sql). "Delivery" (AC7.1, the
-- device-notice column of §11): each kind's row with its server-built title,
-- text and link, tag, push_after and the gate's answer; nobody outside the
-- conversation, the workspace or chat ever gets one. "The email after an hour"
-- (AC3.2, AC7.9). user_clients, acknowledgements, prefs and their erasure
-- (AC12.8, its table). CV-18 adds "holds and the gate" here.
--
-- Cast: O owns workspace W ("Acme", Duo); A, B, C and Z are members, Z without
-- chat access; X is in no workspace; K is A's API key with Chat at Edit. A
-- makes the public channel L (B, C), the private channel P (B), the
-- announcement channel N (B, C) and a direct message D with B. Team T is B and
-- C. B has a browser that takes pushes. One transaction: now() is the same for
-- every statement, so the email job is run at later times through p_now.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'Z', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Acme');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C', 'Z']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv6a-notices'),
        '{"chat": "edit"}'::jsonb, test.id('A'));
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
VALUES (test.id('B'), 'https://fcm.googleapis.com/fcm/send/db-test-cv6a', repeat('k', 87), repeat('a', 22));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
-- Send as a person, then move the message to the next minute on 1 Oct (one
-- transaction gives every op the same now(); old times keep the sending limit
-- out of the way and order the messages).
CREATE SEQUENCE test.minute;
CREATE FUNCTION test.send(p_who text, p_conv text, p_msg text, p_body text, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_msg), test.ref(p_conv), p_body, CASE WHEN p_reply IS NOT NULL THEN test.mid(p_reply) END));
  UPDATE public.chat_messages SET created_at = '2026-10-01 09:00:00+00'::timestamptz + make_interval(mins => nextval('test.minute')::int)
   WHERE id = test.mid(p_msg);
  RETURN v;
END;
$$;
-- A person's notice about a message: 'kind|title|body|url|tag|hold|held'.
CREATE FUNCTION test.notice(p_who text, p_msg text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((
    SELECT concat_ws('|', d.kind, d.title, coalesce(d.body, '∅'), d.url, d.tag,
                     extract(epoch FROM d.push_after - d.created_at)::int, d.held_for_focus)
      FROM public.notice_deliveries d
     WHERE d.user_id = test.id(p_who) AND d.message_id = test.mid(p_msg)), 'none')
$$;
CREATE FUNCTION test.notices(p_msg text) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.notice_deliveries d WHERE d.message_id = test.mid(p_msg)
$$;
CREATE FUNCTION test.uri(p_type text, p_id uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'moduo://' || p_type || '/' || p_id
$$;
CREATE FUNCTION test.emails(p_who text) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.email_outbox o WHERE o.kind = 'chat_waiting' AND o.to_user_id = test.id(p_who)
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Plans', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel L with B and C', v);
  INSERT INTO test.ids SELECT 'L', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Secret', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Secret';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'News', '', false, ARRAY[%L, %L]::uuid[], true)$q$,
    test.id('W'), test.id('B'), test.id('C')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the announcement channel N with B and C', v);
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'News';
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A opens a direct message D with B', v);
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  INSERT INTO public.teams (id, workspace_id, name, mark) VALUES (test.id('T'), test.id('W'), 'Design', 'D');
  INSERT INTO public.team_members (workspace_id, team_id, user_id)
  SELECT test.id('W'), test.id('T'), test.id(n) FROM unnest(ARRAY['B', 'C']) n;
  -- Z keeps the workspace but not chat (as the role editor's overrides would
  -- leave it; perm_members_resolve would recompute perms from the role).
  SET LOCAL session_replication_role = replica;
  UPDATE public.workspace_members SET perms = array_remove(perms, 'chat.view')
   WHERE workspace_id = test.id('W') AND user_id = test.id('Z');
  SET LOCAL session_replication_role = origin;
  PERFORM test.ok(NOT public.perm_user_has(test.id('W'), test.id('Z'), 'chat.view'), 'setup: Z has no chat access');
  -- A task in a list nobody else may open: its title must never reach B or C.
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
  VALUES (test.id('vault'), test.id('W'), test.id('O'), 'Vault', false);
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('vault');
  INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
  VALUES (test.id('task:secret'), test.id('W'), test.id('vault'), test.id('O'), 'Acquire Northwind', 'todo');
END;
$$;

-- ── 1. Delivery: each kind's row (AC7.1) ────────────────────────────────────
DO $$
DECLARE
  v text;
  d text := test.ref('D');
  l text := test.ref('L');
BEGIN
  v := test.send('A', 'D', 'dm1', 'got a **minute**?');
  PERFORM test.ok(v = 'ok 1'
    AND test.notice('B', 'dm1') = concat_ws('|', 'chat_message', 'A · Acme', 'got a minute?',
          '/chat?c=' || d || '&m=' || test.mid('dm1'), 'chat:' || d, 8, false)
    AND test.notice('A', 'dm1') = 'none',
    'direct message: B gets chat_message "A · Acme", the text without marks, the link to the message, tag chat:<conversation>, pushed after 8 s, sent; the sender gets none',
    test.notice('B', 'dm1'));

  v := test.send('A', 'D', 'dm2', 'still there?');
  PERFORM test.ok(test.notice('B', 'dm2') LIKE 'chat_message|A · Acme|2 messages: still there?|%',
    'a burst on one conversation reads "2 messages" with the newest text', test.notice('B', 'dm2'));

  v := test.send('A', 'L', 'm1', format('ping %s and %s and %s', test.uri('person', test.id('B')),
                                        test.uri('person', test.id('Z')), test.uri('person', test.id('X'))));
  PERFORM test.ok(v = 'ok 1'
    AND test.notice('B', 'm1') = concat_ws('|', 'chat_mention', 'A · #Plans · Acme',
          'ping @B and @Z and Private item', '/chat?c=' || l || '&m=' || test.mid('m1'), 'chat:' || l, 8, false),
    '@you: chat_mention "A · #Plans · Acme"; a member is drawn by name, someone outside the workspace as "Private item"',
    test.notice('B', 'm1'));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries
                               WHERE user_id IN (test.id('Z'), test.id('X'))),
    'named without chat access (Z) or outside the workspace (X): no notice at all');

  v := test.send('A', 'L', 'm2', format('%s and %s on %s',
    test.uri('team', test.id('T')), test.uri('task', test.id('task:secret')), 'moduo://date/2026-10-20'));
  PERFORM test.ok(test.notice('C', 'm2') LIKE 'chat_mention|A · #Plans · Acme|@Design and Private item on 2026-10-20|%'
                  AND test.notice('B', 'm2') LIKE 'chat_mention|%',
    '@Team: each member gets chat_mention; a task they can''t see reads "Private item", a date as written',
    test.notice('C', 'm2'));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries WHERE body LIKE '%Northwind%'),
    'the hidden task''s title is in no notice');

  v := test.send('A', 'L', 'root', 'plan for Friday');
  v := test.send('B', 'L', 'r1', 'works for me', 'root');
  PERFORM test.ok(test.notice('A', 'r1') = concat_ws('|', 'chat_reply', 'B · #Plans · Acme', 'works for me',
          '/chat?c=' || l || '&m=' || test.mid('r1'), 'chat:' || l || ':' || test.mid('root'), 8, false)
          AND test.notice('B', 'r1') = 'none',
    'a reply in A''s chain: chat_reply with the chain''s own tag; the replier gets none', test.notice('A', 'r1'));

  v := test.send('A', 'N', 'ann', 'office closed Monday');
  PERFORM test.ok(test.notice('B', 'ann') LIKE 'chat_announcement|A · #News · Acme|office closed Monday|%'
                  AND test.notice('C', 'ann') LIKE 'chat_announcement|%',
    'announcement: every member gets chat_announcement', test.notice('B', 'ann'));

  UPDATE public.chat_members SET notify_level = 'all' WHERE channel_id = test.ref('L') AND user_id = test.id('C');
  v := test.send('A', 'L', 'plain', 'lunch?');
  PERFORM test.ok(test.notice('C', 'plain') LIKE 'chat_message|A · #Plans · Acme|2 messages: lunch?|%'
                  AND test.notice('B', 'plain') = 'none',
    'Every message: C gets chat_message (the conversation''s burst counts C''s mention before it); B (on Mentions) gets none', test.notice('C', 'plain'));

  UPDATE public.chat_members SET notify_level = 'none' WHERE channel_id = test.ref('L') AND user_id = test.id('C');
  v := test.send('A', 'L', 'quiet', format('fyi %s', test.uri('person', test.id('C'))));
  PERFORM test.ok(test.notice('C', 'quiet') = 'none'
                  AND EXISTS (SELECT 1 FROM public.chat_catchup WHERE user_id = test.id('C') AND message_id = test.mid('quiet')),
    'on Nothing: the Catch up item only, no notice (CH40)');

  v := test.send('A', 'P', 'priv', format('secret plan %s', test.uri('person', test.id('C'))));
  PERFORM test.ok(test.notice('C', 'priv') = 'none' AND test.notice('B', 'priv') = 'none',
    'a private conversation: named but not in it (C), no notice; a plain message there pings nobody');

  v := test.as_key('K', format($q$SELECT public.chat_op_agent_post(%L, %L, %L)$q$,
    test.id('W'), test.ref('L'), format('build is green <@%s>', test.id('B'))));
  PERFORM test.ok(v = 'ok 1' AND EXISTS (
      SELECT 1 FROM public.notice_deliveries d JOIN public.chat_messages m ON m.id = d.message_id
       WHERE d.user_id = test.id('B') AND m.author_kind = 'api_key'
         AND d.title = 'Claude Desktop · #Plans · Acme' AND d.body LIKE '% messages: build is green @B'),
    'an app''s post: the notice is from the app by its name', v);

  PERFORM test.ok(public.notice__gate(test.id('B'), test.id('W'), 'chat_message', now()) = 'send'
                  AND NOT EXISTS (SELECT 1 FROM public.notice_deliveries WHERE workspace_id = test.id('W') AND held_for_focus),
    'the gate answers send (rules arrive with CV-18)');

  v := test.as_user('A', format($q$SELECT public.chat_op_edit(%L, %L)$q$, test.mid('plain'),
    format('lunch? %s', test.uri('person', test.id('B')))));
  PERFORM test.ok(v = 'ok 1' AND test.notice('B', 'plain') LIKE 'chat_mention|A · #Plans · Acme|% messages: lunch? @B|%'
                  AND test.notices('plain') = 2,
    'a mention added by an edit: only the newly named get a notice', v);
END;
$$;

-- ── 2. Push at once: the claim and the wait ─────────────────────────────────
DO $$
DECLARE
  v_claimed uuid[];
BEGIN
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notice_deliveries_kick_now'
                           AND tgrelid = 'public.notice_deliveries'::regclass),
    'a chat notice kicks push-send from the write (statement trigger)');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries__claim(500) c WHERE c.user_id = test.id('B')),
    'nothing is claimed inside its 8 s');
  PERFORM test.ok(public.notice_deliveries__next_due() BETWEEN 7000 AND 8000,
    'push-send is told how long to wait for the next one (≤ 10 s)', public.notice_deliveries__next_due()::text);

  -- dm1 then dm2 on one tag; m1 acknowledged; m2's message deleted; the
  -- announcement still inside its hold.
  UPDATE public.notice_deliveries SET created_at = now() - interval '1 minute', push_after = now() - interval '1 second'
   WHERE user_id = test.id('B') AND message_id = test.mid('dm1');
  UPDATE public.notice_deliveries SET created_at = now() - interval '30 seconds', push_after = now() - interval '1 second'
   WHERE user_id = test.id('B') AND message_id = test.mid('dm2');
  UPDATE public.notice_deliveries SET push_after = now() - interval '1 second', acked_at = now()
   WHERE user_id = test.id('B') AND message_id = test.mid('m1');
  UPDATE public.notice_deliveries SET push_after = now() - interval '1 second', tag = 'chat:test-m2'
   WHERE user_id = test.id('B') AND message_id = test.mid('m2');
  UPDATE public.chat_messages SET deleted_at = now() WHERE id = test.mid('m2');

  SELECT array_agg(c.id) INTO v_claimed FROM public.notice_deliveries__claim(500) c WHERE c.user_id = test.id('B');
  PERFORM test.ok(v_claimed = ARRAY[(SELECT id FROM public.notice_deliveries
                                      WHERE user_id = test.id('B') AND message_id = test.mid('dm2'))],
    'the claim takes only what is due: not a row a newer one on its tag replaced, not one acknowledged, not a deleted message''s, not one inside its hold',
    v_claimed::text);
  PERFORM test.ok((SELECT push_attempts FROM public.notice_deliveries
                    WHERE user_id = test.id('B') AND message_id = test.mid('dm2')) = 1,
    'claiming counts an attempt');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries__claim(500) c WHERE c.user_id = test.id('C')),
    'someone without a browser is never claimed');
END;
$$;

-- ── 3. A notice is read only by its person, while they can read its message ─
DO $$
BEGIN
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE message_id = %L$q$, test.mid('dm1'))) = '1'
                  AND test.value_as('A', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE message_id = %L$q$, test.mid('dm1'))) = '0',
    'B reads B''s notice; A, who sent it, doesn''t');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE message_id = %L$q$, test.mid('m2'))) = '0',
    'a deleted message''s notice is no longer readable');
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = test.ref('N') AND user_id = test.id('B');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE message_id = %L$q$, test.mid('ann'))) = '1',
    'a public conversation stays readable after leaving it');
  UPDATE public.chat_channels SET is_private = true WHERE id = test.ref('N');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.notice_deliveries WHERE message_id = %L$q$, test.mid('ann'))) = '0',
    'a conversation B can no longer read hides its notices from B');
  UPDATE public.chat_channels SET is_private = false WHERE id = test.ref('N');
  UPDATE public.chat_members SET left_at = NULL WHERE channel_id = test.ref('N') AND user_id = test.id('B');
END;
$$;

-- ── 4. One device rings: user_clients and acknowledgements ──────────────────
DO $$
DECLARE
  v text;
  i int;
BEGIN
  PERFORM set_config('request.headers', '{"user-agent": "Moduo-Web db-test"}', true);
  v := test.as_user('B', format($q$SELECT public.user_op_client_seen(%L, 'web', true)$q$, test.id('c1')));
  PERFORM test.ok(v = 'ok 1' AND (SELECT user_agent FROM public.user_clients WHERE id = test.id('c1')) = 'Moduo-Web db-test'
                  AND (SELECT user_id FROM public.user_clients WHERE id = test.id('c1')) = test.id('B'),
    'seen: the client is stamped for the person in the session, with the request''s user agent', v);
  UPDATE public.user_clients SET last_active_at = now() - interval '1 minute', last_seen_at = now() - interval '1 minute'
   WHERE id = test.id('c1');
  PERFORM test.ok(test.value_as('B', format($q$SELECT (public.user_op_client_seen(%L, 'desktop', true) ->> 'latest')$q$, test.id('c2'))) = 'true'
                  AND test.value_as('B', format($q$SELECT (public.user_op_client_seen(%L, 'web', false) ->> 'latest')$q$, test.id('c1'))) = 'false',
    'the most recently active open client is the one that rings');
  PERFORM test.ok(test.value_as('B', 'SELECT count(*)::text FROM public.user_clients') = '2'
                  AND test.value_as('A', 'SELECT count(*)::text FROM public.user_clients') = '0',
    'user_clients: only your own rows are readable');
  v := test.try('A', format($q$SELECT public.user_op_client_seen(%L, 'web', true)$q$, test.id('c1')));
  PERFORM test.ok(v LIKE '22023 Unknown client%' AND (SELECT user_id FROM public.user_clients WHERE id = test.id('c1')) = test.id('B'),
    'someone else''s client id is refused and the row stays B''s', v);
  v := test.try('A', format($q$DELETE FROM public.user_clients WHERE id = %L$q$, test.id('c1')));
  PERFORM test.ok(v = 'ok 0', 'nobody deletes another person''s client', v);
  v := test.try('B', format($q$INSERT INTO public.user_clients (id, user_id, surface) VALUES (%L, %L, 'web')$q$, test.id('c9'), test.id('B')));
  PERFORM test.ok(v LIKE '42501%', 'no direct writes: only the op stamps clients', v);
  v := test.try('B', format($q$UPDATE public.user_clients SET last_seen_at = now() + interval '1 day' WHERE id = %L$q$, test.id('c1')));
  PERFORM test.ok(v LIKE '42501%', 'no direct updates either', v);
  v := test.try('B', format($q$SELECT public.user_op_client_seen(%L, 'phone', true)$q$, test.id('c3')));
  PERFORM test.ok(v LIKE '22023%', 'an unknown surface is refused', v);
  v := test.as_key('K', format($q$SELECT public.user_op_client_seen(%L, 'web', true)$q$, test.id('c4')));
  PERFORM test.ok(v LIKE '42501%', 'a key has no session to stamp: refused', v);
  FOR i IN 1 .. 21 LOOP
    PERFORM test.as_user('C', format($q$SELECT public.user_op_client_seen(%L, 'web', false)$q$, test.id('cc' || i)));
  END LOOP;
  PERFORM test.ok((SELECT count(*) FROM public.user_clients WHERE user_id = test.id('C')) = 20,
    'twenty clients per person');

  v := test.as_user('A', format($q$SELECT public.notice_op_ack(ARRAY[%L]::uuid[])$q$,
    (SELECT id FROM public.notice_deliveries WHERE user_id = test.id('B') AND message_id = test.mid('ann'))));
  PERFORM test.ok((SELECT acked_at FROM public.notice_deliveries WHERE user_id = test.id('B') AND message_id = test.mid('ann')) IS NULL,
    'ack: nobody acknowledges another person''s notice', v);
  v := test.value_as('B', format($q$SELECT public.notice_op_ack(ARRAY[%L]::uuid[])::text$q$,
    (SELECT id FROM public.notice_deliveries WHERE user_id = test.id('B') AND message_id = test.mid('ann'))));
  PERFORM test.ok(v = '1'
    AND (SELECT acked_at FROM public.notice_deliveries WHERE user_id = test.id('B') AND message_id = test.mid('ann')) IS NOT NULL,
    'ack: B acknowledges B''s own notice', v);
  v := test.try('B', $q$SELECT public.notice_op_ack(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 1001)))$q$);
  PERFORM test.ok(v LIKE '22023%', 'ack: at most 1,000 at a time', v);
END;
$$;

-- ── 5. Prefs: show message text, email when away, the quick row ────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.value_as('B', 'SELECT public.user_chat_prefs()::text')::jsonb
                  = '{"reaction_row": null, "show_online": true, "show_focus_task": false, "notice_show_text": true, "email_when_away": true}'::jsonb,
    'prefs: the defaults', test.value_as('B', 'SELECT public.user_chat_prefs()::text'));
  v := test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"notice_show_text": false, "reaction_row": ["👍", "🎉"]}')$q$);
  PERFORM test.ok(v = 'ok 1' AND test.value_as('B', 'SELECT public.user_chat_prefs()::text')::jsonb
                  @> '{"notice_show_text": false, "reaction_row": ["👍", "🎉"]}'::jsonb,
    'prefs: the op saves them', v);
  PERFORM test.as_user('B', format($q$UPDATE public.user_preferences SET email_when_away = false, notice_show_text = true,
                                     reaction_row = '{x}' WHERE user_id = %L$q$, test.id('B')));
  PERFORM test.ok((SELECT NOT notice_show_text AND email_when_away AND reaction_row = '{👍,🎉}'
                     FROM public.user_preferences WHERE user_id = test.id('B')),
    'prefs: a direct write leaves them as they were (op-only)');
  PERFORM test.ok(test.try('B', $q$SELECT public.user_op_set_chat_prefs('{"reaction_row": ["a"]}')$q$) LIKE '22023%'
                  AND test.try('B', $q$SELECT public.user_op_set_chat_prefs('{"reaction_row": ["👍","👍"]}')$q$) LIKE '22023%'
                  AND test.try('B', $q$SELECT public.user_op_set_chat_prefs('{"reaction_row": ["👍","🎉","👀","🙏","❤️","😄","✅"]}')$q$) LIKE '22023%'
                  AND test.try('B', $q$SELECT public.user_op_set_chat_prefs('{"show_online": "yes"}')$q$) LIKE '22023%'
                  AND test.try('B', $q$SELECT public.user_op_set_chat_prefs('{"user_id": "x"}')$q$) LIKE '22023%',
    'prefs: letters, repeats, seven reactions, a non-boolean and an unknown setting are refused');

  -- Show message text off: the notice names who and where, never the words.
  PERFORM test.ok(test.send('A', 'D', 'dm3', 'the secret word') = 'ok 1', 'sent: ' || 'dm3');
  PERFORM test.ok(test.notice('B', 'dm3') LIKE 'chat_message|A · Acme|%'
                  AND (SELECT coalesce(body, '') NOT LIKE '%secret%' FROM public.notice_deliveries
                        WHERE user_id = test.id('B') AND message_id = test.mid('dm3')),
    '"Show message text" off: no text in the notice (AC7.9)', test.notice('B', 'dm3'));
  PERFORM test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"notice_show_text": true}')$q$);
END;
$$;

-- ── 6. The email after an hour (AC3.2, AC7.9) ───────────────────────────────
DO $$
DECLARE
  v_n int;
  p jsonb;
BEGIN
  -- B's apps were last seen now (section 4); C's too; A has never been seen.
  PERFORM test.ok(public.chat__queue_waiting_emails(now() + interval '30 minutes') = 0,
    'email: nothing under an hour old');
  UPDATE public.user_clients SET last_seen_at = now() + interval '90 minutes' WHERE id = test.id('c1');
  PERFORM public.chat__queue_waiting_emails(now() + interval '2 hours');
  PERFORM test.ok(test.emails('B') = 0, 'email: none within the hour of a client seen');
  UPDATE public.user_clients SET last_seen_at = now() WHERE id = test.id('c1');

  v_n := public.chat__queue_waiting_emails(now() + interval '2 hours');
  SELECT o.payload INTO p FROM public.email_outbox o
   WHERE o.kind = 'chat_waiting' AND o.to_user_id = test.id('B') AND o.payload ->> 'channel_id' = test.ref('D')::text;
  PERFORM test.ok(test.emails('B') = 2
    AND p ->> 'conversation_kind' = 'dm' AND p ->> 'sender_name' = 'A' AND p ->> 'workspace_name' = 'Acme'
    AND (p ->> 'count')::int = 3 AND p ->> 'text' = 'the secret word'
    AND p ->> 'path' = '/chat?c=' || test.ref('D') || '&m=' || test.mid('dm3')
    AND EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.to_email = 'db-test-b@example.com'
                 AND o.dedupe_key = 'chat_waiting:' || test.id('B') || ':' || test.ref('D') || ':'
                                    || to_char(date_trunc('hour', (now() + interval '2 hours') AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24')),
    'email: one chat_waiting per conversation an hour away (the DM with its 3 messages and the newest text, and Plans)',
    p::text);
  PERFORM test.ok(test.emails('A') = 0, 'email: none for someone whose apps were never seen (A''s reply item is no email reason either)');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_catchup WHERE user_id = test.id('B') AND channel_id = test.ref('D')
                                AND reason = 'dm' AND emailed_at IS NULL),
    'email: the items it covers are stamped');
  PERFORM test.ok(public.chat__queue_waiting_emails(now() + interval '2 hours') = 0, 'email: a second run queues nothing');

  PERFORM test.ok(test.send('A', 'D', 'dm4', 'one more') = 'ok 1', 'sent: ' || 'dm4');
  PERFORM public.chat__queue_waiting_emails(now() + interval '150 minutes');
  PERFORM test.ok(test.emails('B') = 2, 'email: a second message in the same conversation within the hour: no second email');
  PERFORM public.chat__queue_waiting_emails(now() + interval '185 minutes');
  PERFORM test.ok(test.emails('B') = 3, 'email: an hour after the last one, the next goes');

  PERFORM test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"email_when_away": false}')$q$);
  PERFORM test.ok(test.send('A', 'D', 'dm5', 'are you there') = 'ok 1', 'sent: ' || 'dm5');
  PERFORM public.chat__queue_waiting_emails(now() + interval '5 hours');
  PERFORM test.ok(test.emails('B') = 3, 'email: "Email when away" off: none');
  PERFORM test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"email_when_away": true}')$q$);
  UPDATE public.chat_catchup SET emailed_at = now() WHERE user_id = test.id('B') AND message_id = test.mid('dm5');

  PERFORM test.ok(test.send('A', 'D', 'dm6', 'during quiet hours') = 'ok 1', 'sent: ' || 'dm6');
  UPDATE public.chat_catchup SET held_at = now() WHERE user_id = test.id('B') AND message_id = test.mid('dm6');
  PERFORM public.chat__queue_waiting_emails(now() + interval '7 hours');
  PERFORM test.ok(test.emails('B') = 3, 'email: never for something that arrived while held (quiet hours, do not disturb, a vacation)');

  PERFORM test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"notice_show_text": false}')$q$);
  PERFORM test.ok(test.send('A', 'D', 'dm7', 'private words') = 'ok 1', 'sent: ' || 'dm7');
  PERFORM public.chat__queue_waiting_emails(now() + interval '9 hours');
  SELECT o.payload INTO p FROM public.email_outbox o
   WHERE o.kind = 'chat_waiting' AND o.to_user_id = test.id('B') ORDER BY o.send_after DESC LIMIT 1;
  PERFORM test.ok(test.emails('B') = 4 AND p ? 'text' AND p -> 'text' = 'null'::jsonb AND (p ->> 'count')::int = 1,
    'email: "Show message text" off: the email carries no text (AC7.9)', p::text);

  UPDATE public.chat_members SET notify_level = 'none' WHERE channel_id = test.ref('D') AND user_id = test.id('B');
  PERFORM test.ok(test.send('A', 'D', 'dm8', 'on nothing') = 'ok 1', 'sent: ' || 'dm8');
  PERFORM public.chat__queue_waiting_emails(now() + interval '11 hours');
  PERFORM test.ok(test.emails('B') = 4, 'email: none from a conversation on Nothing');
END;
$$;

-- ── 7. The gate's answers reach the rows (rules: CV-18) ─────────────────────
CREATE OR REPLACE FUNCTION public.notice__gate(p_user uuid, p_workspace_id uuid, p_kind text, p_at timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE WHEN p_user = md5('db-test:C')::uuid THEN 'drop' ELSE 'hold' END
$$;
DO $$
BEGIN
  UPDATE public.chat_members SET notify_level = 'mentions' WHERE channel_id = test.ref('L');
  PERFORM test.ok(test.send('A', 'L', 'gate', format('%s %s', test.uri('person', test.id('B')), test.uri('person', test.id('C')))) = 'ok 1', 'sent: ' || 'gate');
  PERFORM test.ok(test.notice('B', 'gate') LIKE '%|t' AND test.notice('C', 'gate') = 'none'
                  AND EXISTS (SELECT 1 FROM public.chat_catchup WHERE user_id = test.id('C') AND message_id = test.mid('gate')),
    'gate: hold writes the row held for Focus; drop writes none (the Catch up item stays)', test.notice('B', 'gate'));
  UPDATE public.notice_deliveries SET push_after = now() - interval '1 second' WHERE message_id = test.mid('gate');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries__claim(500) c
                               WHERE c.id IN (SELECT id FROM public.notice_deliveries WHERE message_id = test.mid('gate'))),
    'gate: a held row is never pushed');
END;
$$;

-- ── 8. Erasure and grants (AC12.8, its table) ───────────────────────────────
DO $$
DECLARE
  v jsonb;
BEGIN
  PERFORM test.ok((SELECT confdeltype = 'c' FROM pg_constraint
                    WHERE conrelid = 'public.user_clients'::regclass AND contype = 'f'
                      AND confrelid = 'public.profiles'::regclass),
    'erase: user_clients cascade from profiles');
  v := public.account_erase_workspace_data(test.id('B'), true);
  PERFORM test.ok((v ->> 'user_clients_deleted')::int = 2
                  AND (SELECT count(*) FROM public.user_clients WHERE user_id = test.id('B')) = 2,
    'erase: the preview counts B''s clients and deletes nothing', v::text);
  PERFORM public.account_erase_workspace_data(test.id('B'), false);
  PERFORM test.ok((SELECT count(*) FROM public.user_clients WHERE user_id = test.id('B')) = 0
                  AND (SELECT count(*) FROM public.user_clients WHERE user_id = test.id('C')) = 20,
    'erase: B''s clients are gone, nobody else''s');

  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.user_clients', 'INSERT')
                  AND NOT has_table_privilege('authenticated', 'public.user_clients', 'UPDATE')
                  AND NOT has_table_privilege('anon', 'public.user_clients', 'SELECT')
                  AND NOT has_function_privilege('authenticated', 'public.notice_deliveries__claim(integer)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.notice_deliveries__next_due()', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.notice_deliveries__kick()', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.chat__queue_waiting_emails(timestamptz)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.chat__notice_text(text, uuid, uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.chat__notice_ref(uuid, text, uuid, uuid)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.chat__notify_devices(public.chat_channels, public.chat_messages, uuid, text, uuid[])', 'EXECUTE')
                  AND NOT has_function_privilege('anon', 'public.user_op_client_seen(uuid, text, boolean)', 'EXECUTE')
                  AND NOT has_function_privilege('anon', 'public.notice_op_ack(uuid[])', 'EXECUTE')
                  AND NOT has_function_privilege('anon', 'public.user_op_set_chat_prefs(jsonb)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.user_op_client_seen(uuid, text, boolean)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.user_chat_prefs()', 'EXECUTE'),
    'grants: server-only functions stay server-only; people call only their own ops');
END;
$$;

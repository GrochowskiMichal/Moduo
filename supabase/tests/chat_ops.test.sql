-- Chat v2 message ops (CV-2a: supabase/migrations/…_chat_v2_core_ops.sql).
-- "Every op, every role" (AC12.1, AC10.1), messages half: send, edit, delete,
-- restore, react, pin and typing, tried as the owner, an admin, a channel
-- manager, a member, a viewer, an outsider and a key; the activity rows they
-- write (and the ones they don't); a resent id; the stored form read on the
-- server (mentions, teams, @channel, the excerpt); chains; the blank job;
-- chat_has_cap for people outside the workspace. CV-2b adds the conversation
-- ops to this file.
--
-- Cast: O owns workspace W (Duo); D is an admin; A, B and C are members (A makes
-- the public channel Q, so A manages it, and the private channel P with B); V is
-- a viewer; E holds a custom role; X is in no workspace; K is A's API key with
-- Chat at Edit. N is an announcement channel A manages. T is a team of W; T2 a
-- team of another workspace W2.

SELECT test.person(n) FROM unnest(ARRAY['O', 'D', 'A', 'B', 'C', 'V', 'E', 'X', 'O2']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id IN (test.id('O'), test.id('O2'));
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Ops'),
  (test.id('W2'), test.id('O2'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('D'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
-- A message id the client mints, by name.
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
-- A v2 send as a person: the op's answer ('ok 1' or '<sqlstate> <message>').
CREATE FUNCTION test.send(p_who text, p_conv text, p_msg text, p_body text, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_msg), test.ref(p_conv), p_body, CASE WHEN p_reply IS NOT NULL THEN test.mid(p_reply) END))
$$;
-- VOLATILE (a fresh snapshot per call), so a check sees what an op in the same
-- expression just wrote.
CREATE FUNCTION test.msg(p_name text) RETURNS public.chat_messages LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_messages WHERE id = test.mid(p_name)
$$;
-- Activity rows about one message: how many, of one op, by one person.
CREATE FUNCTION test.acts(p_msg text, p_op text DEFAULT NULL, p_who text DEFAULT NULL) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.module_activity a
   WHERE a.workspace_id = test.id('W') AND a.payload ->> 'message_id' = test.mid(p_msg)::text
     AND (p_op IS NULL OR a.op = p_op)
     AND (p_who IS NULL OR (a.actor_type = 'user' AND a.actor_id = test.id(p_who)))
$$;
CREATE FUNCTION test.all_acts() RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.module_activity WHERE workspace_id = test.id('W')
$$;

DO $$
DECLARE
  v text;
BEGIN
  -- A custom role for E: chat, but not one of the three system roles.
  INSERT INTO public.workspace_roles (id, workspace_id, system_key, name, permissions)
  SELECT test.id('role:E'), test.id('W'), NULL, 'Contractor', r.permissions
    FROM public.workspace_roles r WHERE r.workspace_id = test.id('W') AND r.system_key = 'member';
  INSERT INTO public.workspace_members (workspace_id, user_id, role, role_id)
  VALUES (test.id('W'), test.id('E'), 'member', test.id('role:E'))
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, ARRAY[%L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('D')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q with B, C and D', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'open-plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'secret-plans', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret-plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'news', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('D')));
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'news';
  v := test.as_user('A', format($q$SELECT public.share_op_announce(%L, true)$q$, test.ref('N')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: N is an announcement channel A manages', v);
  -- V (a viewer) and E are in Q too.
  INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
  SELECT test.ref('Q'), test.id(n), test.id('W') FROM unnest(ARRAY['V', 'E']) AS n ON CONFLICT DO NOTHING;

  INSERT INTO public.teams (id, workspace_id, name, mark) VALUES
    (test.id('T'), test.id('W'), 'Design', 'D'),
    (test.id('T2'), test.id('W2'), 'Other', 'O');
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv2a'),
          '{"chat": "edit"}'::jsonb, test.id('A'));
END;
$$;

-- ── chat_has_cap: capabilities belong to the workspace's people ─────────────
DO $$
DECLARE
  v_bad text;
  v_caps text[] := ARRAY['create_public', 'create_private', 'manage_any', 'delete_others',
                         'mention_everyone', 'post', 'start_calls'];
BEGIN
  SELECT string_agg(c, ', ') INTO v_bad FROM unnest(v_caps) c
   WHERE public.chat_has_cap(test.id('W'), test.id('X'), c)
      OR public.chat_has_cap(test.id('W'), test.id('O2'), c);
  PERFORM test.ok(v_bad IS NULL, 'caps: an outsider (X, and O2 who owns another workspace) has none of the seven', v_bad);
  SELECT string_agg(c, ', ') INTO v_bad FROM unnest(v_caps) c WHERE NOT public.chat_has_cap(test.id('W'), test.id('O'), c);
  PERFORM test.ok(v_bad IS NULL, 'caps: the owner has all seven', v_bad);
  SELECT string_agg(c, ', ') INTO v_bad FROM unnest(v_caps) c WHERE public.chat_has_cap(test.id('W'), test.id('V'), c);
  PERFORM test.ok(v_bad IS NULL, 'caps: a viewer has none', v_bad);
  PERFORM test.ok(public.chat_has_cap(test.id('W'), test.id('B'), 'post')
                  AND NOT public.chat_has_cap(test.id('W'), test.id('B'), 'delete_others')
                  AND public.chat_has_cap(test.id('W'), test.id('D'), 'delete_others')
                  AND public.chat_has_cap(test.id('W'), test.id('D'), 'manage_any'),
    'caps: a member posts but deletes only their own; an admin deletes others'' and manages any channel');
  PERFORM test.ok((SELECT role_id FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('E'))
                    = test.id('role:E')
                  AND public.chat_has_cap(test.id('W'), test.id('E'), 'post')
                  AND NOT public.chat_has_cap(test.id('W'), test.id('E'), 'delete_others'),
    'caps: a custom role reads as member');
  PERFORM test.ok(NOT public.chat_has_cap(test.id('W'), NULL, 'post'), 'caps: nobody (no session) has none');
END;
$$;

-- ── Send: every role ────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
  v_acts int := test.all_acts();
BEGIN
  PERFORM test.ok(test.send('O', 'Q', 'o1', 'from the owner') LIKE 'ok %', 'send: the owner posts');
  PERFORM test.ok(test.send('D', 'Q', 'd1', 'from an admin') LIKE 'ok %', 'send: an admin posts');
  PERFORM test.ok(test.send('A', 'Q', 'a1', 'from the manager') LIKE 'ok %', 'send: the channel''s manager posts');
  PERFORM test.ok(test.send('B', 'Q', 'b1', 'from a member') LIKE 'ok %', 'send: a member posts');
  PERFORM test.ok(test.send('E', 'Q', 'e1', 'from a custom role') LIKE 'ok %', 'send: a custom-role member posts');
  v := test.send('V', 'Q', 'v1', 'from a viewer');
  PERFORM test.ok(v = '42501 Your role can''t post in chat.', 'send: a viewer is refused', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('V')));
  INSERT INTO test.ids SELECT 'VB', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  v := test.send('V', 'VB', 'v2', 'in a direct message');
  PERFORM test.ok(v = '42501 Your role can''t post in chat.', 'send: a viewer doesn''t post in a direct message either', v);
  v := test.send('X', 'Q', 'x1', 'from outside');
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'send: an outsider is refused', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'from a key'::text, NULL::uuid)$q$,
    test.mid('k1'), test.ref('Q')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'send: a key is refused (apps post through chat_op_agent_post)', v);
  v := test.send('C', 'P', 'c1', 'into P');
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.', 'send: C, not in the private P, is refused', v);
  PERFORM test.ok((SELECT count(*) FROM public.chat_messages WHERE id IN (test.mid('v1'), test.mid('x1'), test.mid('k1'), test.mid('c1'))) = 0,
    'send: a refusal writes nothing');

  -- Announcement channel N: its managers only (an admin who isn't one too).
  PERFORM test.ok(test.send('A', 'N', 'n1', 'news') LIKE 'ok %', 'send: N''s manager posts in the announcement channel');
  v := test.send('B', 'N', 'n2', 'me too');
  PERFORM test.ok(v = '42501 Only managers can post in this channel.', 'send: a member is refused in the announcement channel', v);
  v := test.send('D', 'N', 'n3', 'admin');
  PERFORM test.ok(v = '42501 Only managers can post in this channel.', 'send: an admin who isn''t its manager is refused too', v);

  -- The announcement in N rang the bell (CV-5's fan-out); the sends themselves log nothing.
  PERFORM test.ok(test.all_acts() = v_acts + 1 AND test.acts('n1', 'chat.announcement', 'A') = 1,
    'send: a plain send logs no activity row (N''s post rings the bell: CV-5)');
  PERFORM test.ok((test.msg('b1')).format_version = 2 AND (test.msg('b1')).kind = 'message'
                  AND (test.msg('b1')).author_id = test.id('B') AND (test.msg('b1')).client_id = test.mid('b1')
                  AND (test.msg('b1')).body_text = 'from a member',
    'send: the row is v2, a message, B''s, keyed by its own id (client_id = id while the v1 wrappers live)');
END;
$$;

-- ── Send: a resent id, the stored form, limits ──────────────────────────────
DO $$
DECLARE
  v text;
  v_before timestamptz := (test.msg('b1')).updated_at;
BEGIN
  v := test.send('B', 'Q', 'b1', 'from a member, resent');
  PERFORM test.ok(v = 'ok 1' AND (test.msg('b1')).body = 'from a member' AND (test.msg('b1')).updated_at = v_before
                  AND (SELECT count(*) FROM public.chat_messages WHERE id = test.mid('b1')) = 1,
    'resend: the same id returns the stored row and changes nothing', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT (public.chat_op_send(%L::uuid, %L::uuid, 'again'::text, NULL::uuid)).body$q$,
                    test.mid('b1'), test.ref('Q'))) = 'from a member',
    'resend: what comes back is the stored message');
  v := test.send('C', 'Q', 'b1', 'C takes B''s id');
  PERFORM test.ok(v = '22023 That message id is already used.', 'resend: another person''s id is refused, nothing returned', v);
  v := test.send('X', 'Q', 'b1', 'X takes B''s id');
  PERFORM test.ok(v LIKE '42501 %', 'resend: an outsider learns nothing from an id', v);

  -- 8,000 stored characters, references included; the count comes back.
  PERFORM test.ok(test.send('C', 'Q', 'long-ok', repeat('a', 8000)) LIKE 'ok %', 'limits: 8,000 characters are taken');
  v := test.send('C', 'Q', 'long-no', repeat('a', 7949) || ' moduo://person/' || test.id('B')::text);
  PERFORM test.ok(v = '22023 That message is 8,001 characters long; the most is 8,000.' AND test.msg('long-no') IS NULL,
    'limits: 8,001 stored characters (a reference included) are refused with the count, nothing kept', v);
  v := test.send('C', 'Q', 'blank', E'  \n\t');
  PERFORM test.ok(v = '22023 A message can''t be empty.', 'limits: an empty message is refused', v);

  -- Mentions, teams and @channel are read from the text on the server.
  v := test.send('B', 'Q', 'm1', format(
    'hi moduo://person/%s and moduo://person/%s, not `moduo://person/%s`, nor moduo\://person/%s; moduo://team/%s moduo://team/%s',
    test.id('C'), test.id('X'), test.id('V'), test.id('A'), test.id('T'), test.id('T2')));
  PERFORM test.ok(v LIKE 'ok %'
                  AND (test.msg('m1')).mentioned_user_ids = ARRAY[test.id('C')]
                  AND (test.msg('m1')).mentioned_team_ids = ARRAY[test.id('T')]
                  AND NOT (test.msg('m1')).mentions_everyone,
    'mentions: people who can read Q (not X), never inside code or escaped; teams of this workspace only', v);
  PERFORM test.ok(test.acts('m1', 'chat.mention', 'B') = 1
                  AND (SELECT payload -> 'notify_user_ids' = jsonb_build_array(test.id('C')::text)
                             AND payload ->> 'format_version' = '2'
                             AND payload ->> 'excerpt' = public.chat__excerpt((test.msg('m1')).body)
                        FROM public.module_activity WHERE payload ->> 'message_id' = test.mid('m1')::text),
    'mentions: C hears it once; the excerpt is built on the server in the stored form');
  v := test.send('A', 'P', 'p1', format('moduo://person/%s look', test.id('C')));
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('p1')).mentioned_user_ids = '{}' AND test.acts('p1') = 0,
    'mentions: C, who can''t read P, is neither mentioned nor told', v);
  PERFORM test.ok(test.send('B', 'Q', 'all1', '@channel standup moved') LIKE 'ok %'
                  AND (test.msg('all1')).mentions_everyone
                  AND test.acts('all1', 'chat.mention', 'B') = 1,
    '@channel: a member with "Mention everyone" reaches the channel');
  UPDATE public.workspace_chat_caps SET mention_everyone = false
   WHERE workspace_id = test.id('W') AND role_key = 'member';
  v := test.send('B', 'Q', 'all2', '@channel standup moved again');
  PERFORM test.ok(v LIKE 'ok %' AND NOT (test.msg('all2')).mentions_everyone
                  AND (test.msg('all2')).body = '@channel standup moved again' AND test.acts('all2') = 0,
    '@channel: without the switch it is stored as plain text and nobody is pinged', v);
  PERFORM test.ok(test.send('D', 'Q', 'all3', 'heads up @channel') LIKE 'ok %' AND (test.msg('all3')).mentions_everyone,
    '@channel: an admin keeps it');
  UPDATE public.workspace_chat_caps SET mention_everyone = true
   WHERE workspace_id = test.id('W') AND role_key = 'member';

  -- The sender's read mark moves to their message.
  PERFORM test.ok((SELECT last_read_id FROM public.chat_members WHERE channel_id = test.ref('Q') AND user_id = test.id('D'))
                  = test.mid('all3'),
    'read mark: the sender has read up to their own message');
END;
$$;

-- ── Replies join their root's chain ─────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.send('A', 'Q', 'root', 'Which day?') LIKE 'ok %', 'chain: A asks');
  v := test.send('B', 'Q', 'r1', 'Friday', 'root');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('r1')).parent_id = test.mid('root') AND (test.msg('r1')).reply_to_id = test.mid('root'),
    'chain: a reply joins the root and quotes it', v);
  v := test.send('C', 'Q', 'r2', 'Friday works', 'r1');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('r2')).parent_id = test.mid('root') AND (test.msg('r2')).reply_to_id = test.mid('r1'),
    'chain: a reply to a reply joins the root''s chain and quotes the reply', v);
  PERFORM test.ok((test.msg('root')).reply_count = 2
                  AND (test.msg('root')).reply_user_ids = ARRAY[test.id('C'), test.id('B')]
                  AND (test.msg('root')).last_reply_at = (test.msg('r2')).created_at,
    'chain: "2 replies", the last people to reply first');
  PERFORM test.ok(test.acts('r2', 'chat.reply', 'C') = 1
                  AND (SELECT payload -> 'notify_user_ids' @> jsonb_build_array(test.id('A')::text, test.id('B')::text)
                         AND NOT payload -> 'notify_user_ids' ? test.id('C')::text
                        FROM public.module_activity WHERE payload ->> 'message_id' = test.mid('r2')::text),
    'chain: the root''s author and the chain''s people hear the reply, not its sender');
  v := test.send('B', 'Q', 'r3', 'wrong place', 'p1');
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chain: a reply to another conversation''s message is refused', v);
  PERFORM test.ok((SELECT last_message_at FROM public.chat_channels WHERE id = test.ref('Q')) = (test.msg('r2')).created_at,
    'chain: a reply moves the conversation''s last message (replies post at the bottom)');
END;
$$;

-- ── Edit ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, %L::text)$q$, test.mid('b1'),
    format('from a member, now with moduo://person/%s', test.id('A'))));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('b1')).edited_at IS NOT NULL
                  AND (test.msg('b1')).mentioned_user_ids = ARRAY[test.id('A')]
                  AND test.acts('b1', 'chat.message_edit', 'B') = 1
                  AND test.acts('b1', 'chat.mention') = 1,
    'edit: the author edits; mentions are read again; one attributed row; A, named for the first time, hears it (CV-5)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, %L::text)$q$, test.mid('b1'),
    format('from a member, now with moduo://person/%s', test.id('A'))));
  PERFORM test.ok(v = 'ok 1' AND test.acts('b1', 'chat.message_edit') = 1, 'edit: the same text again changes nothing', v);
  v := test.as_user('D', format($q$SELECT public.chat_op_edit(%L::uuid, 'admin edit'::text)$q$, test.mid('b1')));
  PERFORM test.ok(v = '42501 You can only edit your own messages.', 'edit: an admin can''t edit someone else''s message', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_edit(%L::uuid, 'manager edit'::text)$q$, test.mid('b1')));
  PERFORM test.ok(v = '42501 You can only edit your own messages.', 'edit: nor can the channel''s manager', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_edit(%L::uuid, 'viewer edit'::text)$q$, test.mid('b1')));
  PERFORM test.ok(v = '42501 You can only edit your own messages.', 'edit: nor a viewer', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_edit(%L::uuid, 'outsider'::text)$q$, test.mid('b1')));
  PERFORM test.ok(v LIKE '42501 %', 'edit: nor an outsider', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_edit(%L::uuid, 'key'::text)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE '42501 %', 'edit: nor a key', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, %L::text)$q$, test.mid('b1'), repeat('b', 8001)));
  PERFORM test.ok(v = '22023 That message is 8,001 characters long; the most is 8,000.', 'edit: too long is refused with the count', v);
  PERFORM test.ok((test.msg('b1')).body LIKE 'from a member, now with %', 'edit: a refusal keeps the text');
END;
$$;

-- ── Delete, Undo, and the blank job ─────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('C', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = '42501 You can only delete your own messages.', 'delete: a member can''t delete someone else''s', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = '42501 You can only delete your own messages.', 'delete: nor can the channel''s manager', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = '42501 You can only delete your own messages.', 'delete: nor a viewer', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v LIKE '42501 %', 'delete: nor an outsider', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE '42501 %', 'delete: nor a key', v);

  v := test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('r1')).deleted_at IS NOT NULL AND (test.msg('r1')).body = 'Friday'
                  AND test.acts('r1', 'chat.message_delete', 'B') = 1,
    'delete: the author''s message is hidden at once, its text kept for Undo; one attributed row', v);
  PERFORM test.ok((test.msg('root')).reply_count = 1 AND (test.msg('root')).reply_user_ids = ARRAY[test.id('C')],
    'delete: the chain counts what''s left');
  v := test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = 'ok 1' AND test.acts('r1', 'chat.message_delete') = 1, 'delete: twice is once', v);
  -- Other people's deleted messages on a shared stack are blanked first, so the counts below are this test's.
  PERFORM public.chat__blank_deleted();
  PERFORM test.ok(public.chat__blank_deleted() = 0 AND (test.msg('r1')).body = 'Friday',
    'blank job: nothing is blanked inside the window');

  v := test.as_user('B', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('r1')).deleted_at IS NULL AND test.acts('r1', 'chat.message_restore', 'B') = 1
                  AND (test.msg('root')).reply_count = 2,
    'restore: Undo brings it back with its chain place; one attributed row', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('r1')));
  PERFORM test.ok(v = 'ok 1' AND test.acts('r1', 'chat.message_restore') = 1, 'restore: twice is once', v);

  -- An admin deletes someone else's message ("Delete others' messages").
  UPDATE public.chat_messages SET reactions = jsonb_build_object('👍', jsonb_build_array(test.id('C')::text)),
         pinned_at = now(), pinned_by = test.id('A')
   WHERE id = test.mid('m1');
  v := test.as_user('D', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('m1')));
  PERFORM test.ok(v = 'ok 1' AND test.acts('m1', 'chat.message_delete', 'D') = 1, 'delete: an admin deletes B''s message', v);
  PERFORM test.ok((test.msg('m1')).deleted_by = test.id('D'), 'delete: the row says who deleted it');
  v := test.as_user('B', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('m1')));
  PERFORM test.ok(v = '42501 Only the person who deleted it can undo that.' AND (test.msg('m1')).deleted_at IS NOT NULL,
    'restore: the author can''t undo a delete by someone else', v);
  v := test.as_user('D', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('m1')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('m1')).deleted_at IS NULL AND (test.msg('m1')).deleted_by IS NULL,
    'restore: the admin who deleted it can', v);
  v := test.as_user('D', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('m1')));
  UPDATE public.chat_messages SET deleted_at = clock_timestamp() - interval '20 seconds' WHERE id = test.mid('m1');
  v := test.as_user('D', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('m1')));
  PERFORM test.ok(v = '22023 It''s too late to undo that delete.', 'restore: after the window it''s too late', v);
  PERFORM test.ok(public.chat__blank_deleted() = 1
                  AND (test.msg('m1')).body = '' AND (test.msg('m1')).body_text = ''
                  AND (test.msg('m1')).mentioned_user_ids = '{}' AND (test.msg('m1')).mentioned_team_ids = '{}'
                  AND (test.msg('m1')).reactions = '{}'::jsonb AND (test.msg('m1')).pinned_at IS NULL
                  AND (test.msg('m1')).deleted_at IS NOT NULL,
    'blank job: after the window the text, mentions, reactions and pin are blanked');
  PERFORM test.ok((SELECT payload ->> 'excerpt' FROM public.module_activity
                    WHERE payload ->> 'message_id' = test.mid('m1')::text AND op = 'chat.mention') = '',
    'blank job: the bell''s excerpt of the deleted message is blanked too');
  PERFORM test.ok(public.chat__blank_deleted() = 0, 'blank job: a second run blanks nothing');
  PERFORM test.ok(EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-blank-deleted' AND schedule = '* * * * *'),
    'blank job: chat-blank-deleted runs every minute');

  -- An app's message (no author): only "Delete others' messages" deletes it.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, author_label, body)
  VALUES (test.mid('app'), test.id('W'), test.ref('Q'), NULL, 'api_key', 'Claude Desktop', 'deployed');
  SET LOCAL session_replication_role = origin;
  PERFORM test.ok(public.chat__may_delete(test.msg('app'), test.id('B')) IS FALSE
                  AND test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('app')))
                        = '42501 You can only delete your own messages.'
                  AND test.as_user('D', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('app'))) = 'ok 1',
    'delete: an app''s message is deleted by an admin, not by a member');

  -- A deleted root keeps its chain.
  v := test.as_user('A', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('root')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('root')).reply_count = 2
                  AND (SELECT count(*) FROM public.chat_messages WHERE parent_id = test.mid('root') AND deleted_at IS NULL) = 2,
    'delete: a deleted root keeps its chain', v);
  v := test.send('C', 'Q', 'r4', 'and a quote of the deleted root', 'root');
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chain: a deleted message can''t be replied to', v);
  PERFORM test.ok(test.send('C', 'Q', 'r5', 'still in the chain', 'r2') LIKE 'ok %'
                  AND (test.msg('r5')).parent_id = test.mid('root') AND (test.msg('root')).reply_count = 3,
    'chain: a reply to a live reply still joins the deleted root''s chain');
END;
$$;

-- ── Archived, deleted, left and removed ─────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'old-room', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C')));
  INSERT INTO test.ids SELECT 'OLD', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'old-room';
  PERFORM test.ok(test.send('B', 'OLD', 'old1', 'before the archive') LIKE 'ok %'
                  AND test.send('C', 'OLD', 'old2', 'me too') LIKE 'ok %', 'setup: B and C write in OLD');

  -- Removed by a manager: no posting back in; leaving on your own and posting rejoins.
  UPDATE public.chat_members SET left_at = now(), removed_at = now(), removed_by = test.id('A')
   WHERE channel_id = test.ref('OLD') AND user_id = test.id('C');
  v := test.send('C', 'OLD', 'old3', 'let me back in');
  PERFORM test.ok(v = '42501 You were removed from this conversation.' AND test.msg('old3') IS NULL
                  AND (SELECT left_at FROM public.chat_members WHERE channel_id = test.ref('OLD') AND user_id = test.id('C')) IS NOT NULL,
    'removed: C, removed from the public OLD, can''t post their way back in', v);
  PERFORM test.ok(test.as_user('C', format($q$SELECT public.chat_op_edit(%L::uuid, 'edited after removal'::text)$q$, test.mid('old2')))
                        = '42501 You were removed from this conversation.'
                  AND test.as_user('C', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('old2')))
                        = '42501 Your role can''t pin messages here.'
                  AND test.as_user('C', format($q$SELECT public.chat_op_react(%L::uuid, '👀'::text, true)$q$, test.mid('old2'))) = 'ok 1',
    'removed: C can''t edit or pin in OLD any more; reading it, C may still react');
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = test.ref('OLD') AND user_id = test.id('B');
  v := test.send('B', 'OLD', 'old4', 'back again');
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT left_at FROM public.chat_members WHERE channel_id = test.ref('OLD') AND user_id = test.id('B')) IS NULL,
    'left: B, who left OLD, posts and is back in', v);

  -- Removed from a private conversation: nothing there any more, own messages included.
  UPDATE public.chat_members SET left_at = now(), removed_at = now(), removed_by = test.id('A')
   WHERE channel_id = test.ref('P') AND user_id = test.id('B');
  PERFORM test.ok(test.send('B', 'P', 'p2', 'still here?') = '42501 You''re not a member of this conversation.'
                  AND test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('p1')))
                        = 'P0002 That message no longer exists.',
    'removed: B, removed from the private P, can''t post or react there');
  UPDATE public.chat_members SET left_at = NULL, removed_at = NULL, removed_by = NULL
   WHERE channel_id = test.ref('P') AND user_id = test.id('B');

  -- Archived: read-only (a message can still be deleted).
  v := test.as_user('A', format($q$SELECT public.chat_op_archive_channel(%L, true)$q$, test.ref('OLD')));
  PERFORM test.ok(v = 'ok 1', 'setup: A archives OLD', v);
  PERFORM test.ok(test.send('B', 'OLD', 'old5', 'after the archive') = '42501 This channel is archived.'
                  AND test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, 'edited late'::text)$q$, test.mid('old1')))
                        = '42501 This channel is archived.'
                  AND test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('old2')))
                        = '42501 This channel is archived.'
                  AND test.as_user('A', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('old1')))
                        = '42501 This channel is archived.',
    'archived: no sending, editing, reacting or pinning');
  PERFORM test.ok(test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('old1'))) = 'ok 1',
    'archived: the author can still delete their message');

  -- Deleted: gone for everyone.
  UPDATE public.chat_channels SET deleted_at = now(), deleted_by = test.id('A') WHERE id = test.ref('OLD');
  PERFORM test.ok(test.as_user('B', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('old1')))
                        = 'P0002 That conversation no longer exists.'
                  AND test.as_user('C', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('old2')))
                        = 'P0002 That conversation no longer exists.'
                  AND test.as_user('D', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('old2')))
                        = 'P0002 That message no longer exists.'
                  AND test.send('D', 'OLD', 'old6', 'hello?') = 'P0002 That conversation no longer exists.',
    'deleted channel: it is gone for everyone, an admin included');
END;
$$;

-- ── React: readers, viewers too, explicit on and off ───────────────────────
DO $$
DECLARE
  v text;
  v_acts int;
BEGIN
  v := test.as_user('V', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('a1')).reactions -> '👍' = jsonb_build_array(test.id('V')::text)
                  AND test.acts('a1', 'chat.react', 'V') = 1,
    'react: a viewer reacts; one attributed row', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'ok 1' AND jsonb_array_length((test.msg('a1')).reactions -> '👍') = 1 AND test.acts('a1', 'chat.react') = 1,
    'react: on twice is on once (no toggle, no second row)', v);
  PERFORM test.ok(test.as_user('O', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1'))) = 'ok 1'
                  AND test.as_user('D', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1'))) = 'ok 1'
                  AND test.as_user('A', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1'))) = 'ok 1'
                  AND test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1'))) = 'ok 1'
                  AND jsonb_array_length((test.msg('a1')).reactions -> '👍') = 5,
    'react: the owner, an admin, the manager and a member react');
  v := test.as_user('V', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, false)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'ok 1' AND NOT ((test.msg('a1')).reactions -> '👍' ? test.id('V')::text) AND test.acts('a1', 'chat.react', 'V') = 2,
    'react: off takes it away', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, false)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'ok 1' AND test.acts('a1', 'chat.react', 'V') = 2, 'react: off twice is off once', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('p1')));
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'react: C can''t react in P, which C can''t read (same answer as a missing message)', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'react: an outsider is refused (same answer as a missing message)', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'react: a key is refused', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity WHERE payload ->> 'message_id' = test.mid('a1')::text
                                AND op IN ('chat.mention', 'chat.reply')),
    'react: never notifies');
  PERFORM test.ok((SELECT bool_and(NOT payload ? 'body' AND NOT payload ? 'excerpt' AND NOT payload ? 'notify_user_ids')
                     FROM public.module_activity WHERE op IN ('chat.react', 'chat.message_edit', 'chat.message_delete', 'chat.message_restore')),
    'activity: the ops'' rows carry ids, never text');

  -- At most 20 kinds per message.
  UPDATE public.chat_messages
     SET reactions = (SELECT jsonb_object_agg(chr(128512 + g), jsonb_build_array(test.id('C')::text)) FROM generate_series(1, 20) g)
   WHERE id = test.mid('o1');
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, chr(128512 + 21), true)$q$, test.mid('o1')));
  PERFORM test.ok(v = '22023 This message has the most reactions it can hold.', 'react: a 21st kind is refused', v);
  PERFORM test.ok(test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, chr(128512 + 1), true)$q$, test.mid('o1'))) = 'ok 1',
    'react: joining one of the 20 still works');
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, %L::text, true)$q$, test.mid('o1'), repeat('x', 33)));
  PERFORM test.ok(v = '22023 That reaction isn''t supported.', 'react: a key is an emoji (the shared check, CV-7c)', v);

  -- A paused workspace can still react; it can't post.
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  v_acts := test.acts('d1', 'chat.react');
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, '🎉'::text, true)$q$, test.mid('d1')));
  PERFORM test.ok(v = 'ok 1' AND test.acts('d1', 'chat.react') = v_acts + 1, 'plan off: reacting still works (§Assumptions #25)', v);
  v := test.send('B', 'Q', 'paused', 'hello?');
  PERFORM test.ok(v = '42501 Chat is available on the Duo and Team plans.', 'plan off: sending needs the plan', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, 'paused edit'::text)$q$, test.mid('b1')));
  PERFORM test.ok(v = '42501 Chat is available on the Duo and Team plans.', 'plan off: editing needs the plan', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('b1')));
  PERFORM test.ok(v = '42501 Chat is available on the Duo and Team plans.', 'plan off: deleting needs the plan', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('b1')));
  PERFORM test.ok(v = '42501 Chat is available on the Duo and Team plans.', 'plan off: pinning needs the plan', v);
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
END;
$$;

-- ── Pin ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg('a1')).pinned_by = test.id('B') AND test.acts('a1', 'chat.pin', 'B') = 1,
    'pin: a member pins; one attributed row', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = 'ok 1' AND test.acts('a1', 'chat.pin') = 1, 'pin: twice is once', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_pin(%L::uuid, false)$q$, test.mid('a1')));
  PERFORM test.ok(v = '42501 Your role can''t pin messages here.', 'pin: a viewer can''t', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_pin(%L::uuid, false)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE '42501 %', 'pin: nor an outsider', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_pin(%L::uuid, false)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE '42501 %', 'pin: nor a key', v);
  PERFORM test.ok(test.as_user('O', format($q$SELECT public.chat_op_pin(%L::uuid, false)$q$, test.mid('a1'))) = 'ok 1'
                  AND (test.msg('a1')).pinned_at IS NULL AND test.acts('a1', 'chat.pin', 'O') = 1,
    'pin: the owner unpins');
  PERFORM test.ok(test.as_user('D', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('d1'))) = 'ok 1'
                  AND test.as_user('A', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('o1'))) = 'ok 1',
    'pin: an admin and the manager pin');
  -- Announcement channel N: its managers (and admins, who manage any channel).
  v := test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('n1')));
  PERFORM test.ok(v = '42501 Your role can''t pin messages here.', 'pin: a member can''t pin in the announcement channel', v);
  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('n1'))) = 'ok 1'
                  AND test.as_user('D', format($q$SELECT public.chat_op_pin(%L::uuid, false)$q$, test.mid('n1'))) = 'ok 1',
    'pin: its manager and an admin can');

  -- Event lines are not pinned (nor reacted to, nor replied to).
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, kind, event)
  VALUES (test.mid('ev'), test.id('W'), test.ref('Q'), test.id('A'), '', 'event',
          jsonb_build_object('type', 'moved_in'));
  SET LOCAL session_replication_role = origin;
  v := test.as_user('A', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('ev')));
  PERFORM test.ok(v = '22023 Only a message can be pinned.', 'pin: an event line can''t be pinned', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('ev')));
  PERFORM test.ok(v = '22023 Only a message takes reactions.', 'react: an event line takes none', v);
  v := test.send('B', 'Q', 'r6', 'about that move', 'ev');
  PERFORM test.ok(v = '22023 Only a message can be replied to.', 'chain: an event line can''t be replied to', v);

  -- At most 100 live pins per conversation.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, pinned_at, pinned_by)
  SELECT test.mid('pin' || g), test.id('W'), test.ref('Q'), test.id('A'), 'pin ' || g, now(), test.id('A')
    FROM generate_series(1, 100 - (SELECT count(*)::int FROM public.chat_messages
                                   WHERE channel_id = test.ref('Q') AND pinned_at IS NOT NULL AND deleted_at IS NULL)) g;
  SET LOCAL session_replication_role = origin;
  v := test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('b1')));
  PERFORM test.ok(v = '22023 This conversation has 100 pinned messages; unpin one first.', 'pin: a 101st is refused', v);
  PERFORM test.ok(test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, false)$q$, test.mid('pin1'))) = 'ok 1'
                  AND test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('b1'))) = 'ok 1',
    'pin: after one is unpinned there is room again');
  -- Undo of a pinned message's delete doesn't take the conversation past 100.
  v := test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('b1')))
       || test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('pin1')))
       || test.as_user('B', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('b1')));
  PERFORM test.ok(v = 'ok 1ok 1ok 1'
                  AND (test.msg('b1')).pinned_at IS NULL
                  AND (SELECT count(*) FROM public.chat_messages
                        WHERE channel_id = test.ref('Q') AND pinned_at IS NOT NULL AND deleted_at IS NULL) = 100
                  AND (SELECT count(*) FROM public.module_activity WHERE op = 'chat.pin'
                        AND payload ->> 'message_id' = test.mid('b1')::text AND payload ->> 'pinned' = 'false') = 1,
    'pin: a message restored into a full conversation comes back unpinned (and says so)', v);
END;
$$;

-- ── Sending limits (20261014155205): event lines and API keys ──────────────
-- F and H are fresh members, so earlier sends here don't count against them;
-- KH is H's key. The file is one transaction: every row has the same now().
DO $$
DECLARE
  v text;
  v_bad text := '';
  i int;
  c_limited constant text := 'PT429 You''re sending messages too quickly. Wait a moment and try again.';
BEGIN
  PERFORM test.person('F');
  PERFORM test.person('H');
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['F', 'H']) AS n
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('KH'), test.id('W'), 'H''s app', 'mdo_tsth', md5('db-test-key-cv2a-h'), '{"chat": "edit"}'::jsonb, test.id('H'));

  -- Event lines an op writes in F's name are not sends.
  FOR i IN 1 .. 12 LOOP
    v := test.as_op('F', format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, kind, event)
         VALUES (%L, %L, %L, '', 'event', '{"type": "moved_in"}'::jsonb)$q$,
      test.id('W'), test.ref('Q'), test.id('F')));
    IF v <> 'ok 1' THEN v_bad := v; END IF;
  END LOOP;
  PERFORM test.ok(v_bad = '', 'limits: twelve event lines in a moment are not held back', v_bad);
  FOR i IN 1 .. 10 LOOP
    v := test.send('F', 'Q', 'f' || i, 'message ' || i);
    IF v NOT LIKE 'ok %' THEN v_bad := v; END IF;
  END LOOP;
  PERFORM test.ok(v_bad = '', 'limits: and don''t count: F still sends ten messages', v_bad);
  v := test.send('F', 'Q', 'f11', 'one too many');
  PERFORM test.ok(v = c_limited, 'limits: F''s eleventh message in 10 s is refused with PT429', v);

  -- A message posted through a key counts against that key, not its person.
  v_bad := '';
  FOR i IN 1 .. 10 LOOP
    v := test.as_key('KH', format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, author_kind, author_label, body, api_key_id)
         VALUES (%L, %L, %L, 'api_key', 'H''s app', 'from the app', %L)$q$,
      test.id('W'), test.ref('Q'), test.id('H'), test.id('KH')));
    IF v <> 'ok 1' THEN v_bad := v; END IF;
  END LOOP;
  PERFORM test.ok(v_bad = '', 'limits: H''s key posts ten messages in a moment', v_bad);
  v := test.as_key('KH', format(
    $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, author_kind, author_label, body, api_key_id)
       VALUES (%L, %L, %L, 'api_key', 'H''s app', 'one too many', %L)$q$,
    test.id('W'), test.ref('Q'), test.id('H'), test.id('KH')));
  PERFORM test.ok(v = c_limited, 'limits: the key''s eleventh in 10 s is refused with PT429', v);
  PERFORM test.ok(test.send('H', 'Q', 'h1', 'and me, by hand') LIKE 'ok %',
    'limits: H''s own budget is H''s: the key''s posts don''t use it');
  PERFORM test.ok(test.as_key('K', format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, author_kind, author_label, body, api_key_id)
         VALUES (%L, %L, NULL, 'api_key', 'Claude Desktop', 'another app', %L)$q$,
      test.id('W'), test.ref('Q'), test.id('K'))) = 'ok 1',
    'limits: another key has its own budget');
END;
$$;

-- ── Typing: members only, sender from the session, quiet ───────────────────
DO $$
DECLARE
  v text;
  v_acts int;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'quiet-room', '', false, '{}'::uuid[])$q$, test.id('W')));
  INSERT INTO test.ids SELECT 'R', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'quiet-room';
  v_acts := test.all_acts();
  v := test.as_user('B', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT count(*) FROM realtime.messages WHERE topic = 'chat:typing:' || test.ref('Q')::text
                         AND payload ->> 'userId' = test.id('B')::text) >= 1,
    'typing: a member says they are typing, as themselves', v);
  v := test.as_user('O', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('R')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.', 'typing: the owner, who only reads the public R, is refused', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('P')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.', 'typing: C, not in P, is refused', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'typing: an outsider is refused', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v = '42501 permission denied for function chat_op_typing', 'typing: a key can''t say anyone is typing', v);
  PERFORM test.ok(test.all_acts() = v_acts, 'typing: logs no activity row');
END;
$$;

-- ── The stored form, read on the server ─────────────────────────────────────
DO $$
DECLARE
  a constant text := 'd037b0b7-4125-415d-bef9-72662d6b58e6';
  t constant text := '0b7e2a1c-1111-4222-8333-944455556666';
  m record;
BEGIN
  SELECT * INTO m FROM public.chat__mentions(format(
    E'hi moduo://person/%s\n```\nmoduo://person/%s @channel\n```\n> `@channel` [x](moduo://person/%s) moduo://team/%s',
    a, '11111111-1111-4111-8111-111111111111', upper(a), t));
  PERFORM test.ok(m.people = ARRAY[a::uuid] AND m.teams = ARRAY[t::uuid] AND NOT m.everyone,
    'mentions: each person once; nothing in a fence or code; a titled reference counts');
  PERFORM test.ok(
    (public.chat__mentions('@channel now')).everyone
    AND (public.chat__mentions('**@channel** now')).everyone
    AND (public.chat__mentions('> @channel')).everyone
    AND NOT (public.chat__mentions('a@channel')).everyone
    AND NOT (public.chat__mentions('a**@channel**')).everyone
    AND NOT (public.chat__mentions('@channels')).everyone
    AND NOT (public.chat__mentions('a **@channel')).everyone
    AND NOT (public.chat__mentions('`@channel`')).everyone
    AND (public.chat__mentions(format('[t](https://x.com/moduo://person/%s)', a))).people = '{}'
    AND (public.chat__mentions(format('moduo\://person/%s', a))).people = '{}',
    '@channel at a token start as a whole word; a link''s target and an escaped reference mention nobody');
  PERFORM test.ok(
    public.chat__excerpt(repeat('a', 130) || ' moduo://person/' || a) = repeat('a', 130) || ' '
    AND public.chat__excerpt('short moduo://person/' || a) = 'short moduo://person/' || a
    AND public.chat__excerpt(repeat('a', 100) || ' moduo://date/2026-10-14 tail ' || repeat('b', 20))
          = repeat('a', 100) || ' moduo://date/2026-10-14 tail ' || repeat('b', 10)
    AND public.chat__excerpt(repeat('a', 117) || ' moduo://date/2026-10-14 tail') = repeat('a', 117) || ' '
    AND public.chat__excerpt(repeat('a', 88) || ' moduo://person/' || a || ' tail') = repeat('a', 88) || ' moduo://person/' || a,
    'excerpt: 140 characters, never half a reference');
END;
$$;

-- ── Grants: definers pin search_path; helpers are server-only; ops are people's ──
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.oid IN (
           'public.chat_op_send(uuid, uuid, text, uuid)'::regprocedure,
           'public.chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)'::regprocedure,
           'public.chat_op_edit(uuid, text)'::regprocedure,
           'public.chat_op_edit(uuid, text, uuid[])'::regprocedure,
           'public.chat_op_delete(uuid)'::regprocedure,
           'public.chat_op_restore(uuid)'::regprocedure,
           'public.chat_op_react(uuid, text, boolean)'::regprocedure,
           'public.chat_op_react(uuid, text)'::regprocedure,
           'public.chat_op_pin(uuid, boolean)'::regprocedure,
           'public.chat_op_typing(uuid, uuid, boolean)'::regprocedure,
           'public.chat_op_agent_post(uuid, uuid, text, uuid)'::regprocedure,
           'public.chat_op__guard(uuid)'::regprocedure,
           'public.chat_op__channel(uuid)'::regprocedure,
           'public.chat_op__reader(uuid)'::regprocedure,
           'public.chat_has_cap(uuid, uuid, text)'::regprocedure)
     AND (NOT p.prosecdef
          OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
          OR p.proacl IS NULL
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
          OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  PERFORM test.ok(v_bad IS NULL, 'definers: search_path pinned, no PUBLIC or anon EXECUTE', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat__mentions(text)', 'chat__mentions_inline(text)', 'chat__mentions_ref_at(text)',
                      'share_chat_message_guard()', 'chat_send_limit()',
                      'chat__excerpt(text)', 'chat__chain_refresh(uuid)', 'chat__may_delete(public.chat_messages, uuid)',
                      'chat__blank_deleted(integer)', 'chat_op__guard(uuid)', 'chat_op__channel(uuid)',
                      'chat_op__reader(uuid)', 'chat_has_cap(uuid, uuid, text)', 'chat_op_agent_post(uuid, uuid, text, uuid)']) AS f
   WHERE has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
      OR has_function_privilege('anon', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the helpers are not callable by signed-in people or anon', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat_op_send(uuid, uuid, text, uuid)', 'chat_op_edit(uuid, text)', 'chat_op_delete(uuid)',
                      'chat_op_restore(uuid)', 'chat_op_react(uuid, text, boolean)', 'chat_op_pin(uuid, boolean)',
                      'chat_op_typing(uuid, uuid, boolean)']) AS f
   WHERE NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: signed-in people call the ops', v_bad);
  PERFORM test.ok(NOT has_function_privilege('service_role', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE'),
    'grants: typing is people''s only');
  PERFORM test.ok((SELECT column_default FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'format_version') = '2',
    'columns: new rows default to format_version 2');
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- CV-2b: the conversation ops (…_chat_v2_conversation_ops). "Every op, every
-- role" (AC10.1, AC12.1), conversations half; "names as typed, General, the
-- last manager" (AC10.2, AC10.7, AC1.12); a former member (AC6.5); the access
-- check and the people list.
-- ════════════════════════════════════════════════════════════════════════════

-- A live channel of W by name.
CREATE FUNCTION test.conv(p_name text) RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT id FROM public.chat_channels
   WHERE workspace_id = test.id('W') AND kind = 'channel' AND name = p_name AND deleted_at IS NULL
$$;
CREATE FUNCTION test.member(p_conv uuid, p_who text) RETURNS public.chat_members LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_members WHERE channel_id = p_conv AND user_id = test.id(p_who)
$$;
CREATE FUNCTION test.manages(p_conv uuid, p_who text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
  SELECT EXISTS (SELECT 1 FROM public.chat_channel_managers WHERE channel_id = p_conv AND user_id = test.id(p_who))
$$;
-- Activity rows about one conversation: of one op, by one person.
CREATE FUNCTION test.cacts(p_conv uuid, p_op text DEFAULT NULL, p_who text DEFAULT NULL) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.module_activity a
   WHERE a.workspace_id = test.id('W') AND a.entity_id = p_conv
     AND (p_op IS NULL OR a.op = p_op)
     AND (p_who IS NULL OR (a.actor_type = 'user' AND a.actor_id = test.id(p_who)))
$$;
-- An op on one conversation as a person (K: the key): 'ok <rows>' or '<sqlstate> <message>'.
CREATE FUNCTION test.conv_op(p_who text, p_call text, p_conv uuid, p_rest text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN p_who = 'K'
              THEN test.as_key('K', format('SELECT public.%s(%L::uuid%s)', p_call, p_conv, p_rest))
              ELSE test.as_user(p_who, format('SELECT public.%s(%L::uuid%s)', p_call, p_conv, p_rest)) END
$$;

-- ── General: made once, everyone in it, leaving sticks (#11) ───────────────
DO $$
DECLARE
  v text;
  v_g uuid := (SELECT id FROM public.chat_channels WHERE workspace_id = test.id('W') AND is_default);
  v_n int;
BEGIN
  INSERT INTO test.ids VALUES ('G', v_g);
  PERFORM test.ok((SELECT name FROM public.chat_channels WHERE id = v_g) = 'General'
                  AND (SELECT count(*) FROM public.chat_channels WHERE workspace_id = test.id('W') AND is_default) = 1,
    'General: bootstrap made one "General", flagged is_default');
  SELECT count(*) INTO v_n FROM public.chat_members
   WHERE channel_id = v_g AND left_at IS NULL
     AND user_id IN (SELECT test.id(n) FROM unnest(ARRAY['O', 'D', 'A', 'B', 'C', 'V', 'E']) n);
  PERFORM test.ok(v_n = 7,
    'General: everyone in the workspace is in it (the owner, an admin, members, a viewer, a custom role), so they can type there',
    v_n::text);
  PERFORM test.ok(test.manages(v_g, 'O')
                  AND EXISTS (SELECT 1 FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = v_g AND label = 'General'),
    'General: the owner manages it; it is registered under its name');
  v := test.as_user('V', format($q$SELECT (public.chat_op_bootstrap(%L)).id$q$, test.id('W')));
  PERFORM test.ok(v = 'ok 1' AND (SELECT count(*) FROM public.chat_channels WHERE workspace_id = test.id('W') AND is_default) = 1
                  AND test.cacts(v_g) = 0,
    'General: bootstrap again (a viewer) finds it, makes nothing new and logs nothing', v);

  v := test.conv_op('C', 'chat_op_leave', v_g);
  PERFORM test.ok(v = 'ok 1' AND (test.member(v_g, 'C')).left_at IS NOT NULL AND test.cacts(v_g, 'chat.leave', 'C') = 1,
    'General: C leaves it (the row is stamped, one attributed leave row)', v);
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok((test.member(v_g, 'C')).left_at IS NOT NULL, 'General: leaving sticks (bootstrap doesn''t put C back)');
  PERFORM test.person('J');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('J'), 'member');
  PERFORM test.ok((test.member(v_g, 'J')).left_at IS NULL AND (test.member(v_g, 'J')).notify_level = 'mentions',
    'General: a new member of the workspace joins it by trigger, on Mentions and replies');
  PERFORM test.conv_op('J', 'chat_op_leave', v_g);
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('J');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('J'), 'member');
  PERFORM test.ok((test.member(v_g, 'J')).left_at IS NOT NULL,
    'General: someone who left it, then the workspace, stays out of it when they come back');
  v := test.conv_op('C', 'chat_op_join', v_g);
  PERFORM test.ok(v = 'ok 1' AND (test.member(v_g, 'C')).left_at IS NULL AND test.cacts(v_g, 'chat.join', 'C') = 1,
    'General: C joins it again', v);
  v := test.conv_op('O', 'chat_op_archive_channel', v_g, ', true');
  PERFORM test.ok(v = '22023 General can''t be archived.', 'General: it can''t be archived (the owner tried)', v);

  -- A workspace with no channels yet: a viewer opening chat first makes it.
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W3'), test.id('O'), 'Fresh');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W3'), test.id('V'), 'viewer');
  v := test.as_user('V', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W3')));
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT count(*) FROM public.chat_members m JOIN public.chat_channels c ON c.id = m.channel_id
                        WHERE c.workspace_id = test.id('W3') AND c.is_default AND c.name = 'General'
                          AND m.user_id IN (test.id('O'), test.id('V'))) = 2,
    'General: in a new workspace a viewer''s first open makes it, the owner and the viewer in it', v);
  -- A workspace from before General: its live public "general" becomes General.
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W4'), test.id('O'), 'Older');
  INSERT INTO public.chat_channels (id, workspace_id, kind, name) VALUES (test.id('W4:g'), test.id('W4'), 'channel', 'general');
  v := test.as_user('O', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W4')));
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT is_default FROM public.chat_channels WHERE id = test.id('W4:g'))
                  AND (SELECT count(*) FROM public.chat_channels WHERE workspace_id = test.id('W4')) = 1
                  AND (test.member(test.id('W4:g'), 'O')).left_at IS NULL,
    'General: an older workspace''s "general" is flagged, not doubled, and its people are put in it', v);
  -- A member's own channel named "general" never becomes General.
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W5'), test.id('O'), 'Squat');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W5'), test.id('B'), 'member');
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'general')$q$, test.id('W5')));
  v := test.as_user('B', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W5')));
  PERFORM test.ok(v = 'ok 1'
                  AND NOT (SELECT is_default FROM public.chat_channels WHERE workspace_id = test.id('W5') AND name = 'general')
                  AND (SELECT name FROM public.chat_channels WHERE workspace_id = test.id('W5') AND is_default) = 'General 2'
                  AND (SELECT created_by FROM public.chat_channels WHERE workspace_id = test.id('W5') AND is_default) = test.id('O'),
    'General: a member''s own "general" isn''t made General; General is the owner''s (its name taken, "General 2")', v);
END;
$$;

-- ── Create: names as typed (AC10.2), who may (AC10.1), the announcement switch ──
DO $$
DECLARE
  v text;
  v_l uuid;
BEGIN
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'Launch v1', 'Ship it', false, ARRAY[%L, %L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('V'), test.id('A'), test.id('X')));
  v_l := test.conv('Launch v1');
  INSERT INTO test.ids VALUES ('L', v_l);
  PERFORM test.ok(v = 'ok 1' AND v_l IS NOT NULL, 'names: "Launch v1" is stored as typed', v);
  PERFORM test.ok(test.manages(v_l, 'A')
                  AND (SELECT count(*) FROM public.chat_channel_managers WHERE channel_id = v_l) = 1
                  AND (test.member(v_l, 'A')).notify_level = 'mentions'
                  AND (test.member(v_l, 'B')).notify_level = 'mentions'
                  AND (SELECT count(*) FROM public.chat_members WHERE channel_id = v_l AND left_at IS NULL
                         AND user_id IN (test.id('A'), test.id('B'), test.id('V'))) = 3
                  AND (SELECT count(*) FROM public.chat_members WHERE channel_id = v_l) = 3,
    'create: A manages it, on Mentions and replies like B and the viewer V; X, outside the workspace, is skipped (AC1.7)');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = v_l AND label = 'Launch v1')
                  AND test.cacts(v_l, 'chat.channel_create', 'A') = 1 AND test.cacts(v_l) = 1
                  AND (SELECT payload FROM public.module_activity WHERE entity_id = v_l) = '{"is_private": false}'::jsonb,
    'create: registered for ⌘K under its name; one attributed activity row, ids only');

  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'launch v1')$q$, test.id('W')));
  PERFORM test.ok(v = '23505 A channel named "launch v1" already exists.', 'names: "launch v1" is refused as a duplicate', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, '   ')$q$, test.id('W')));
  PERFORM test.ok(v = '22023 Give the channel a name.', 'names: a name of spaces is refused', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, %L)$q$, test.id('W'), repeat('x', 81)));
  PERFORM test.ok(v = '22023 A channel name can be up to 80 characters (this one has 81).', 'names: 81 characters are refused', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, %L)$q$, test.id('W'), repeat('y', 80)));
  PERFORM test.ok(v = 'ok 1', 'names: 80 characters are fine', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, %L)$q$, test.id('W'), 'two' || chr(10) || 'lines'));
  PERFORM test.ok(v = '22023 A channel name fits on one line.', 'names: a line break is refused', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'Acme rebrand', %L)$q$, test.id('W'), repeat('t', 251)));
  PERFORM test.ok(v = '22023 A topic can be up to 250 characters (this one has 251).', 'topics: 251 characters are refused', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, '  Acme rebrand  ')$q$, test.id('W')));
  PERFORM test.ok(v = 'ok 1' AND test.conv('Acme rebrand') IS NOT NULL, 'names: spaces around a name are trimmed', v);
  INSERT INTO test.ids VALUES ('AR', test.conv('Acme rebrand'));

  v := test.as_user('V', format($q$SELECT public.chat_op_create_channel(%L, 'Viewer room')$q$, test.id('W')));
  PERFORM test.ok(v = '42501 Your role can''t create channels.', 'create: a viewer can''t', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_create_channel(%L, 'Viewer room', '', true)$q$, test.id('W')));
  PERFORM test.ok(v = '42501 Your role can''t create private channels.', 'create: nor a private one', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_create_channel(%L, 'Outside')$q$, test.id('W')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'create: an outsider can''t', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_create_channel(%L, 'From an app')$q$, test.id('W')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'create: a key can''t', v);
  PERFORM test.ok(test.as_user('O', format($q$SELECT public.chat_op_create_channel(%L, 'Owner room')$q$, test.id('W'))) = 'ok 1'
                  AND test.as_user('D', format($q$SELECT public.chat_op_create_channel(%L, 'Admin room')$q$, test.id('W'))) = 'ok 1'
                  AND test.as_user('E', format($q$SELECT public.chat_op_create_channel(%L, 'Contractor room')$q$, test.id('W'))) = 'ok 1',
    'create: the owner, an admin and a custom-role member can');
  UPDATE public.workspace_chat_caps SET create_private = false WHERE workspace_id = test.id('W') AND role_key = 'member';
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'Hidden', '', true)$q$, test.id('W')));
  PERFORM test.ok(v = '42501 Your role can''t create private channels.', 'create: "Create private channels" off, a member can''t', v);
  UPDATE public.workspace_chat_caps SET create_private = true WHERE workspace_id = test.id('W') AND role_key = 'member';

  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Founders', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  INSERT INTO test.ids VALUES ('FO', test.conv('Founders'));
  PERFORM test.ok(v = 'ok 1' AND (SELECT is_private FROM public.chat_channels WHERE id = test.ref('FO')),
    'create: A makes the private channel Founders with B', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Desk', '', false, ARRAY[%L, %L]::uuid[], true)$q$,
    test.id('W'), test.id('B'), test.id('C')));
  INSERT INTO test.ids VALUES ('DK', test.conv('Desk'));
  PERFORM test.ok(v = 'ok 1' AND (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('DK'))
                  AND test.manages(test.ref('DK'), 'A'),
    'create: the announcement switch at creation, its creator managing it (AC1.12)', v);
  v := test.send('B', 'DK', 'dk-b', 'can I?');
  PERFORM test.ok(v = '42501 Only managers can post in this channel.', 'create: in it only its managers post', v);
END;
$$;

-- ── Rename (managers, admins), topic (posters) ─────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.conv_op('B', 'chat_op_update_channel', test.ref('L'), ', ''Launch v2''');
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can rename it.', 'rename: a member can''t', v);
  v := test.conv_op('V', 'chat_op_update_channel', test.ref('L'), ', ''Launch v2''');
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can rename it.', 'rename: a viewer can''t', v);
  v := test.conv_op('A', 'chat_op_update_channel', test.ref('L'), ', ''Launch v2''');
  PERFORM test.ok(v = 'ok 1' AND (SELECT name FROM public.chat_channels WHERE id = test.ref('L')) = 'Launch v2'
                  AND EXISTS (SELECT 1 FROM public.entities WHERE entity_id = test.ref('L') AND label = 'Launch v2')
                  AND test.cacts(test.ref('L'), 'chat.channel_rename', 'A') = 1,
    'rename: its manager renames it; the registry label follows; one attributed row', v);
  v := test.conv_op('D', 'chat_op_update_channel', test.ref('L'), ', ''Launch V2''');
  PERFORM test.ok(v = 'ok 1' AND (SELECT name FROM public.chat_channels WHERE id = test.ref('L')) = 'Launch V2',
    'rename: an admin ("Manage any channel"), not its manager, renames it; a change of case is its own name', v);
  v := test.conv_op('O', 'chat_op_update_channel', test.ref('L'), ', ''Launch v1''');
  PERFORM test.ok(v = 'ok 1', 'rename: the owner renames it', v);
  v := test.conv_op('A', 'chat_op_update_channel', test.ref('L'), ', ''acme rebrand''');
  PERFORM test.ok(v = '23505 A channel named "acme rebrand" already exists.', 'rename: to another channel''s name is refused', v);
  v := test.conv_op('A', 'chat_op_update_channel', test.ref('L'), ', ''Launch v1''');
  PERFORM test.ok(v = 'ok 1' AND test.cacts(test.ref('L'), 'chat.channel_rename') = 3,
    'rename: the same name again changes and logs nothing', v);
  PERFORM test.ok(test.conv_op('X', 'chat_op_update_channel', test.ref('L'), ', ''Mine''') = '42501 You don''t have access to this workspace.'
                  AND test.conv_op('K', 'chat_op_update_channel', test.ref('L'), ', ''Mine''') = '42501 You don''t have access to this workspace.',
    'rename: an outsider and a key can''t');

  v := test.conv_op('B', 'chat_op_update_channel', test.ref('L'), ', NULL, ''Ship it on Friday''');
  PERFORM test.ok(v = 'ok 1' AND (SELECT topic FROM public.chat_channels WHERE id = test.ref('L')) = 'Ship it on Friday'
                  AND test.cacts(test.ref('L'), 'chat.channel_topic', 'B') = 1,
    'topic: a member who can post sets it; one attributed row', v);
  v := test.conv_op('V', 'chat_op_update_channel', test.ref('L'), ', NULL, ''Mine now''');
  PERFORM test.ok(v = '42501 Your role can''t change this channel''s topic.', 'topic: a viewer can''t', v);
  v := test.conv_op('B', 'chat_op_update_channel', test.ref('DK'), ', NULL, ''Desk rules''');
  PERFORM test.ok(v = '42501 Your role can''t change this channel''s topic.',
    'topic: in an announcement channel only its managers (and admins) set it', v);
  v := test.conv_op('A', 'chat_op_update_channel', test.ref('DK'), ', NULL, ''Desk rules''');
  PERFORM test.ok(v = 'ok 1', 'topic: the announcement channel''s manager sets it', v);
  v := test.conv_op('B', 'chat_op_update_channel', test.ref('L'), format(', NULL, %L', repeat('t', 251)));
  PERFORM test.ok(v = '22023 A topic can be up to 250 characters (this one has 251).', 'topic: 251 characters are refused', v);
END;
$$;

-- ── Archive, unarchive (managers, admins) ──────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.conv_op('B', 'chat_op_archive_channel', test.ref('L'), ', true')
                    = '42501 Only this channel''s managers and admins can archive it.'
                  AND test.conv_op('V', 'chat_op_archive_channel', test.ref('L'), ', true')
                    = '42501 Only this channel''s managers and admins can archive it.'
                  AND test.conv_op('X', 'chat_op_archive_channel', test.ref('L'), ', true')
                    = '42501 You don''t have access to this workspace.'
                  AND test.conv_op('K', 'chat_op_archive_channel', test.ref('L'), ', true')
                    = '42501 You don''t have access to this workspace.',
    'archive: a member, a viewer, an outsider and a key can''t');
  v := test.conv_op('A', 'chat_op_archive_channel', test.ref('L'), ', true');
  PERFORM test.ok(v = 'ok 1' AND (SELECT archived_at FROM public.chat_channels WHERE id = test.ref('L')) IS NOT NULL
                  AND test.cacts(test.ref('L'), 'chat.channel_archive', 'A') = 1,
    'archive: its manager archives it; one attributed row', v);
  v := test.conv_op('A', 'chat_op_archive_channel', test.ref('L'), ', true');
  PERFORM test.ok(v = 'ok 1' AND test.cacts(test.ref('L'), 'chat.channel_archive') = 1, 'archive: again changes and logs nothing', v);
  PERFORM test.ok(test.conv_op('C', 'chat_op_join', test.ref('L')) = '42501 This channel is archived.'
                  AND test.conv_op('A', 'chat_op_add_members', test.ref('L'), format(', ARRAY[%L]::uuid[]', test.id('C')))
                        = '42501 This channel is archived.'
                  AND test.conv_op('A', 'chat_op_update_channel', test.ref('L'), ', ''Old launch''')
                        = '42501 This channel is archived.',
    'archived: nobody joins, is added or renames it');
  v := test.conv_op('D', 'chat_op_archive_channel', test.ref('L'), ', false');
  PERFORM test.ok(v = 'ok 1' AND (SELECT archived_at FROM public.chat_channels WHERE id = test.ref('L')) IS NULL
                  AND test.cacts(test.ref('L'), 'chat.channel_unarchive', 'D') = 1,
    'unarchive: an admin brings it back; one attributed row', v);
END;
$$;

-- ── Join, leave, add, remove (§12, CH58, CH61) ─────────────────────────────
DO $$
DECLARE
  v text;
  v_stamp timestamptz;
BEGIN
  -- Join: a public channel, viewers too; leaving and joining are stamps.
  v := test.conv_op('C', 'chat_op_join', test.ref('L'));
  PERFORM test.ok(v = 'ok 1' AND (test.member(test.ref('L'), 'C')).left_at IS NULL
                  AND (test.member(test.ref('L'), 'C')).notify_level = 'mentions'
                  AND test.cacts(test.ref('L'), 'chat.join', 'C') = 1,
    'join: C joins the public channel; one attributed row', v);
  v := test.conv_op('C', 'chat_op_join', test.ref('L'));
  PERFORM test.ok(v = 'ok 1' AND test.cacts(test.ref('L'), 'chat.join', 'C') = 1, 'join: again changes and logs nothing', v);
  PERFORM test.ok(test.conv_op('E', 'chat_op_join', test.ref('AR')) = 'ok 1'
                  AND test.conv_op('V', 'chat_op_join', test.ref('AR')) = 'ok 1',
    'join: a custom-role member and a viewer join a public channel');
  PERFORM test.ok(test.conv_op('C', 'chat_op_join', test.ref('FO')) = '42501 You''re not a member of this conversation.'
                  AND test.conv_op('X', 'chat_op_join', test.ref('L')) = '42501 You don''t have access to this workspace.'
                  AND test.conv_op('K', 'chat_op_join', test.ref('L')) = '42501 You don''t have access to this workspace.',
    'join: not a private channel you aren''t in; not an outsider or a key');

  v := test.conv_op('C', 'chat_op_leave', test.ref('L'));
  PERFORM test.ok(v = 'ok 1' AND (test.member(test.ref('L'), 'C')).left_at IS NOT NULL
                  AND (test.member(test.ref('L'), 'C')).removed_by IS NULL
                  AND test.cacts(test.ref('L'), 'chat.leave', 'C') = 1,
    'leave: the row stays, stamped; one attributed row', v);
  v := test.conv_op('C', 'chat_op_leave', test.ref('L'));
  PERFORM test.ok(v = 'ok 1' AND test.cacts(test.ref('L'), 'chat.leave', 'C') = 1, 'leave: again changes and logs nothing', v);
  v := test.conv_op('B', 'chat_op_leave', test.ref('FO'));
  PERFORM test.ok(v = 'ok 1'
                  AND test.value_as('B', format('SELECT count(*)::text FROM public.chat_channels WHERE id = %L', test.ref('FO'))) = '0'
                  AND test.conv_op('B', 'chat_op_leave', test.ref('FO')) = 'ok 1'
                  AND test.conv_op('B', 'chat_op_join', test.ref('FO')) = '42501 You''re not a member of this conversation.',
    'leave: B leaves the private Founders, no longer sees it, may leave again, can''t rejoin unless added', v);
  PERFORM test.ok(test.conv_op('X', 'chat_op_leave', test.ref('L')) = '42501 You don''t have access to this workspace.'
                  AND test.conv_op('K', 'chat_op_leave', test.ref('L')) = '42501 You don''t have access to this workspace.',
    'leave: not an outsider or a key');

  -- Add: a public channel takes any poster's adds; a private one its managers' and admins'.
  v := test.value_as('B', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L, %L]::uuid[])::text$q$,
    test.ref('L'), test.id('C'), test.id('X')));
  PERFORM test.ok(v = '1' AND (test.member(test.ref('L'), 'C')).left_at IS NULL
                  AND test.cacts(test.ref('L'), 'chat.member_add', 'B') = 1
                  AND (SELECT payload FROM public.module_activity WHERE entity_id = test.ref('L') AND op = 'chat.member_add')
                        = jsonb_build_object('user_ids', jsonb_build_array(test.id('C'))),
    'add: a member adds C back to the public channel (X, outside, skipped); one attributed row with ids', v);
  v := test.value_as('B', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$, test.ref('L'), test.id('C')));
  PERFORM test.ok(v = '0' AND test.cacts(test.ref('L'), 'chat.member_add') = 1, 'add: someone already in changes and logs nothing', v);
  v := test.conv_op('V', 'chat_op_add_members', test.ref('L'), format(', ARRAY[%L]::uuid[]', test.id('E')));
  PERFORM test.ok(v = '42501 Your role can''t add people to channels.', 'add: a viewer can''t', v);
  v := test.value_as('A', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L, %L]::uuid[])::text$q$,
    test.ref('FO'), test.id('B'), test.id('C')));
  PERFORM test.ok(v = '2', 'add: the private channel''s manager adds B back and C', v);
  v := test.conv_op('B', 'chat_op_add_members', test.ref('FO'), format(', ARRAY[%L]::uuid[]', test.id('E')));
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can add people to it.',
    'add: a member can''t add people to a private channel (CH58)', v);
  v := test.conv_op('D', 'chat_op_add_members', test.ref('FO'), format(', ARRAY[%L]::uuid[]', test.id('E')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.',
    'add: an admin who isn''t in a private channel doesn''t see it', v);
  PERFORM test.value_as('A', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$, test.ref('FO'), test.id('D')));
  v := test.value_as('D', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$, test.ref('FO'), test.id('E')));
  PERFORM test.ok(v = '1', 'add: an admin in the private channel adds people to it', v);
  PERFORM test.ok(test.conv_op('X', 'chat_op_add_members', test.ref('L'), format(', ARRAY[%L]::uuid[]', test.id('E')))
                    = '42501 You don''t have access to this workspace.'
                  AND test.conv_op('K', 'chat_op_add_members', test.ref('L'), format(', ARRAY[%L]::uuid[]', test.id('E')))
                    = '42501 You don''t have access to this workspace.',
    'add: not an outsider or a key');

  -- Remove: managers and admins; the person's own row is stamped (it reaches them live).
  PERFORM test.ok(test.conv_op('B', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('C')))
                    = '42501 Only this channel''s managers and admins can remove people.'
                  AND test.conv_op('V', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('C')))
                    = '42501 Only this channel''s managers and admins can remove people.',
    'remove: a member and a viewer can''t remove others (CH61)');
  v_stamp := (test.member(test.ref('L'), 'C')).updated_at;
  v := test.conv_op('A', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('C')));
  PERFORM test.ok(v = 'ok 1' AND (test.member(test.ref('L'), 'C')).left_at IS NOT NULL
                  AND (test.member(test.ref('L'), 'C')).removed_at IS NOT NULL
                  AND (test.member(test.ref('L'), 'C')).removed_by = test.id('A')
                  AND (test.member(test.ref('L'), 'C')).updated_at > v_stamp
                  AND test.cacts(test.ref('L'), 'chat.member_remove', 'A') = 1
                  AND (SELECT payload FROM public.module_activity WHERE entity_id = test.ref('L') AND op = 'chat.member_remove')
                        = jsonb_build_object('user_id', test.id('C')),
    'remove: its manager removes C: the row stays, stamped left_at + removed_at (+ who: removed_by) and updated; one attributed row', v);
  PERFORM test.ok(test.conv_op('C', 'chat_op_join', test.ref('L')) = '42501 You were removed from this channel. A manager can add you back.'
                  AND test.send('C', 'L', 'l-c1', 'let me in') = '42501 You were removed from this conversation.',
    'remove: C can''t join or post their way back in');
  v := test.value_as('B', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$, test.ref('L'), test.id('C')));
  PERFORM test.ok(v = '0' AND (test.member(test.ref('L'), 'C')).left_at IS NOT NULL,
    'remove: a member can''t add back someone a manager removed', v);
  v := test.value_as('A', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$, test.ref('L'), test.id('C')));
  PERFORM test.ok(v = '1' AND (test.member(test.ref('L'), 'C')).removed_by IS NULL
                  AND (test.member(test.ref('L'), 'C')).removed_at IS NULL
                  AND test.send('C', 'L', 'l-c2', 'thanks') = 'ok 1',
    'remove: the manager adds C back, and C posts again', v);
  v := test.conv_op('A', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('B')));
  v := test.conv_op('A', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('B')));
  PERFORM test.ok(v = 'ok 1' AND test.cacts(test.ref('L'), 'chat.member_remove') = 2,
    'remove: removing someone already out changes and logs nothing', v);
  v := test.conv_op('D', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('V')));
  PERFORM test.ok(v = 'ok 1' AND (test.member(test.ref('L'), 'V')).removed_by = test.id('D'),
    'remove: an admin removes people', v);
  v := test.conv_op('E', 'chat_op_join', test.ref('L'));
  v := test.conv_op('E', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('E')));
  PERFORM test.ok(v = 'ok 1' AND (test.member(test.ref('L'), 'E')).left_at IS NOT NULL
                  AND (test.member(test.ref('L'), 'E')).removed_by IS NULL
                  AND (test.member(test.ref('L'), 'E')).removed_at IS NULL
                  AND test.conv_op('E', 'chat_op_join', test.ref('L')) = 'ok 1',
    'remove: removing yourself is leaving (you may join again)', v);
  PERFORM test.ok(test.conv_op('X', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('E')))
                    = '42501 You don''t have access to this workspace.'
                  AND test.conv_op('K', 'chat_op_remove_member', test.ref('L'), format(', %L::uuid', test.id('E')))
                    = '42501 You don''t have access to this workspace.',
    'remove: not an outsider or a key');
END;
$$;

-- ── The last manager (AC10.7) ──────────────────────────────────────────────
DO $$
DECLARE
  v text;
  v_m uuid;
BEGIN
  -- Public, the owner not in it: B, its only manager, leaves → the owner manages it.
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'Handover', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('C'), test.id('V')));
  v_m := test.conv('Handover');
  v := test.conv_op('B', 'chat_op_leave', v_m);
  PERFORM test.ok(v = 'ok 1' AND NOT test.manages(v_m, 'B') AND test.manages(v_m, 'O')
                  AND (test.member(v_m, 'O')).channel_id IS NULL
                  AND (SELECT payload FROM public.module_activity WHERE entity_id = v_m AND op = 'chat.leave')
                        = jsonb_build_object('manager_id', test.id('O')),
    'last manager: leaving a public channel hands it to the workspace owner, who can read it', v);

  -- Private, the owner not in it: C leaves → its earliest remaining member.
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'Quiet corner', '', true, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('E'), test.id('B')));
  v_m := test.conv('Quiet corner');
  UPDATE public.chat_members SET joined_at = now() - interval '1 hour' WHERE channel_id = v_m AND user_id = test.id('E');
  v := test.conv_op('C', 'chat_op_leave', v_m);
  PERFORM test.ok(v = 'ok 1' AND test.manages(v_m, 'E') AND NOT test.manages(v_m, 'O') AND NOT test.manages(v_m, 'B'),
    'last manager: leaving a private channel the owner isn''t in hands it to its earliest remaining member', v);

  -- Removed by an admin while last: the same rule.
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'Handover two', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  v_m := test.conv('Handover two');
  v := test.conv_op('D', 'chat_op_remove_member', v_m, format(', %L::uuid', test.id('C')));
  PERFORM test.ok(v = 'ok 1' AND NOT test.manages(v_m, 'C') AND test.manages(v_m, 'O'),
    'last manager: removed by an admin, the channel passes on the same way', v);

  -- Not the last: another manager is still in it, nobody is added.
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Two hands', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  v_m := test.conv('Two hands');
  INSERT INTO public.chat_channel_managers (channel_id, user_id) VALUES (v_m, test.id('B'));
  v := test.conv_op('A', 'chat_op_leave', v_m);
  PERFORM test.ok(v = 'ok 1' AND test.manages(v_m, 'B') AND NOT test.manages(v_m, 'A') AND NOT test.manages(v_m, 'O')
                  AND (SELECT payload FROM public.module_activity WHERE entity_id = v_m AND op = 'chat.leave') = '{}'::jsonb,
    'last manager: a manager who isn''t the last just leaves', v);
END;
$$;

-- ── Who manages, who comes back, where General reaches ─────────────────────
DO $$
DECLARE
  v text;
  v_r uuid;
  v_rp uuid;
  v_vo uuid;
  v_g uuid := test.ref('G');
BEGIN
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Rules', '', false, ARRAY[%L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('F')));
  v_r := test.conv('Rules');
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Rules private', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('C')));
  v_rp := test.conv('Rules private');

  -- Someone removed doesn't bring themselves back.
  PERFORM test.conv_op('A', 'chat_op_remove_member', v_r, format(', %L::uuid', test.id('C')));
  v := test.conv_op('C', 'chat_op_add_members', v_r, format(', ARRAY[%L]::uuid[]', test.id('C')));
  PERFORM test.ok(v = '42501 Your role can''t add people to channels.' AND (test.member(v_r, 'C')).removed_by = test.id('A'),
    'removed: C can''t add themselves back to the public channel', v);
  PERFORM test.conv_op('A', 'chat_op_remove_member', v_rp, format(', %L::uuid', test.id('C')));
  PERFORM test.ok(test.conv_op('C', 'chat_op_join', v_rp) = '42501 You''re not a member of this conversation.'
                  AND test.conv_op('C', 'chat_op_add_members', v_rp, format(', ARRAY[%L]::uuid[]', test.id('C')))
                        = '42501 You''re not a member of this conversation.'
                  AND test.conv_op('C', 'chat_op_mark_read', v_rp, format(', %L::uuid', test.mid('p1')))
                        = '42501 You''re not a member of this conversation.',
    'removed: C can''t rejoin, re-add themselves to or mark anything in the private channel');

  -- A manager row alone manages nothing: not after leaving, not in a read-only role.
  INSERT INTO public.chat_channel_managers (channel_id, user_id) VALUES (v_r, test.id('B')), (v_r, test.id('F'));
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = v_r AND user_id = test.id('B');
  v := test.conv_op('B', 'chat_op_update_channel', v_r, ', ''Rules by B''');
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can rename it.',
    'managers: a manager who is no longer in the channel can''t rename it', v);
  PERFORM test.ok(test.conv_op('F', 'chat_op_update_channel', v_r, ', ''Rules by F''') = 'ok 1',
    'managers: F, a manager in it, renames it');
  UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = test.id('W') AND user_id = test.id('F');
  PERFORM test.ok(test.conv_op('F', 'chat_op_update_channel', v_r, ', ''Rules''') = '42501 Only this channel''s managers and admins can rename it.'
                  AND test.conv_op('F', 'chat_op_remove_member', v_r, format(', %L::uuid', test.id('A')))
                        = '42501 Only this channel''s managers and admins can remove people.',
    'managers: once F''s role is read-only, F manages nothing');
  UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = test.id('W') AND user_id = test.id('F');

  -- "Manage any channel" is what makes an admin.
  UPDATE public.workspace_chat_caps SET manage_any = false WHERE workspace_id = test.id('W') AND role_key = 'admin';
  v := test.conv_op('D', 'chat_op_update_channel', v_r, ', ''Rules by D''');
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can rename it.',
    'admins: with "Manage any channel" off, an admin who isn''t its manager can''t rename it (AC1.12)', v);
  UPDATE public.workspace_chat_caps SET manage_any = true WHERE workspace_id = test.id('W') AND role_key = 'admin';

  -- The hand-over never makes a read-only role a manager.
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'Viewers only', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('V')));
  v_vo := test.conv('Viewers only');
  v := test.conv_op('C', 'chat_op_leave', v_vo);
  PERFORM test.ok(v = 'ok 1' AND (SELECT count(*) FROM public.chat_channel_managers WHERE channel_id = v_vo) = 0,
    'last manager: with only a viewer left in it, nobody becomes its manager', v);

  -- General never reaches a private conversation.
  UPDATE public.chat_channels SET is_private = true WHERE id = v_g;
  PERFORM test.person('L2');
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('L2'), 'member');
  PERFORM test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok((test.member(v_g, 'L2')).channel_id IS NULL,
    'General: a private one takes nobody, by trigger or by bootstrap');
  UPDATE public.chat_channels SET is_private = false WHERE id = v_g;
END;
$$;

-- ── Direct messages: 2–9 people, one per set, viewers receive ──────────────
DO $$
DECLARE
  v text;
  v_d uuid;
  v_d2 uuid;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  v_d := (SELECT id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm'
            AND dm_key = (SELECT string_agg(u::text, ',' ORDER BY u) FROM unnest(ARRAY[test.id('A'), test.id('B')]) u)
            AND deleted_at IS NULL);
  PERFORM test.ok(v = 'ok 1' AND v_d IS NOT NULL
                  AND (test.member(v_d, 'A')).notify_level = 'all' AND (test.member(v_d, 'B')).left_at IS NULL
                  AND EXISTS (SELECT 1 FROM public.entities WHERE entity_id = v_d AND label = '')
                  AND test.cacts(v_d) = 0,
    'DM: A opens one with B: both in it, registered without a label, nothing logged', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])).id::text$q$,
                    test.id('W'), test.id('A'))) = v_d::text
                  AND test.value_as('A', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L, %L, %L]::uuid[])).id::text$q$,
                    test.id('W'), test.id('B'), test.id('B'), test.id('A'))) = v_d::text,
    'DM: one per set of people, whoever opens it, in any order');
  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, '{}'::uuid[])$q$, test.id('W')))
                    = '22023 A direct message needs someone besides you.'
                  AND test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('A')))
                    = '22023 A direct message needs someone besides you.',
    'DM: never with only yourself (notes to self don''t exist)');
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, %L::uuid[])$q$,
    test.id('W'), ARRAY(SELECT test.id('n' || i) FROM generate_series(1, 9) i)));
  PERFORM test.ok(v = '22023 A direct message can include up to 9 people.', 'DM: ten people are too many', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('X')));
  PERFORM test.ok(v = '22023 Everyone in a direct message must be in this workspace.', 'DM: not with someone outside it', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('A')));
  PERFORM test.ok(v = '42501 Your role can''t start direct messages.', 'DM: a viewer doesn''t start one', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('V')));
  PERFORM test.ok(v = 'ok 1' AND test.value_as('V', format($q$SELECT count(*)::text FROM public.chat_channels c
                    WHERE c.workspace_id = %L AND c.kind = 'dm' AND position(%L IN c.dm_key) > 0 AND position(%L IN c.dm_key) > 0$q$,
                    test.id('W'), test.id('V'), test.id('A'))) = '1',
    'DM: a viewer receives one and reads it', v);
  PERFORM test.ok(test.value_as('V', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])).id::text$q$,
                    test.id('W'), test.id('A')))
                  = (SELECT id::text FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm' AND deleted_at IS NULL
                       AND dm_key = (SELECT string_agg(u::text, ',' ORDER BY u) FROM unnest(ARRAY[test.id('A'), test.id('V')]) u)),
    'DM: the viewer opens the one they received (only starting one needs a role that posts)');
  PERFORM test.ok(test.as_user('X', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('A')))
                    = '42501 You don''t have access to this workspace.'
                  AND test.as_key('K', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')))
                    = '42501 You don''t have access to this workspace.',
    'DM: not an outsider or a key');

  PERFORM test.ok(test.conv_op('A', 'chat_op_update_channel', v_d, ', ''Name''') = '22023 Direct messages don''t have a name or topic.'
                  AND test.conv_op('A', 'chat_op_archive_channel', v_d, ', true') = '22023 Direct messages can''t be archived.'
                  AND test.conv_op('A', 'chat_op_add_members', v_d, format(', ARRAY[%L]::uuid[]', test.id('C')))
                        = '22023 Start a new direct message to add people.'
                  AND test.conv_op('A', 'chat_op_remove_member', v_d, format(', %L::uuid', test.id('B')))
                        = '22023 People can''t be removed from a direct message.',
    'DM: no name, topic, archive, adding or removing');

  -- Leaving one: opening it again brings you back. A deleted one is never reused.
  v := test.conv_op('A', 'chat_op_leave', v_d);
  PERFORM test.ok(v = 'ok 1'
                  AND test.value_as('A', format('SELECT count(*)::text FROM public.chat_channels WHERE id = %L', v_d)) = '0'
                  AND test.value_as('B', format('SELECT count(*)::text FROM public.chat_channels WHERE id = %L', v_d)) = '1',
    'DM: A leaves it; B still has it', v);
  PERFORM test.ok(test.value_as('A', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])).id::text$q$,
                    test.id('W'), test.id('B'))) = v_d::text
                  AND (test.member(v_d, 'A')).left_at IS NULL,
    'DM: opening it again brings A back into the same one');
  UPDATE public.chat_channels SET deleted_at = now() WHERE id = v_d;
  v_d2 := test.value_as('A', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])).id::text$q$, test.id('W'), test.id('B')))::uuid;
  PERFORM test.ok(v_d2 IS NOT NULL AND v_d2 <> v_d, 'DM: a deleted one is never reused (a new one is made)');
END;
$$;

-- ── Preferences; a paused workspace (#25) ──────────────────────────────────
DO $$
DECLARE
  v text;
  v_acts int := test.all_acts();
BEGIN
  v := test.conv_op('B', 'chat_op_set_prefs', test.ref('AR'), ', ''all'', true');
  PERFORM test.ok(v = 'ok 1' AND (test.member(test.ref('AR'), 'B')).notify_level = 'all'
                  AND (test.member(test.ref('AR'), 'B')).starred,
    'prefs: Every message and "Pin to sidebar"', v);
  PERFORM test.ok(test.conv_op('B', 'chat_op_set_prefs', test.ref('AR'), ', ''loud''') = '22023 Unknown notification level.'
                  AND test.conv_op('C', 'chat_op_set_prefs', test.ref('AR'), ', ''none''') = '42501 Join this conversation first.'
                  AND test.conv_op('K', 'chat_op_set_prefs', test.ref('AR'), ', ''none''') = '42501 You don''t have access to this workspace.',
    'prefs: an unknown level, someone not in it and a key are refused');

  -- The owner's plan stops including chat: tidying works, the rest waits.
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  PERFORM test.ok(test.conv_op('B', 'chat_op_set_prefs', test.ref('AR'), ', ''mentions''') = 'ok 1'
                  AND test.conv_op('V', 'chat_op_leave', test.ref('AR')) = 'ok 1',
    'paused: preferences and leaving still work');
  PERFORM test.ok(test.conv_op('V', 'chat_op_join', test.ref('AR')) = '42501 Chat is available on the Duo and Team plans.'
                  AND test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Paused room')$q$, test.id('W')))
                        = '42501 Chat is available on the Duo and Team plans.'
                  AND test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('C')))
                        = '42501 Chat is available on the Duo and Team plans.'
                  AND test.conv_op('B', 'chat_op_update_channel', test.ref('AR'), ', ''Acme''') = '42501 Chat is available on the Duo and Team plans.'
                  AND test.conv_op('B', 'chat_op_archive_channel', test.ref('AR'), ', true') = '42501 Chat is available on the Duo and Team plans.'
                  AND test.conv_op('B', 'chat_op_add_members', test.ref('AR'), format(', ARRAY[%L]::uuid[]', test.id('C')))
                        = '42501 Chat is available on the Duo and Team plans.'
                  AND test.conv_op('B', 'chat_op_remove_member', test.ref('AR'), format(', %L::uuid', test.id('E')))
                        = '42501 Chat is available on the Duo and Team plans.'
                  AND test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')))
                        = '42501 Chat is available on the Duo and Team plans.',
    'paused: joining, creating, opening a direct message, renaming, archiving, adding, removing and bootstrap wait for the plan');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
  PERFORM test.ok(test.all_acts() = v_acts + 1, 'prefs log nothing (only V''s leave was logged)', (test.all_acts() - v_acts)::text);
END;
$$;

-- ── A former member (AC6.5), the people list and the access check ──────────
DO $$
DECLARE
  v_de uuid;
BEGIN
  -- E, a contractor, writes in a direct message with A and in Q, then leaves the workspace.
  v_de := test.value_as('A', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])).id::text$q$, test.id('W'), test.id('E')))::uuid;
  INSERT INTO test.ids VALUES ('DE', v_de);
  PERFORM test.ok(test.send('E', 'DE', 'e-dm', 'handing over the files') = 'ok 1'
                  AND test.send('E', 'Q', 'e-q', 'last day today') = 'ok 1', 'setup: E writes to A and in Q');
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('E');

  PERFORM test.ok(test.value_as('A', format($q$SELECT display_name || ' ' || former::text FROM public.chat_people(%L) WHERE user_id = %L$q$,
                    test.id('W'), test.id('E'))) = 'E true'
                  AND test.value_as('A', format($q$SELECT former::text FROM public.chat_people(%L) WHERE user_id = %L$q$,
                    test.id('W'), test.id('B'))) = 'false',
    'former member: E keeps their name and reads as a former member; B doesn''t (AC6.5)');
  PERFORM test.ok(test.value_as('A', format('SELECT count(*)::text FROM public.chat_messages WHERE channel_id = %L', v_de)) = '1'
                  AND test.value_as('A', format($q$SELECT count(*)::text FROM public.chat_sync_ids(%L)
                                                  WHERE kind IN ('conversation', 'member') AND id = %L$q$, test.id('W'), v_de)) = '2',
    'former member: the direct message with E stays readable and in A''s sidebar (AC6.5)');
  PERFORM test.conv_op('A', 'chat_op_leave', v_de);
  PERFORM test.ok(test.value_as('A', format($q$SELECT (public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])).id::text$q$,
                    test.id('W'), test.id('E'))) = v_de::text
                  AND (test.member(v_de, 'A')).left_at IS NULL
                  AND test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L, %L]::uuid[])$q$,
                    test.id('W'), test.id('E'), test.id('B'))) = '22023 Everyone in a direct message must be in this workspace.',
    'former member: A, who left the DM with E, opens it again; a new one with E can''t be started');
  PERFORM test.ok(test.value_as('E', format('SELECT count(*)::text FROM public.chat_people(%L)', test.id('W'))) = '0'
                  AND test.value_as('E', format($q$SELECT string_agg(kind, ',') FROM public.chat_sync_ids(%L)$q$, test.id('W'))) = 'checked',
    'former member: E, out of the workspace, gets no people and no conversations');
  PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_people(%L) WHERE user_id = %L$q$,
                    test.id('W'), test.id('E'))) = '1'
                  AND test.value_as('X', format('SELECT count(*)::text FROM public.chat_people(%L)', test.id('W'))) = '0',
    'people: C (who reads Q, where E wrote) gets E; an outsider gets nobody');

  -- The access check.
  PERFORM test.ok(test.value_as('C', format($q$SELECT string_agg(kind, ',' ORDER BY kind) FROM public.chat_sync_ids(%L) WHERE id = %L$q$,
                    test.id('W'), test.ref('P'))) IS NULL
                  AND test.value_as('C', format($q$SELECT string_agg(kind, ',' ORDER BY kind) FROM public.chat_sync_ids(%L) WHERE id = %L$q$,
                    test.id('W'), test.ref('L'))) = 'conversation,member'
                  AND test.value_as('B', format($q$SELECT string_agg(kind, ',' ORDER BY kind) FROM public.chat_sync_ids(%L) WHERE id = %L$q$,
                    test.id('W'), test.ref('L'))) = 'conversation',
    'access check: C isn''t given P (private, not in it); C is in L; B, removed from public L, still reads it but isn''t in it');
  -- A message moved out of Q into P: C (who can't read P) is told its id is gone.
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, kind, event)
  VALUES (test.mid('moved-line'), test.id('W'), test.ref('Q'), test.id('A'), 'event',
          jsonb_build_object('type', 'moved_out', 'ids', jsonb_build_array(test.mid('p1')), 'to', test.ref('P')));
  PERFORM test.ok(test.value_as('C', format($q$SELECT conversation_id::text FROM public.chat_sync_ids(%L)
                                              WHERE kind = 'moved_away' AND id = %L$q$, test.id('W'), test.mid('p1'))) = test.ref('Q')::text
                  AND test.value_as('B', format($q$SELECT count(*)::text FROM public.chat_sync_ids(%L) WHERE kind = 'moved_away'$q$,
                    test.id('W'))) = '0'
                  AND test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_sync_ids(%L, now() + interval '1 day')
                                                  WHERE kind = 'moved_away'$q$, test.id('W'))) = '0',
    'access check: an id moved where C can''t read is "moved_away" for C, not for B (who reads P), and not before p_since');
  PERFORM test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_sync_ids(%L)$q$, test.id('W'))) LIKE '42501 %'
                  AND test.as_key('K', format($q$SELECT * FROM public.chat_people(%L)$q$, test.id('W'))) LIKE '42501 %',
    'reads: a key gets neither the access check nor the people');
END;
$$;

-- ── The set-based read rule says what the per-row one says ─────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.n || ':' || c.name, ', ') INTO v_bad
    FROM public.chat_channels c
   CROSS JOIN unnest(ARRAY['O', 'D', 'A', 'B', 'C', 'V', 'E', 'F', 'X']) AS p(n)
   WHERE c.workspace_id = test.id('W')
     AND public.chat__can_read_channel_as(c.id, test.id(p.n))
         IS DISTINCT FROM (c.id IN (SELECT r FROM public.chat__readable_channel_ids(test.id('W'), test.id(p.n)) r));
  PERFORM test.ok(v_bad IS NULL AND (SELECT count(*) FROM public.chat_channels WHERE workspace_id = test.id('W')) > 20,
    'read rule: chat__readable_channel_ids agrees with chat__can_read_channel_as for every conversation and person (deleted, private, left, removed, former)',
    v_bad);
END;
$$;

-- ── Grants (CV-2b) ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.oid IN (
           'public.chat_op_bootstrap(uuid)'::regprocedure,
           'public.chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean)'::regprocedure,
           'public.chat_op_open_dm(uuid, uuid[])'::regprocedure,
           'public.chat_op_update_channel(uuid, text, text)'::regprocedure,
           'public.chat_op_archive_channel(uuid, boolean)'::regprocedure,
           'public.chat_op_join(uuid)'::regprocedure,
           'public.chat_op_leave(uuid)'::regprocedure,
           'public.chat_op_add_members(uuid, uuid[])'::regprocedure,
           'public.chat_op_remove_member(uuid, uuid)'::regprocedure,
           'public.chat_op_set_prefs(uuid, text, boolean)'::regprocedure,
           'public.chat_op_mark_read(uuid, uuid)'::regprocedure,
           'public.chat_op_mark_read(uuid, timestamptz)'::regprocedure,
           'public.chat_op_mark_unread(uuid, uuid)'::regprocedure,
           'public.chat_op_mark_unread(uuid, timestamptz)'::regprocedure,
           'public.chat_unread_counts(uuid)'::regprocedure,
           'public.chat_sync_ids(uuid, timestamptz)'::regprocedure,
           'public.chat_people(uuid)'::regprocedure,
           'public.chat__join_general()'::regprocedure,
           'public.share_chat_channel_guard()'::regprocedure)
     AND (NOT p.prosecdef
          OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
          OR p.proacl IS NULL
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
          OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  PERFORM test.ok(v_bad IS NULL, 'CV-2b definers: search_path pinned, no PUBLIC or anon EXECUTE', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat__channel_name(text)', 'chat__channel_topic(text)', 'chat__name_taken(uuid, text, uuid, uuid)',
                      'chat__is_manager(public.chat_channels, uuid)',
                      'chat__can_manage(public.chat_channels, uuid)', 'chat__can_post(public.chat_channels, uuid)',
                      'chat__enter(uuid, uuid, uuid, text)', 'chat__hand_over(uuid, uuid)',
                      'chat__reads_workspace(uuid, uuid)', 'chat__readable_channel_ids(uuid, uuid)',
                      'chat__join_general()', 'share_chat_channel_guard()']) AS f
   WHERE has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
      OR has_function_privilege('anon', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'CV-2b grants: the helpers are not callable by signed-in people or anon', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat_unread_counts(uuid)', 'chat_sync_ids(uuid, timestamptz)', 'chat_people(uuid)']) AS f
   WHERE has_function_privilege('service_role', 'public.' || f, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'CV-2b grants: the reads are signed-in people''s only', v_bad);
  PERFORM test.ok(to_regprocedure('public.chat_op_create_channel(uuid, text, text, boolean, uuid[])') IS NULL
                  AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'chat_channels_dm_uq')
                  AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'chat_channels_live_dm_uq'),
    'CV-2b: v1''s 5-argument create is gone (one signature); direct messages are unique among live ones');
END;
$$;

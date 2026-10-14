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

  PERFORM test.ok(test.all_acts() = v_acts, 'send: a plain send logs no activity row');
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
                  AND test.acts('b1', 'chat.mention') = 0,
    'edit: the author edits; mentions are read again; one attributed row; nobody is pinged here (CV-5)', v);
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
  UPDATE public.chat_members SET left_at = now(), removed_by = test.id('A')
   WHERE channel_id = test.ref('OLD') AND user_id = test.id('C');
  v := test.send('C', 'OLD', 'old3', 'let me back in');
  PERFORM test.ok(v = '42501 You were removed from this conversation.' AND test.msg('old3') IS NULL
                  AND (SELECT left_at FROM public.chat_members WHERE channel_id = test.ref('OLD') AND user_id = test.id('C')) IS NOT NULL,
    'removed: C, removed from the public OLD, can''t post their way back in', v);
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = test.ref('OLD') AND user_id = test.id('B');
  v := test.send('B', 'OLD', 'old4', 'back again');
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT left_at FROM public.chat_members WHERE channel_id = test.ref('OLD') AND user_id = test.id('B')) IS NULL,
    'left: B, who left OLD, posts and is back in', v);

  -- Removed from a private conversation: nothing there any more, own messages included.
  UPDATE public.chat_members SET left_at = now(), removed_by = test.id('A')
   WHERE channel_id = test.ref('P') AND user_id = test.id('B');
  PERFORM test.ok(test.send('B', 'P', 'p2', 'still here?') = '42501 You''re not a member of this conversation.'
                  AND test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('p1')))
                        = '42501 You''re not a member of this conversation.',
    'removed: B, removed from the private P, can''t post or react there');
  UPDATE public.chat_members SET left_at = NULL, removed_by = NULL
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
                        = 'P0002 That conversation no longer exists.'
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
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.', 'react: C can''t react in P, which C can''t read', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'react: an outsider is refused', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE '42501 %', 'react: a key is refused', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity WHERE payload ->> 'message_id' = test.mid('a1')::text
                                AND op IN ('chat.mention', 'chat.reply')),
    'react: never notifies');
  PERFORM test.ok((SELECT bool_and(NOT payload ? 'body' AND NOT payload ? 'excerpt' AND NOT payload ? 'notify_user_ids')
                     FROM public.module_activity WHERE op IN ('chat.react', 'chat.message_edit', 'chat.message_delete', 'chat.message_restore')),
    'activity: the ops'' rows carry ids, never text');

  -- At most 20 kinds per message.
  UPDATE public.chat_messages
     SET reactions = (SELECT jsonb_object_agg('k' || g, jsonb_build_array(test.id('C')::text)) FROM generate_series(1, 20) g)
   WHERE id = test.mid('o1');
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, 'k21'::text, true)$q$, test.mid('o1')));
  PERFORM test.ok(v = '22023 This message has the most reactions it can hold.', 'react: a 21st kind is refused', v);
  PERFORM test.ok(test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, 'k1'::text, true)$q$, test.mid('o1'))) = 'ok 1',
    'react: joining one of the 20 still works');
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, %L::text, true)$q$, test.mid('o1'), repeat('x', 33)));
  PERFORM test.ok(v = '22023 That reaction isn''t supported.', 'react: the live key check (CV-7c widens it)', v);

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
  PERFORM test.ok(test.as_user('B', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('b1'))) = 'ok 1'
                  AND test.as_user('B', format($q$SELECT public.chat_op_pin(%L::uuid, true)$q$, test.mid('pin1'))) = 'ok 1'
                  AND test.as_user('B', format($q$SELECT public.chat_op_restore(%L::uuid)$q$, test.mid('b1'))) = 'ok 1'
                  AND (test.msg('b1')).pinned_at IS NULL
                  AND (SELECT count(*) FROM public.chat_messages
                        WHERE channel_id = test.ref('Q') AND pinned_at IS NOT NULL AND deleted_at IS NULL) = 100,
    'pin: a message restored into a full conversation comes back unpinned');
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
                      'share_chat_message_guard()',
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

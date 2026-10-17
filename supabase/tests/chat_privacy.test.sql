-- Chat v1 privacy rules (supabase/migrations/20261014090000_chat_privacy_rules.sql).
--
-- Cast: O owns workspace W on the Duo plan, so chat is on. A, B and C are
-- members. X is in no workspace. A makes a private channel P with B, a public
-- channel Q, and opens a direct message D with B; A mentions B in P and in D.
-- Reads go through RLS as the signed-in person; ops are called the way the
-- app calls them.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Conversations, made by A through the ops.
CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: #general exists', v);
  INSERT INTO test.ids SELECT 'G', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND kind = 'channel' AND is_default;

  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'secret-plans', 'quiet', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND name = 'secret-plans';

  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, '{}'::uuid[])$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND name = 'open-plans';

  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A opens a direct message D with B', v);
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND kind = 'dm';

  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(gen_random_uuid(), %L, 'hello moduo://person/%s', NULL)$q$,
    test.ref('P'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A mentions B in P', v);
  INSERT INTO test.ids SELECT 'M', id FROM public.chat_messages WHERE channel_id = test.ref('P');

  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(gen_random_uuid(), %L, 'psst moduo://person/%s', NULL)$q$,
    test.ref('D'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A mentions B in D', v);
  -- A direct message rings no bell (CV-5), so A's edit writes the row about D.
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_edit(m.id, 'psst again'::text) FROM public.chat_messages m WHERE m.channel_id = %L$q$,
    test.ref('D')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A edits the message in D', v);

  -- The registry: making P wrote its row (CV-2b registers every conversation).
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.entities WHERE workspace_id = test.id('W')
                            AND entity_type = 'chat_channel' AND entity_id = test.ref('P')
                            AND label = 'secret-plans'),
    'setup: making P registered it, its name as the label');
END;
$$;

-- How many activity rows about one conversation a person can read.
CREATE FUNCTION test.activity_rows(p_who text, p_conv text) RETURNS int LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT count(*)::text FROM public.module_activity WHERE workspace_id = %L AND entity_id = %L$q$,
    test.id('W'), test.ref(p_conv)))::int
$$;

-- ── 1. Activity rows and registry rows follow the conversation's read rule ──
DO $$
BEGIN
  PERFORM test.ok(
    (SELECT count(*) FROM public.module_activity WHERE entity_id = test.ref('P')) = 2
    AND (SELECT count(*) FROM public.module_activity WHERE entity_id = test.ref('D')) = 1
    AND (SELECT count(*) FROM public.module_activity WHERE entity_id = test.ref('Q')) = 1,
    'activity: the ops wrote 2 rows about P, 1 about D, 1 about Q');

  PERFORM test.ok(test.value_as('X', format(
      $q$SELECT count(*)::text FROM public.module_activity WHERE workspace_id = %L$q$, test.id('W'))) = '0',
    'activity: X, in no workspace, reads no row of W');
  PERFORM test.ok(test.activity_rows('C', 'P') = 0,
    'activity: C, a member who is not in P, reads no row about P');
  PERFORM test.ok(test.activity_rows('C', 'D') = 0,
    'activity: C reads no row about the direct message D');
  PERFORM test.ok(test.activity_rows('C', 'Q') = 1,
    'activity: C reads the row about the public channel Q');
  PERFORM test.ok(test.activity_rows('B', 'P') = 2,
    'activity: B, in P, reads both rows about P');
  PERFORM test.ok(test.activity_rows('B', 'D') = 1,
    'activity: B reads the row about D');
  PERFORM test.ok(test.activity_rows('A', 'P') = 2 AND test.activity_rows('A', 'D') = 1,
    'activity: A, who acted, reads their own rows');

  -- A makes a second private channel P2 with B and leaves it: the row A wrote
  -- about P2 stays A's to read; C still reads nothing about P2.
  PERFORM test.ok(test.as_user('A', format(
      $q$SELECT public.chat_op_create_channel(%L, 'left-behind', '', true, ARRAY[%L]::uuid[])$q$,
      test.id('W'), test.id('B'))) LIKE 'ok %', 'setup: A makes the private channel P2 with B');
  INSERT INTO test.ids SELECT 'P2', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND name = 'left-behind';
  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_leave(%L)$q$, test.ref('P2'))) LIKE 'ok %',
    'setup: A leaves P2');
  PERFORM test.ok(test.value_as('A', format($q$SELECT count(*)::text FROM public.chat_channels WHERE id = %L$q$,
      test.ref('P2'))) = '0',
    'activity: A no longer reads P2 itself');
  PERFORM test.ok(test.activity_rows('A', 'P2') = 2, 'activity: A still reads the rows they wrote about P2 (made it, left it)');
  PERFORM test.ok(test.activity_rows('B', 'P2') = 2, 'activity: B, in P2, reads them');
  PERFORM test.ok(test.activity_rows('C', 'P2') = 0, 'activity: C reads nothing about P2');

  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT count(*)::text FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = %L$q$,
      test.ref('P'))) = '0',
    'registry: C does not read the registry row for P');
  PERFORM test.ok(test.value_as('B', format(
      $q$SELECT count(*)::text FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = %L$q$,
      test.ref('P'))) = '1',
    'registry: B reads the registry row for P');

  PERFORM test.ok(
    test.value_as('B', format($q$SELECT public.perm_can_see_entity(%L, 'chat_message', %L)::text$q$,
      test.id('W'), test.ref('M'))) = 'true'
    AND test.value_as('C', format($q$SELECT public.perm_can_see_entity(%L, 'chat_message', %L)::text$q$,
      test.id('W'), test.ref('M'))) = 'false',
    'rule: a message is readable exactly when its conversation is');
  PERFORM test.ok(
    test.value_as('B', format($q$SELECT public.perm_can_see_entity(%L, 'chat_channel', %L)::text$q$,
      test.id('X'), test.ref('P'))) = 'false',
    'rule: a conversation filed under another workspace id is not readable through it');

  -- An app's key (chat at View, made by A, who is in P) reads chat through the
  -- chat tools, never through the spine.
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
          '{"chat": "view", "links": "view"}'::jsonb, test.id('A'));
  PERFORM test.ok(
    test.as_key('K', format($q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_channel', %L)$q$,
      test.id('W'), test.ref('Q'))) = 'ok 0'
    AND test.as_key('K', format($q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_channel', %L)$q$,
      test.id('W'), test.ref('P'))) = 'ok 0'
    AND test.as_key('K', format($q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_message', %L)$q$,
      test.id('W'), test.ref('M'))) = 'ok 0',
    'rule: an API key reads no conversation through the spine, public or private');

  PERFORM test.ok(
    (SELECT qual LIKE '%perm_can_see_entity%' FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'module_activity' AND policyname = 'module_activity_workspace_read')
    AND (SELECT qual LIKE '%perm_can_see_entity%' FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'entities' AND policyname = 'entities_workspace_read'),
    'catalog: the activity and registry read policies ask perm_can_see_entity');
END;
$$;

-- ── 3. chat_caps_get answers members ────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(test.value_as('X', format($q$SELECT public.chat_caps_get(%L)::text$q$, test.id('W'))) = '[]',
    'caps: X, in no workspace, gets []');
  PERFORM test.ok(
    test.value_as('C', format($q$SELECT jsonb_array_length(public.chat_caps_get(%L))::text$q$, test.id('W')))::int
      = (SELECT count(*) FROM public.workspace_chat_caps WHERE workspace_id = test.id('W'))
    AND (SELECT count(*) FROM public.workspace_chat_caps WHERE workspace_id = test.id('W')) > 0,
    'caps: C, a member, gets every row of W');
  PERFORM test.ok(test.value_as('O', format($q$SELECT jsonb_array_length(public.chat_caps_get(%L))::text$q$, test.id('W')))::int > 0,
    'caps: the owner gets the rows');
END;
$$;

-- ── 4. chat_op_set_announcement: a channel the caller can read, never a DM ─────────
DO $$
DECLARE
  v text;
BEGIN
  -- Members hold "Manage any channel" for this part.
  UPDATE public.workspace_chat_caps SET manage_any = true WHERE workspace_id = test.id('W') AND role_key = 'member';

  v := test.as_user('C', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('P')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.',
    'announce: C, who cannot read P, is refused even with Manage any channel', v);
  PERFORM test.ok((SELECT NOT managers_only FROM public.chat_channels WHERE id = test.ref('P')),
    'announce: P is unchanged');

  v := test.as_user('X', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('Q')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'announce: X, in no workspace, is refused', v);

  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('D')));
  PERFORM test.ok(v = '22023 Direct messages can''t be announcement channels.',
    'announce: a direct message is refused, even for someone in it', v);

  v := test.as_user('C', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('Q')),
    'announce: C, with Manage any channel, switches the public channel Q on', v);

  UPDATE public.workspace_chat_caps SET manage_any = false WHERE workspace_id = test.id('W') AND role_key = 'member';

  v := test.as_user('B', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('P')));
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can change who posts.',
    'announce: B, in P but not a manager, is refused', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('P')));
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('P')),
    'announce: A, who made P, switches it on', v);
END;
$$;

-- ── 2. Typing: the server writes it, only the conversation reads it ─────────
-- A typing row the server wrote, by conversation.
CREATE FUNCTION test.typing_rows(p_conv text, p_who text, p_stop boolean, p_parent text DEFAULT NULL)
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM realtime.messages
  WHERE topic = 'chat:typing:' || test.ref(p_conv)::text
    AND extension = 'broadcast' AND private AND event = 'typing'
    AND payload ->> 'userId' = test.id(p_who)::text
    AND payload ->> 'channelId' = test.ref(p_conv)::text
    AND (payload ->> 'stop')::boolean = p_stop
    AND (payload ->> 'parentId') IS NOT DISTINCT FROM test.ref(p_parent)::text
$$;
-- A read of realtime.messages the way Realtime authorizes a join: the topic
-- set for the connection, then the policy on the table.
CREATE FUNCTION test.realtime_reads(p_who text, p_topic text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, true);
  v := test.value_as(p_who, format($q$SELECT count(*)::text FROM realtime.messages WHERE topic = %L$q$, p_topic));
  PERFORM set_config('realtime.topic', '', true);
  RETURN v::int;
END;
$$;
CREATE FUNCTION test.realtime_writes(p_who text, p_topic text, p_extension text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, true);
  v := test.as_user(p_who, format(
    $q$INSERT INTO realtime.messages (topic, extension, payload, event, private) VALUES (%L, %L, '{}'::jsonb, 'probe', true)$q$,
    p_topic, p_extension));
  PERFORM set_config('realtime.topic', '', true);
  RETURN v;
END;
$$;

DO $$
DECLARE
  v text;
  v_ws text := 'chat:' || test.id('W')::text;
  v_p text := 'chat:typing:' || test.ref('P')::text;
BEGIN
  v := test.as_user('X', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'typing: X, in no workspace, is refused', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('P')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.', 'typing: C, not in P, is refused', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('D')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.', 'typing: C is refused for the direct message D', v);
  -- Only this test's conversations: a live client on the shared stack may type elsewhere.
  PERFORM test.ok((SELECT count(*) FROM realtime.messages
                   WHERE topic IN ('chat:typing:' || test.ref('Q')::text, v_p, 'chat:typing:' || test.ref('D')::text)) = 0,
    'typing: a refusal writes nothing');

  v := test.as_user('B', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('P')));
  PERFORM test.ok(v LIKE 'ok %', 'typing: B, in P, can say they are typing', v);
  PERFORM test.ok(test.typing_rows('P', 'B', false) = 1,
    'typing: the row is on P''s topic, private, with B as the sender from the session');
  v := test.as_user('B', format($q$SELECT public.chat_op_typing(%L, NULL, true)$q$, test.ref('P')));
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('P', 'B', true) = 1, 'typing: B can say they stopped', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_typing(%L, %L, false)$q$, test.ref('P'), test.ref('M')));
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('P', 'A', false, 'M') = 1,
    'typing: a thread''s typing names the thread', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_typing(%L, %L, false)$q$, test.ref('Q'), test.ref('M')));
  PERFORM test.ok(v = 'P0002 That thread no longer exists.', 'typing: a thread from another conversation is refused', v);
  -- Chat v2 (CV-2a): typing is the members' (the topic's readers), so C, who reads
  -- the public Q without being in it, is refused and nothing is sent.
  v := test.as_user('C', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v = '42501 You''re not a member of this conversation.' AND test.typing_rows('Q', 'C', false) = 0,
    'typing: C, who only reads the public channel Q, is refused (members only)', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('Q', 'A', false) = 1, 'typing: A, in Q, can type there', v);

  -- Reading the typing topic: the conversation's readers only.
  PERFORM test.ok(test.realtime_reads('B', v_p) = 3, 'realtime: B reads P''s typing topic');
  PERFORM test.ok(test.realtime_reads('A', v_p) = 3, 'realtime: A reads P''s typing topic');
  PERFORM test.ok(test.realtime_reads('C', v_p) = 0, 'realtime: C, not in P, reads nothing on P''s typing topic');
  PERFORM test.ok(test.realtime_reads('X', v_p) = 0, 'realtime: X reads nothing on P''s typing topic');
  -- Chat v2 (CV-1, …_chat_v2_foundation): a typing topic is its members' only, so
  -- C, who reads the public Q without being in it, gets none.
  PERFORM test.ok(test.realtime_reads('C', 'chat:typing:' || test.ref('Q')::text) = 0
                  AND test.realtime_reads('A', 'chat:typing:' || test.ref('Q')::text) = 1,
    'realtime: the public channel Q''s typing topic is read by its member A, not by C who only reads Q');

  -- Writing: nobody writes a typing topic; members track presence on the workspace topic.
  v := test.realtime_writes('B', v_p, 'broadcast');
  PERFORM test.ok(v = '42501 new row violates row-level security policy for table "messages"',
    'realtime: B cannot broadcast on P''s typing topic', v);
  v := test.realtime_writes('B', v_p, 'presence');
  PERFORM test.ok(v = '42501 new row violates row-level security policy for table "messages"',
    'realtime: B cannot track presence on P''s typing topic', v);
  v := test.realtime_writes('B', v_ws, 'broadcast');
  PERFORM test.ok(v = '42501 new row violates row-level security policy for table "messages"',
    'realtime: B cannot broadcast on the workspace topic', v);
  v := test.realtime_writes('B', v_ws, 'presence');
  PERFORM test.ok(v = 'ok 1', 'realtime: B tracks presence on the workspace topic', v);
  v := test.realtime_writes('X', v_ws, 'presence');
  PERFORM test.ok(v = '42501 new row violates row-level security policy for table "messages"',
    'realtime: X cannot track presence on the workspace topic', v);
  PERFORM test.ok(test.realtime_reads('B', v_ws) = 1 AND test.realtime_reads('X', v_ws) = 0,
    'realtime: the workspace topic is read by its members only');
  PERFORM test.ok(test.realtime_reads('B', 'chat:typing:not-a-conversation') = 0
    AND test.realtime_reads('B', 'notes:' || test.id('W')::text) = 0,
    'realtime: other topic shapes are not chat''s');

  PERFORM test.ok(
    NOT has_function_privilege('service_role', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
    AND test.as_key('K', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')))
      = '42501 permission denied for function chat_op_typing',
    'typing: a key cannot say anyone is typing (people only)');
  PERFORM test.ok(
    NOT has_function_privilege('anon', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_realtime_topic_writable(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_realtime_topic_writable(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_caps_get(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_op_set_announcement(uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.perm_can_see_entity(uuid, text, uuid)', 'EXECUTE'),
    'grants: signed-in people only, never anon');
END;
$$;

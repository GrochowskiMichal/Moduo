-- Chat v1 per-person sending and typing limits
-- (supabase/migrations/20261014155205_chat_send_limits.sql).
--
-- Cast: O owns workspace W and O2 owns W2, both on the Duo plan, so chat is on.
-- A, B and C are members of W; A is also in W2. A makes a public channel Q and
-- a private channel P with B. K is an app's key in W (Chat: Edit), made by A.
-- Ops are called the way the app and the connector call them.
--
-- The whole file is one transaction, so now() never moves: every message sent
-- here is stamped with the same moment. "Time passing" is the test moving the
-- earlier rows back (test.age).

SELECT test.person(n) FROM unnest(ARRAY['O', 'O2', 'A', 'B', 'C', 'T']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id IN (test.id('O'), test.id('O2'));
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('O2'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C', 'T']) AS n
UNION ALL SELECT test.id('W2'), test.id('A'), 'member'
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;

-- A message from a person, the way the app sends it.
CREATE FUNCTION test.send(p_who text, p_conv text, p_client text DEFAULT NULL) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L, 'hello', NULL, '{}'::uuid[], false, %L)$q$,
    test.ref(p_conv), CASE WHEN p_client IS NULL THEN NULL ELSE test.id(p_client) END))
$$;
-- A message from the app behind key K, the way the connector posts it.
CREATE FUNCTION test.post_as_app(p_conv text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_key('K', format($q$SELECT public.chat_op_agent_post(%L, %L, 'from the app')$q$,
    test.id('W'), test.ref(p_conv)))
$$;
-- Moves every message of a workspace back in time ("that long ago").
CREATE FUNCTION test.age(p_ws text, p_by interval) RETURNS void LANGUAGE sql AS $$
  UPDATE public.chat_messages SET created_at = created_at - p_by WHERE workspace_id = test.id(p_ws)
$$;
-- A person's messages in a workspace, from the last p_within.
CREATE FUNCTION test.sent(p_who text, p_ws text, p_within interval DEFAULT interval '60 seconds')
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.chat_messages
  WHERE author_id = test.id(p_who) AND workspace_id = test.id(p_ws) AND created_at > now() - p_within
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: #general exists in W', v);
  INSERT INTO test.ids SELECT 'G', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND kind = 'channel' AND name = 'general';
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W2')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: #general exists in W2', v);
  INSERT INTO test.ids SELECT 'G2', id FROM public.chat_channels
    WHERE workspace_id = test.id('W2') AND kind = 'channel' AND name = 'general';

  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, '{}'::uuid[])$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND name = 'open-plans';
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'secret-plans', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND name = 'secret-plans';

  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
          '{"chat": "edit"}'::jsonb, test.id('A'));
END;
$$;

-- ── 1. Sending ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
  v_refused int := 0;
  v_seen text;
  i int;
  c_limited constant text := 'PT429 You''re sending messages too quickly. Wait a moment and try again.';
BEGIN
  -- A steady conversation: one message every 3 seconds for two minutes.
  FOR i IN 1 .. 40 LOOP
    v := test.send('A', 'G');
    IF v NOT LIKE 'ok %' THEN
      v_refused := v_refused + 1;
      v_seen := v;
    END IF;
    PERFORM test.age('W', interval '3 seconds');
  END LOOP;
  PERFORM test.ok(v_refused = 0, 'send: a message every 3 s for two minutes is never refused', v_seen);
  PERFORM test.age('W', interval '1 hour');

  -- A burst: ten in a moment go through, the eleventh doesn't.
  v := test.send('A', 'G', 'first-of-burst');
  PERFORM test.ok(v LIKE 'ok %', 'send: the first message of a burst goes through', v);
  v_refused := 0;
  FOR i IN 2 .. 10 LOOP
    v := test.send('A', 'G');
    IF v NOT LIKE 'ok %' THEN
      v_refused := v_refused + 1;
      v_seen := v;
    END IF;
  END LOOP;
  PERFORM test.ok(v_refused = 0 AND test.sent('A', 'W') = 10, 'send: ten messages in a moment go through', v_seen);
  v := test.send('A', 'G');
  PERFORM test.ok(v = c_limited, 'send: the eleventh message in 10 s is refused with PT429', v);
  PERFORM test.ok(test.sent('A', 'W') = 10, 'send: a refused message writes nothing');
  v := test.send('A', 'Q');
  PERFORM test.ok(v = c_limited, 'send: the limit is per workspace, not per conversation', v);
  v := test.send('A', 'G', 'first-of-burst');
  PERFORM test.ok(v LIKE 'ok %' AND test.sent('A', 'W') = 10,
    'send: retrying a message that was saved answers it again, without counting', v);

  v := test.send('B', 'G');
  PERFORM test.ok(v LIKE 'ok %', 'send: B, in the same conversation, is not held back by A', v);
  v := test.send('A', 'G2');
  PERFORM test.ok(v LIKE 'ok %', 'send: A can still post in another workspace', v);
  v := test.as_op(NULL, format(
    $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body) VALUES (%L, %L, %L, 'from the server')$q$,
    test.id('W'), test.ref('G'), test.id('A')));
  PERFORM test.ok(v = 'ok 1', 'send: a server write in A''s name is not limited', v);

  -- The minute: 29 messages from 30 s ago, then two more now.
  PERFORM test.age('W', interval '1 hour');
  INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, created_at)
  SELECT test.id('W'), test.ref('G'), test.id('A'), 'earlier', now() - interval '30 seconds'
  FROM generate_series(1, 29);
  v := test.send('A', 'G');
  PERFORM test.ok(v LIKE 'ok %', 'send: the 30th message in a minute goes through', v);
  v := test.send('A', 'G');
  PERFORM test.ok(v = c_limited AND test.sent('A', 'W', interval '10 seconds') = 1,
    'send: the 31st message in a minute is refused, with only one in the last 10 s', v);

  PERFORM test.age('W', interval '61 seconds');
  v := test.send('A', 'G');
  PERFORM test.ok(v LIKE 'ok %', 'send: a minute later A can post again', v);

  -- Apps share one budget per workspace, apart from the people's.
  PERFORM test.age('W', interval '1 hour');
  v_refused := 0;
  FOR i IN 1 .. 10 LOOP
    v := test.post_as_app('G');
    IF v NOT LIKE 'ok %' THEN
      v_refused := v_refused + 1;
      v_seen := v;
    END IF;
  END LOOP;
  PERFORM test.ok(v_refused = 0, 'send: an app posts ten messages in a moment', v_seen);
  v := test.post_as_app('Q');
  PERFORM test.ok(v = c_limited, 'send: the app''s eleventh message in 10 s is refused with PT429', v);
  v := test.send('A', 'G');
  PERFORM test.ok(v LIKE 'ok %', 'send: A, who made the key, still posts as themselves', v);

  PERFORM test.ok(
    (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.chat_messages'::regclass
       AND tgname = 'chat_send_limit' AND tgenabled = 'O') = 1,
    'catalog: the limit is a trigger on every insert into chat_messages');
END;
$$;

-- The limit's count is one index range: author (or none, for apps), workspace,
-- then time. (A plan check would prove nothing on a table this small.)
DO $$
BEGIN
  PERFORM test.ok(
    (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'chat_messages_author_recent_idx')
      LIKE '%(author_id, workspace_id, created_at)',
    'catalog: chat_messages has an index on (author_id, workspace_id, created_at)');
END;
$$;

-- ── 2. Typing ────────────────────────────────────────────────────────────────
-- Typing rows the server wrote for one person in one conversation.
CREATE FUNCTION test.typing_rows(p_conv text, p_who text, p_stop boolean) RETURNS int
LANGUAGE sql AS $$
  SELECT count(*)::int FROM realtime.messages
  WHERE topic = 'chat:typing:' || test.ref(p_conv)::text
    AND extension = 'broadcast' AND private AND event = 'typing'
    AND payload ->> 'userId' = test.id(p_who)::text
    AND (payload ->> 'stop')::boolean = p_stop
$$;
CREATE FUNCTION test.typing(p_who text, p_conv text, p_stop boolean DEFAULT false, p_parent uuid DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_typing(%L, %L, %L)$q$,
    test.ref(p_conv), p_parent, p_stop))
$$;
CREATE FUNCTION test.marks(p_who text, p_conv text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.chat_typing_marks
  WHERE user_id = test.id(p_who) AND channel_id = test.ref(p_conv)
$$;

DO $$
DECLARE
  v text;
  v_bad text := '';
  i int;
BEGIN
  FOR i IN 1 .. 5 LOOP
    v := test.typing('B', 'G');
    IF v NOT LIKE 'ok %' THEN v_bad := v; END IF;
  END LOOP;
  PERFORM test.ok(v_bad = '' AND test.typing_rows('G', 'B', false) = 1,
    'typing: five calls in a moment answer quietly and broadcast once', v_bad);
  v := test.typing('B', 'G', true);
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('G', 'B', true) = 1, 'typing: a stop goes out', v);
  v := test.typing('B', 'G', true);
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('G', 'B', true) = 2, 'typing: every stop goes out', v);
  v := test.typing('B', 'G');
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('G', 'B', false) = 1,
    'typing: a stop doesn''t open the window early', v);

  v := test.typing('A', 'G');
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('G', 'A', false) = 1,
    'typing: A in the same conversation is not held back by B', v);
  v := test.typing('B', 'Q');
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('Q', 'B', false) = 1,
    'typing: B in another conversation is not held back', v);

  UPDATE public.chat_typing_marks SET sent_at = sent_at - interval '2.5 seconds'
  WHERE user_id = test.id('B') AND channel_id = test.ref('G');
  v := test.typing('B', 'G');
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('G', 'B', false) = 2,
    'typing: 2.5 s later it goes out again', v);
  v := test.typing('B', 'G');
  PERFORM test.ok(v LIKE 'ok %' AND test.typing_rows('G', 'B', false) = 2,
    'typing: and then waits again', v);

  -- Refusals are unchanged and leave no mark.
  v := test.typing('C', 'P');
  PERFORM test.ok(v = 'P0001 You''re not a member of this conversation.' AND test.marks('C', 'P') = 0,
    'typing: C, not in P, is refused and leaves no mark', v);
  v := test.typing('A', 'Q', false, test.id('no-such-thread'));
  PERFORM test.ok(v = 'P0001 That thread no longer exists.' AND test.marks('A', 'Q') = 0,
    'typing: a missing thread is refused and leaves no mark', v);

  -- The marks are the server's alone.
  v := test.as_user('B', 'SELECT count(*) FROM public.chat_typing_marks');
  PERFORM test.ok(v = '42501 permission denied for table chat_typing_marks', 'marks: B cannot read them', v);
  v := test.as_user('B', format(
    $q$INSERT INTO public.chat_typing_marks (user_id, channel_id, sent_at) VALUES (%L, %L, now() - interval '1 hour')$q$,
    test.id('B'), test.ref('Q')));
  PERFORM test.ok(v = '42501 permission denied for table chat_typing_marks', 'marks: B cannot add one', v);
  v := test.as_user('B', 'UPDATE public.chat_typing_marks SET sent_at = now() - interval ''1 hour''');
  PERFORM test.ok(v = '42501 permission denied for table chat_typing_marks', 'marks: B cannot move one', v);
  v := test.as_user('B', 'DELETE FROM public.chat_typing_marks');
  PERFORM test.ok(v = '42501 permission denied for table chat_typing_marks', 'marks: B cannot remove one', v);
  PERFORM test.ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_typing_marks'::regclass)
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_typing_marks')
    AND NOT has_table_privilege('anon', 'public.chat_typing_marks', 'SELECT, INSERT, UPDATE, DELETE'),
    'marks: RLS on, no policies, nothing for anon');

  PERFORM test.ok(
    NOT has_function_privilege('anon', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_op_typing(uuid, uuid, boolean)', 'EXECUTE'),
    'grants: chat_op_typing stays signed-in people only');
END;
$$;

-- ── 3. Marks go with the account and with the conversation ──────────────────
DO $$
DECLARE
  v jsonb;
  v_marks int;
  r text;
BEGIN
  v_marks := (SELECT count(*) FROM public.chat_typing_marks WHERE user_id = test.id('B'));
  v := public.account_erase_workspace_data(test.id('B'), true);
  PERFORM test.ok(v_marks = 2 AND (v ->> 'chat_typing_marks_deleted')::int = v_marks,
    'erasure: the preview counts B''s typing marks', v ->> 'chat_typing_marks_deleted');
  PERFORM public.account_erase_workspace_data(test.id('B'), false);
  PERFORM test.ok((SELECT count(*) FROM public.chat_typing_marks WHERE user_id = test.id('B')) = 0
    AND test.marks('A', 'G') = 1,
    'erasure: B''s marks are gone, A''s stay');

  r := test.typing('T', 'G');
  PERFORM test.ok(r LIKE 'ok %' AND test.marks('T', 'G') = 1, 'setup: T types in #general', r);
  r := test.as_op(NULL, format('DELETE FROM auth.users WHERE id = %L', test.id('T')));
  PERFORM test.ok(r = 'ok 1' AND test.marks('T', 'G') = 0, 'erasure: deleting T''s account takes T''s marks', r);

  r := test.typing('A', 'Q');
  PERFORM test.ok(r LIKE 'ok %' AND test.marks('A', 'Q') = 1, 'setup: A types in Q', r);
  r := test.as_op(NULL, format('DELETE FROM public.chat_channels WHERE id = %L', test.ref('Q')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.chat_typing_marks WHERE channel_id = test.ref('Q')),
    'marks: a conversation that goes takes its marks', r);
END;
$$;

-- Chat v2 Realtime (CV-1: supabase/migrations/…_chat_v2_foundation.sql, on top of
-- 20261014090000_chat_privacy_rules.sql). "Typing is per conversation, sender from
-- the session" (AC12.4).
--
-- Cast: O owns workspace W on the Duo plan; A, B and C are members; X is in no
-- workspace. A makes a private channel P with B and a public channel Q; B joins
-- Q; C reads Q without joining it.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Realtime');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
-- A read of realtime.messages the way Realtime authorizes a join: the topic set
-- for the connection, then the policy on the table.
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
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'secret-plans', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret-plans';
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, '{}'::uuid[])$q$, test.id('W')));
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'open-plans';
  v := test.as_user('B', format($q$SELECT public.chat_op_join(%L)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: B joins the public channel Q', v);
END;
$$;

DO $$
DECLARE
  v text;
  v_p text := 'chat:typing:' || test.ref('P')::text;
  v_q text := 'chat:typing:' || test.ref('Q')::text;
  v_ws text := 'chat:' || test.id('W')::text;
BEGIN
  -- The server writes typing, with the sender from the session.
  v := test.as_user('B', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %'
    AND (SELECT count(*) FROM realtime.messages WHERE topic = v_q AND private AND event = 'typing'
           AND payload ->> 'userId' = test.id('B')::text) = 1,
    'typing: chat_op_typing writes the caller as the sender, on the conversation''s private topic', v);
  PERFORM test.ok(
    (SELECT proargnames FROM pg_proc WHERE oid = 'public.chat_op_typing(uuid, uuid, boolean)'::regprocedure)
      = ARRAY['p_channel_id', 'p_parent_id', 'p_stop']
    AND (SELECT count(*) FROM pg_proc WHERE proname = 'chat_op_typing' AND pronamespace = 'public'::regnamespace) = 1,
    'typing: the op takes no sender, so a passed id can never be the sender');
  v := test.as_user('A', format($q$SELECT public.chat_op_typing(%L, NULL, false)$q$, test.ref('P')));

  -- Joining (reading) a typing topic: the conversation's members only.
  PERFORM test.ok(test.realtime_reads('A', v_p) = 1 AND test.realtime_reads('B', v_p) = 1,
    'typing: A and B, in P, read P''s typing');
  PERFORM test.ok(test.realtime_reads('C', v_p) = 0 AND test.realtime_reads('X', v_p) = 0,
    'typing: C (not in P) and X (no workspace) are refused P''s typing');
  PERFORM test.ok(test.realtime_reads('B', v_q) = 1,
    'typing: B, who joined the public Q, reads its typing');
  PERFORM test.ok(test.realtime_reads('C', v_q) = 0
    AND test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_channels WHERE id = %L$q$, test.ref('Q'))) = '1',
    'typing: C reads the public Q but isn''t in it, so gets no typing (members only)');

  -- Leaving ends it.
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = test.ref('P') AND user_id = test.id('B');
  PERFORM test.ok(test.realtime_reads('B', v_p) = 0, 'typing: B, who left P, is refused its typing');
  UPDATE public.chat_members SET left_at = NULL WHERE channel_id = test.ref('P') AND user_id = test.id('B');

  -- No client writes a typing topic, member or not.
  v := test.realtime_writes('B', v_p, 'broadcast');
  PERFORM test.ok(v LIKE '42501%', 'typing: B can''t broadcast on P''s typing topic', v);
  v := test.realtime_writes('A', v_q, 'broadcast');
  PERFORM test.ok(v LIKE '42501%', 'typing: A can''t broadcast on Q''s typing topic either', v);
  v := test.realtime_writes('B', v_p, 'presence');
  PERFORM test.ok(v LIKE '42501%', 'typing: nobody tracks presence on a typing topic', v);

  -- Presence: the workspace topic, for members of a workspace with chat; display only.
  PERFORM test.ok(test.realtime_writes('C', v_ws, 'presence') = 'ok 1' AND test.realtime_reads('C', v_ws) = 1,
    'presence: C, a member, tracks and reads presence on the workspace topic');
  PERFORM test.ok(test.realtime_writes('X', v_ws, 'presence') LIKE '42501%' AND test.realtime_reads('X', v_ws) = 0,
    'presence: X is refused');
  PERFORM test.ok(test.realtime_writes('C', v_ws, 'broadcast') LIKE '42501%',
    'presence: nobody broadcasts on the workspace topic');
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  PERFORM test.ok(test.realtime_reads('C', v_ws) = 0 AND test.realtime_writes('C', v_ws, 'presence') LIKE '42501%',
    'presence: a workspace without chat (plan off) has no presence');
  PERFORM test.ok(test.realtime_reads('A', v_p) = 1,
    'typing: reading a conversation''s typing doesn''t need the plan (reading never does)');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');

  -- The publication: the three chat tables and Catch up; not the chain mutes.
  PERFORM test.ok(
    (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename LIKE 'chat%')
      = ARRAY['chat_catchup', 'chat_channels', 'chat_members', 'chat_messages'],
    'publication: chat_catchup, chat_channels, chat_members and chat_messages are published');
  PERFORM test.ok(
    NOT has_function_privilege('anon', 'public.chat_realtime_topic_allowed(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_realtime_topic_allowed(text)', 'EXECUTE')
    AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
          AND policyname IN ('chat_realtime_read', 'chat_realtime_write')) = 2,
    'grants: the topic rule is for signed-in people; both Realtime policies are in place');
END;
$$;

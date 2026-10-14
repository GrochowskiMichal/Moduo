-- Chat v2 · the v1 signatures, one release (CV-2a: supabase/migrations/…_chat_v2_core_ops.sql).
-- "Old builds" (AC12.9, server half): v1's send (7 arguments), edit (3) and
-- react (2, a toggle) convert v1 markup and go through the v2 ops, so a desktop
-- build from before min_build keeps sending; v2 calls resolve to the v2 ops;
-- the app's post writes v2 rows. CV-23 drops the wrappers.
--
-- Cast: O owns workspace W (Duo); A, B and C are members, V a viewer. A makes the
-- public channel Q with B, C and V. K is A's API key with Chat at Edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'V']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Wrappers');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W'), test.id('V'), 'viewer') ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.msg(p_id uuid) RETURNS public.chat_messages LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_messages WHERE id = p_id
$$;
-- v1's send, as the v1 client calls it (every argument named).
CREATE FUNCTION test.send_v1(p_who text, p_body text, p_client text DEFAULT NULL, p_parent uuid DEFAULT NULL,
                             p_mentioned uuid[] DEFAULT '{}', p_notify boolean DEFAULT false, p_excerpt text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(p_channel_id => %L, p_body => %L, p_parent_id => %L, p_mentioned_user_ids => %L,
                                  p_notify_channel => %L, p_client_id => %L, p_excerpt => %L)$q$,
    test.ref('Q'), p_body, p_parent, p_mentioned, p_notify,
    CASE WHEN p_client IS NOT NULL THEN test.id('client:' || p_client) END, p_excerpt))
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, ARRAY[%L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'open-plans';
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv2a-wrap'),
          '{"chat": "edit"}'::jsonb, test.id('A'));
END;
$$;

-- ── v1 send ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
  m public.chat_messages;
BEGIN
  v := test.send_v1('B', format('hi <@%s> _soon_ <!channel>', test.id('C')), 'one',
                    p_mentioned => ARRAY[test.id('A')], p_notify => false, p_excerpt => 'something else entirely');
  m := test.msg(test.id('client:one'));
  PERFORM test.ok(v = 'ok 1' AND m.format_version = 2
                  AND m.body = format('hi moduo://person/%s *soon* @channel', test.id('C'))
                  AND m.body_text = 'hi  soon @channel',
    'send v1: the v1 markup is converted and stored as v2, keyed by the v1 client id', v);
  PERFORM test.ok(m.client_id = test.id('client:one'),
    'send v1: the row carries the v1 client id, so v1 screens match their optimistic row');
  PERFORM test.ok(m.mentioned_user_ids = ARRAY[test.id('C')] AND m.mentions_everyone,
    'send v1: who it mentions is read from the text, not from the list or the switch the client passed');
  PERFORM test.ok((SELECT payload ->> 'excerpt' FROM public.module_activity
                    WHERE payload ->> 'message_id' = m.id::text AND op = 'chat.mention')
                  = public.chat__excerpt(m.body),
    'send v1: the bell''s excerpt is built on the server, not taken from the client');
  v := test.send_v1('B', 'hi again, resent', 'one');
  PERFORM test.ok(v = 'ok 1' AND (test.msg(test.id('client:one'))).body = m.body
                  AND (SELECT count(*) FROM public.chat_messages WHERE channel_id = test.ref('Q') AND author_id = test.id('B')) = 1,
    'send v1: a resent client id returns the stored row', v);

  -- A row sent before the release: its own id, the client id in client_id, v1 text.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, client_id, format_version)
  VALUES (test.id('old'), test.id('W'), test.ref('Q'), test.id('C'), 'from _before_', test.id('client:old'), 1);
  SET LOCAL session_replication_role = origin;
  v := test.send_v1('C', 'from _before_', 'old');
  PERFORM test.ok(v = 'ok 1' AND test.msg(test.id('client:old')) IS NULL
                  AND (test.msg(test.id('old'))).format_version = 1,
    'send v1: a resend of a message sent before the release finds it by its client id', v);

  -- A thread reply (v1's parent) joins the chain and quotes the root.
  v := test.as_user('A', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'the root'::text, NULL::uuid)$q$,
    test.id('root'), test.ref('Q')));
  v := test.send_v1('C', 'in the thread', 'reply', p_parent => test.id('root'));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(test.id('client:reply'))).parent_id = test.id('root')
                  AND (test.msg(test.id('client:reply'))).reply_to_id = test.id('root')
                  AND (test.msg(test.id('root'))).reply_count = 1,
    'send v1: a thread reply joins the root''s chain', v);
  v := test.as_user('B', 'SELECT public.chat_op_send(p_channel_id => ' || quote_literal(test.ref('Q'))
                         || '::uuid, p_body => ''no client id''::text)');
  PERFORM test.ok(v = 'ok 1' AND EXISTS (SELECT 1 FROM public.chat_messages WHERE body = 'no client id' AND format_version = 2),
    'send v1: without a client id it still sends', v);
  v := test.send_v1('V', 'from a viewer', 'viewer');
  PERFORM test.ok(v = '42501 Your role can''t post in chat.', 'send v1: the v2 rules hold (a viewer is refused)', v);
  v := test.as_user('C', 'SELECT public.chat_op_send(p_channel_id => ' || quote_literal(test.ref('Q'))
                         || '::uuid, p_body => ''taking an id''::text, p_client_id => ' || quote_literal(test.id('root')) || '::uuid)');
  PERFORM test.ok(v = '22023 That message id is already used.' AND (test.msg(test.id('root'))).body = 'the root',
    'send v1: a client id that is someone else''s message id is refused', v);
END;
$$;

-- ── v1 edit and react; v2 calls resolve to the v2 ops ───────────────────────
DO $$
DECLARE
  v text;
  v_id uuid := test.id('client:one');
BEGIN
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(p_message_id => %L, p_body => %L, p_mentioned_user_ids => '{}')$q$,
    v_id, format('now <@%s> *later*', test.id('A'))));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(v_id)).body = format('now moduo://person/%s *later*', test.id('A'))
                  AND (test.msg(v_id)).mentioned_user_ids = ARRAY[test.id('A')] AND NOT (test.msg(v_id)).mentions_everyone,
    'edit v1: a v2 message keeps its text, its v1 tokens become references, mentions are read again', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_edit(p_message_id => %L, p_body => 'not mine', p_mentioned_user_ids => '{}')$q$, v_id));
  PERFORM test.ok(v = '42501 You can only edit your own messages.', 'edit v1: the v2 rules hold (only the author edits)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(p_message_id => %L, p_body => 'v2 _as typed_')$q$, v_id));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(v_id)).body = 'v2 _as typed_',
    'edit: two named arguments mean the v2 op (no conversion, no ambiguity)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, 'positional'::text)$q$, v_id));
  PERFORM test.ok(v = 'ok 1', 'edit: two positional arguments mean the v2 op', v);
  -- v1's composer opens an edit with the stored (v2) text: it isn't converted
  -- twice, and the tokens its pickers add become references.
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(p_message_id => %L, p_body => %L, p_mentioned_user_ids => '{}')$q$,
    v_id, format('ping moduo://person/%s *now* and <@%s>', test.id('C'), test.id('A'))));
  PERFORM test.ok(v = 'ok 1'
                  AND (test.msg(v_id)).body = format('ping moduo://person/%s *now* and moduo://person/%s', test.id('C'), test.id('A'))
                  AND (test.msg(v_id)).mentioned_user_ids = ARRAY[test.id('C'), test.id('A')],
    'edit v1: a v2 message''s text is kept, a person picked in v1 becomes a mention', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_edit(p_message_id => %L, p_body => 'from _after_', p_mentioned_user_ids => '{}')$q$,
    test.id('old')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(test.id('old'))).body = 'from *after*' AND (test.msg(test.id('old'))).format_version = 2,
    'edit v1: a v1 message''s text is converted whole', v);

  v := test.as_user('C', format($q$SELECT public.chat_op_react(p_message_id => %L, p_emoji => '👍')$q$, v_id));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(v_id)).reactions -> '👍' = jsonb_build_array(test.id('C')::text),
    'react v1: the toggle turns it on', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_react(p_message_id => %L, p_emoji => '👍')$q$, v_id));
  PERFORM test.ok(v = 'ok 1' AND NOT ((test.msg(v_id)).reactions ? '👍'), 'react v1: and off again', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_react(p_message_id => %L, p_key => '🎉', p_on => true)$q$, v_id));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(v_id)).reactions ? '🎉', 'react: named key and on mean the v2 op', v);
END;
$$;

-- ── The app's post writes v2 ────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_key('K', format($q$SELECT public.chat_op_agent_post(%L, %L, %L, NULL)$q$,
    test.id('W'), test.ref('Q'), format('Deployed for <@%s> _now_', test.id('B'))));
  PERFORM test.ok(v = 'ok 1'
                  AND EXISTS (SELECT 1 FROM public.chat_messages
                               WHERE channel_id = test.ref('Q') AND author_kind = 'api_key' AND format_version = 2
                                 AND body = format('Deployed for moduo://person/%s *now*', test.id('B'))
                                 AND mentioned_user_ids = ARRAY[test.id('B')]),
    'agent post: its v1 markup is converted; the row is v2', v);
END;
$$;

-- ── Signatures and grants ───────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chat_op_send') = 2
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chat_op_edit') = 2
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chat_op_react') = 2
    AND (SELECT pronargdefaults FROM pg_proc WHERE oid = 'public.chat_op_edit(uuid, text, uuid[])'::regprocedure) = 0
    AND (SELECT pronargdefaults FROM pg_proc WHERE oid = 'public.chat_op_react(uuid, text, boolean)'::regprocedure) = 0,
    'signatures: v1 and v2 side by side; no default lets a v2 call reach a v1 wrapper');
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_op_edit(uuid, text, uuid[])', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_op_react(uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_op_edit(uuid, text, uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_op_react(uuid, text)', 'EXECUTE'),
    'grants: old builds call the wrappers signed in, never as anon');
END;
$$;

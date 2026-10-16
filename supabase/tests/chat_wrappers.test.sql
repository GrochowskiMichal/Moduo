-- Chat v2 · old builds after the contract cleanup (CV-23:
-- supabase/migrations/…_chat_v2_contract.sql). "Old builds" (AC12.9, server
-- half): the v1 signatures CV-2a kept for one release are gone, so a build
-- below app_settings.min_build is told to update (src/lib/min-build.ts) instead
-- of reaching them; the v2 ops answer, a send is keyed by the id the client
-- mints and writes no client_id; v1 rows keep theirs.
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

-- ── The v2 ops; no client_id ────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('B', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'hi *soon*'::text, NULL::uuid)$q$,
    test.id('one'), test.ref('Q')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(test.id('one'))).format_version = 2
                  AND (test.msg(test.id('one'))).client_id IS NULL,
    'send: the row is keyed by the id the client minted and carries no client_id', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'hi *soon*'::text, NULL::uuid)$q$,
    test.id('one'), test.ref('Q')));
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT count(*) FROM public.chat_messages WHERE channel_id = test.ref('Q') AND author_id = test.id('B')) = 1,
    'send: a resent id returns the stored row (idempotent on the id)', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'taking it'::text, NULL::uuid)$q$,
    test.id('one'), test.ref('Q')));
  PERFORM test.ok(v = '22023 That message id is already used.', 'send: someone else''s message id is refused', v);

  -- A row sent before the release keeps its client id.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, client_id, format_version)
  VALUES (test.id('old'), test.id('W'), test.ref('Q'), test.id('C'), 'from _before_', test.id('client:old'), 1);
  SET LOCAL session_replication_role = origin;
  PERFORM test.ok((test.msg(test.id('old'))).client_id = test.id('client:old'), 'v1 rows: their client_id stays');

  v := test.as_user('B', format($q$SELECT public.chat_op_edit(%L::uuid, 'v2 _as typed_'::text)$q$, test.id('one')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(test.id('one'))).body = 'v2 _as typed_', 'edit: the v2 op', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_react(p_message_id => %L, p_key => '🎉', p_on => true)$q$, test.id('one')));
  PERFORM test.ok(v = 'ok 1' AND (test.msg(test.id('one'))).reactions ? '🎉', 'react: the v2 op', v);

  -- The v1 forms an old build would send are refused as unknown functions.
  v := test.as_user('B', format($q$SELECT public.chat_op_send(p_channel_id => %L::uuid, p_body => 'old'::text, p_client_id => %L::uuid)$q$,
    test.ref('Q'), test.id('client:new')));
  PERFORM test.ok(v LIKE '42883 %', 'v1 send: gone', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_edit(p_message_id => %L, p_body => 'x', p_mentioned_user_ids => '{}')$q$, test.id('one')));
  PERFORM test.ok(v LIKE '42883 %', 'v1 edit: gone', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_react(p_message_id => %L, p_emoji => '👍')$q$, test.id('one')));
  PERFORM test.ok(v LIKE '42883 %', 'v1 react (the toggle): gone', v);
  v := test.as_user('A', format($q$SELECT public.share_op_announce(%L, true)$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE '42883 %', 'share_op_announce: gone (chat_op_set_announcement replaces it)', v);
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

-- ── What CV-23 retired, and what it keeps ───────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    to_regprocedure('public.chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)') IS NULL
    AND to_regprocedure('public.chat_op_edit(uuid, text, uuid[])') IS NULL
    AND to_regprocedure('public.chat_op_react(uuid, text)') IS NULL
    AND to_regprocedure('public.chat_op_mark_read(uuid, timestamptz)') IS NULL
    AND to_regprocedure('public.chat_op_mark_unread(uuid, timestamptz)') IS NULL
    AND to_regprocedure('public.share_op_announce(uuid, boolean)') IS NULL
    AND to_regprocedure('public.chat_normalize_channel_name(text)') IS NULL,
    'signatures: the v1 forms, share_op_announce and chat_normalize_channel_name are gone');
  PERFORM test.ok(
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chat_op_send') = 1
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chat_op_edit') = 1
    AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'chat_op_react') = 1
    AND to_regprocedure('public.chat_op_agent_post(uuid, uuid, text, uuid)') IS NOT NULL,
    'signatures: one of each op is left; the connector''s chat_op_agent_post stays');
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.chat_op_send(uuid, uuid, text, uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.chat_op_send(uuid, uuid, text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_op_send(uuid, uuid, text, uuid)', 'EXECUTE')
    AND (SELECT prosecdef AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')
           FROM pg_proc WHERE oid = 'public.chat_op_send(uuid, uuid, text, uuid)'::regprocedure),
    'grants: the send is signed-in people''s and the service role''s, never anon''s; definer, search_path pinned');
  PERFORM test.ok(to_regclass('public.chat_messages_channel_idx') IS NULL
                  AND to_regclass('public.chat_messages_stream_idx') IS NOT NULL
                  AND to_regclass('public.chat_messages_client_uq') IS NOT NULL,
    'indexes: v1''s stream index is gone; the stream index and v1 rows'' client id index stay');
  PERFORM test.ok((SELECT convalidated FROM pg_constraint
                    WHERE conrelid = 'public.chat_channels'::regclass AND conname = 'chat_channels_name_trimmed'),
    'names: chat_channels_name_trimmed is validated');
  PERFORM test.ok((SELECT value #>> '{}' FROM public.app_settings WHERE key = 'min_build') = '1.0.21',
    'min_build: the first production desktop build without v1 calls (1.0.21)');
END;
$$;

-- Chat v2 · linked channels and "Mentioned in" (AC9.1–9.3, AC5.1, AC6.1,
-- AC3.6; supabase/migrations/…_chat_v2_references.sql). CV-10 writes the
-- "Mentioned in" half and the two reference kinds; CV-13 adds the channel-link
-- half below its own heading.
--
-- Rules, as behaviour: a message that refers to an item leaves one "Mentioned
-- in" line per conversation and item, readable only by the conversation's
-- readers; edits add lines and never remove them, nor does a delete; only items
-- the sender can open, already in the registry, count. A message's chip and
-- card answer only to people who can read it (everyone else gets nothing, so
-- the app draws "Private item" with no title); registering a message for a link
-- needs reading it and never stores a label; no op takes a person from the
-- caller; an API key reads no chat row through any of it.
--
-- Cast: O owns workspace W (Duo). A, B and N are members; X is in no
-- workspace; K is A's API key (chat and tasks at Edit). Q is a public channel
-- A makes with B; P a private one of A and B (N reads Q, not P). T, T2 are
-- tasks in the shared project SB; TP is O's task in the private project PB.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'N', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Links');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('N'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv10'),
        '{"chat": "edit", "tasks": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.uri(p_type text, p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'moduo://' || p_type || '/' || test.id(p_name)
$$;
CREATE FUNCTION test.send(p_who text, p_msg text, p_channel text, p_body text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, NULL::uuid)$q$,
    test.mid(p_msg), test.ref(p_channel), p_body))
$$;
-- Live "Mentioned in" rows from conversation p_channel to task p_task (any direction).
CREATE FUNCTION test.mentions(p_channel text, p_task text) RETURNS bigint LANGUAGE sql VOLATILE AS $$
  SELECT count(*) FROM public.entity_links l
   WHERE l.workspace_id = test.id('W') AND l.deleted_at IS NULL AND l.relation_kind = 'mentions'
     AND l.pair_key = public.spine_pair_key('chat_channel', test.ref(p_channel), 'task', test.id(p_task))
$$;
CREATE FUNCTION test.lines(p_who text, p_task text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(coalesce(channel_name, channel_kind), ',' ORDER BY channel_name), '')
         FROM public.chat_conversations_for_item('task', %L::uuid)$q$, test.id(p_task)))
$$;

-- ── Setup ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'acme', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q with B', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'acme';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'founders', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'founders';
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T'), 'title', 'Get logo SVGs', 'bucket_id', test.id('SB'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'title', 'Brief', 'bucket_id', test.id('SB'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'Secret plan', 'bucket_id', test.id('PB'))));
  PERFORM test.ok((SELECT count(*) FROM public.entities WHERE workspace_id = test.id('W') AND entity_type = 'task'
                    AND entity_id IN (test.id('T'), test.id('T2'), test.id('TP'))) = 3,
    'setup: the three tasks are in the registry');
END;
$$;

-- ── "Mentioned in": one line per conversation and item ──────────────────────
DO $$
DECLARE
  v text;
BEGIN
  -- Twice in one message, an item A can't open, an unknown id, and one in code.
  v := test.send('A', 'q1', 'Q', 'Can you take ' || test.uri('task', 'T') || ' and ' || test.uri('task', 'T')
    || ' and ' || test.uri('task', 'TP') || ' and ' || test.uri('task', 'nothing') || ' but not `'
    || test.uri('task', 'T2') || '`');
  PERFORM test.ok(v LIKE 'ok %', 'a message that refers to items sends', v);
  PERFORM test.ok(test.mentions('Q', 'T') = 1, 'the item it refers to (twice) has one "Mentioned in" row');
  PERFORM test.ok((SELECT origin = 'ref' AND source_type = 'chat_channel' AND created_by = test.id('A')
                     FROM public.entity_links WHERE pair_key = public.spine_pair_key('chat_channel', test.ref('Q'), 'task', test.id('T'))
                      AND deleted_at IS NULL),
    'the row runs from the conversation, origin ref, made by the sender');
  PERFORM test.ok(test.mentions('Q', 'TP') = 0, 'an item the sender can''t open leaves no row');
  PERFORM test.ok(test.mentions('Q', 'T2') = 0, 'a reference inside code leaves no row');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.entities WHERE entity_id = test.id('nothing')),
    'an unknown id stays text (nothing joins the registry)');

  v := test.send('B', 'q2', 'Q', 'again ' || test.uri('task', 'T'));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'T') = 1, 'another message in the same conversation adds no row', v);
  v := test.send('A', 'p1', 'P', 'just us: ' || test.uri('task', 'T'));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('P', 'T') = 1, 'another conversation gets its own row', v);
  PERFORM test.ok((SELECT count(*) FROM public.entity_links WHERE target_id = test.id('T') AND deleted_at IS NULL
                     AND relation_kind = 'mentions') = 2, 'one row per conversation and item');

  -- Edits add; nothing removes.
  v := test.as_user('A', format($q$SELECT public.chat_op_edit(%L::uuid, %L::text)$q$,
    test.mid('q1'), 'Now about ' || test.uri('task', 'T2')));
  PERFORM test.ok(v LIKE 'ok %', 'A edits q1 to refer to T2 instead', v);
  PERFORM test.ok(test.mentions('Q', 'T2') = 1, 'an edit that adds an item adds its row');
  PERFORM test.ok(test.mentions('Q', 'T') = 1, 'an edit that drops an item keeps its row (history)');
  v := test.as_user('A', format($q$SELECT public.chat_op_delete(%L::uuid)$q$, test.mid('q1')));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'T2') = 1, 'deleting the message keeps its rows', v);
  -- The v1 wrapper goes through the same body.
  v := test.as_user('B', format($q$SELECT public.chat_op_send(%L::uuid, %L::text)$q$,
    test.ref('Q'), 'v1 path ' || test.uri('task', 'TP')));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'TP') = 0,
    'through the v1 wrapper an item the sender can''t open still leaves no row', v);
END;
$$;

-- ── Who reads the lines ─────────────────────────────────────────────────────
SELECT test.ok(test.lines('A', 'T') = 'acme,founders', 'A reads both lines for T', test.lines('A', 'T'));
SELECT test.ok(test.lines('N', 'T') = 'acme', 'N (not in P) reads only the public line', test.lines('N', 'T'));
SELECT test.ok(test.lines('X', 'T') = '', 'an outsider reads no line', test.lines('X', 'T'));
SELECT test.ok(test.lines('B', 'TP') = '', 'a line for an item the reader can''t open never shows');
SELECT test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_conversations_for_item('task', %L::uuid)$q$,
  test.id('T'))) = 'ok 0', 'an API key reads no line');
SELECT test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.entity_links
    WHERE source_id = %L::uuid OR target_id = %L::uuid$q$, test.ref('P'), test.ref('P'))) = '0',
  'N reads no entity_links row of the private conversation');
SELECT test.ok(test.value_as('B', format($q$SELECT count(*) FROM public.entity_links
    WHERE (source_id = %L::uuid OR target_id = %L::uuid) AND relation_kind = 'mentions'$q$, test.ref('P'), test.ref('P'))) = '1',
  'B (in P) reads its row');
-- A key reads with the service role (no RLS): the spine's per-item check is
-- what its reads go through (and the connector drops chat ends, key-scopes.test.ts).
SELECT test.ok(test.as_key('K', format($q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_channel', %L)
    OR public.perm_can_see_entity(%L, 'chat_message', %L)$q$,
    test.id('W'), test.ref('Q'), test.id('W'), test.mid('q2'))) = 'ok 0',
  'an API key sees no conversation or message through the spine');

-- ── A message's chip and card ───────────────────────────────────────────────
SELECT test.ok(test.value_as('A', format($q$SELECT string_agg(
      CASE WHEN deleted THEN 'deleted' ELSE coalesce(channel_name, '?') || ':' || excerpt END, '|'
      ORDER BY CASE WHEN deleted THEN 'deleted' ELSE coalesce(channel_name, '?') || ':' || excerpt END)
    FROM public.chat_message_refs(ARRAY[%L, %L, %L, %L]::uuid[])$q$,
    test.mid('q1'), test.mid('q2'), test.mid('p1'), test.id('nothing'))) = 'acme:again|deleted|founders:just us:',
  'A gets q1 (deleted, no words), q2 and p1; an unknown id answers nothing',
  test.value_as('A', format($q$SELECT string_agg(coalesce(excerpt, 'deleted'), '|') FROM public.chat_message_refs(ARRAY[%L, %L, %L]::uuid[])$q$,
    test.mid('q1'), test.mid('q2'), test.mid('p1'))));
SELECT test.ok(test.value_as('A', format($q$SELECT (author_id IS NULL AND excerpt IS NULL)::text
    FROM public.chat_message_refs(ARRAY[%L]::uuid[])$q$, test.mid('q1'))) = 'true',
  'a deleted message answers with no author and no words');
SELECT test.ok(test.value_as('A', format($q$SELECT (author_id = %L::uuid)::text
    FROM public.chat_message_refs(ARRAY[%L]::uuid[])$q$, test.id('B'), test.mid('q2'))) = 'true',
  'a message answers with its author');
SELECT test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.chat_message_refs(ARRAY[%L, %L]::uuid[])$q$,
    test.mid('q2'), test.mid('p1'))) = '1', 'N gets only the message it can read (p1 answers nothing)');
SELECT test.ok(test.value_as('X', format($q$SELECT count(*) FROM public.chat_message_refs(ARRAY[%L]::uuid[])$q$,
    test.mid('q2'))) = '0', 'an outsider gets nothing');
SELECT test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_message_refs(ARRAY[%L]::uuid[])$q$,
    test.mid('q2'))) = 'ok 0', 'an API key gets nothing');

-- ── Registering a message ───────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('N', format($q$SELECT public.chat_op_register_message(%L::uuid)$q$, test.mid('p1')));
  PERFORM test.ok(v LIKE '42501 %', 'N can''t register a message it can''t read', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_register_message(%L::uuid)$q$, test.mid('q2')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'an API key can''t register a message', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_register_message(%L::uuid)$q$, test.mid('q1')));
  PERFORM test.ok(v LIKE 'P0002 %', 'a deleted message can''t be registered', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_register_message(%L::uuid)$q$, test.mid('p1')));
  PERFORM test.ok(v LIKE 'ok %', 'A registers p1', v);
  PERFORM test.ok((SELECT label FROM public.entities WHERE entity_type = 'chat_message' AND entity_id = test.mid('p1')) = '',
    'a registered message has no label');
  v := test.as_user('A', format($q$SELECT public.chat_op_register_message(%L::uuid)$q$, test.mid('p1')));
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT count(*) FROM public.entities WHERE entity_id = test.mid('p1')) = 1,
    'registering again changes nothing', v);

  -- Linking goes through the same rule, whatever label the caller passes.
  v := test.as_user('N', format($q$SELECT public.links_op_create(%L, 'task', %L, 'chat_message', %L, 'spawned-from', 'manual')$q$,
    test.id('W'), test.id('T'), test.mid('p1')));
  PERFORM test.ok(v LIKE '42501 %', 'N can''t link a task to a message it can''t read', v);
  v := test.as_user('N', format($q$SELECT public.links_op_create(%L, 'task', %L, 'chat_message', %L, 'spawned-from', 'manual', NULL, NULL, 'Fake title')$q$,
    test.id('W'), test.id('T'), test.mid('q2')));
  PERFORM test.ok(v LIKE 'ok %', 'N links T to q2 (it reads Q)', v);
  PERFORM test.ok((SELECT label FROM public.entities WHERE entity_id = test.mid('q2')) = '',
    'linking drops the label the caller passed for a message');
  v := test.as_user('N', format($q$SELECT public.entities_op_ensure(%L, 'chat_message', %L, 'Fake title')$q$,
    test.id('W'), test.mid('q2')));
  PERFORM test.ok(v LIKE '42501 %', 'the app can''t call the registry''s ensure itself', v);
  v := test.as_user('X', format($q$SELECT public.links_op_create(%L, 'task', %L, 'chat_channel', %L, 'references', 'manual', NULL, NULL, 'Fake')$q$,
    test.id('W'), test.id('T'), test.ref('P')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'an outsider can''t link a conversation', v);
  v := test.as_key('K', format($q$SELECT public.links_op_create(%L, 'task', %L, 'chat_message', %L, 'spawned-from', 'manual')$q$,
    test.id('W'), test.id('T'), test.mid('q2')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'an API key can''t link a message', v);
  v := test.as_user('A', format($q$SELECT public.links_op_create(%L, 'task', %L, 'chat_message', %L, 'spawned-from', 'manual', NULL, NULL, 'Fake')$q$,
    test.id('W'), test.id('T'), test.mid('p1')));
  PERFORM test.ok(v LIKE 'ok %', 'A links T to p1 ("Became a task")', v);
  PERFORM test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.entity_links WHERE target_id = %L::uuid$q$,
    test.mid('p1'))) = '0', 'N doesn''t read the link to a message it can''t read');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*) FROM public.entity_links WHERE target_id = %L::uuid$q$,
    test.mid('p1'))) = '1', 'B (in P) reads it');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*) FROM public.entities WHERE entity_type LIKE 'chat_%%'
    AND workspace_id = %L::uuid$q$, test.id('W'))) = '0', 'an outsider reads no conversation or message in the registry');
END;
$$;

-- ── No op takes a person from the caller ────────────────────────────────────
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('chat_op_register_message', 'chat_message_refs', 'chat_conversations_for_item')
     AND (pg_get_function_identity_arguments(p.oid) ~ 'user' )),
  'the new reads and op take no user id');
-- Grants: nothing for anon; the app calls only its ops and reads; the helpers
-- and the registry's ensure are the server's alone.
CREATE TABLE test.fn_grants (fn text PRIMARY KEY, app boolean NOT NULL);
INSERT INTO test.fn_grants VALUES
  ('public.chat_op_send(uuid, uuid, text, uuid)', true),
  ('public.chat_op_edit(uuid, text)', true),
  ('public.chat_op_register_message(uuid)', true),
  ('public.chat_message_refs(uuid[])', true),
  ('public.chat_conversations_for_item(text, uuid)', true),
  ('public.chat__body_refs(text)', false),
  ('public.chat__link_mentions(public.chat_messages, uuid)', false),
  ('public.entities_op_ensure(uuid, text, uuid, text, text)', false);
SELECT test.ok(NOT has_function_privilege('anon', g.fn, 'execute'), 'anon can''t run ' || g.fn)
  FROM test.fn_grants g;
SELECT test.ok(has_function_privilege('authenticated', g.fn, 'execute') = g.app,
  CASE WHEN g.app THEN 'the app runs ' ELSE 'the app can''t run ' END || g.fn)
  FROM test.fn_grants g;
SELECT test.ok(has_function_privilege('service_role', g.fn, 'execute'), 'the server runs ' || g.fn)
  FROM test.fn_grants g;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM test.fn_grants g, aclexplode((SELECT proacl FROM pg_proc WHERE oid = g.fn::regprocedure)) a
                            WHERE a.grantee = 0),
  'no function here is open to PUBLIC');

-- ── Ids the caller can't read answer nothing ────────────────────────────────
-- Another workspace W2 (O2 alone) with a channel and a
-- message mentioning its own task.
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.person('O2');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O2');
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W2'), test.id('O2'), 'Elsewhere');
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position)
  VALUES (test.id('SB2'), test.id('W2'), test.id('O2'), 'Theirs', false, '0001');
  v := test.as_user('O2', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W2')));
  INSERT INTO test.ids SELECT 'G2', id FROM public.chat_channels WHERE workspace_id = test.id('W2') AND kind = 'channel' LIMIT 1;
  PERFORM test.as_user('O2', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W2'),
    jsonb_build_object('id', test.id('T9'), 'title', 'Their task', 'bucket_id', test.id('SB2'))));
  v := test.send('O2', 'w2', 'G2', 'ours ' || test.uri('task', 'T9'));
  PERFORM test.ok(v LIKE 'ok %', 'setup: O2 mentions T9 in W2', v);
END;
$$;
SELECT test.ok(test.value_as('A', format($q$SELECT count(*) FROM public.chat_message_refs(ARRAY[%L]::uuid[])$q$,
  test.mid('w2'))) = '0', 'a message in another workspace answers nothing');
SELECT test.ok(test.value_as('A', format($q$SELECT count(*) FROM public.chat_conversations_for_item('task', %L::uuid)$q$,
  test.id('T9'))) = '0', 'another workspace''s "Mentioned in" answers nothing');
SELECT test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.chat_message_refs(ARRAY[%L]::uuid[])$q$,
  test.mid('p1'))) = '0', 'a message in a private conversation you''re not in answers nothing');
SELECT test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.chat_message_refs(ARRAY[%L]::uuid[])
  WHERE excerpt IS NOT NULL OR author_id IS NOT NULL$q$, test.mid('q1'))) = '0',
  'a deleted message answers with no words and no author');
SELECT test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_message_refs(ARRAY[%L, %L, %L]::uuid[])$q$,
  test.mid('q1'), test.mid('q2'), test.mid('p1'))) = 'ok 0', 'an API key gets no message, deleted or not');
SELECT test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_conversations_for_item('task', %L::uuid)$q$,
  test.id('T2'))) = 'ok 0', 'an API key gets no "Mentioned in" line');

-- ── CV-13: the channel link half goes below ────────────────────────────────

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

-- ── AC3.6: a contact mentioned in the private conversation ─────────────────
DO $$
DECLARE
  v text;
  v_contact uuid;
BEGIN
  v := test.as_user('A', format($q$SELECT public.contacts_op_create(%L, 'Ina Investor', NULL, NULL, NULL, NULL, NULL, NULL)$q$,
    test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A adds the investor''s contact', v);
  SELECT entity_id INTO v_contact FROM public.entities
   WHERE workspace_id = test.id('W') AND entity_type = 'contact' AND label = 'Ina Investor';
  INSERT INTO test.ids VALUES ('CI', v_contact);
  v := test.send('A', 'p2', 'P', 'Met ' || 'moduo://contact/' || v_contact || ' today');
  PERFORM test.ok(v LIKE 'ok %', 'A mentions the contact in P', v);
END;
$$;
SELECT test.ok(test.value_as('A', format($q$SELECT string_agg(channel_name, ',') FROM public.chat_conversations_for_item('contact', %L::uuid)$q$,
  test.ref('CI'))) = 'founders', 'the contact''s Linked shows "Mentioned in founders" to a reader of P who can open it');
SELECT test.ok(coalesce(test.value_as('N', format($q$SELECT string_agg(channel_name, ',') FROM public.chat_conversations_for_item('contact', %L::uuid)$q$,
  test.ref('CI'))), '') = '', 'N (not in P) sees no line for it');

-- ── Linking a deleted message; a conversation missing from the registry ────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.links_op_create(%L, 'task', %L, 'chat_message', %L, 'spawned-from', 'manual')$q$,
    test.id('W'), test.id('T'), test.mid('q1')));
  PERFORM test.ok(v LIKE 'P0002 %', 'a deleted message can''t be linked either', v);
  -- Its registry row gone (links cascade), a send that refers to an item still goes through.
  DELETE FROM public.entities WHERE workspace_id = test.id('W') AND entity_type = 'chat_channel' AND entity_id = test.ref('Q');
  v := test.send('A', 'q3', 'Q', 'back to ' || test.uri('task', 'T'));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'T') = 1,
    'a conversation missing from the registry is registered and the line written', v);
END;
$$;

-- ── CV-13: the channel link half goes below ────────────────────────────────
-- Rules, as behaviour: a channel links to at most one project, client or team;
-- linking needs being in the conversation, able to post, and edit rights on
-- the item; the item's conversation line and its spine row are readable only by
-- the conversation's readers; "Start a conversation for X" is public when every
-- member who uses chat sees X, else private with exactly those who do, named
-- after X with " 2" on a clash; linking a team adds nobody (the app offers the
-- people once, through chat_op_add_members); no op takes a person from the
-- caller; a key reads nothing.
--
-- Cast added: C1 a company A makes; TM a team of A and N; PB2 a project only O
-- and A can see (A at edit); PA an archived project.
CREATE FUNCTION test.link(p_who text, p_channel text, p_type text, p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_link_channel(%L::uuid, %L::text, %L::uuid)$q$,
    test.ref(p_channel), p_type, p_id))
$$;
CREATE FUNCTION test.linked(p_channel text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(linked_type || ':' || linked_id, 'none') FROM public.chat_channels WHERE id = test.ref(p_channel)
$$;
CREATE FUNCTION test.mirrors(p_channel text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(string_agg(target_type || ':' || target_id, ','), 'none') FROM public.entity_links
   WHERE workspace_id = test.id('W') AND source_type = 'chat_channel' AND source_id = test.ref(p_channel)
     AND relation_kind = 'conversation-of' AND deleted_at IS NULL
$$;
CREATE FUNCTION test.convo(p_who text, p_type text, p_id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format(
    $q$SELECT string_agg(channel_name || '/' || unread, ',' ORDER BY channel_name)
         FROM public.chat_conversations_for_item(%L, %L::uuid) WHERE relation = 'conversation-of'$q$, p_type, p_id)), '')
$$;

DO $$
BEGIN
  INSERT INTO public.companies (id, workspace_id, owner_id, name) VALUES (test.id('C1'), test.id('W'), test.id('A'), 'Acme');
  INSERT INTO public.teams (id, workspace_id, name, mark) VALUES (test.id('TM'), test.id('W'), 'Design', 'D');
  INSERT INTO public.team_members (workspace_id, team_id, user_id)
  VALUES (test.id('W'), test.id('TM'), test.id('A')), (test.id('W'), test.id('TM'), test.id('N'));
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
    (test.id('PB2'), test.id('W'), test.id('O'), 'Website', false, '0003'),
    (test.id('PA'), test.id('W'), test.id('O'), 'Old site', false, '0004');
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB2');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PB2'), 'member', test.id('A'), 'edit', test.id('O'));
  UPDATE public.buckets SET archived_at = now() WHERE id = test.id('PA');
  PERFORM test.ok(public.can_access('bucket', test.id('SB'), 'edit', test.id('A')),
    'setup: A may edit the shared project');
END;
$$;

-- ── AC9.1: one link per channel, from Details ──────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.link('A', 'Q', 'project', test.id('SB'));
  PERFORM test.ok(v LIKE 'ok %', 'A (in Q, can post, edits Shared) links Q to the project', v);
  PERFORM test.ok(test.linked('Q') = 'bucket:' || test.id('SB'), 'the channel points at the project');
  PERFORM test.ok(test.mirrors('Q') = 'bucket:' || test.id('SB'), 'one conversation-of row mirrors it');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE entity_id = test.ref('Q') AND op = 'chat.channel_link'
                            AND payload ->> 'linked_type' = 'bucket'), 'the link is in the channel''s history');
  v := test.link('A', 'Q', 'company', test.id('C1'));
  PERFORM test.ok(v LIKE 'ok %' AND test.linked('Q') = 'company:' || test.id('C1'), 'relinking replaces the link', v);
  PERFORM test.ok(test.mirrors('Q') = 'company:' || test.id('C1'), 'the old row goes, one row stays');
  v := test.link('A', 'Q', NULL, NULL);
  PERFORM test.ok(v LIKE 'ok %' AND test.linked('Q') = 'none' AND test.mirrors('Q') = 'none', 'unlinking clears both', v);

  -- Who may not.
  v := test.link('N', 'Q', 'project', test.id('SB'));
  PERFORM test.ok(v LIKE '42501 %', 'N reads Q but isn''t in it: refused', v);
  v := test.link('X', 'Q', 'project', test.id('SB'));
  PERFORM test.ok(v NOT LIKE 'ok %', 'an outsider: refused', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_link_channel(%L::uuid, 'project', %L::uuid)$q$, test.ref('Q'), test.id('SB')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'an API key: refused', v);
  v := test.link('A', 'Q', 'project', test.id('PB'));
  PERFORM test.ok(v LIKE '42501 %' AND test.linked('Q') = 'none', 'a project A can''t edit (O''s private one): refused', v);
  v := test.link('B', 'Q', 'company', test.id('C1'));
  PERFORM test.ok(v LIKE '42501 %' AND test.linked('Q') = 'none', 'B (in Q) can''t edit A''s company: refused', v);
  v := test.link('A', 'Q', 'company', test.id('C1'));
  PERFORM test.ok(v LIKE 'ok %', 'A links Q to the company', v);
  v := test.link('A', 'Q', 'project', test.id('PA'));
  PERFORM test.ok(v LIKE '22023 %' AND test.linked('Q') = 'company:' || test.id('C1'), 'an archived project: refused, the link stays', v);
  v := test.link('A', 'Q', 'note', test.id('SB'));
  PERFORM test.ok(v LIKE '22023 %', 'a conversation links only to a project, client or team', v);
  v := test.link('A', 'Q', 'project', test.id('nothing'));
  PERFORM test.ok(v LIKE 'P0002 %', 'an unknown id: refused', v);
  v := test.link('A', 'Q', 'project', test.id('SB2'));
  PERFORM test.ok(v LIKE 'P0002 %', 'another workspace''s project: refused', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  INSERT INTO test.ids SELECT 'DM', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm' LIMIT 1;
  v := test.link('A', 'DM', 'project', test.id('SB'));
  PERFORM test.ok(v LIKE '22023 %', 'a direct message links to nothing', v);
END;
$$;

-- ── The spine row: written by the chat op only, read by readers only ───────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.links_op_create(%L, 'chat_channel', %L, 'bucket', %L, 'conversation-of', 'manual')$q$,
    test.id('W'), test.ref('Q'), test.id('SB')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'the link op can''t write a conversation-of row', v);
  v := test.as_op('A', format($q$INSERT INTO public.entity_links (workspace_id, source_type, source_id, target_type, target_id, relation_kind)
    VALUES (%L, 'chat_channel', %L, 'bucket', %L, 'conversation-of')$q$, test.id('W'), test.ref('Q'), test.id('SB')));
  PERFORM test.ok(v LIKE '42501 %', 'nor can a row for an item the channel doesn''t link to', v);
  v := test.as_op('A', format($q$UPDATE public.entity_links SET relation_kind = 'references'
    WHERE source_id = %L AND relation_kind = 'conversation-of'$q$, test.ref('Q')));
  PERFORM test.ok(v LIKE '42501 %', 'a conversation-of row never changes kind', v);
  -- An item's restore brings back its row only while the link holds.
  UPDATE public.entity_links SET deleted_at = now()
   WHERE source_id = test.ref('Q') AND relation_kind = 'conversation-of' AND target_id = test.id('SB');
  UPDATE public.entity_links SET deleted_at = NULL
   WHERE source_id = test.ref('Q') AND relation_kind = 'conversation-of' AND target_id = test.id('SB');
  PERFORM test.ok(test.mirrors('Q') = 'company:' || test.id('C1'), 'an old row of a former link never comes back');

  v := test.link('A', 'P', 'project', test.id('SB'));
  PERFORM test.ok(v LIKE 'ok %', 'A links the private P to the shared project', v);
END;
$$;
SELECT test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.entity_links
    WHERE source_id = %L::uuid AND relation_kind = 'conversation-of'$q$, test.ref('P'))) = '0',
  'N (not in P) reads no conversation-of row of P');
SELECT test.ok(test.value_as('B', format($q$SELECT count(*) FROM public.entity_links
    WHERE source_id = %L::uuid AND relation_kind = 'conversation-of' AND deleted_at IS NULL$q$, test.ref('P'))) = '1',
  'B (in P) reads it');
SELECT test.ok(test.value_as('N', format($q$SELECT count(*) FROM public.entity_links
    WHERE source_id = %L::uuid AND relation_kind = 'conversation-of' AND deleted_at IS NULL$q$, test.ref('Q'))) = '1',
  'N reads the public Q''s row');

-- ── AC5.1 / AC6.1: the item shows its conversation, with the reader's unread ─
SELECT test.ok(test.send('B', 'q4', 'Q', 'logo is in') LIKE 'ok %', 'setup: B posts in Q');
SELECT test.ok(test.convo('A', 'company', test.id('C1')) = 'acme/' || test.value_as('A', format(
    $q$SELECT unread FROM public.chat_unread_counts(%L) WHERE channel_id = %L$q$, test.id('W'), test.ref('Q')))
  AND test.convo('A', 'company', test.id('C1')) <> 'acme/0',
  'the company shows "Conversation: acme · N new" to A, N being A''s unread in Q', test.convo('A', 'company', test.id('C1')));
SELECT test.ok(test.convo('N', 'company', test.id('C1')) = '',
  'N reads Q but can''t open A''s company: no line', test.convo('N', 'company', test.id('C1')));
SELECT test.ok(test.convo('A', 'project', test.id('SB')) = 'founders/0', 'the project shows P to A',
  test.convo('A', 'project', test.id('SB')));
SELECT test.ok(test.convo('N', 'project', test.id('SB')) = '', 'N (not in P) sees no line for P');
SELECT test.ok(test.convo('X', 'company', test.id('C1')) = '', 'an outsider sees nothing');
SELECT test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_conversations_for_item('company', %L::uuid)$q$,
  test.id('C1'))) = 'ok 0', 'an API key reads no line');
SELECT test.ok(test.as_key('K', format($q$SELECT 1 FROM public.entity_links WHERE source_id = %L AND relation_kind = 'conversation-of'
    AND public.perm_can_see_entity(workspace_id, source_type, source_id)$q$, test.ref('Q'))) = 'ok 0',
  'an API key sees no conversation-of row through the spine');

-- ── AC9.2: linking a team adds nobody; the offer adds its people once ───────
DO $$
DECLARE
  v text;
BEGIN
  v := test.link('B', 'Q', 'team', test.id('TM'));
  PERFORM test.ok(v LIKE '42501 %', 'B isn''t in the team: refused', v);
  v := test.link('A', 'Q', 'team', test.id('TM'));
  PERFORM test.ok(v LIKE 'ok %' AND test.linked('Q') = 'team:' || test.id('TM'), 'A (in the team) links Q to it', v);
  PERFORM test.ok(test.mirrors('Q') = 'none', 'a team link is the column only');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_members WHERE channel_id = test.ref('Q') AND user_id = test.id('N')),
    'linking adds nobody');
  PERFORM test.ok(test.convo('A', 'team', test.id('TM')) LIKE 'acme/%', 'the team''s conversation answers for it');
  v := test.as_user('A', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L, %L]::uuid[])$q$,
    test.ref('Q'), test.id('A'), test.id('N')));
  PERFORM test.ok(v LIKE 'ok %' AND EXISTS (SELECT 1 FROM public.chat_members WHERE channel_id = test.ref('Q')
    AND user_id = test.id('N') AND left_at IS NULL), 'the offer adds the team''s people', v);
  INSERT INTO public.team_members (workspace_id, team_id, user_id) VALUES (test.id('W'), test.id('TM'), test.id('O'));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_members WHERE channel_id = test.ref('Q') AND user_id = test.id('O')),
    'a later team change doesn''t follow');
END;
$$;

-- ── New conversation with a link ───────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'kickoff', '', false, '{}'::uuid[], false, 'company', %L)$q$,
    test.id('W'), test.id('C1')));
  PERFORM test.ok(v LIKE 'ok %', 'A makes "kickoff" linked to the company', v);
  INSERT INTO test.ids SELECT 'KO', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'kickoff';
  PERFORM test.ok(test.linked('KO') = 'company:' || test.id('C1') AND test.mirrors('KO') = 'company:' || test.id('C1'),
    'it is linked from the start');
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'secret', '', false, '{}'::uuid[], false, 'project', %L)$q$,
    test.id('W'), test.id('PB')));
  PERFORM test.ok(v LIKE '42501 %' AND NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret'),
    'linked to a project A can''t edit: refused, nothing made', v);
END;
$$;

-- ── "Start a conversation for X" (CH56) ────────────────────────────────────
DO $$
DECLARE
  v text;
  r public.chat_channels;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_start_conversation(%L, 'project', %L)$q$, test.id('W'), test.id('SB')));
  PERFORM test.ok(v LIKE 'ok %', 'A starts a conversation for the shared project', v);
  SELECT * INTO r FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Shared';
  PERFORM test.ok(r.id IS NOT NULL AND NOT r.is_private AND r.linked_type = 'bucket' AND r.linked_id = test.id('SB'),
    'everyone sees it: a public channel named after it, linked to it');
  PERFORM test.ok((SELECT array_agg(user_id) FROM public.chat_members WHERE channel_id = r.id AND left_at IS NULL) = ARRAY[test.id('A')],
    'with the creator in it');
  v := test.as_user('A', format($q$SELECT public.chat_op_start_conversation(%L, 'project', %L)$q$, test.id('W'), test.id('SB')));
  PERFORM test.ok(v LIKE 'ok %' AND EXISTS (SELECT 1 FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Shared 2'),
    'again: "Shared 2"', v);

  v := test.as_user('A', format($q$SELECT public.chat_op_start_conversation(%L, 'project', %L)$q$, test.id('W'), test.id('PB2')));
  PERFORM test.ok(v LIKE 'ok %', 'A starts one for Website, which only O and A see', v);
  SELECT * INTO r FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Website';
  PERFORM test.ok(r.is_private AND r.linked_id = test.id('PB2'), 'it is private and linked');
  PERFORM test.ok((SELECT array_agg(user_id ORDER BY user_id) FROM public.chat_members WHERE channel_id = r.id AND left_at IS NULL)
                  = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[test.id('A'), test.id('O')]) x),
    'with exactly the people who can see the project');

  v := test.as_user('A', format($q$SELECT public.chat_op_start_conversation(%L, 'company', %L)$q$, test.id('W'), test.id('C1')));
  PERFORM test.ok(v LIKE 'ok %' AND EXISTS (SELECT 1 FROM public.chat_channels WHERE workspace_id = test.id('W')
    AND name = 'Acme 2' AND linked_type = 'company'),
    'from a client''s hub: named after Acme, "Acme 2" beside the channel acme, linked to the company', v);
  v := test.as_user('N', format($q$SELECT public.chat_op_start_conversation(%L, 'project', %L)$q$, test.id('W'), test.id('PB2')));
  PERFORM test.ok(v LIKE '42501 %', 'N can''t edit Website: refused', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_start_conversation(%L, 'team', %L)$q$, test.id('W'), test.id('TM')));
  PERFORM test.ok(v LIKE '22023 %', 'a team has no "Start a conversation"', v);
END;
$$;

-- ── Capture's destination: the linked project, for whoever may add to it ───
CREATE FUNCTION test.files_here(p_who text, p_channel_name text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT public.chat_link_files_here(%L::uuid)::text$q$,
    (SELECT id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = p_channel_name)))
$$;
SELECT test.ok(test.files_here('A', 'Shared') = 'true', 'A, who edits Shared, files into it from its channel');
SELECT test.ok(test.files_here('A', 'Website') = 'true', 'and into Website from its private channel');
SELECT test.ok(test.files_here('O', 'Website') = 'true', 'O, its owner, too');
SELECT test.ok(test.files_here('N', 'Website') = 'false', 'N (can''t read the channel): no');
SELECT test.ok(test.files_here('A', 'kickoff') = 'false', 'a channel linked to a client: the Inbox');
SELECT test.ok(test.as_key('K', format($q$SELECT 1 WHERE public.chat_link_files_here(%L)$q$,
  (SELECT id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Shared'))) = 'ok 0',
  'an API key: no');

-- ── The linked project is deleted: the channel stays ───────────────────────
DO $$
BEGIN
  UPDATE public.buckets SET deleted_at = now() WHERE id = test.id('PB2');
  PERFORM test.ok(test.files_here('A', 'Website') = 'false', 'a deleted project: capture falls back to the Inbox');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_channels WHERE name = 'Website' AND deleted_at IS NULL
    AND linked_id = test.id('PB2')), 'the channel stays, still pointing at it (the chip shows the tombstone)');
END;
$$;

-- ── No op takes a person; grants ───────────────────────────────────────────
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('chat_op_link_channel', 'chat_op_start_conversation', 'chat_op_create_channel', 'chat_conversations_for_item')
     AND (pg_get_function_identity_arguments(p.oid) ~ 'user')),
  'the link ops and read take no user id');
CREATE TABLE test.fn_grants_13 (fn text PRIMARY KEY, app boolean NOT NULL);
INSERT INTO test.fn_grants_13 VALUES
  ('public.chat_op_link_channel(uuid, text, uuid)', true),
  ('public.chat_op_start_conversation(uuid, text, uuid)', true),
  ('public.chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean, text, uuid)', true),
  ('public.chat_conversations_for_item(text, uuid)', true),
  ('public.chat_link_files_here(uuid)', true),
  ('public.chat__links_to(uuid, text, uuid)', false),
  ('public.chat__link_type(text)', false),
  ('public.chat__check_link_target(uuid, text, uuid, uuid)', false),
  ('public.chat__set_link(public.chat_channels, text, uuid, uuid)', false);
SELECT test.ok(NOT has_function_privilege('anon', g.fn, 'execute'), 'anon can''t run ' || g.fn) FROM test.fn_grants_13 g;
SELECT test.ok(has_function_privilege('authenticated', g.fn, 'execute') = g.app,
  CASE WHEN g.app THEN 'the app runs ' ELSE 'the app can''t run ' END || g.fn) FROM test.fn_grants_13 g;
SELECT test.ok(has_function_privilege('service_role', g.fn, 'execute'), 'the server runs ' || g.fn) FROM test.fn_grants_13 g;
SELECT test.ok(NOT EXISTS (SELECT 1 FROM test.fn_grants_13 g, aclexplode((SELECT proacl FROM pg_proc WHERE oid = g.fn::regprocedure)) a
                            WHERE a.grantee = 0), 'no CV-13 function is open to PUBLIC');
SELECT test.ok(NOT has_function_privilege('authenticated', 'public.chat__guard_conversation_of()', 'execute'),
  'the trigger function is nobody''s to call');

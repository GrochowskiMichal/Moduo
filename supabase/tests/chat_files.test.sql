-- Chat v2 · CV-9 "files follow the message" (AC2.3;
-- supabase/migrations/20261016170000_chat_v2_files.sql). A pending upload is
-- seen by its uploader only; send takes it; readers of the conversation read
-- it (row and bytes), nobody else; deleting the message sends its files to the
-- trash on the message's clock and its Undo brings them back; a removed
-- member loses them at once; the eleventh file is refused before upload; the
-- per-file cap and the pool still apply; a key reads none of it.
--
-- Cast: O owns workspace W (Duo). A, B, C and D are members, V a viewer, X
-- owns another workspace. P is A's private channel with B and D; Q a public
-- channel with V. K is A's API key (chat at Edit).

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'D', 'V', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Files'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('C'), 'member'),
  (test.id('W'), test.id('D'), 'member'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Agent', 'mdo_test', md5('db-test-key-cv9'),
        '{"chat": "edit", "tasks": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
-- Begin one chat upload as a person: 'ok 1' or the refusal.
CREATE FUNCTION test.cbegin(p_who text, p_channel text, p_msg text, p_file text, p_size bigint)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.attachments_op_begin(p_workspace_id => %L, p_entity_type => 'chat_message',
         p_entity_id => %L, p_file_name => %L, p_mime => 'image/png', p_size_bytes => %s,
         p_channel_id => %L)$q$,
    test.id('W'), test.mid(p_msg), p_file, p_size, test.ref(p_channel)))
$$;
CREATE FUNCTION test.file(p_name text) RETURNS public.attachments LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.attachments WHERE file_name = p_name
$$;
-- The bytes, the way the Storage API writes them (as the person, under policy).
CREATE FUNCTION test.put(p_who text, p_file text, p_size bigint) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
       VALUES ('attachments', %L, %L, %L, jsonb_build_object('size', %s))$q$,
    (test.file(p_file)).object_path, test.id(p_who), test.id(p_who)::text, p_size))
$$;
CREATE FUNCTION test.finalize(p_who text, p_file text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.attachments_op_finalize(%L)$q$, (test.file(p_file)).id))
$$;
-- What a person reads: the row through RLS, the bytes through Storage's policy.
CREATE FUNCTION test.sees_row(p_who text, p_file text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.attachments WHERE id = %L$q$,
    (test.file(p_file)).id))
$$;
CREATE FUNCTION test.sees_bytes(p_who text, p_file text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM storage.objects
    WHERE bucket_id = 'attachments' AND name = %L$q$, (test.file(p_file)).object_path))
$$;
CREATE FUNCTION test.files_view(p_who text, p_channel text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT coalesce(string_agg(file_name, ',' ORDER BY file_name), '')
    FROM public.chat_files(%L)$q$, test.ref(p_channel)))
$$;
CREATE FUNCTION test.send(p_who text, p_channel text, p_msg text, p_body text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, NULL::uuid)$q$,
    test.mid(p_msg), test.ref(p_channel), p_body))
$$;
CREATE FUNCTION test.used() RETURNS bigint LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((SELECT bytes_used FROM public.storage_usage WHERE owner_id = test.id('O')), 0)
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer, uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer, uuid)', 'EXECUTE'),
    'grants: begin (with the conversation) is the signed-in person''s');
  PERFORM test.ok(to_regprocedure('public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer)') IS NULL,
    'grants: the old begin is gone (one signature, no ambiguous call)');
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.chat_files(uuid, timestamptz, integer, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_files(uuid, timestamptz, integer, uuid)', 'EXECUTE'),
    'grants: the Files view reads for the signed-in person only');
  PERFORM test.ok(
    has_function_privilege('authenticated', 'public.chat_op_send(uuid, uuid, text, uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_op_delete(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_op_restore(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.attachments_op_finalize(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.attachments_op_delete(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_op_send(uuid, uuid, text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.attachments_op_delete(uuid)', 'EXECUTE'),
    'grants: the redefined ops keep their callers');
  PERFORM test.ok(
    NOT has_function_privilege('authenticated', 'public.attachments__chat_file_cap()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.attachments__chat_file_cap()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.attachments__purge_candidates(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.attachments__purge_rows(uuid[])', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.attachments__purge_rows(uuid[])', 'EXECUTE'),
    'grants: the helpers stay the server''s');
END $$;

-- ── Setup: General, the private channel P (A, B, D) and the public Q (A, V)
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'secret', '', true, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('D')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B and D', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'plans', '', false, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q with V', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'plans';
  v := test.send('A', 'P', 'old', 'already here');
  PERFORM test.ok(v LIKE 'ok %', 'setup: A posts "old" in P', v);
END $$;

-- ── Begin: who may upload into a conversation ─────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.cbegin('A', 'P', 'm1', 'shot.png', 1000);
  PERFORM test.ok(v = 'ok 1', 'begin: A uploads into P under a new message id', v);
  PERFORM test.ok((test.file('shot.png')).entity_type = 'chat_message'
                  AND (test.file('shot.png')).entity_id = test.mid('m1')
                  AND (test.file('shot.png')).status = 'pending',
    'begin: the row is a pending chat_message file under that id');
  PERFORM test.ok(position(test.mid('m1')::text in (test.file('shot.png')).object_path) = 0
                  AND (test.file('shot.png')).object_path LIKE test.id('W')::text || '/%/original.png',
    'begin: the path is the workspace and a random id, nothing guessable from the message');
  v := test.cbegin('X', 'P', 'mx', 'x.png', 10);
  PERFORM test.ok(v LIKE 'P0002 entity_not_found%', 'begin: someone outside the workspace is refused as "not found"', v);
  v := test.cbegin('C', 'P', 'mc', 'c.png', 10);
  PERFORM test.ok(v LIKE 'P0002 entity_not_found%', 'begin: a member outside the private conversation is refused', v);
  v := test.cbegin('V', 'Q', 'mv', 'v.png', 10);
  PERFORM test.ok(v LIKE '42501 no_edit_access%', 'begin: a viewer reads but doesn''t upload', v);
  v := test.cbegin('B', 'P', 'old', 'late.png', 10);
  PERFORM test.ok(v LIKE 'P0002 entity_not_found%', 'begin: a message that exists takes no new files (not even its own)', v);
  v := test.cbegin('A', 'P', 'm9', 'huge.bin', 60 * 1048576);
  PERFORM test.ok(v LIKE 'P0001 attachment_too_large%', 'begin: the per-file cap (50 MB) applies to chat files', v);
  v := test.as_user('A', format(
    $q$SELECT public.attachments_op_begin(%L, 'chat_message', %L, 'n.png', 'image/png', 10)$q$,
    test.id('W'), test.mid('m8')));
  PERFORM test.ok(v LIKE 'P0002 entity_not_found%', 'begin: a chat file without its conversation is refused', v);
  v := test.as_key('K', format(
    $q$SELECT public.attachments_op_begin(p_workspace_id => %L, p_entity_type => 'chat_message',
         p_entity_id => %L, p_file_name => 'k.png', p_mime => 'image/png', p_size_bytes => 10,
         p_channel_id => %L)$q$, test.id('W'), test.mid('mk'), test.ref('P')));
  PERFORM test.ok(v LIKE '42501 not_signed_in%', 'begin: a key uploads nothing', v);
END $$;

-- ── Before the send: only the uploader sees it ────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.sees_row('A', 'shot.png') = '1', 'pending: the uploader sees their upload');
  PERFORM test.ok(test.sees_row('B', 'shot.png') = '0', 'pending: someone in the conversation doesn''t yet');
  v := test.put('A', 'shot.png', 1000);
  PERFORM test.ok(v = 'ok 1', 'pending: the uploader''s bytes land', v);
  v := test.put('B', 'shot.png', 1000);
  PERFORM test.ok(v NOT LIKE 'ok%', 'pending: nobody else writes its bytes', v);
  PERFORM test.ok(test.sees_bytes('B', 'shot.png') = '0', 'pending: nobody else reads its bytes');
  v := test.finalize('A', 'shot.png');
  PERFORM test.ok(v LIKE 'ok%' AND (test.file('shot.png')).status = 'ready', 'pending: finalize makes it ready', v);
  PERFORM test.ok(test.sees_row('B', 'shot.png') = '0' AND test.sees_bytes('B', 'shot.png') = '0',
    'ready, unsent: still nobody else''s');
  PERFORM test.ok(test.used() = 1000, 'budget: the finished file counts against the owner''s pool', test.used()::text);
  -- A second file that won't finish before the send.
  v := test.cbegin('A', 'P', 'm1', 'slow.pdf', 500);
  PERFORM test.ok(v = 'ok 1', 'pending: a second file under the same message', v);
END $$;

-- ── Send takes it: readers of the conversation read it ────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('A', 'P', 'm0', '');
  PERFORM test.ok(v LIKE '22023 A message can''t be empty%', 'send: no words and no files is still refused', v);
  v := test.send('A', 'P', 'm1', '');
  PERFORM test.ok(v LIKE 'ok %', 'send: a message of files only, no words, is sent', v);
  PERFORM test.ok((SELECT file_count FROM public.chat_messages WHERE id = test.mid('m1')) = 1,
    'send: it holds the one finished file (the unfinished one isn''t taken)');
  PERFORM test.ok(test.sees_row('B', 'shot.png') = '1' AND test.sees_bytes('B', 'shot.png') = '1',
    'sent: someone in the conversation reads the file and its bytes');
  PERFORM test.ok(test.sees_row('C', 'shot.png') = '0' AND test.sees_bytes('C', 'shot.png') = '0',
    'sent: a member outside the private conversation reads neither');
  PERFORM test.ok(test.sees_row('X', 'shot.png') = '0' AND test.sees_bytes('X', 'shot.png') = '0',
    'sent: someone outside the workspace reads neither');
  PERFORM test.ok(test.files_view('B', 'P') = 'shot.png', 'Files view: lists it for a reader', test.files_view('B', 'P'));
  PERFORM test.ok(test.files_view('C', 'P') LIKE 'ERROR%', 'Files view: refused to a member outside it');
  v := test.as_key('K', format($q$SELECT * FROM public.chat_files(%L)$q$, test.ref('P')));
  PERFORM test.ok(v NOT LIKE 'ok%', 'Files view: a key reads nothing through it', v);
  -- The late file: its bytes land, finalize fails it.
  v := test.put('A', 'slow.pdf', 500);
  v := test.finalize('A', 'slow.pdf');
  PERFORM test.ok((test.file('slow.pdf')).status = 'failed', 'late: a file finishing after its message was sent never joins it', v);
  PERFORM test.ok(test.sees_row('B', 'slow.pdf') = '0', 'late: nobody else sees it');
  -- Only the uploader's own files go with a send.
  v := test.cbegin('B', 'P', 'm2', 'b.png', 100);
  PERFORM test.put('B', 'b.png', 100);
  PERFORM test.finalize('B', 'b.png');
  v := test.send('A', 'P', 'm2', 'hijack');
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT file_count FROM public.chat_messages WHERE id = test.mid('m2')) = 0,
    'send: another person''s upload under the same id isn''t taken', v);
  PERFORM test.ok(test.sees_row('D', 'b.png') = '0' AND test.sees_bytes('D', 'b.png') = '0',
    'send: and it stays unreadable to the conversation');
END $$;

-- ── The composer's remove, before the send only ───────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.cbegin('A', 'P', 'm3', 'gone.png', 50);
  PERFORM test.put('A', 'gone.png', 50);
  PERFORM test.finalize('A', 'gone.png');
  v := test.as_user('B', format($q$SELECT public.attachments_op_delete(%L)$q$, (test.file('gone.png')).id));
  PERFORM test.ok(v LIKE 'P0002 attachment_not_found%', 'remove: not someone else''s unsent file', v);
  v := test.as_user('A', format($q$SELECT public.attachments_op_delete(%L)$q$, (test.file('gone.png')).id));
  PERFORM test.ok(v LIKE 'ok%' AND (test.file('gone.png')).deleted_at IS NOT NULL,
    'remove: the uploader takes a finished file out before sending', v);
  v := test.send('A', 'P', 'm3', 'without it');
  PERFORM test.ok((SELECT file_count FROM public.chat_messages WHERE id = test.mid('m3')) = 0,
    'remove: the message goes without it', v);
  v := test.as_user('A', format($q$SELECT public.attachments_op_delete(%L)$q$, (test.file('shot.png')).id));
  PERFORM test.ok(v LIKE 'P0002 attachment_not_found%', 'remove: a sent message''s file leaves only with its message', v);
END $$;

-- ── Ten files a message; the eleventh is refused before upload ─────────────
DO $$
DECLARE
  v text;
  i int;
BEGIN
  FOR i IN 1..10 LOOP
    v := test.cbegin('A', 'Q', 'm10', format('f%s.png', i), 10);
  END LOOP;
  PERFORM test.ok(v = 'ok 1' AND (SELECT count(*) FROM public.attachments WHERE entity_id = test.mid('m10')) = 10,
    'cap: ten files begin', v);
  v := test.cbegin('A', 'Q', 'm10', 'f11.png', 10);
  PERFORM test.ok(v LIKE 'P0001 too_many_files%', 'cap: the eleventh is refused before any bytes move', v);
END $$;

-- ── Delete, Undo, and the trash clock ─────────────────────────────────────
DO $$
DECLARE
  v text;
  v_before bigint := test.used();
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_delete(%L)$q$, test.mid('m1')));
  PERFORM test.ok(v LIKE 'ok%', 'delete: A deletes the message', v);
  PERFORM test.ok((test.file('shot.png')).deleted_reason = 'chat_message'
                  AND (test.file('shot.png')).deleted_at = (SELECT deleted_at FROM public.chat_messages WHERE id = test.mid('m1')),
    'delete: its file goes to the trash on the message''s clock');
  PERFORM test.ok(test.sees_row('B', 'shot.png') = '0' AND test.sees_bytes('B', 'shot.png') = '0',
    'delete: the conversation no longer reaches the file, at once');
  PERFORM test.ok(test.files_view('B', 'P') = '', 'delete: the Files view drops it');
  PERFORM test.ok(test.used() = v_before - 1000, 'delete: its bytes leave the pool', test.used()::text);
  v := test.as_user('A', format($q$SELECT public.chat_op_restore(%L)$q$, test.mid('m1')));
  PERFORM test.ok(v LIKE 'ok%' AND (test.file('shot.png')).deleted_at IS NULL, 'undo: the file comes back with its message', v);
  PERFORM test.ok(test.sees_row('B', 'shot.png') = '1' AND test.sees_bytes('B', 'shot.png') = '1'
                  AND test.used() = v_before,
    'undo: readable and counted again');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.attachments__purge_candidates(100000) c
                               WHERE c.id = (test.file('shot.png')).id),
    'undo: nothing of it waits for the purge');
  v := test.as_user('A', format($q$SELECT public.chat_op_delete(%L)$q$, test.mid('m1')));
  -- Past the 10 s Undo: the purge takes the bytes, as the text is blanked.
  UPDATE public.attachments SET deleted_at = deleted_at - interval '11 seconds' WHERE file_name = 'shot.png';
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.attachments__purge_candidates(100000) c
                           WHERE c.id = (test.file('shot.png')).id),
    'clock: past the Undo, the purge takes the deleted message''s file');
  PERFORM test.ok(public.attachments__purge_rows(ARRAY[(test.file('shot.png')).id]) = 1,
    'clock: and removes its row');
END $$;

-- ── A removed member loses the files at once ──────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.cbegin('A', 'P', 'm4', 'deck.pdf', 200);
  PERFORM test.put('A', 'deck.pdf', 200);
  PERFORM test.finalize('A', 'deck.pdf');
  v := test.send('A', 'P', 'm4', 'the deck');
  PERFORM test.ok(test.sees_bytes('D', 'deck.pdf') = '1' AND test.files_view('D', 'P') = 'deck.pdf',
    'setup: D reads the deck', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_remove_member(%L, %L)$q$, test.ref('P'), test.id('D')));
  PERFORM test.ok(v LIKE 'ok%', 'removed: A removes D from P', v);
  PERFORM test.ok(test.sees_row('D', 'deck.pdf') = '0' AND test.sees_bytes('D', 'deck.pdf') = '0'
                  AND test.files_view('D', 'P') LIKE 'ERROR%',
    'removed: D reaches neither the file, its bytes nor the Files view');
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('W') AND user_id = test.id('B');
  PERFORM test.ok(test.sees_row('B', 'deck.pdf') = '0' AND test.sees_bytes('B', 'deck.pdf') = '0',
    'removed: someone removed from the workspace loses them too');
END $$;

-- ── Orphans: files whose message never came ───────────────────────────────
DO $$
BEGIN
  PERFORM test.cbegin('A', 'Q', 'm5', 'never.png', 10);
  PERFORM test.put('A', 'never.png', 10);
  PERFORM test.finalize('A', 'never.png');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.attachments__purge_candidates(100000) c
                               WHERE c.id = (test.file('never.png')).id),
    'orphan: a fresh unsent file waits for its message');
  UPDATE public.attachments SET created_at = now() - interval '25 hours' WHERE file_name = 'never.png';
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.attachments__purge_candidates(100000) c
                           WHERE c.id = (test.file('never.png')).id),
    'orphan: a day on, the purge removes it');
  PERFORM test.ok(public.attachments__purge_rows(ARRAY[(test.file('never.png')).id]) = 1,
    'orphan: and its row');
END $$;

-- AT-3 · Attachments everywhere + Settings → Storage
-- (supabase/migrations/20261013272000_attachments_everywhere.sql;
-- specs/attachments.md AT3-1–4; decisions/tasks.md "AT-3").
--
-- A file is visible only to people who can see its task, on every path the
-- app reads it by: the table (RLS, and so Realtime and the shared store's
-- delta and id reads), Storage (signed links), Settings → Storage's
-- largest-files list. Only the uploader can abandon their own unfinished
-- upload, and the pool's helpers stay the server's.
--
-- Cast: O owns workspace W. E and M are members, N a member who can only view
-- O's project PV, V a viewer, X someone in another workspace. SB is a shared
-- project, PB O's private one.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'M', 'N', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002'),
  (test.id('PV'), test.id('W'), test.id('O'), 'O view-only', false, '0003');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PV'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('N'), 'view', test.id('O'));

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', 'Task ' || p_name, 'bucket_id', test.id(p_project))))
$$;

-- An upload's first step as a person; the new row's id (by its file name).
CREATE FUNCTION test.begin(p_who text, p_task text, p_file text, p_size bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  r text;
BEGIN
  r := test.as_user(p_who, format(
    $q$SELECT public.attachments_op_begin(%L, 'task', %L, %L, 'image/png', %s)$q$,
    test.id('W'), test.id(p_task), p_file, p_size));
  PERFORM test.ok(r LIKE 'ok%', format('setup: %s begins %s', p_who, p_file), r);
  RETURN (SELECT a.id FROM public.attachments a WHERE a.file_name = p_file);
END;
$$;

-- Bytes landing the way the Storage API writes them: as the person, under the
-- storage.objects policies and the object guard.
CREATE FUNCTION test.put(p_who text, p_path text, p_size bigint) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
       VALUES ('attachments', %L, %L, %L, jsonb_build_object('size', %s))$q$,
    p_path, test.id(p_who), test.id(p_who)::text, p_size))
$$;

-- A whole upload: begin, the bytes, finalize. The row's id.
CREATE FUNCTION test.attach(p_who text, p_task text, p_file text, p_size bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := test.begin(p_who, p_task, p_file, p_size);
  r text;
BEGIN
  r := test.put(p_who, (SELECT object_path FROM public.attachments WHERE id = v_id), p_size);
  PERFORM test.ok(r = 'ok 1', format('setup: %s uploads %s', p_who, p_file), r);
  r := test.as_user(p_who, format($q$SELECT public.attachments_op_finalize(%L)$q$, v_id));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT status FROM public.attachments WHERE id = v_id) = 'ready',
    format('setup: %s is ready', p_file), r);
  RETURN v_id;
END;
$$;

-- The largest-files list as a person: "name:can_delete,…", biggest first.
CREATE FUNCTION test.largest(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(file_name || ':' || can_delete, ',' ORDER BY size_bytes DESC, id), '')
       FROM public.attachments_largest(%L)$q$, test.id('W')))
$$;

CREATE FUNCTION test.unsettled() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT public.storage__unsettled_bytes(test.id('O'))
$$;

-- ── Grants and the read paths' policies ──────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(has_function_privilege('authenticated', 'public.attachments_op_abandon(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.attachments_op_abandon(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('service_role', 'public.attachments_op_abandon(uuid)', 'EXECUTE'),
    'grants: abandon is for signed-in people only (no anon, no key)');
  PERFORM test.ok(has_function_privilege('authenticated', 'public.attachments_largest(uuid, integer)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.attachments_largest(uuid, integer)', 'EXECUTE')
              AND NOT has_function_privilege('service_role', 'public.attachments_largest(uuid, integer)', 'EXECUTE'),
    'grants: the largest-files list is for signed-in people only (a key, which skips RLS, can''t call it)');
  PERFORM test.ok(NOT (SELECT p.prosecdef FROM pg_proc p
                       WHERE p.oid = 'public.attachments_largest(uuid, integer)'::regprocedure),
    'the largest-files list runs as the caller (SECURITY INVOKER): RLS applies');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.storage__unsettled_bytes(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.storage__unsettled_bytes(uuid)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.storage__unsettled_bytes(uuid)', 'EXECUTE'),
    'grants: storage__unsettled_bytes stays the server''s');
  PERFORM test.ok(has_table_privilege('authenticated', 'public.attachments', 'SELECT')
              AND NOT has_table_privilege('authenticated', 'public.attachments', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.attachments', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.attachments', 'DELETE')
              AND NOT has_table_privilege('anon', 'public.attachments', 'SELECT'),
    'grants: attachments is read-only for the app (every write is an op)');
  PERFORM test.ok((SELECT string_agg(p.qual, ' ') FROM pg_policies p
                   WHERE p.schemaname = 'public' AND p.tablename = 'attachments' AND p.policyname <> 'app_tokens_refused') LIKE '%can_access(entity_type, entity_id, ''view''%'
              AND (SELECT count(*) FROM pg_policies p
                   WHERE p.schemaname = 'public' AND p.tablename = 'attachments' AND p.policyname <> 'app_tokens_refused') = 1,
    'path: RLS — attachments are read through the item gate, their only policy');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables
                          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attachments'),
    'path: Realtime — attachments stream under that policy (the store''s 📎 counts)');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'attachments' AND indexname = 'attachments_sync_idx'),
    'the store''s delta read has its index');
END;
$$;

-- ── The world ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.new_task('E', 'TS', 'SB');
  PERFORM test.ok(r LIKE 'ok%', 'setup: E''s task in the shared project', r);
  r := test.new_task('O', 'TP', 'PB');
  PERFORM test.ok(r LIKE 'ok%', 'setup: O''s task in O''s private project', r);
  r := test.new_task('O', 'TV', 'PV');
  PERFORM test.ok(r LIKE 'ok%', 'setup: O''s task in the project N may only view', r);
  r := test.new_task('E', 'TD', 'SB');
  PERFORM test.ok(r LIKE 'ok%', 'setup: a task E will delete', r);

  PERFORM test.attach('E', 'TS', 'shared.png', 3000);
  PERFORM test.attach('O', 'TP', 'p-secret.png', 9000);
  PERFORM test.attach('O', 'TV', 'view-only.png', 5000);
  PERFORM test.attach('E', 'TD', 'on-deleted-task.png', 8000);
  PERFORM test.attach('E', 'TS', 'trashed.png', 7000);
  r := test.as_user('E', format($q$SELECT public.attachments_op_delete(%L)$q$,
    (SELECT id FROM public.attachments WHERE file_name = 'trashed.png')));
  PERFORM test.ok(r LIKE 'ok%', 'setup: E trashes a file', r);
  r := test.as_user('E', format($q$SELECT public.tasks_op_delete(%L, %L)$q$, test.id('W'), test.id('TD')));
  IF r NOT LIKE 'ok%' THEN
    r := test.as_user('E', format($q$UPDATE public.tasks SET deleted_at = now() WHERE id = %L$q$, test.id('TD')));
  END IF;
  PERFORM test.ok((SELECT deleted_at IS NOT NULL FROM public.attachments WHERE file_name = 'on-deleted-task.png'),
    'setup: deleting the task trashed its file', r);
  PERFORM test.begin('E', 'TS', 'still-uploading.png', 6000);
END;
$$;

-- ── Settings → Storage's list: only files whose task you can see ────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.largest('O');
  PERFORM test.ok(r = 'p-secret.png:true,view-only.png:true,shared.png:true',
    'list: the owner sees every live, finished file, biggest first, and may delete each', r);
  r := test.largest('E');
  PERFORM test.ok(r = 'shared.png:true',
    'list: a member sees only files on tasks they can see (no private project''s, no trashed, no pending)', r);
  r := test.largest('M');
  PERFORM test.ok(r = 'shared.png:true', 'list: so does another member', r);
  r := test.largest('N');
  PERFORM test.ok(r = 'view-only.png:false,shared.png:true',
    'list: view access shows a file but not Delete', r);
  r := test.largest('V');
  PERFORM test.ok(r = 'shared.png:false', 'list: a workspace viewer sees, never deletes', r);
  r := test.largest('X');
  PERFORM test.ok(r LIKE 'ERROR%workspace_not_found%', 'list: someone outside the workspace is refused', r);
  r := test.try(NULL, format($q$SELECT * FROM public.attachments_largest(%L)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '42501%not_signed_in%', 'list: nobody signed in is refused', r);
  r := test.as_key('K', format($q$SELECT * FROM public.attachments_largest(%L)$q$, test.id('W')));
  PERFORM test.ok(r LIKE '42501%', 'list: a key can''t call it', r);

  -- A hidden task's name never comes along, and the limit holds.
  r := test.value_as('M', format($q$SELECT count(*)::text FROM public.attachments_largest(%L)
                                  WHERE task_title = 'Task TP' OR file_name = 'p-secret.png'$q$, test.id('W')));
  PERFORM test.ok(r = '0', 'list: nothing of O''s private task reaches M, not even its title', r);
  r := test.value_as('O', format($q$SELECT count(*)::text FROM public.attachments_largest(%L, 2)$q$, test.id('W')));
  PERFORM test.ok(r = '2', 'list: the limit holds', r);
  r := test.value_as('O', format($q$SELECT task_title FROM public.attachments_largest(%L, 1)$q$, test.id('W')));
  PERFORM test.ok(r = 'Task TP', 'list: each file names its task (for the person who can see it)', r);

  -- A file goes when its task becomes private to someone else.
  UPDATE public.tasks SET bucket_id = test.id('PB') WHERE id = test.id('TS');
  r := test.largest('E');
  PERFORM test.ok(r = '', 'list: a file leaves the list when its task is moved out of sight', r);
  UPDATE public.tasks SET bucket_id = test.id('SB') WHERE id = test.id('TS');
END;
$$;

-- ── The other read paths: the table (store, Realtime) and Storage ───────────
DO $$
DECLARE
  r text;
  v_secret text := (SELECT object_path FROM public.attachments WHERE file_name = 'p-secret.png');
BEGIN
  r := test.value_as('M', $q$SELECT count(*)::text FROM public.attachments WHERE file_name = 'p-secret.png'$q$);
  PERFORM test.ok(r = '0', 'read: M reads no row of a file on a task M can''t see', r);
  r := test.value_as('O', $q$SELECT count(*)::text FROM public.attachments WHERE file_name = 'p-secret.png'$q$);
  PERFORM test.ok(r = '1', 'read: O does', r);
  -- The store's id read (its access check) and its delta read.
  r := test.value_as('M', format($q$SELECT string_agg(file_name, ',' ORDER BY file_name) FROM public.attachments
                                  WHERE workspace_id = %L AND entity_type = 'task' AND status = 'ready'
                                    AND deleted_at IS NULL$q$, test.id('W')));
  PERFORM test.ok(r = 'shared.png', 'read: the store''s id read gives M only the shared file', r);
  r := test.value_as('X', format($q$SELECT count(*)::text FROM public.attachments WHERE workspace_id = %L$q$, test.id('W')));
  PERFORM test.ok(r = '0', 'read: an outsider reads nothing of the workspace''s files', r);
  r := test.value_as('M', format($q$SELECT count(*)::text FROM storage.objects
                                  WHERE bucket_id = 'attachments' AND name = %L$q$, v_secret));
  PERFORM test.ok(r = '0', 'read: M can''t read (or sign a link to) the private file''s bytes', r);
  r := test.value_as('O', format($q$SELECT count(*)::text FROM storage.objects
                                  WHERE bucket_id = 'attachments' AND name = %L$q$, v_secret));
  PERFORM test.ok(r = '1', 'read: O can', r);
END;
$$;

-- ── Abandon: only the uploader's own unfinished upload ──────────────────────
DO $$
DECLARE
  r text;
  v_pending uuid := (SELECT id FROM public.attachments WHERE file_name = 'still-uploading.png');
  v_ready uuid := (SELECT id FROM public.attachments WHERE file_name = 'shared.png');
  v_half uuid;
  v_path text;
  v_before bigint;
BEGIN
  v_before := test.unsettled();
  PERFORM test.ok(v_before = 6000, 'pool: an upload in progress holds its declared size', v_before::text);

  r := test.try('M', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_pending));
  PERFORM test.ok(r LIKE 'P0002%attachment_not_found%', 'abandon: another member can''t (reads as missing)', r);
  r := test.try('O', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_pending));
  PERFORM test.ok(r LIKE 'P0002%attachment_not_found%', 'abandon: nor can the workspace owner', r);
  r := test.try('X', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_pending));
  PERFORM test.ok(r LIKE 'P0002%attachment_not_found%', 'abandon: nor an outsider', r);
  r := test.try(NULL, format($q$SELECT public.attachments_op_abandon(%L)$q$, v_pending));
  PERFORM test.ok(r LIKE '42501%not_signed_in%', 'abandon: nor nobody', r);
  r := test.as_key('K', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_pending));
  PERFORM test.ok(r LIKE '42501%', 'abandon: nor a key', r);
  PERFORM test.ok((SELECT status FROM public.attachments WHERE id = v_pending) = 'pending'
              AND test.unsettled() = 6000, 'abandon: and the upload is untouched');

  r := test.value_as('E', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_pending));
  PERFORM test.ok(r = 'removed' AND NOT EXISTS (SELECT 1 FROM public.attachments WHERE id = v_pending),
    'abandon: the uploader''s upload with nothing stored goes at once', r);
  PERFORM test.ok(test.unsettled() = 0, 'pool: its space is free at once (no 24 h wait)', test.unsettled()::text);

  -- Part of it stored: the row turns failed and holds only what it stored.
  v_half := test.begin('E', 'TS', 'half.png', 6000);
  v_path := (SELECT object_path FROM public.attachments WHERE id = v_half);
  r := test.put('E', v_path, 1500);
  PERFORM test.ok(r = 'ok 1', 'setup: 1500 of 6000 bytes landed', r);
  PERFORM test.ok(test.unsettled() = 6000, 'pool: while uploading it holds the declared 6000');
  r := test.value_as('E', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_half));
  PERFORM test.ok(r = 'failed' AND (SELECT status FROM public.attachments WHERE id = v_half) = 'failed',
    'abandon: with bytes stored the row turns failed (the purge removes them)', r);
  PERFORM test.ok(test.unsettled() = 1500, 'pool: a failed upload holds what it stored, not its declared size',
    test.unsettled()::text);
  r := test.as_user('E', format($q$UPDATE storage.objects SET metadata = jsonb_build_object('size', 6000)
                                  WHERE bucket_id = 'attachments' AND name = %L$q$, v_path));
  PERFORM test.ok((SELECT (metadata ->> 'size')::bigint FROM storage.objects
                   WHERE bucket_id = 'attachments' AND name = v_path) = 1500,
    'abandon: the abandoned object can''t grow afterwards', r);
  r := test.put('E', v_path || '.again', 10);
  PERFORM test.ok(r NOT LIKE 'ok%', 'abandon: and nothing new lands beside it', r);
  r := test.value_as('E', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_half));
  PERFORM test.ok(r = 'failed', 'abandon: twice is the same answer', r);

  -- A finished file is never abandoned (deleting it is the trash's, with Undo).
  r := test.value_as('E', format($q$SELECT public.attachments_op_abandon(%L)$q$, v_ready));
  PERFORM test.ok(r = 'ready' AND (SELECT status = 'ready' AND deleted_at IS NULL FROM public.attachments WHERE id = v_ready),
    'abandon: a finished file stays as it is', r);

  -- The helper itself is the server's.
  r := test.try('E', format($q$SELECT public.storage__unsettled_bytes(%L)$q$, test.id('O')));
  PERFORM test.ok(r LIKE '42501%', 'path: storage__unsettled_bytes can''t be called by the app', r);
  r := test.try('O', format($q$SELECT public.storage__unsettled_bytes(%L)$q$, test.id('O')));
  PERFORM test.ok(r LIKE '42501%', 'path: not even by the owner', r);
  r := test.value_as('E', format($q$SELECT (public.storage_status(%L) ->> 'pending_bytes')$q$, test.id('W')));
  PERFORM test.ok(r = '1500', 'path: storage_status reads it for the app', r);
END;
$$;

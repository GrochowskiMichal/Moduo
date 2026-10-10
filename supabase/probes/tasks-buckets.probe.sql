-- Probe for supabase/migrations/20261009140000_buckets_archive_trash.sql (TV-U6,
-- specs/tasks-v2.md block 16: U6-2, U6-3, U6-4). Run it on a throwaway
-- Postgres 17 database that holds nothing else, after the TV-D1, TV-D2, AT-1
-- and TV-D3 chain (production's tasks schema as of 2026-10-09):
--
--   createdb -h /tmp -p 54391 -U postgres u6
--   P="-h /tmp -p 54391 -U postgres -d u6 -v ON_ERROR_STOP=1 -q"
--   psql $P -f supabase/probes/tasks-assignee.stub.sql \
--     -f supabase/migrations/20261008150000_tasks_assignee_creator.sql \
--     -f supabase/probes/tasks-queue.stub.sql \
--     -f supabase/probes/tasks-queue.seed.sql \
--     -f supabase/migrations/20261008171500_tasks_personal_queue.sql \
--     -f supabase/probes/attachments.stub.sql \
--     -f supabase/migrations/20261008210500_attachments_storage.sql \
--     -f supabase/probes/tasks-time.stub.sql \
--     -f supabase/probes/tasks-time.seed.sql
--   psql $P -1 -f supabase/migrations/20261008225500_tasks_time_entries.sql
--   psql $P -1 -f supabase/migrations/20261009140000_buckets_archive_trash.sql
--   psql $P -f supabase/probes/tasks-buckets.probe.sql
--
-- The seed's world (tasks-queue.seed.sql): workspace W owned by Olga (O) with
-- members Ada (A) and Bea (B), the viewer Vera (V); Nell (N) is in her own
-- workspace. SB is Olga's bucket shared with the workspace (members get Edit,
-- Olga has Full). K is Ada's API key. Every check stops the run with its
-- message; a clean run ends with "PASS: all".

SET client_min_messages = notice;
SET timezone = 'UTC';

CREATE FUNCTION probe.ok(p_cond boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END;
$$;

-- Run a statement as a person (or a key); 'ok' or the error message.
CREATE FUNCTION probe.try_as(p_who text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r text := 'ok';
BEGIN
  IF p_who = 'K' THEN PERFORM probe.as_key('K'); ELSE PERFORM probe.as_user(p_who); END IF;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    r := SQLERRM;
  END;
  PERFORM probe.as_system();
  RETURN r;
END;
$$;

-- The ops, as a person; the answer.
CREATE FUNCTION probe.del(p_who text, p_bucket text, p_with_tasks boolean) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  IF p_who = 'K' THEN PERFORM probe.as_key('K'); ELSE PERFORM probe.as_user(p_who); END IF;
  r := public.tasks_op_bucket_delete(probe.id('W'), probe.id(p_bucket), p_with_tasks);
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.restore(p_who text, p_type text, p_name text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM probe.as_user(p_who);
  r := public.tasks_op_trash_restore(probe.id('W'), p_type, probe.id(p_name));
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.purge(p_who text, p_type text, p_name text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM probe.as_user(p_who);
  r := public.tasks_op_trash_purge(probe.id('W'), p_type, probe.id(p_name));
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.bucket(p_name text) RETURNS public.buckets LANGUAGE sql STABLE AS $$
  SELECT b.* FROM public.buckets b WHERE b.id = probe.id(p_name)
$$;
CREATE FUNCTION probe.inbox(p_who text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT b.id FROM public.buckets b
  WHERE b.workspace_id = probe.id('W') AND b.is_system AND b.owner_id = probe.id(p_who)
    AND b.deleted_at IS NULL
$$;
CREATE FUNCTION probe.att(p_id uuid) RETURNS public.attachments LANGUAGE sql STABLE AS $$
  SELECT a.* FROM public.attachments a WHERE a.id = p_id
$$;
CREATE FUNCTION probe.queued(p_task text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.task_queue WHERE task_id = probe.id(p_task)
$$;
CREATE FUNCTION probe.queue_add(p_who text, p_task text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user(p_who);
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id(p_task), 'end');
  PERFORM probe.as_system();
END;
$$;
-- Move a trashed row's stamp back (the trash clock trigger won't let a write do it).
CREATE FUNCTION probe.age(p_table text, p_name text, p_days integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER trash_stamp_deleted_at', p_table);
  EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER perm_enforce_write', p_table);
  EXECUTE format('UPDATE public.%I SET deleted_at = now() - make_interval(days => %s) WHERE id = %L',
                 p_table, p_days, probe.id(p_name));
  IF p_table = 'tasks' THEN
    UPDATE public.attachments SET deleted_at = now() - make_interval(days => p_days)
    WHERE entity_type = 'task' AND entity_id = probe.id(p_name) AND deleted_at IS NOT NULL;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER trash_stamp_deleted_at', p_table);
  EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER perm_enforce_write', p_table);
END;
$$;

-- A file on a task, the way AT-1 leaves a finished upload (no Storage here).
CREATE FUNCTION probe.file(p_task text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.attachments (id, workspace_id, entity_type, entity_id, uploader_id, file_name,
                                  mime, size_bytes, object_path, status)
  VALUES (v, probe.id('W'), 'task', probe.id(p_task), probe.id('O'), 'shot.png', 'image/png', 10,
          probe.id('W') || '/' || v || '/original.png', 'ready');
  RETURN v;
END;
$$;

-- Olga's bucket MB ("Marketing"), shared with the workspace like SB:
--   M1 open (a file, in Ada's and Olga's queues), M2 done, M3 open parent with
--   subtask M3a in MB and subtask M3b living in SB, and M0, deleted on its own
--   before the bucket.
CREATE FUNCTION probe.make_marketing() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user('O');
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, position)
  VALUES (probe.id('MB'), probe.id('W'), probe.id('O'), 'Marketing', 'm');
  PERFORM probe.as_system();
  PERFORM probe.new_task('M0', 'O', 'O', 'MB');
  PERFORM probe.new_task('M1', 'O', 'A', 'MB');
  PERFORM probe.new_task('M2', 'O', 'O', 'MB');
  PERFORM probe.new_task('M3', 'O', 'O', 'MB');
  PERFORM probe.new_task('M3a', 'O', 'O', 'MB');
  PERFORM probe.new_task('M3b', 'O', 'O', 'SB');
  UPDATE public.tasks SET status = 'done' WHERE id = probe.id('M2');
  UPDATE public.tasks SET parent_id = probe.id('M3') WHERE id IN (probe.id('M3a'), probe.id('M3b'));
  PERFORM probe.as_user('O');
  UPDATE public.tasks SET deleted_at = now() WHERE id = probe.id('M0');
  PERFORM probe.as_system();
  PERFORM probe.queue_add('A', 'M1');
  PERFORM probe.queue_add('O', 'M1');
END;
$$;

DO $$
DECLARE
  r jsonb;
  f uuid;
  v_inbox uuid;
  v_batch uuid;
BEGIN
  PERFORM probe.make_marketing();
  f := probe.file('M1');
  PERFORM probe.ok(probe.queued('M1') = 2, 'setup: M1 is in two queues');

  -- ── Who may delete ────────────────────────────────────────────────────────
  PERFORM probe.ok(probe.try_as('V', format('SELECT public.tasks_op_bucket_delete(%L, %L, false)',
                   probe.id('W'), probe.id('MB'))) LIKE '%edit access to Tasks%',
                   'a viewer can''t delete a bucket');
  PERFORM probe.ok(probe.try_as('A', format('SELECT public.tasks_op_bucket_delete(%L, %L, false)',
                   probe.id('W'), probe.id('MB'))) LIKE '%access to delete this bucket%',
                   'a member with Edit (not Full) on a shared bucket can''t delete it');
  PERFORM probe.ok(probe.try_as('N', format('SELECT public.tasks_op_bucket_delete(%L, %L, false)',
                   probe.id('W'), probe.id('MB'))) <> 'ok',
                   'someone outside the workspace can''t delete it');
  PERFORM probe.as_system();
  INSERT INTO public.buckets (workspace_id, owner_id, name, is_system, position)
  VALUES (probe.id('W'), probe.id('O'), 'Inbox', true, 'a0');
  PERFORM probe.ok(probe.try_as('O', format('SELECT public.tasks_op_bucket_delete(%L, %L, false)',
                   probe.id('W'), probe.inbox('O'))) LIKE '%Inbox can''t be deleted%',
                   'the Inbox can''t be deleted');

  -- ── U6-2: delete, moving the tasks to Inbox; Undo puts them back ─────────
  r := probe.del('O', 'MB', false);
  v_inbox := probe.inbox('O');
  PERFORM probe.ok((r ->> 'moved')::int = 4 AND (r ->> 'inbox_id')::uuid = v_inbox,
                   'move: the 4 live tasks moved to Olga''s Inbox, the deleted one stayed');
  PERFORM probe.ok((probe.bucket('MB')).deleted_at IS NOT NULL
                   AND (probe.bucket('MB')).deleted_batch_id = (r ->> 'batch_id')::uuid,
                   'move: the bucket is in the trash with its batch');
  PERFORM probe.ok(cardinality((probe.bucket('MB')).trash_moved_task_ids) = 4,
                   'move: the bucket remembers the 4 tasks it moved');
  PERFORM probe.ok((probe.task('M1')).bucket_id = v_inbox AND (probe.task('M3a')).bucket_id = v_inbox
                   AND (probe.task('M0')).bucket_id = probe.id('MB')
                   AND (probe.task('M3b')).bucket_id = probe.id('SB'),
                   'move: only the bucket''s live tasks moved');
  PERFORM probe.ok(probe.queued('M1') = 2, 'move: moving never touches queues');
  PERFORM probe.ok((probe.task('M1')).deleted_batch_id IS NULL, 'move: moved tasks are not in a batch');
  PERFORM probe.ok((probe.del('O', 'MB', true) ->> 'deleted')::int = 0
                   AND (probe.task('M1')).deleted_at IS NULL,
                   'deleting a bucket already in the trash changes nothing');

  -- Someone files M2 elsewhere meanwhile; Undo leaves that one where it went.
  PERFORM probe.as_user('O');
  UPDATE public.tasks SET bucket_id = probe.id('SB') WHERE id = probe.id('M2');
  PERFORM probe.as_system();
  r := probe.restore('O', 'bucket', 'MB');
  PERFORM probe.ok((r ->> 'buckets')::int = 1 AND (r ->> 'moved')::int = 3,
                   'move undo: the bucket is back and takes back the 3 tasks still in an Inbox');
  PERFORM probe.ok((probe.task('M1')).bucket_id = probe.id('MB')
                   AND (probe.task('M3a')).bucket_id = probe.id('MB')
                   AND (probe.task('M2')).bucket_id = probe.id('SB'),
                   'move undo: tasks back in the bucket, the one moved on stays');
  PERFORM probe.ok((probe.bucket('MB')).deleted_at IS NULL
                   AND (probe.bucket('MB')).deleted_batch_id IS NULL
                   AND (probe.bucket('MB')).trash_moved_task_ids IS NULL,
                   'move undo: the restored bucket leaves its batch');
  PERFORM probe.ok((probe.restore('O', 'bucket', 'MB') ->> 'buckets')::int = 0,
                   'restoring a bucket that isn''t in the trash changes nothing');
  PERFORM probe.as_user('O');
  UPDATE public.tasks SET bucket_id = probe.id('MB') WHERE id = probe.id('M2');
  PERFORM probe.as_system();

  -- ── U6-2: delete with the tasks; one Undo brings back tasks, subtasks, files
  r := probe.del('O', 'MB', true);
  v_batch := (r ->> 'batch_id')::uuid;
  PERFORM probe.ok((r ->> 'deleted')::int = 5,
                   'with tasks: M1, M2, M3, M3a and M3b (a subtask in another bucket) go to the trash');
  PERFORM probe.ok((SELECT count(*) FROM public.tasks WHERE deleted_batch_id = v_batch) = 5
                   AND (probe.bucket('MB')).deleted_batch_id = v_batch,
                   'with tasks: bucket and tasks share one batch');
  PERFORM probe.ok((probe.task('M0')).deleted_batch_id IS NULL,
                   'with tasks: a task deleted on its own before keeps its own trash entry');
  PERFORM probe.ok((probe.att(f)).deleted_at IS NOT NULL AND (probe.att(f)).deleted_batch_id = v_batch,
                   'with tasks: the file went to the trash in the same batch');
  PERFORM probe.ok(probe.queued('M1') = 0, 'with tasks: deleted tasks left every queue');

  r := probe.restore('O', 'bucket', 'MB');
  PERFORM probe.ok((r ->> 'tasks')::int = 5, 'with tasks undo: all five tasks are back');
  PERFORM probe.ok((probe.task('M3a')).parent_id = probe.id('M3')
                   AND (probe.task('M3b')).parent_id = probe.id('M3')
                   AND (probe.task('M3b')).bucket_id = probe.id('SB'),
                   'with tasks undo: subtasks are under their parent, where they were');
  PERFORM probe.ok((probe.att(f)).deleted_at IS NULL AND (probe.att(f)).deleted_batch_id IS NULL,
                   'with tasks undo: the file is back');
  PERFORM probe.ok((SELECT count(*) FROM public.tasks WHERE deleted_batch_id = v_batch) = 0,
                   'with tasks undo: nobody is left in the batch');
  PERFORM probe.ok(probe.queued('M1') = 0, 'with tasks undo: restoring never re-queues');
  PERFORM probe.ok((probe.task('M0')).deleted_at IS NOT NULL,
                   'with tasks undo: the task deleted on its own stays in the trash');

  -- ── U6-3: Recently deleted ────────────────────────────────────────────────
  -- Restoring a task whose bucket is gone puts it in the restorer's Inbox.
  PERFORM probe.del('O', 'MB', true);
  r := probe.restore('O', 'task', 'M1');
  PERFORM probe.ok((probe.task('M1')).deleted_at IS NULL AND (probe.task('M1')).bucket_id = v_inbox
                   AND (probe.task('M1')).deleted_batch_id IS NULL,
                   'restore: a task whose bucket was deleted goes to Inbox');
  PERFORM probe.ok((probe.att(f)).deleted_at IS NULL, 'restore: the task''s file comes back with it');
  PERFORM probe.ok(probe.try_as('V', format('SELECT public.tasks_op_trash_restore(%L, ''bucket'', %L)',
                   probe.id('W'), probe.id('MB'))) <> 'ok', 'a viewer can''t restore');
  -- A plain un-delete (an old Undo) also leaves the batch.
  PERFORM probe.as_user('O');
  UPDATE public.tasks SET deleted_at = NULL WHERE id = probe.id('M2');
  PERFORM probe.as_system();
  PERFORM probe.ok((probe.task('M2')).deleted_batch_id IS NULL,
                   'a task restored by a plain update leaves its batch');
  PERFORM probe.as_user('O');
  UPDATE public.tasks SET deleted_at = now() WHERE id = probe.id('M2');
  PERFORM probe.as_system();

  -- Past 30 days nothing comes back.
  PERFORM probe.age('tasks', 'M3a', 31);
  PERFORM probe.ok(probe.try_as('O', format('SELECT public.tasks_op_trash_restore(%L, ''task'', %L)',
                   probe.id('W'), probe.id('M3a'))) LIKE '%more than 30 days%',
                   'restore: past 30 days it can''t come back');

  -- Delete forever: only from the trash; the bucket goes with its batch.
  PERFORM probe.ok(probe.try_as('O', format('SELECT public.tasks_op_trash_purge(%L, ''task'', %L)',
                   probe.id('W'), probe.id('M1'))) LIKE '%Only something in Recently deleted%',
                   'delete forever: a live task can''t be');
  PERFORM probe.ok(probe.try_as('A', format('SELECT public.tasks_op_trash_purge(%L, ''bucket'', %L)',
                   probe.id('W'), probe.id('MB'))) <> 'ok',
                   'delete forever: a member without Full on the bucket can''t');
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label)
  VALUES (probe.id('W'), 'task', probe.id('M3'), 'M3');
  r := probe.purge('O', 'bucket', 'MB');
  -- Still in the batch: M3, M3a (past 30 days) and M3b. M1 was restored, M2
  -- left the batch and was deleted again on its own.
  PERFORM probe.ok((r ->> 'buckets')::int = 1 AND (r ->> 'tasks')::int = 3,
                   'delete forever: the bucket and the 3 tasks still in its batch are gone');
  PERFORM probe.ok(probe.task('M3') IS NULL AND probe.task('M3b') IS NULL AND probe.bucket('MB') IS NULL,
                   'delete forever: the rows are deleted');
  PERFORM probe.ok((probe.task('M0')).deleted_at IS NOT NULL AND (probe.task('M0')).bucket_id = v_inbox
                   AND (probe.task('M2')).deleted_at IS NOT NULL AND (probe.task('M2')).bucket_id = v_inbox,
                   'delete forever: tasks deleted on their own stay in the trash, now under Inbox');
  PERFORM probe.ok((probe.task('M1')).deleted_at IS NULL, 'delete forever: a restored task is untouched');
  PERFORM probe.ok((SELECT deleted_at IS NOT NULL FROM public.entities
                    WHERE entity_type = 'task' AND entity_id = probe.id('M3')),
                   'delete forever: registry entries are tombstoned');
  r := probe.purge('O', 'task', 'M0');
  PERFORM probe.ok((r ->> 'tasks')::int = 1 AND probe.task('M0') IS NULL,
                   'delete forever: a single task');

  -- ── U6-3: the daily purge takes a deleted batch and its files after 30 days
  PERFORM probe.as_system();
  DELETE FROM public.attachments WHERE entity_id IN (probe.id('M1'), probe.id('M2'));
  DELETE FROM public.tasks WHERE id IN (probe.id('M1'), probe.id('M2'));
  PERFORM probe.make_marketing();
  f := probe.file('M1');
  PERFORM probe.del('O', 'MB', true);
  PERFORM probe.age('buckets', 'MB', 31);
  PERFORM probe.age('tasks', 'M1', 31);
  PERFORM probe.age('tasks', 'M2', 31);
  PERFORM probe.age('tasks', 'M3', 31);
  PERFORM probe.age('tasks', 'M3a', 31);
  PERFORM probe.age('tasks', 'M3b', 31);
  PERFORM probe.age('tasks', 'M0', 31);
  PERFORM probe.ok(EXISTS (SELECT 1 FROM public.attachments__purge_candidates(100) c WHERE c.id = f),
                   'purge: the batch''s file is a candidate (its objects go first)');
  PERFORM public.attachments__purge_rows(ARRAY[f]);
  r := public.tasks__purge_expired(100);
  PERFORM probe.ok((r ->> 'tasks')::int = 6 AND (r ->> 'buckets')::int = 1,
                   'purge: the tasks, then the bucket, are gone after 30 days');
  PERFORM probe.ok(probe.att(f) IS NULL, 'purge: the file row went first');

  -- ── U6-4: archive ─────────────────────────────────────────────────────────
  PERFORM probe.make_marketing();
  PERFORM probe.ok(probe.queued('M1') = 2, 'archive setup: M1 queued twice');
  PERFORM probe.ok(probe.try_as('V', format('UPDATE public.buckets SET archived_at = now() WHERE id = %L',
                   probe.id('MB'))) LIKE '%can''t edit tasks%', 'a viewer can''t archive');
  PERFORM probe.ok(probe.try_as('O', format('UPDATE public.buckets SET archived_at = now() WHERE id = %L',
                   probe.id('MB'))) = 'ok', 'archive: the owner archives');
  PERFORM probe.ok(probe.queued('M1') = 0, 'archive: its tasks left every queue');
  -- (A STABLE read in the same statement as the write sees the snapshot from
  -- before it, so each check reads after its write.)
  PERFORM probe.ok(probe.try_as('O', format('UPDATE public.buckets SET archived_at = NULL WHERE id = %L',
                   probe.id('MB'))) = 'ok', 'unarchive works');
  PERFORM probe.ok((probe.bucket('MB')).archived_at IS NULL, 'unarchive: the bucket is live again');
  PERFORM probe.ok(probe.queued('M1') = 0, 'unarchive: nothing is re-queued');
  PERFORM probe.ok(probe.try_as('O', format('UPDATE public.buckets SET archived_at = now() WHERE id = %L',
                   v_inbox)) LIKE '%buckets_inbox_not_archived%', 'the Inbox can''t be archived');
  PERFORM probe.ok(probe.try_as('O', format('UPDATE public.buckets SET color = %L WHERE id = %L',
                   repeat('x', 40), probe.id('MB'))) LIKE '%buckets_color_length%',
                   'a colour is a short hue name');
  PERFORM probe.ok(probe.try_as('O', format('UPDATE public.buckets SET color = ''teal'' WHERE id = %L',
                   probe.id('MB'))) = 'ok', 'a colour saves');
  PERFORM probe.ok((probe.bucket('MB')).color = 'teal', 'the colour reads back');

  -- ── A key acts as its creator ─────────────────────────────────────────────
  PERFORM probe.as_user('A');
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, position)
  VALUES (probe.id('AB'), probe.id('W'), probe.id('A'), 'Ada''s', 'n');
  PERFORM probe.as_system();
  PERFORM probe.new_task('A1', 'A', 'A', 'AB');
  r := probe.del('K', 'AB', false);
  PERFORM probe.ok((r ->> 'moved')::int = 1 AND (probe.task('A1')).bucket_id = probe.inbox('A'),
                   'a key deletes for its creator: the task lands in Ada''s Inbox');

  RAISE NOTICE 'PASS: all';
END;
$$;

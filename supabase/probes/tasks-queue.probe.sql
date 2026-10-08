-- Probe for supabase/migrations/20261008171500_tasks_personal_queue.sql
-- (TV-D2, specs/tasks-v2.md block 4). Run it on a throwaway Postgres 17
-- database that holds nothing else, in one psql session:
--
--   createdb -h /tmp -p 54352 -U postgres d2_probe
--   psql -h /tmp -p 54352 -U postgres -d d2_probe -v ON_ERROR_STOP=1 -q \
--     -f supabase/probes/tasks-assignee.stub.sql \
--     -f supabase/migrations/20261008150000_tasks_assignee_creator.sql \
--     -f supabase/probes/tasks-queue.stub.sql \
--     -f supabase/probes/tasks-queue.seed.sql \
--     -f supabase/migrations/20261008171500_tasks_personal_queue.sql \
--     -f supabase/probes/tasks-queue.probe.sql
--
-- Every check stops the run with the failing check's message. A clean run
-- prints one PASS line per check and ends with "PASS: all".

GRANT USAGE ON SCHEMA probe TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

-- A person's queue in a workspace, as task names in order.
CREATE FUNCTION probe.queue(p_user text, p_ws text DEFAULT 'W') RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(t.title ORDER BY q.position, q.id), '{}')
  FROM public.task_queue q JOIN public.tasks t ON t.id = q.task_id
  WHERE q.user_id = probe.id(p_user) AND q.workspace_id = probe.id(p_ws)
$$;
-- What an op returned, as task names.
CREATE FUNCTION probe.names(p_rows public.task_queue[]) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(t.title ORDER BY r.ord), '{}')
  FROM unnest(p_rows) WITH ORDINALITY AS r(id, workspace_id, user_id, task_id, position, queued_at, updated_at, ord)
  JOIN public.tasks t ON t.id = r.task_id
$$;
CREATE FUNCTION probe.activity(p_op text, p_task text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.module_activity WHERE op = p_op AND entity_id = probe.id(p_task)
$$;
-- Every key is a clean 10-digit key, and no person has two rows on one key.
CREATE FUNCTION probe.keys_clean() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE position !~ '^[0-9a-z]{10}$')
     AND NOT EXISTS (SELECT 1 FROM public.task_queue
                     GROUP BY workspace_id, user_id, position HAVING count(*) > 1)
$$;
-- Raises the error an expression raises, or NULL.
CREATE FUNCTION probe.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

-- ── 1. Carry-over (D2-4) ─────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT probe.queue('A') = ARRAY['C1 Ada commits', 'C3 key commits'],
    format('carry-over: Ada''s queue is %s', probe.queue('A'));
  -- Bea: today's in commit order (C8 she recommitted last; C4 falls back to
  -- her as its assignee), then tomorrow's.
  ASSERT probe.queue('B') = ARRAY['C2 Bea commits', 'C8 Ada then Bea', 'C4 nobody logged', 'C10 tomorrow'],
    format('carry-over: Bea''s queue is %s', probe.queue('B'));
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue q JOIN public.tasks t ON t.id = q.task_id
                     WHERE t.title IN ('C5 done', 'C6 last week', 'C7 deleted', 'C9 by Nell')),
    'carry-over: a done, old, deleted or ex-member commit was carried';
  ASSERT (SELECT count(*) FROM public.task_queue) = 6, 'carry-over: 6 rows';
  ASSERT probe.keys_clean(), 'carry-over: keys are clean';
  ASSERT (SELECT min(position) FROM public.task_queue WHERE user_id = probe.id('A')) = '000000mh34',
    'carry-over: the first key is 2^20 in base 36, as the app encodes it';
  ASSERT (SELECT count(*) FROM public.module_activity) = (SELECT activity FROM probe.before),
    'carry-over: the migration logged activity';
  ASSERT (SELECT jsonb_object_agg(id, jsonb_build_array(committed_for, commit_order)) FROM public.tasks)
         = (SELECT commits FROM probe.before), 'carry-over: the old columns changed';
  RAISE NOTICE 'PASS carry-over: today''s commits in each committer''s queue, in order; nothing else touched';
END;
$$;

-- ── 2. Add, remove, reorder, move to end; queues never mix (D2-1, D2-2) ──────

DO $$
DECLARE
  r public.task_queue[];
  v_logs bigint;
BEGIN
  PERFORM probe.new_task('Q1', 'A', 'A');
  PERFORM probe.new_task('Q2', 'A', 'A');
  PERFORM probe.new_task('Q3', 'A', NULL);

  PERFORM probe.as_user('A');
  r := ARRAY(SELECT x FROM public.tasks_op_queue_add(probe.id('W'), probe.id('Q1')) x);
  ASSERT probe.names(r) = ARRAY['C1 Ada commits', 'C3 key commits', 'Q1'],
    format('add: returns the queue in order, got %s', probe.names(r));
  ASSERT probe.activity('tasks.queue_add', 'Q1') = 1, 'add: logged once';
  -- Already there: nothing moves, nothing is logged.
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q1'));
  ASSERT probe.queue('A') = ARRAY['C1 Ada commits', 'C3 key commits', 'Q1'], 'add again: moved it';
  ASSERT probe.activity('tasks.queue_add', 'Q1') = 1, 'add again: logged again';
  -- To the top (Calendar's Start focus), new and existing.
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q2'), 'top');
  ASSERT probe.queue('A') = ARRAY['Q2', 'C1 Ada commits', 'C3 key commits', 'Q1'],
    format('add top: %s', probe.queue('A'));
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q1'), 'top');
  ASSERT probe.queue('A') = ARRAY['Q1', 'Q2', 'C1 Ada commits', 'C3 key commits'],
    format('add top of a queued task moves it: %s', probe.queue('A'));
  ASSERT probe.activity('tasks.queue_add', 'Q1') = 1, 'add top: a move was logged as an add';

  v_logs := (SELECT count(*) FROM public.module_activity);
  -- Reorder: after another task, to the top; move to end. None logged.
  PERFORM public.tasks_op_queue_reorder(probe.id('W'), probe.id('Q1'), probe.id('C1 Ada commits'));
  ASSERT probe.queue('A') = ARRAY['Q2', 'C1 Ada commits', 'Q1', 'C3 key commits'],
    format('reorder after: %s', probe.queue('A'));
  PERFORM public.tasks_op_queue_reorder(probe.id('W'), probe.id('C3 key commits'), NULL);
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q2', 'C1 Ada commits', 'Q1'],
    format('reorder to top: %s', probe.queue('A'));
  PERFORM public.tasks_op_queue_reorder(probe.id('W'), probe.id('Q1'), probe.id('Q1'));
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q2', 'C1 Ada commits', 'Q1'], 'reorder after itself moved it';
  PERFORM public.tasks_op_queue_move_to_end(probe.id('W'), probe.id('Q2'));
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'C1 Ada commits', 'Q1', 'Q2'],
    format('move to end: %s', probe.queue('A'));
  ASSERT (SELECT count(*) FROM public.module_activity) = v_logs, 'reorder/move to end: logged';
  ASSERT (probe.task('Q2')).reschedule_count = 0, 'move to end: counted as a reschedule';

  -- Not in the queue: reorder and move to end refuse; after a task that isn't in it too.
  ASSERT probe.error_of(format('SELECT public.tasks_op_queue_reorder(%L, %L, NULL)', probe.id('W'), probe.id('Q3')))
         = 'That task isn''t in your queue.', 'reorder: a task not in the queue';
  ASSERT probe.error_of(format('SELECT public.tasks_op_queue_move_to_end(%L, %L)', probe.id('W'), probe.id('Q3')))
         = 'That task isn''t in your queue.', 'move to end: a task not in the queue';
  ASSERT probe.error_of(format('SELECT public.tasks_op_queue_reorder(%L, %L, %L)', probe.id('W'),
                               probe.id('Q1'), probe.id('Q3')))
         = 'That task isn''t in your queue.', 'reorder: after a task not in the queue';
  ASSERT probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L, %L)', probe.id('W'), probe.id('Q3'), 'middle'))
         = 'A task goes to the end or the top of the queue.', 'add: an unknown placement';

  -- Remove: logged once; again is a no-op.
  PERFORM public.tasks_op_queue_remove(probe.id('W'), probe.id('C1 Ada commits'));
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q1', 'Q2'], format('remove: %s', probe.queue('A'));
  ASSERT probe.activity('tasks.queue_remove', 'C1 Ada commits') = 1, 'remove: logged once';
  PERFORM public.tasks_op_queue_remove(probe.id('W'), probe.id('C1 Ada commits'));
  ASSERT probe.activity('tasks.queue_remove', 'C1 Ada commits') = 1, 'remove again: logged';

  -- Bea's queue never moved; she can queue Ada's task too (a claim, not a lock).
  ASSERT probe.queue('B') = ARRAY['C2 Bea commits', 'C8 Ada then Bea', 'C4 nobody logged', 'C10 tomorrow'],
    'mixing: Ada''s ops touched Bea''s queue';
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q1'));
  ASSERT probe.queue('B') = ARRAY['C2 Bea commits', 'C8 Ada then Bea', 'C4 nobody logged', 'C10 tomorrow', 'Q1'],
    'mixing: Bea couldn''t queue Q1';
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q1', 'Q2'], 'mixing: Bea''s add touched Ada''s queue';
  -- Removing her copy leaves Ada's.
  PERFORM public.tasks_op_queue_remove(probe.id('W'), probe.id('Q1'));
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q1', 'Q2'], 'mixing: Bea''s remove touched Ada''s queue';
  PERFORM probe.as_system();
  ASSERT probe.keys_clean(), 'ops: keys are clean';
  RAISE NOTICE 'PASS ops: add (end/top), remove, reorder, move to end; logged only add/remove; queues stay apart';
END;
$$;

-- ── 3. Room runs out: the queue is spaced out again ──────────────────────────

DO $$
DECLARE
  i integer;
  v_expected text[] := '{}';
BEGIN
  -- 30 tasks each added at the top: the top key halves until it hits 1.
  FOR i IN 1 .. 30 LOOP
    PERFORM probe.new_task('R' || lpad(i::text, 2, '0'), 'B', 'B', 'SB2');
  END LOOP;
  PERFORM probe.as_user('B');
  FOR i IN 1 .. 30 LOOP
    PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('R' || lpad(i::text, 2, '0')), 'top');
    v_expected := ('R' || lpad(i::text, 2, '0')) || v_expected;
  END LOOP;
  ASSERT probe.queue('B') = v_expected || ARRAY['C2 Bea commits', 'C8 Ada then Bea', 'C4 nobody logged', 'C10 tomorrow'],
    format('top x30: %s', probe.queue('B'));
  -- 30 moves into the same gap (each right after R30): the gap halves until
  -- it closes, then the queue is renumbered.
  FOR i IN 1 .. 29 LOOP
    PERFORM public.tasks_op_queue_reorder(probe.id('W'), probe.id('R' || lpad(i::text, 2, '0')), probe.id('R30'));
  END LOOP;
  -- Each move lands right after R30, so the last one moved (R29) is first.
  ASSERT (probe.queue('B'))[1:4] = ARRAY['R30', 'R29', 'R28', 'R27'],
    format('after x29: %s', (probe.queue('B'))[1:6]);
  ASSERT (probe.queue('B'))[30:34] = ARRAY['R01', 'C2 Bea commits', 'C8 Ada then Bea', 'C4 nobody logged', 'C10 tomorrow'],
    format('after x29, tail: %s', (probe.queue('B'))[28:34]);
  PERFORM probe.as_system();
  ASSERT probe.keys_clean(), 'renumber: keys are clean and distinct';
  RAISE NOTICE 'PASS renumber: 30 tops and 29 moves into one gap keep the order with clean, distinct keys';
END;
$$;

-- ── 4. Who can queue ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_err text;
BEGIN
  PERFORM probe.new_task('P1 Bea private', 'B', 'B', 'PB');
  PERFORM probe.new_task('P2 Nell''s', 'N', 'N', 'NB', 'WN');

  -- A viewer can't: no Tasks edit access.
  PERFORM probe.as_user('V');
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('Q3')));
  ASSERT v_err LIKE 'You don''t have edit access to Tasks%', format('viewer: %s', v_err);
  -- Someone outside the workspace can't.
  PERFORM probe.as_user('N');
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('Q3')));
  ASSERT v_err LIKE 'You don''t have edit access to Tasks%', format('outsider: %s', v_err);
  -- A member can't queue a task they can't see (Bea's private bucket).
  PERFORM probe.as_user('A');
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('P1 Bea private')));
  ASSERT v_err = 'You don''t have access to this task.', format('private task: %s', v_err);
  -- Nor a task from another workspace.
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('P2 Nell''s')));
  ASSERT v_err = 'Task not found in this workspace.', format('other workspace: %s', v_err);
  -- Done and archived tasks can't be queued.
  UPDATE public.tasks SET status = 'done' WHERE id = probe.id('Q3');
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('Q3')));
  ASSERT v_err = 'Done tasks can''t be queued.', format('done: %s', v_err);
  UPDATE public.tasks SET status = 'archived' WHERE id = probe.id('Q3');
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('Q3')));
  ASSERT v_err = 'Archived tasks can''t be queued.', format('archived: %s', v_err);
  UPDATE public.tasks SET status = 'todo' WHERE id = probe.id('Q3');
  -- No person, no queue (system work).
  PERFORM probe.as_system();
  v_err := probe.error_of(format('SELECT public.tasks_op_queue_add(%L, %L)', probe.id('W'), probe.id('Q3')));
  ASSERT v_err IS NOT NULL, 'system: queued without a person';
  ASSERT (SELECT count(*) FROM public.task_queue WHERE task_id IN (probe.id('Q3'), probe.id('P1 Bea private'), probe.id('P2 Nell''s'))) = 0,
    'who can queue: a refused add left a row';
  RAISE NOTICE 'PASS access: viewers, outsiders, unseen and other-workspace tasks, done/archived, and system calls are refused';
END;
$$;

-- ── 5. An API key queues for its creator (D2-6) ──────────────────────────────

DO $$
BEGIN
  PERFORM probe.as_key('K');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q3'));
  PERFORM probe.as_system();
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q1', 'Q2', 'Q3'], format('key: %s', probe.queue('A'));
  ASSERT (SELECT actor_type FROM public.module_activity WHERE op = 'tasks.queue_add' AND entity_id = probe.id('Q3')) = 'api_key',
    'key: the add reads as the key';
  -- A key without Tasks edit can't.
  UPDATE public.workspace_api_keys SET scopes = '{"tasks": "view"}' WHERE id = probe.id('K');
  PERFORM probe.as_key('K');
  ASSERT probe.error_of(format('SELECT public.tasks_op_queue_remove(%L, %L)', probe.id('W'), probe.id('Q3'))) IS NOT NULL,
    'key: a view-only key removed from the queue';
  PERFORM probe.as_system();
  UPDATE public.workspace_api_keys SET scopes = '{"tasks": "edit"}' WHERE id = probe.id('K');
  ASSERT probe.queue('A') = ARRAY['C3 key commits', 'Q1', 'Q2', 'Q3'], 'key: the refused remove changed the queue';
  RAISE NOTICE 'PASS key: an API key adds to its creator''s queue, reads as the key, and needs Tasks edit';
END;
$$;

-- ── 6. Leaving every queue (D2-3) ────────────────────────────────────────────

DO $$
BEGIN
  -- Q1 is in Ada's queue; Bea queues it again.
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q1'));
  -- Completing it (Bea, through the status op) takes it out of both.
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('Q1'), 'done');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q1')), 'done: still queued';
  -- Reopening doesn't put it back.
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('Q1'), 'todo');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q1')), 'reopen: re-queued';

  -- Archiving (a plain field write, like the app's).
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET status = 'archived' WHERE id = probe.id('Q2');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q2')), 'archive: still queued';

  -- Deleting (soft) and restoring.
  UPDATE public.tasks SET deleted_at = now() WHERE id = probe.id('Q3');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q3')), 'delete: still queued';
  UPDATE public.tasks SET deleted_at = NULL WHERE id = probe.id('Q3');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q3')), 'restore: re-queued';

  -- A repeating task completed from the queue leaves; catch-up reopens it
  -- without queuing it.
  PERFORM probe.new_task('Q4 daily', 'A', 'A');
  UPDATE public.tasks SET recurrence = '{"rrule": "FREQ=DAILY"}' WHERE id = probe.id('Q4 daily');
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q4 daily'));
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('Q4 daily'), 'done');
  PERFORM public.tasks_op_catch_up(probe.id('W'), jsonb_build_array(jsonb_build_object(
    'task_id', probe.id('Q4 daily'), 'kind', 'reopen', 'status', 'todo', 'clear_commit', true)));
  ASSERT (probe.task('Q4 daily')).status = 'todo', 'recurrence: catch-up didn''t reopen';
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q4 daily')), 'recurrence: re-queued';

  -- A deleted bucket takes its tasks out of every queue (Olga, its owner).
  PERFORM probe.as_user('O');
  ASSERT (SELECT count(*) FROM public.task_queue q JOIN public.tasks t ON t.id = q.task_id
          WHERE t.bucket_id = probe.id('SB2')) = 30, 'bucket: Bea''s R tasks aren''t queued';
  UPDATE public.buckets SET deleted_at = now() WHERE id = probe.id('SB2');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue q JOIN public.tasks t ON t.id = q.task_id
                     WHERE t.bucket_id = probe.id('SB2')), 'bucket delete: still queued';
  UPDATE public.buckets SET deleted_at = NULL WHERE id = probe.id('SB2');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue q JOIN public.tasks t ON t.id = q.task_id
                     WHERE t.bucket_id = probe.id('SB2')), 'bucket restore: re-queued';

  -- Moving buckets or reassigning doesn't touch queues.
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q3'));
  UPDATE public.tasks SET bucket_id = probe.id('SB2') WHERE id = probe.id('Q3');
  PERFORM public.tasks_op_assign(probe.id('W'), probe.id('Q3'), probe.id('B'));
  ASSERT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q3') AND user_id = probe.id('A')),
    'move/reassign: left the queue';

  -- A hard delete cascades.
  PERFORM probe.as_system();
  PERFORM probe.new_task('Q5 hard', 'A', 'A');
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q5 hard'));
  DELETE FROM public.tasks WHERE id = probe.id('Q5 hard');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q5 hard')), 'hard delete: still queued';
  PERFORM probe.as_system();
  RAISE NOTICE 'PASS leave: done, archived, deleted (soft and hard), bucket deleted; reopen/restore/catch-up never re-queue; move/reassign keep it';
END;
$$;

-- ── 7. Old versions' commit ops act on the caller's queue (D2-5) ─────────────

DO $$
DECLARE
  t public.tasks;
  v_before text[];
BEGIN
  PERFORM probe.new_task('L1', 'A', 'A');
  PERFORM probe.new_task('L2', 'A', 'A');
  v_before := probe.queue('A');

  -- Bea commits L1 the old way: it lands at the end of Bea's queue, and the
  -- old columns still say "today" for old versions.
  PERFORM probe.as_user('B');
  t := public.tasks_op_commit(probe.id('W'), probe.id('L1'), current_date);
  ASSERT (probe.queue('B'))[array_length(probe.queue('B'), 1)] = 'L1', format('commit: Bea''s queue %s', probe.queue('B'));
  ASSERT t.committed_for = current_date AND t.commit_order IS NOT NULL, 'commit: the old columns weren''t written';
  ASSERT probe.queue('A') = v_before, 'commit: Ada''s queue changed';
  ASSERT probe.activity('tasks.commit', 'L1') = 1 AND probe.activity('tasks.queue_add', 'L1') = 0,
    'commit: logged other than one tasks.commit';
  -- Recommitting moves it to the end.
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('L2'), current_date);
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('L1'), current_date);
  ASSERT (probe.queue('B'))[array_length(probe.queue('B'), 1) - 1 :] = ARRAY['L2', 'L1'],
    format('recommit: %s', probe.queue('B'));
  -- Archived can't be committed (as before).
  ASSERT probe.error_of(format('SELECT public.tasks_op_commit(%L, %L, current_date)', probe.id('W'), probe.id('Q2')))
         = 'Archived tasks can''t be committed.', 'commit: archived';

  -- Uncommit: out of Bea's queue, the columns cleared.
  t := public.tasks_op_uncommit(probe.id('W'), probe.id('L2'));
  ASSERT NOT ('L2' = ANY (probe.queue('B'))), 'uncommit: still in Bea''s queue';
  ASSERT t.committed_for IS NULL AND t.commit_order IS NULL, 'uncommit: columns not cleared';
  ASSERT probe.activity('tasks.uncommit', 'L2') = 1, 'uncommit: not logged';
  -- Uncommitting a task only in the queue (the columns already NULL) still takes it out.
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('L2'));
  t := public.tasks_op_uncommit(probe.id('W'), probe.id('L2'));
  ASSERT NOT ('L2' = ANY (probe.queue('B'))), 'uncommit (queue only): still queued';
  ASSERT probe.activity('tasks.uncommit', 'L2') = 2, 'uncommit (queue only): not logged';
  -- Neither: a no-op, no log.
  PERFORM public.tasks_op_uncommit(probe.id('W'), probe.id('L2'));
  ASSERT probe.activity('tasks.uncommit', 'L2') = 2, 'uncommit (nothing): logged';

  -- Skip today: out of the queue, columns cleared, NOT a reschedule.
  t := public.tasks_op_skip_today(probe.id('W'), probe.id('L1'));
  ASSERT NOT ('L1' = ANY (probe.queue('B'))), 'skip today: still in Bea''s queue';
  ASSERT t.committed_for IS NULL AND t.reschedule_count = 0, 'skip today: columns kept, or counted as a reschedule';
  ASSERT probe.activity('tasks.skip_today', 'L1') = 1, 'skip today: not logged';
  PERFORM public.tasks_op_skip_today(probe.id('W'), probe.id('L1'));
  ASSERT probe.activity('tasks.skip_today', 'L1') = 1, 'skip today (nothing): logged';

  -- Ada's queue never moved through any of it.
  ASSERT probe.queue('A') = v_before, 'legacy ops: Ada''s queue changed';

  -- Old builds' ops through an API key act for the key's creator.
  PERFORM probe.as_key('K');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('L2'), current_date);
  ASSERT (probe.queue('A'))[array_length(probe.queue('A'), 1)] = 'L2', 'key commit: not in Ada''s queue';
  PERFORM public.tasks_op_uncommit(probe.id('W'), probe.id('L2'));
  ASSERT probe.queue('A') = v_before, 'key uncommit: Ada''s queue';
  PERFORM probe.as_system();
  RAISE NOTICE 'PASS legacy ops: commit/recommit/uncommit/skip_today act on the caller''s queue and still write the old columns; skip isn''t a reschedule';
END;
$$;

-- ── 8. Old versions' direct column writes ────────────────────────────────────

DO $$
DECLARE
  v_before text[];
BEGIN
  -- Capture straight into today (an insert carrying committed_for).
  PERFORM probe.as_user('B');
  INSERT INTO public.tasks (id, workspace_id, bucket_id, assignee_id, title, committed_for, commit_order)
  VALUES (probe.id('D1 captured'), probe.id('W'), probe.id('SB'), probe.id('B'), 'D1 captured', current_date, 9);
  ASSERT (probe.queue('B'))[array_length(probe.queue('B'), 1)] = 'D1 captured',
    format('capture: %s', probe.queue('B'));
  -- An old upsert of a task that exists, committing it (ON CONFLICT path).
  PERFORM probe.new_task('D2 upserted', 'A', 'A');
  PERFORM probe.as_user('B');
  INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, committed_for, commit_order)
  VALUES (probe.id('D2 upserted'), probe.id('W'), probe.id('SB'), probe.id('A'), 'D2 upserted', current_date, 10)
  ON CONFLICT (id) DO UPDATE SET committed_for = EXCLUDED.committed_for, commit_order = EXCLUDED.commit_order,
                                 title = EXCLUDED.title, owner_id = EXCLUDED.owner_id;
  ASSERT (probe.queue('B'))[array_length(probe.queue('B'), 1)] = 'D2 upserted',
    format('upsert commit: %s', probe.queue('B'));

  -- Dragging the old day's queue: the app writes commit_order one task per
  -- request. Bea's today-rows are C2, C8, C4, D1, D2 (commit_order 2, 4, 5, 9,
  -- 10); she drags D2 to the front: [D2, C2, C8, C4, D1] = 1..5.
  UPDATE public.tasks SET commit_order = 1 WHERE id = probe.id('D2 upserted');
  UPDATE public.tasks SET commit_order = 2 WHERE id = probe.id('C2 Bea commits');
  UPDATE public.tasks SET commit_order = 3 WHERE id = probe.id('C8 Ada then Bea');
  UPDATE public.tasks SET commit_order = 4 WHERE id = probe.id('C4 nobody logged');
  UPDATE public.tasks SET commit_order = 5 WHERE id = probe.id('D1 captured');
  -- The day's five tasks are re-sorted into the five slots they held; C10
  -- (tomorrow's) keeps its own slot, between the third and the fourth.
  ASSERT probe.queue('B') = ARRAY['D2 upserted', 'C2 Bea commits', 'C8 Ada then Bea', 'C10 tomorrow',
                                  'C4 nobody logged', 'D1 captured'],
    format('drag: %s', probe.queue('B'));

  -- A stale whole-row save writing committed_for back to NULL empties nothing.
  v_before := probe.queue('B');
  UPDATE public.tasks SET committed_for = NULL, commit_order = NULL, title = 'C2 Bea commits'
  WHERE id = probe.id('C2 Bea commits');
  ASSERT probe.queue('B') = v_before, 'stale NULL: dequeued';
  -- …nor does a stale old date write it back in.
  UPDATE public.tasks SET committed_for = current_date - 5 WHERE id = probe.id('Q3');
  ASSERT NOT ('Q3' = ANY (probe.queue('B'))), 'stale date: queued';
  -- Skipping an occurrence still clears the old columns, but keeps the queue.
  PERFORM probe.new_task('D3 weekly', 'B', 'B');
  PERFORM probe.as_user('B');
  UPDATE public.tasks SET recurrence = '{"rrule": "FREQ=WEEKLY"}', scheduled_at = now() WHERE id = probe.id('D3 weekly');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('D3 weekly'), current_date);
  PERFORM public.tasks_op_skip_occurrence(probe.id('W'), probe.id('D3 weekly'), now() + interval '7 days',
                                          '{"rrule": "FREQ=WEEKLY"}', true);
  ASSERT (probe.task('D3 weekly')).committed_for IS NULL, 'skip occurrence: old columns kept';
  ASSERT 'D3 weekly' = ANY (probe.queue('B')), 'skip occurrence: dequeued';
  -- System writes (no person) don't queue anything.
  PERFORM probe.as_system();
  UPDATE public.tasks SET committed_for = current_date WHERE id = probe.id('Q3');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('Q3') AND user_id <> probe.id('A')),
    'system write: queued';
  -- A done task written as committed isn't queued.
  PERFORM probe.as_user('B');
  UPDATE public.tasks SET status = 'done', committed_for = current_date + 1 WHERE id = probe.id('L2');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('L2')), 'done write: queued';
  PERFORM probe.as_system();
  ASSERT probe.keys_clean(), 'direct writes: keys are clean';
  RAISE NOTICE 'PASS direct writes: capture/upsert commits land in the writer''s queue, drags re-sort it; stale NULLs, old dates, recurrence and system writes don''t touch it';
END;
$$;


-- ── 9. Leaving the workspace, deleting the account ──────────────────────────

DO $$
BEGIN
  PERFORM probe.as_user('X');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q3'));
  PERFORM probe.as_system();
  ASSERT probe.queue('X') = ARRAY['Q3'], 'member: Xavier couldn''t queue';
  DELETE FROM public.workspace_members WHERE workspace_id = probe.id('W') AND user_id = probe.id('X');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE user_id = probe.id('X')), 'member removed: queue kept';
  ASSERT EXISTS (SELECT 1 FROM public.task_queue WHERE user_id = probe.id('A') AND task_id = probe.id('Q3')),
    'member removed: someone else''s row went';

  -- Back in, queue again, then delete the account: the profile cascade empties it.
  INSERT INTO public.workspace_members (workspace_id, user_id, role, perms, joined_at)
  VALUES (probe.id('W'), probe.id('X'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), now());
  PERFORM probe.as_user('X');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('Q3'));
  PERFORM probe.as_system();
  ASSERT probe.queue('X') = ARRAY['Q3'], 'account: Xavier couldn''t queue again';
  DELETE FROM auth.users WHERE id = probe.id('X');
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE user_id = probe.id('X')), 'account deleted: queue kept';
  ASSERT EXISTS (SELECT 1 FROM public.task_queue WHERE user_id = probe.id('A') AND task_id = probe.id('Q3')),
    'account deleted: someone else''s row went';
  RAISE NOTICE 'PASS membership: leaving a workspace or deleting the account empties that queue, nobody else''s';
END;
$$;

-- ── 10. Reading (claims) and no direct writes: RLS and grants ────────────────

-- Bea queues a task in her private bucket; Ada can't see it.
DO $$
BEGIN
  PERFORM probe.new_task('P3 private queued', 'B', 'B', 'PB');
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('P3 private queued'));
  PERFORM probe.as_system();
END;
$$;
CREATE TABLE probe.expect AS
SELECT q.user_id, q.task_id FROM public.task_queue q;
GRANT SELECT ON probe.expect TO authenticated;

-- Ada reads her own queue and Bea's rows on tasks she can see.
BEGIN;
SELECT FROM probe.as_user('A');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.task_queue WHERE user_id = probe.id('A'))
         = (SELECT count(*) FROM probe.expect WHERE user_id = probe.id('A')),
    'read: Ada can''t read all of her own queue';
  ASSERT (SELECT count(*) FROM public.task_queue WHERE user_id = probe.id('B'))
         = (SELECT count(*) FROM probe.expect WHERE user_id = probe.id('B')) - 1,
    'read: Ada sees other than all of Bea''s rows but the private one';
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('P3 private queued')),
    'read: Ada sees a row on Bea''s private task';
  ASSERT probe.error_of(format(
    'INSERT INTO public.task_queue (workspace_id, user_id, task_id, position) VALUES (%L, %L, %L, %L)',
    probe.id('W'), probe.id('A'), probe.id('L1'), '0000000001')) LIKE 'permission denied%',
    'write: Ada inserted directly';
  ASSERT probe.error_of('UPDATE public.task_queue SET position = ''0000000001''') LIKE 'permission denied%',
    'write: Ada updated directly';
  ASSERT probe.error_of('DELETE FROM public.task_queue') LIKE 'permission denied%',
    'write: Ada deleted directly';
  RAISE NOTICE 'PASS read: own queue + claims on visible tasks; no direct writes';
END;
$$;
RESET ROLE;
COMMIT;

-- Bea sees her private row; the viewer sees claims; someone outside sees nothing.
BEGIN;
SELECT FROM probe.as_user('B');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('P3 private queued')),
    'read: Bea can''t see her private row';
END;
$$;
RESET ROLE;
SELECT FROM probe.as_user('V');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.task_queue WHERE user_id = probe.id('A')),
    'read: the viewer can''t see claims';
END;
$$;
RESET ROLE;
SELECT FROM probe.as_user('N');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue), 'read: an outsider sees queue rows';
  RAISE NOTICE 'PASS read: own private rows, viewer claims, outsiders nothing';
END;
$$;
RESET ROLE;
COMMIT;

-- A task that stops being shared with Ada drops out of her queue (and her
-- view of anyone's), without touching the row.
DO $$
BEGIN
  PERFORM probe.new_task('S1 unshared', 'B', 'B', 'PB');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (probe.id('W'), 'task', probe.id('S1 unshared'), 'member', probe.id('A'), 'edit', probe.id('B'));
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_queue_add(probe.id('W'), probe.id('S1 unshared'));
  PERFORM probe.as_system();
  DELETE FROM public.resource_grants WHERE resource_type = 'task' AND resource_id = probe.id('S1 unshared');
END;
$$;
BEGIN;
SELECT FROM probe.as_user('A');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_queue WHERE task_id = probe.id('S1 unshared')),
    'unshared: still in Ada''s queue';
  RAISE NOTICE 'PASS unshared: a task you can no longer see drops out of your queue';
END;
$$;
RESET ROLE;
COMMIT;

-- anon reads nothing at all.
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  ASSERT probe.error_of('SELECT count(*) FROM public.task_queue') LIKE 'permission denied%', 'anon: read task_queue';
END;
$$;
RESET ROLE;
COMMIT;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_queue_add(uuid, uuid, text)', 'tasks_op_queue_remove(uuid, uuid)',
    'tasks_op_queue_reorder(uuid, uuid, uuid)', 'tasks_op_queue_move_to_end(uuid, uuid)',
    'tasks_op_commit(uuid, uuid, date)', 'tasks_op_uncommit(uuid, uuid)', 'tasks_op_skip_today(uuid, uuid)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), 'grants: anon can call ' || fn;
    ASSERT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), 'grants: authenticated can''t call ' || fn;
    ASSERT has_function_privilege('service_role', 'public.' || fn, 'EXECUTE'), 'grants: service_role can''t call ' || fn;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'tasks_queue__key(bigint)', 'tasks_queue__num(text)', 'tasks_queue__lock(uuid, uuid)',
    'tasks_queue__renumber(uuid, uuid, uuid)', 'tasks_queue__place(uuid, uuid, uuid, text, uuid)',
    'tasks_queue__mine(uuid, uuid)', 'tasks_queue__guard(uuid, uuid)',
    'tasks_queue_legacy()', 'tasks_queue_leave()', 'tasks_queue_member_removed()'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), 'grants: anon can call ' || fn;
    ASSERT NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), 'grants: authenticated can call ' || fn;
  END LOOP;
  ASSERT NOT has_table_privilege('anon', 'public.task_queue', 'SELECT'), 'grants: anon reads task_queue';
  ASSERT NOT has_table_privilege('anon', 'public.task_queue', 'TRUNCATE'), 'grants: anon truncates task_queue';
  ASSERT NOT has_table_privilege('authenticated', 'public.task_queue', 'INSERT'), 'grants: authenticated inserts';
  ASSERT NOT has_table_privilege('authenticated', 'public.task_queue', 'TRUNCATE'), 'grants: authenticated truncates';
  RAISE NOTICE 'PASS grants: ops for signed-in users and the connector only; helpers closed; no direct table writes';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'PASS: all'; END $$;

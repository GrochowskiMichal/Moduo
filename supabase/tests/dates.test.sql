-- TV-D9 · Due dates, due times, late, completion
-- (supabase/migrations/20261010171000_tasks_completion_due_on.sql).
-- specs/tasks-v3.md AC map: "due date is a date; zones" (AC12.5, AC12.7,
-- AC2.2) and the completion record (AC12.5, REPLAN 77).
--
-- Cast: A works from Tokyo (UTC+9), B from Los Angeles (UTC-8 in November),
-- N has never saved a zone. All three are in O's workspace W; SB is shared, PB
-- is O's private project. K is an API key B made with Tasks at Edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'N']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('N'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit"}'::jsonb, test.id('B'));

CREATE FUNCTION test.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.new_task(p_who text, p_name text, p_fields jsonb DEFAULT '{}') RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id('SB')) || p_fields))
$$;

DO $$
DECLARE
  r text;
  v_t public.tasks;
BEGIN
  PERFORM test.as_user('A', $q$SELECT public.user_op_set_time_zone('Asia/Tokyo')$q$);
  PERFORM test.as_user('B', $q$SELECT public.user_op_set_time_zone('America/Los_Angeles')$q$);

  -- ── A due date is a date, the same for everyone (AC12.5) ─────────────────
  r := test.new_task('A', 'D1', '{"due_on": "2026-11-08"}');
  v_t := test.task('D1');
  PERFORM test.ok(r = 'ok 1' AND v_t.due_on = '2026-11-08' AND v_t.due_date = '2026-11-08T12:00:00Z',
    'a due date is stored as a date; the old column mirrors it as noon UTC', r);
  PERFORM test.ok(test.value_as('B', format($q$SELECT due_on::text FROM public.tasks WHERE id = %L$q$, test.id('D1'))) = '2026-11-08'
              AND test.value_as('A', format($q$SELECT due_on::text FROM public.tasks WHERE id = %L$q$, test.id('D1'))) = '2026-11-08',
    'someone in Los Angeles reads the same date as its author in Tokyo');
  PERFORM test.ok(((v_t.due_date AT TIME ZONE 'Asia/Tokyo')::date, (v_t.due_date AT TIME ZONE 'America/Los_Angeles')::date)
                  = ('2026-11-08'::date, '2026-11-08'::date),
    'an old build in either zone reads the mirror as the same day');

  -- Old builds write a local midnight; the date is the writer's.
  r := test.as_user('A', format($q$UPDATE public.tasks SET due_date = '2026-11-08T15:00:00Z' WHERE id = %L$q$, test.id('D1')));
  v_t := test.task('D1');
  PERFORM test.ok(r = 'ok 1' AND v_t.due_on = '2026-11-09' AND v_t.due_date = '2026-11-09T12:00:00Z',
    'an old build in Tokyo writing its local midnight of Nov 9 sets Nov 9', r);
  r := test.as_user('B', format($q$UPDATE public.tasks SET due_date = '2026-11-10T08:00:00Z' WHERE id = %L$q$, test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-10',
    'an old build in Los Angeles writing its local midnight of Nov 10 sets Nov 10', r);
  r := test.as_user('N', format($q$UPDATE public.tasks SET due_date = '2026-11-11T15:00:00Z' WHERE id = %L$q$, test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-12',
    'with no zone saved, a local midnight east of UTC still lands on its own day (Tokyo''s Nov 12)', r);
  r := test.as_user('N', format($q$UPDATE public.tasks SET due_date = '2026-11-13T05:00:00Z' WHERE id = %L$q$, test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-13',
    'and west of UTC (New York''s Nov 13)', r);
  -- An old build saving the row it read changes nothing.
  r := test.as_user('A', format($q$UPDATE public.tasks SET due_date = %L, title = 'Renamed' WHERE id = %L$q$,
    (test.task('D1')).due_date, test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-13', 'a whole-row save keeps the date', r);
  r := test.as_user('A', format($q$UPDATE public.tasks SET due_date = NULL WHERE id = %L$q$, test.id('D1')));
  v_t := test.task('D1');
  PERFORM test.ok(v_t.due_on IS NULL AND v_t.due_date IS NULL, 'an old build clearing the date clears it', r);

  -- Agents send dates as text; a date alone is the date.
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_date": "2026-11-08"}'::jsonb)$q$,
    test.id('W'), test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-08', 'a date-only due_date is that date', r);
  r := test.as_key('K', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_date": "2026-11-09T00:00:00.000Z"}'::jsonb)$q$,
    test.id('W'), test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-09',
    'the UTC midnight an agent''s date became stays that date, even for a writer in Los Angeles', r);
  r := test.as_user('B', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_on": "2026-11-20", "due_date": "2026-01-01T00:00:00Z"}'::jsonb)$q$,
    test.id('W'), test.id('D1')));
  PERFORM test.ok(r = 'ok 1' AND (test.task('D1')).due_on = '2026-11-20', 'due_on wins over due_date in one patch', r);
  PERFORM test.ok((SELECT payload -> 'due_on' ->> 'to' FROM public.module_activity
                   WHERE entity_id = test.id('D1') AND op = 'tasks.update' AND payload -> 'due_on' ->> 'to' = '2026-11-20') = '2026-11-20',
    'the trail line for a new date names the day');

  -- ── A due time is a moment: the clock time in the assignee's zone ────────
  r := test.new_task('A', 'D2', '{"due_on": "2026-11-08", "due_time": "15:00"}');
  v_t := test.task('D2');
  PERFORM test.ok(r = 'ok 1' AND v_t.due_time = '15:00' AND public.tasks__due_at(v_t) = '2026-11-08T06:00:00Z',
    'Nov 8 at 3 PM for an assignee in Tokyo is 06:00 UTC', r);
  PERFORM test.ok((public.tasks__due_at(v_t) AT TIME ZONE 'America/Los_Angeles') = '2026-11-07 22:00:00',
    'which someone in Los Angeles sees as Nov 7, 10 PM');
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('D2'), test.id('B')));
  PERFORM test.ok(public.tasks__due_at(test.task('D2')) = '2026-11-08T23:00:00Z',
    'assigned to Los Angeles, 3 PM is Los Angeles'' 3 PM');
  r := test.as_user('A', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_on": null}'::jsonb)$q$, test.id('W'), test.id('D2')));
  v_t := test.task('D2');
  PERFORM test.ok(v_t.due_on IS NULL AND v_t.due_time IS NULL AND v_t.due_date IS NULL, 'no date, no time', r);
  r := test.try('A', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"due_day": "2026-11-08"}'::jsonb)$q$, test.id('W'), test.id('D2')));
  PERFORM test.ok(r LIKE '%no field "due_day"%', 'the ops still refuse fields they don''t know', r);

  -- ── Late, on the server (REPLAN 23) ──────────────────────────────────────
  PERFORM test.new_task('A', 'L1', '{"due_on": "2026-11-08"}');
  v_t := test.task('L1');
  PERFORM test.ok(NOT public.tasks__late(v_t, '2026-11-08T14:59:00Z') AND public.tasks__late(v_t, '2026-11-08T15:00:00Z'),
    'a date-only task is late from the assignee''s midnight (Tokyo)');
  PERFORM test.as_user('A', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('L1'), test.id('B')));
  v_t := test.task('L1');
  PERFORM test.ok(NOT public.tasks__late(v_t, '2026-11-09T07:59:00Z') AND public.tasks__late(v_t, '2026-11-09T08:00:00Z'),
    'assigned to Los Angeles, from Los Angeles'' midnight (roll-over and late follow the assignee, AC12.7)');
  PERFORM test.new_task('A', 'L2', '{"due_on": "2026-11-08", "due_time": "15:00"}');
  v_t := test.task('L2');
  PERFORM test.ok(NOT public.tasks__late(v_t, '2026-11-08T06:00:00Z') AND public.tasks__late(v_t, '2026-11-08T06:01:00Z'),
    'a task with a due time is late once that moment passes');
  PERFORM test.new_task('A', 'L3', '{"due_on": "2026-01-01", "status": "backlog"}');
  PERFORM test.new_task('A', 'L4', '{"due_on": "2026-01-01", "status": "done"}');
  PERFORM test.ok(NOT public.tasks__late(test.task('L3'), '2026-11-08T00:00:00Z')
              AND NOT public.tasks__late(test.task('L4'), '2026-11-08T00:00:00Z'),
    'backlog and done tasks are never late');
  PERFORM test.new_task('A', 'L5', '{"due_on": "2020-01-01"}');
  PERFORM test.ok(test.value_as('A', format($q$SELECT public.tasks_late(t)::text FROM public.tasks t WHERE t.id = %L$q$, test.id('L5'))) = 'true',
    'the late read answers for a task you can see');
  PERFORM test.as_op('O', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, due_on, assignee_id)
      VALUES (%L, %L, %L, 'Private late', '2020-01-01', %L)$q$, test.id('PL'), test.id('W'), test.id('PB'), test.id('O')));
  PERFORM test.ok(test.value_as('A', format($q$SELECT coalesce(public.tasks_late(t)::text, 'null') FROM public.tasks t WHERE t.id = %L$q$, test.id('PL'))) IS NULL
              AND (SELECT public.tasks_late(t) FROM public.tasks t WHERE t.id = test.id('PL')),
    'and says nothing about a task you can''t see');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.tasks__late(public.tasks, timestamptz)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.tasks_late(public.tasks)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.tasks_late(public.tasks)', 'EXECUTE'),
    'only the guarded late read is callable by people');
END;
$$;

-- ── Completion: when and who, per cycle (REPLAN 77) ─────────────────────────
DO $$
DECLARE
  r text;
  v_t public.tasks;
BEGIN
  PERFORM test.new_task('A', 'C1');
  r := test.as_user('B', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('C1')));
  v_t := test.task('C1');
  PERFORM test.ok(r = 'ok 1' AND v_t.completed_at = now() AND v_t.completed_by = test.id('B'),
    'finishing a task records when and who', r);
  PERFORM test.ok((SELECT count(*) FROM public.task_completions WHERE task_id = test.id('C1') AND deleted_at IS NULL) = 1,
    'one completion in the history');
  r := test.as_user('A', format($q$UPDATE public.tasks SET completed_by = %L, completed_at = '2020-01-01' WHERE id = %L$q$,
    test.id('A'), test.id('C1')));
  v_t := test.task('C1');
  PERFORM test.ok(v_t.completed_by = test.id('B') AND v_t.completed_at = now(), 'nobody rewrites who finished it', r);
  PERFORM test.as_user('B', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'todo')).status$q$, test.id('W'), test.id('C1')));
  v_t := test.task('C1');
  PERFORM test.ok(v_t.completed_at IS NULL AND v_t.completed_by IS NULL
              AND (SELECT count(*) FROM public.task_completions WHERE task_id = test.id('C1') AND deleted_at IS NULL) = 0,
    'reopening clears it, and the completion is taken back');

  -- An old build's own status write (before TV-D8 it saved status directly).
  PERFORM test.new_task('A', 'C2');
  r := test.as_user('A', format($q$UPDATE public.tasks SET status = 'done' WHERE id = %L$q$, test.id('C2')));
  v_t := test.task('C2');
  PERFORM test.ok(r = 'ok 1' AND v_t.completed_by = test.id('A') AND v_t.completed_at IS NOT NULL
              AND (SELECT count(*) FROM public.task_completions WHERE task_id = test.id('C2') AND deleted_at IS NULL) = 1,
    'an old build finishing a task records it too', r);
  r := test.as_key('K', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('C2')));
  PERFORM test.ok((SELECT count(*) FROM public.task_completions WHERE task_id = test.id('C2') AND deleted_at IS NULL) = 1,
    'finishing it again changes nothing', r);
  PERFORM test.new_task('B', 'C3');
  r := test.as_key('K', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('C3')));
  PERFORM test.ok((test.task('C3')).completed_by = test.id('B'), 'an agent''s completion is its person''s', r);
  r := test.as_user('A', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"status": "Won''t do"}'::jsonb)$q$, test.id('W'), test.id('C3')));
  PERFORM test.ok((test.task('C3')).completed_at IS NULL, 'Won''t do is not a completion', r);

  -- Account erasure clears the mark in other people's workspaces.
  PERFORM test.ok((public.account_erase_workspace_data(test.id('A'), true) ->> 'tasks_completed_by_cleared')::integer = 2,
    'the erasure preview counts the tasks someone finished (two here)');
  r := test.run(NULL, format($q$SELECT public.account_erase_workspace_data(%L, false)$q$, test.id('A')), false);
  PERFORM test.ok(r = 'ok 1' AND (test.task('C2')).completed_by IS NULL AND (test.task('C2')).completed_at IS NOT NULL
              AND (test.task('C2')).status_category = 'done',
    'erasure clears who finished it; the task stays done', r);
END;
$$;

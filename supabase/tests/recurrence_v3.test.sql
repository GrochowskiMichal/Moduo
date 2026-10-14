-- TV-D12 · Recurrence a–h (supabase/migrations/20261013111000_recurrence_moves_dst.sql).
-- specs/tasks-v3.md §2 "Repeats", edge cases "Dates, zones, repeats"; REPLAN 27;
-- decisions "TV-D12".
--
-- Cast: O owns workspace W; E works on tasks (zone UTC), P in Warsaw. SB is
-- shared, AR archived.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'P']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('P'), 'member');
INSERT INTO public.user_preferences (user_id, time_zone) VALUES
  (test.id('E'), 'UTC'), (test.id('P'), 'Europe/Warsaw')
ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('AR'), test.id('W'), test.id('O'), 'Old', false, '0002');

CREATE FUNCTION test.new_task(p_who text, p_name text, p_fields jsonb DEFAULT '{}') RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id('SB')) || p_fields))
$$;
CREATE FUNCTION test.t(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT * FROM public.tasks WHERE id = test.id(p_name)
$$;
-- A weekly rule starting on a day (09:00 UTC).
CREATE FUNCTION test.weekly(p_day date) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('rrule', 'FREQ=WEEKLY', 'dtstart', public.tasks__iso((p_day + time '09:00') AT TIME ZONE 'UTC'))
$$;

-- ── a · Rules read in the task's zone: 9:00 stays 9:00 across DST ──────────
DO $$
DECLARE
  v_rec jsonb := '{"rrule": "FREQ=WEEKLY;BYDAY=MO", "dtstart": "2026-10-19T07:00:00.000Z"}';
BEGIN
  PERFORM test.ok(public.tasks__rrule_next_in(v_rec, '2026-10-20T00:00:00Z', NULL, 'Europe/Warsaw')
                  = '2026-10-26T08:00:00Z'::timestamptz,
    'a Monday 9:00 Warsaw repeat is still 9:00 after the clocks go back (08:00 UTC)');
  PERFORM test.ok(public.tasks__rrule_next(v_rec, '2026-10-20T00:00:00Z', NULL) = '2026-10-26T07:00:00Z'::timestamptz,
    'the UTC engine underneath is unchanged (rrule.js parity)');
  PERFORM test.ok(public.tasks__rrule_next_in(v_rec, '2026-10-20T00:00:00Z', NULL, 'UTC')
                  = public.tasks__rrule_next(v_rec, '2026-10-20T00:00:00Z', NULL),
    'in UTC the zone-aware engine is the old one');
  PERFORM test.ok(public.tasks__rrule_prev_in(v_rec, '2026-11-03T00:00:00Z', NULL, 'Europe/Warsaw')
                  = '2026-11-02T08:00:00Z'::timestamptz,
    'and backwards too');
  PERFORM test.ok(public.tasks__rrule_next_in(
                    '{"rrule": "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261102T080000Z", "dtstart": "2026-10-19T07:00:00.000Z"}',
                    '2026-10-27T00:00:00Z', NULL, 'Europe/Warsaw') = '2026-11-02T08:00:00Z'::timestamptz
              AND public.tasks__rrule_next_in(
                    '{"rrule": "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261102T075959Z", "dtstart": "2026-10-19T07:00:00.000Z"}',
                    '2026-10-27T00:00:00Z', NULL, 'Europe/Warsaw') IS NULL,
    'UNTIL is read in the zone the same way');
END;
$$;

-- ── c · Due and scheduled move together; e · subtasks reset ─────────────────
DO $$
DECLARE
  d date := (now() AT TIME ZONE 'UTC')::date;
  t public.tasks;
  r text;
BEGIN
  -- Due tomorrow (the rule's day), worked on today at 14:00.
  r := test.new_task('E', 'Weekly report', jsonb_build_object(
    'due_on', d + 1, 'recurrence', test.weekly(d + 1),
    'scheduled_at', public.tasks__iso((d + time '14:00') AT TIME ZONE 'UTC')));
  PERFORM test.ok(r LIKE 'ok%', 'a weekly repeat with a due date and a session', r);
  PERFORM test.new_task('E', 'Gather numbers', jsonb_build_object('parent_id', test.id('Weekly report')));
  PERFORM test.new_task('E', 'Send it', jsonb_build_object('parent_id', test.id('Weekly report')));
  PERFORM test.new_task('E', 'Skip this', jsonb_build_object('parent_id', test.id('Weekly report')));
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('Gather numbers')));
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'wont_do')).status$q$, test.id('W'), test.id('Skip this')));
  PERFORM test.ok(public.tasks__occurrence_of(test.t('Weekly report')) = (d + 1 + time '09:00') AT TIME ZONE 'UTC',
    'it sits on its due date, the day the rule picks');
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('Weekly report')));
  t := test.t('Weekly report');
  PERFORM test.ok(public.tasks__try_ts(t.recurrence ->> 'nextOccurrence') = (d + 8 + time '09:00') AT TIME ZONE 'UTC',
    'completing it points at next week''s due date', t.recurrence::text);
  -- Next week, the day before it's due (its session's day): it's back.
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), ((d + 7) + time '00:30') AT TIME ZONE 'UTC', 100, interval '10 seconds');
  t := test.t('Weekly report');
  PERFORM test.ok(t.status = 'todo' AND t.due_on = d + 8
              AND t.scheduled_at = (d + 7 + time '14:00') AT TIME ZONE 'UTC',
    'it comes back on its session''s day; due and session moved by the same week (c)',
    t.status || ' ' || t.due_on || ' ' || t.scheduled_at);
  PERFORM test.ok((SELECT count(*) FROM public.task_sessions WHERE task_id = test.id('Weekly report') AND deleted_at IS NULL) = 1,
    'its session moved; no second block was made');
  PERFORM test.ok((test.t('Gather numbers')).status_category = 'todo' AND (test.t('Skip this')).status_category = 'todo'
              AND (test.t('Send it')).status_category = 'todo',
    'finished subtasks (Done and Won''t do) are To do again (e)');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.task_completions
                          WHERE task_id = test.id('Gather numbers') AND deleted_at IS NULL),
    'and their completion history stays');
  PERFORM test.ok((SELECT (payload ->> 'subtasks_reset')::integer FROM public.module_activity
                   WHERE entity_id = test.id('Weekly report') AND op = 'tasks.catch_up') = 2,
    'the trail line says how many subtasks were reset');
END;
$$;

-- ── Archived projects never repeat ──────────────────────────────────────────
DO $$
DECLARE
  d date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  PERFORM test.new_task('E', 'Archived chore', jsonb_build_object('due_on', d - 7, 'recurrence', test.weekly(d - 7)));
  UPDATE public.tasks SET bucket_id = test.id('AR') WHERE id = test.id('Archived chore');
  UPDATE public.buckets SET archived_at = now() WHERE id = test.id('AR');
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), now(), 100, interval '10 seconds');
  PERFORM test.ok((test.t('Archived chore')).due_on = d - 7, 'an open repeat in an archived project stays where it is');
END;
$$;

-- ── g · Move just this one; skip; change the pattern ────────────────────────
DO $$
DECLARE
  d date := (now() AT TIME ZONE 'UTC')::date;
  t public.tasks;
  r text;
BEGIN
  PERFORM test.new_task('E', 'Water plants', jsonb_build_object('due_on', d, 'recurrence', test.weekly(d)));
  r := test.as_user('E', format($q$SELECT (public.tasks_op_move_occurrence(%L, %L, %L::date)).due_on$q$,
    test.id('W'), test.id('Water plants'), d + 2));
  t := test.t('Water plants');
  PERFORM test.ok(t.due_on = d + 2 AND (t.recurrence ->> 'movedDays')::integer = 2
              AND public.tasks__try_ts(t.recurrence ->> 'movedFrom') = (d + time '09:00') AT TIME ZONE 'UTC',
    'moving just this one keeps the pattern''s slot', r);
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), ((d + 1) + time '12:00') AT TIME ZONE 'UTC', 100, interval '10 seconds');
  PERFORM test.ok((test.t('Water plants')).due_on = d + 2, 'the roll-over doesn''t pull a moved occurrence back');
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('Water plants')));
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), ((d + 7) + time '00:30') AT TIME ZONE 'UTC', 100, interval '10 seconds');
  t := test.t('Water plants');
  PERFORM test.ok(t.status = 'todo' AND t.due_on = d + 7 AND NOT t.recurrence ? 'movedFrom',
    'next cycle it''s back on the pattern', t.due_on::text);
  -- Moving it there and back again forgets the move.
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_move_occurrence(%L, %L, %L::date)$q$, test.id('W'), test.id('Water plants'), d + 9));
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_move_occurrence(%L, %L, %L::date)$q$, test.id('W'), test.id('Water plants'), d + 7));
  PERFORM test.ok(NOT (test.t('Water plants')).recurrence ? 'movedFrom', 'moving it back where it was forgets the move');
  -- Skip: worked out on the server, whatever the app sent.
  r := test.as_user('E', format($q$SELECT (public.tasks_op_skip_occurrence(%L, %L, '2099-01-01T00:00:00Z', '{"rrule": "FREQ=DAILY"}'::jsonb)).due_on$q$,
    test.id('W'), test.id('Water plants')));
  t := test.t('Water plants');
  PERFORM test.ok(t.due_on = d + 14 AND t.recurrence ->> 'rrule' = 'FREQ=WEEKLY'
              AND public.tasks__try_ts(t.recurrence ->> 'nextOccurrence') = (d + 21 + time '09:00') AT TIME ZONE 'UTC',
    'skipping moves to the next occurrence the server works out (the app''s datetimes are ignored)', r);
  -- d · History: done and skipped, with my own time.
  INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, started_at, ended_at, seconds)
  VALUES (test.id('W'), test.id('Water plants'), test.id('E'), 'focus', now() - interval '1 hour', now() - interval '30 minutes', 1800),
         (test.id('W'), test.id('Water plants'), test.id('O'), 'focus', now() - interval '1 hour', now() - interval '50 minutes', 600);
  r := test.value_as('E', format($q$SELECT public.tasks_op_history(%L, %L)::text$q$, test.id('W'), test.id('Water plants')));
  PERFORM test.ok(r::jsonb @> '[{"kind": "done", "my_seconds": 1800}]'::jsonb
              AND r::jsonb @> '[{"kind": "skipped"}]'::jsonb
              AND NOT r::jsonb @> '[{"my_seconds": 2400}]'::jsonb,
    'the history lists the cycle done and the one skipped, with only my own time (d)', r);
  -- Changing the pattern works the pointer out again.
  r := test.as_user('E', format($q$SELECT public.tasks_op_update(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('Water plants'),
    jsonb_build_object('recurrence', jsonb_build_object('rrule', 'FREQ=DAILY', 'dtstart', public.tasks__iso((d + 14 + time '09:00') AT TIME ZONE 'UTC'),
                                                        'nextOccurrence', '2099-01-01T00:00:00.000Z'))));
  t := test.t('Water plants');
  PERFORM test.ok(public.tasks__try_ts(t.recurrence ->> 'nextOccurrence') = (d + 15 + time '09:00') AT TIME ZONE 'UTC',
    'changing the rule works the next occurrence out again', t.recurrence::text);
END;
$$;

-- ── A "1 day before" reminder comes back every cycle ────────────────────────
DO $$
DECLARE
  d date := (now() AT TIME ZONE 'UTC')::date;
  v_at timestamptz;
BEGIN
  PERFORM test.new_task('E', 'Assignment', jsonb_build_object('due_on', d + 1, 'recurrence', test.weekly(d + 1)));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'day_before')$q$,
    test.id('W'), test.id('Assignment')));
  -- This week's fired.
  UPDATE public.task_reminders SET fired_at = now() WHERE task_id = test.id('Assignment');
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('Assignment')));
  -- The day before next week's due date, just after midnight.
  PERFORM count(*) FROM public.tasks__roll_over(test.id('W'), ((d + 7) + time '00:05') AT TIME ZONE 'UTC', 100, interval '10 seconds');
  SELECT r.at INTO v_at FROM public.task_reminders r WHERE r.task_id = test.id('Assignment');
  PERFORM test.ok((test.t('Assignment')).status = 'todo' AND (test.t('Assignment')).due_on = d + 8
              AND v_at = ((d + 7) + time '09:00') AT TIME ZONE 'UTC'
              AND (SELECT fired_at FROM public.task_reminders WHERE task_id = test.id('Assignment')) IS NULL,
    'a repeat with a "1 day before" reminder comes back the day before, with the reminder armed again',
    (test.t('Assignment')).status || ' ' || (test.t('Assignment')).due_on || ' ' || v_at);
END;
$$;

-- ── The history keeps the newest cycles ────────────────────────────────────
DO $$
DECLARE
  r jsonb;
BEGIN
  PERFORM test.new_task('E', 'Daily habit', jsonb_build_object('recurrence', test.weekly((now() AT TIME ZONE 'UTC')::date)));
  INSERT INTO public.task_completions (workspace_id, task_id, user_id, completed_at, cycle_key)
  SELECT test.id('W'), test.id('Daily habit'), test.id('E'), now() - make_interval(days => n), 'c' || n
  FROM generate_series(1, 120) n;
  r := test.value_as('E', format($q$SELECT public.tasks_op_history(%L, %L)::text$q$, test.id('W'), test.id('Daily habit')))::jsonb;
  PERFORM test.ok(jsonb_array_length(r) = 100 AND r -> 0 ->> 'cycle' = 'c1' AND r -> 99 ->> 'cycle' = 'c100',
    'the history lists the newest 100 cycles, newest first', r -> 0 ->> 'cycle');
END;
$$;

-- ── An old build's local midnight at UTC+13 ─────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(public.tasks__due_on_of('2026-10-13T11:00:00Z', NULL) = '2026-10-14'
              AND public.tasks__due_on_of('2026-10-13T12:00:00Z', NULL) = '2026-10-13'
              AND public.tasks__due_on_of('2026-10-13T10:00:00Z', NULL) = '2026-10-13',
    'with no saved zone, 11:00 UTC is the next day''s midnight at UTC+13; noon is the mirror''s own date');
  PERFORM test.ok(public.tasks__due_on_of('2026-11-08T11:00:00Z', 'Europe/London') = '2026-11-08'
              AND public.tasks__due_on_of('2026-11-08T11:00:00Z', 'America/New_York') = '2026-11-08',
    'with a saved zone, 11:00 UTC keeps its date');
END;
$$;

-- TV-D12 · Skipping or moving a repeat's occurrence goes through the task's
-- edit gate (specs/tasks-v3.md block 27; decisions in docs/decisions/tasks.md
-- "TV-D12").
--
--   * tasks_op_skip_occurrence and tasks_op_move_occurrence call
--     tasks__guard_edit, like the other ops that change one task: Tasks edit in
--     the workspace (a person or a key), then the task's own gate ("not found"
--     when it can't be seen, refused when it can only be viewed).
--   * Grants restated: signed-in people and keys, never anon.
--
-- Re-cut from the live bodies (20261013111000). Apply after
-- 20261013140000. Verified on the local stack by
-- supabase/tests/recurrence_edit_checks.test.sql.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.tasks_op_move_occurrence(uuid, uuid, date, timestamptz)') IS NULL
     OR to_regprocedure('public.tasks__guard_edit(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013111000 (and TV-D10-fix) before this migration.';
  END IF;
END;
$$;

-- ── Skip ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_op_skip_occurrence(p_workspace_id uuid, p_task_id uuid, p_scheduled_at timestamp with time zone, p_recurrence jsonb, p_release_commit boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_zone text;
  v_slot timestamptz;
  v_to timestamptz;
  v_next timestamptz;
  v_from timestamptz;
  v_days integer;
BEGIN
  -- Skipping changes the task: Tasks edit in the workspace, then the task's
  -- own gate (missing when it can't be seen, refused when it can't be edited).
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);
  IF t.recurrence IS NULL OR jsonb_typeof(t.recurrence) <> 'object' THEN
    RAISE EXCEPTION 'Only recurring tasks have occurrences to skip.';
  END IF;
  IF t.status NOT IN ('todo', 'in_progress') THEN
    RAISE EXCEPTION 'Only open tasks can skip an occurrence.';
  END IF;
  v_from := coalesce(public.tasks__occurrence_of(t), t.scheduled_at);

  IF public.tasks__rrule_parse(t.recurrence ->> 'rrule') IS NULL
     OR t.recurrence ->> 'mode' = 'after_completion' THEN
    -- A rule only the app reads: the app's answer, as before.
    IF p_scheduled_at IS NULL OR p_recurrence IS NULL THEN
      RAISE EXCEPTION 'Skip needs the next occurrence.';
    END IF;
    IF t.scheduled_at IS NOT NULL AND p_scheduled_at <= t.scheduled_at THEN
      RAISE EXCEPTION 'Skip can only move an occurrence forward.';
    END IF;
    PERFORM public.tasks__check_recurrence(p_recurrence);
    UPDATE public.tasks
      SET scheduled_at = p_scheduled_at,
          recurrence = p_recurrence,
          committed_for = CASE WHEN p_release_commit THEN NULL ELSE committed_for END,
          commit_order = CASE WHEN p_release_commit THEN NULL ELSE commit_order END,
          updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
    v_to := p_scheduled_at;
  ELSE
    v_zone := public.tasks__zone_of(t);
    v_slot := public.tasks__pattern_slot(t);
    v_to := public.tasks__rrule_next_in(t.recurrence, greatest(now(), coalesce(v_slot, now())), t.created_at, v_zone);
    IF v_to IS NULL THEN
      RAISE EXCEPTION 'This repeat has no occurrence after this one.';
    END IF;
    v_next := public.tasks__rrule_next_in(t.recurrence, v_to, t.created_at, v_zone);
    IF v_slot IS NULL THEN
      UPDATE public.tasks SET due_on = public.tasks__local_date(v_to, v_zone)
      WHERE id = t.id RETURNING * INTO t;
    ELSE
      v_days := public.tasks__local_date(v_to, v_zone) - public.tasks__local_date(v_slot, v_zone)
                - coalesce((t.recurrence ->> 'movedDays')::integer, 0);
      t := public.tasks__shift_dates(t, v_days, v_to, v_slot);
    END IF;
    UPDATE public.tasks
      SET recurrence = (t.recurrence - 'movedFrom' - 'movedDays')
                       || jsonb_build_object('nextOccurrence', public.tasks__iso(v_next)),
          committed_for = CASE WHEN coalesce(p_release_commit, false)
                                 OR public.tasks__local_date(v_to, v_zone) <> public.tasks__local_date(now(), v_zone)
                               THEN NULL ELSE committed_for END,
          commit_order = CASE WHEN coalesce(p_release_commit, false)
                                OR public.tasks__local_date(v_to, v_zone) <> public.tasks__local_date(now(), v_zone)
                              THEN NULL ELSE commit_order END,
          updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.skip_occurrence',
    jsonb_build_object('from', v_from, 'to', v_to,
                       'skipped', coalesce(v_slot, v_from),
                       'next_occurrence', t.recurrence ->> 'nextOccurrence',
                       'released_commit', coalesce(p_release_commit, false)));
  RETURN t;
END;
$function$;

-- ── Move just this one ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_op_move_occurrence(p_workspace_id uuid, p_task_id uuid, p_due_on date DEFAULT NULL::date, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_zone text;
  v_slot timestamptz;
  v_days integer;
  v_moved integer;
  v_from_due date;
  v_from_at timestamptz;
  v_flag text;
BEGIN
  -- The same gate as every other change to one task.
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);
  IF t.recurrence IS NULL OR jsonb_typeof(t.recurrence) <> 'object' THEN
    RAISE EXCEPTION 'Only a repeating task has occurrences to move.';
  END IF;
  IF t.status_category IN ('done', 'wont_do') THEN
    RAISE EXCEPTION 'Only an open repeat can move this occurrence.';
  END IF;
  IF (p_due_on IS NULL) = (p_starts_at IS NULL) THEN
    RAISE EXCEPTION 'Move the due date or the session, one at a time.' USING ERRCODE = '22023';
  END IF;
  v_zone := public.tasks__zone_of(t);
  v_slot := public.tasks__pattern_slot(t);
  v_from_due := t.due_on;
  v_from_at := t.scheduled_at;
  IF p_starts_at IS NOT NULL THEN
    IF t.scheduled_at IS NULL THEN
      RAISE EXCEPTION 'This repeat has no work session to move.' USING ERRCODE = '22023';
    END IF;
    v_days := public.tasks__local_date(p_starts_at, v_zone) - public.tasks__local_date(t.scheduled_at, v_zone);
    v_flag := current_setting('tasks.session_op', true);
    PERFORM set_config('tasks.session_op', '1', true);
    UPDATE public.tasks SET
      scheduled_at = p_starts_at,
      due_on = CASE WHEN due_on IS NULL THEN NULL ELSE due_on + v_days END,
      updated_at = now()
    WHERE id = t.id RETURNING * INTO t;
    PERFORM set_config('tasks.session_op', coalesce(v_flag, ''), true);
  ELSE
    IF t.due_on IS NULL THEN
      RAISE EXCEPTION 'This repeat has no due date to move.' USING ERRCODE = '22023';
    END IF;
    v_days := p_due_on - t.due_on;
    t := public.tasks__shift_dates(t, v_days, NULL, NULL);
  END IF;
  v_moved := coalesce((t.recurrence ->> 'movedDays')::integer, 0) + v_days;
  UPDATE public.tasks SET
    recurrence = CASE
      WHEN v_moved = 0 OR v_slot IS NULL THEN t.recurrence - 'movedFrom' - 'movedDays'
      ELSE t.recurrence || jsonb_build_object(
        'movedFrom', public.tasks__iso(v_slot), 'movedDays', v_moved) END,
    updated_at = now()
  WHERE id = t.id RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.move_occurrence',
    jsonb_build_object('due_on', jsonb_build_object('from', v_from_due, 'to', t.due_on),
                       'scheduled_at', jsonb_build_object('from', v_from_at, 'to', t.scheduled_at),
                       'pattern', public.tasks__iso(v_slot)));
  RETURN t;
END;
$function$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean)',
    'tasks_op_move_occurrence(uuid, uuid, date, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

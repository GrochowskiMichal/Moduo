-- Stub of production for supabase/probes/tasks-queue.probe.sql (TV-D2).
-- Runs on top of supabase/probes/tasks-assignee.stub.sql and the TV-D1
-- migration (20261008150000_tasks_assignee_creator.sql), which together are
-- production's tasks schema as of 2026-10-08. This adds what
-- 20261008171500_tasks_personal_queue.sql also touches, with production's
-- bodies (pg_get_functiondef, project wtoonrvuqumihpkbvwvs, 2026-10-08):
--   * perm_can_view (the task_queue read policy);
--   * the old commit ops the migration redefines, so the seed writes the
--     "before" the way production did;
--   * catch-up and skip-occurrence, which still clear the old columns.

SET check_function_bodies = off;

CREATE FUNCTION public.perm_can_view(p_workspace_id uuid, p_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.perm_user_has(p_workspace_id, auth.uid(), p_module || '.view')
$function$;

CREATE FUNCTION public.tasks_op_commit(p_workspace_id uuid, p_task_id uuid, p_for date)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_order integer;
  v_reordered boolean;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF p_for IS NULL THEN
    RAISE EXCEPTION 'Commit needs a date.';
  END IF;
  IF t.status = 'archived' THEN
    RAISE EXCEPTION 'Archived tasks can''t be committed.';
  END IF;
  v_reordered := t.committed_for = p_for;
  SELECT coalesce(max(commit_order), 0) + 1 INTO v_order
    FROM public.tasks
    WHERE workspace_id = p_workspace_id AND committed_for = p_for
      AND deleted_at IS NULL AND id <> t.id;
  UPDATE public.tasks
    SET committed_for = p_for, commit_order = v_order, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.commit',
    jsonb_build_object('for', p_for, 'order', v_order, 'reordered', coalesce(v_reordered, false))
  );
  RETURN t;
END;
$function$;

CREATE FUNCTION public.tasks_op_uncommit(p_workspace_id uuid, p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_was date;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF t.committed_for IS NULL THEN
    RETURN t; -- no-op, no log
  END IF;
  v_was := t.committed_for;
  UPDATE public.tasks
    SET committed_for = NULL, commit_order = NULL, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.uncommit',
    jsonb_build_object('was', v_was)
  );
  RETURN t;
END;
$function$;

CREATE FUNCTION public.tasks_op_skip_today(p_workspace_id uuid, p_task_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF t.committed_for IS NULL THEN
    RETURN t; -- nothing to skip out of
  END IF;
  UPDATE public.tasks
    SET committed_for = NULL, commit_order = NULL,
        reschedule_count = reschedule_count + 1, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.skip_today',
    jsonb_build_object('reschedule_count', t.reschedule_count)
  );
  RETURN t;
END;
$function$;

CREATE FUNCTION public.tasks_op_catch_up(p_workspace_id uuid, p_items jsonb)
 RETURNS SETOF tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  item jsonb;
  t public.tasks;
  v_task_id uuid;
  v_status text;
  v_scheduled timestamptz;
  v_from timestamptz;
  v_kind text;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Catch-up expects a list of items.';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_task_id := (item ->> 'task_id')::uuid;
    v_kind := coalesce(item ->> 'kind', 'collapse');
    v_status := item ->> 'status';
    v_scheduled := (item ->> 'scheduled_at')::timestamptz;
    IF v_status IS NOT NULL AND v_status NOT IN ('todo', 'in_progress') THEN
      CONTINUE; -- catch-up only ever reopens
    END IF;
    SELECT * INTO t FROM public.tasks
      WHERE id = v_task_id AND workspace_id = p_workspace_id
        AND deleted_at IS NULL AND status <> 'archived'
        AND recurrence IS NOT NULL
      FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF t.scheduled_at IS NOT NULL AND v_scheduled IS NOT NULL
       AND v_scheduled < t.scheduled_at THEN
      CONTINUE; -- never collapse backwards
    END IF;
    v_from := t.scheduled_at;
    UPDATE public.tasks
      SET status = coalesce(v_status, status),
          scheduled_at = coalesce(v_scheduled, scheduled_at),
          recurrence = coalesce(item -> 'recurrence', recurrence),
          committed_for = CASE WHEN coalesce((item ->> 'clear_commit')::boolean, false)
                               THEN NULL ELSE committed_for END,
          commit_order = CASE WHEN coalesce((item ->> 'clear_commit')::boolean, false)
                              THEN NULL ELSE commit_order END,
          updated_at = now()
      WHERE id = t.id
      RETURNING * INTO t;
    PERFORM public.module_activity_log(
      p_workspace_id, 'tasks', 'task', t.id, 'tasks.catch_up',
      jsonb_build_object('kind', v_kind, 'from', v_from, 'to', t.scheduled_at)
    );
    RETURN NEXT t;
  END LOOP;
  RETURN;
END;
$function$;

CREATE FUNCTION public.tasks_op_skip_occurrence(p_workspace_id uuid, p_task_id uuid, p_scheduled_at timestamp with time zone, p_recurrence jsonb, p_release_commit boolean DEFAULT false)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_from timestamptz;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF t.recurrence IS NULL THEN
    RAISE EXCEPTION 'Only recurring tasks have occurrences to skip.';
  END IF;
  IF t.status NOT IN ('todo', 'in_progress') THEN
    RAISE EXCEPTION 'Only open tasks can skip an occurrence.';
  END IF;
  IF p_scheduled_at IS NULL OR p_recurrence IS NULL THEN
    RAISE EXCEPTION 'Skip needs the next occurrence.';
  END IF;
  IF t.scheduled_at IS NOT NULL AND p_scheduled_at <= t.scheduled_at THEN
    RAISE EXCEPTION 'Skip can only move an occurrence forward.';
  END IF;
  v_from := t.scheduled_at;
  UPDATE public.tasks
    SET scheduled_at = p_scheduled_at,
        recurrence = p_recurrence,
        committed_for = CASE WHEN p_release_commit THEN NULL ELSE committed_for END,
        commit_order = CASE WHEN p_release_commit THEN NULL ELSE commit_order END,
        updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.skip_occurrence',
    jsonb_build_object('from', v_from, 'to', p_scheduled_at,
                       'next_occurrence', p_recurrence ->> 'nextOccurrence',
                       'released_commit', coalesce(p_release_commit, false))
  );
  RETURN t;
END;
$function$;

RESET check_function_bodies;

-- Production's grants on these (the internal perm helper is closed; the ops
-- are callable by signed-in users and the connector).
REVOKE ALL ON FUNCTION public.perm_can_view(uuid, text) FROM PUBLIC, anon;
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_commit(uuid, uuid, date)', 'tasks_op_uncommit(uuid, uuid)', 'tasks_op_skip_today(uuid, uuid)',
    'tasks_op_catch_up(uuid, jsonb)', 'tasks_op_skip_occurrence(uuid, uuid, timestamp with time zone, jsonb, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;
GRANT ALL ON public.buckets, public.module_activity, public.workspace_members TO service_role;

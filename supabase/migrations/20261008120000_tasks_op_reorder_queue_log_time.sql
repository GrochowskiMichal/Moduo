-- MCC-2: two intent ops for the Moduo-for-Claude-Code mod and any other agent
-- (specs/moduo-for-claude-code.md). Both follow the existing tasks_op_* shape:
-- permission + workspace scoping through tasks_op__guard, an attributed
-- module_activity row, and execute for authenticated users and the connector.

-- ── tasks.reorder_queue ──────────────────────────────────────────────────────
-- The named tasks trade the queue slots they already hold: their current
-- commit_orders, sorted, are handed out in the requested order. Tasks that are
-- not named (other people's, or ones the caller can't see) are never written
-- or moved, so a reorder can't be blocked by, or disturb, someone else's rows.
-- Every named task must be live, in this workspace, committed for p_for and
-- editable by the caller. Only the named tasks are returned.
CREATE OR REPLACE FUNCTION public.tasks_op_reorder_queue(
  p_workspace_id uuid,
  p_for date,
  p_task_ids uuid[]
)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_distinct integer;
  v_found integer;
  v_id uuid;
BEGIN
  IF p_for IS NULL THEN
    RAISE EXCEPTION 'Reorder needs a date.';
  END IF;
  v_count := coalesce(array_length(p_task_ids, 1), 0);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Reorder needs at least one task.';
  END IF;
  SELECT count(DISTINCT x) INTO v_distinct FROM unnest(p_task_ids) AS x;
  IF v_distinct <> v_count THEN
    RAISE EXCEPTION 'Reorder lists a task more than once.';
  END IF;
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  -- Lock the day's queue in id order first, so concurrent reorders (which may
  -- list the same tasks in different orders) can't deadlock.
  PERFORM 1 FROM public.tasks
    WHERE workspace_id = p_workspace_id AND committed_for = p_for AND deleted_at IS NULL
    ORDER BY id
    FOR UPDATE;
  FOREACH v_id IN ARRAY p_task_ids LOOP
    PERFORM public.tasks_op__guard(p_workspace_id, v_id);
    IF NOT public.can_access('task', v_id, 'edit') THEN
      RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_found FROM public.tasks
    WHERE workspace_id = p_workspace_id AND committed_for = p_for AND deleted_at IS NULL
      AND id = ANY (p_task_ids);
  IF v_found <> v_count THEN
    RAISE EXCEPTION 'Every task must be in that day''s queue.';
  END IF;

  UPDATE public.tasks t
    SET commit_order = m.slot, updated_at = now()
    FROM (
      SELECT want.task_id, have.slot
      FROM unnest(p_task_ids) WITH ORDINALITY AS want(task_id, rn)
      JOIN (
        SELECT slot, row_number() OVER (ORDER BY slot, id) AS rn
        FROM (
          SELECT id, coalesce(commit_order, 0) AS slot FROM public.tasks
          WHERE workspace_id = p_workspace_id AND committed_for = p_for
            AND deleted_at IS NULL AND id = ANY (p_task_ids)
        ) named
      ) have ON have.rn = want.rn
    ) m
    WHERE t.id = m.task_id AND t.commit_order IS DISTINCT FROM m.slot;

  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', p_task_ids[1], 'tasks.reorder_queue',
    jsonb_build_object('for', p_for, 'task_ids', to_jsonb(p_task_ids))
  );

  RETURN QUERY
    SELECT * FROM public.tasks
    WHERE workspace_id = p_workspace_id AND committed_for = p_for AND deleted_at IS NULL
      AND id = ANY (p_task_ids)
    ORDER BY commit_order;
END;
$$;

-- ── tasks.log_time ───────────────────────────────────────────────────────────
-- Adds work time to time_spent_seconds. One log is 1 second to 4 hours, so a
-- laptop that slept can't write a day of focus time in one call.
CREATE OR REPLACE FUNCTION public.tasks_op_log_time(
  p_workspace_id uuid,
  p_task_id uuid,
  p_seconds integer
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF p_seconds IS NULL OR p_seconds < 1 OR p_seconds > 14400 THEN
    RAISE EXCEPTION 'Logged time must be between 1 second and 4 hours.';
  END IF;
  UPDATE public.tasks
    SET time_spent_seconds = time_spent_seconds + p_seconds, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  -- Focus logs every few minutes: fold logs by the same actor on the same task
  -- within 30 minutes into one trail row so the trail stays readable.
  UPDATE public.module_activity
    SET payload = jsonb_build_object(
          'seconds', coalesce((payload->>'seconds')::integer, 0) + p_seconds,
          'total_seconds', t.time_spent_seconds),
        created_at = now()
    WHERE id = (
      SELECT a.id FROM public.module_activity a
      WHERE a.workspace_id = p_workspace_id AND a.module = 'tasks'
        AND a.entity_type = 'task' AND a.entity_id = t.id AND a.op = 'tasks.log_time'
        AND a.actor_id IS NOT DISTINCT FROM coalesce(auth.uid(), public.module_api_key_id())
        AND a.created_at > now() - interval '30 minutes'
      ORDER BY a.created_at DESC LIMIT 1
    );
  IF NOT FOUND THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'tasks', 'task', t.id, 'tasks.log_time',
      jsonb_build_object('seconds', p_seconds, 'total_seconds', t.time_spent_seconds)
    );
  END IF;
  RETURN t;
END;
$$;

-- New functions pick up Supabase's default EXECUTE for anon/authenticated:
-- close it to everyone, then grant the two roles that call ops.
REVOKE ALL ON FUNCTION public.tasks_op_reorder_queue(uuid, date, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasks_op_reorder_queue(uuid, date, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.tasks_op_reorder_queue(uuid, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_op_reorder_queue(uuid, date, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.tasks_op_log_time(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasks_op_log_time(uuid, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.tasks_op_log_time(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_op_log_time(uuid, uuid, integer) TO service_role;

-- CAL-7 validator fixes (two families):
--
-- 1) API-key-aware module permissions. calendar/contacts/spine_module_permission
--    resolved permission ONLY via auth.uid(), which is NULL under the MCP
--    connector's service-role JWT — so every agent WRITE through those modules'
--    ops raised "no edit access" even with a properly-scoped key. Each function
--    gains the module_api_key_id() branch tasks_module_permission has had since
--    20260612160000, reading the key's own module scope ('calendar' | 'contacts'
--    | 'links'). Member/owner resolution is unchanged (all still ride the Tasks
--    permission lane at alpha for humans).
--
-- 2) tasks_op_reschedule schedules from NULL. The old guard quietly no-op'd
--    when the task had nothing scheduled ("triage race"), which made the
--    connector's calendar_schedule_task a phantom success for exactly the case
--    it's named for (scheduling an unscheduled task). Scheduling from NULL now
--    sets the time (activity logs {"from": null, ...}); the race-case behavior
--    change is benign — the clicking/calling intent was "put it at this time".
--    (App callers only ever call it on already-scheduled tasks; verified CAL-4.)

-- ── 1a) calendar ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_key uuid;
BEGIN
  v_key := public.module_api_key_id();
  IF v_key IS NOT NULL THEN
    RETURN coalesce((
      SELECT CASE lower(coalesce(k.scopes ->> 'calendar', 'none'))
        WHEN 'edit' THEN 'edit'
        WHEN 'view' THEN 'view'
        ELSE 'none'
      END
      FROM public.workspace_api_keys k
      WHERE k.id = v_key AND k.workspace_id = p_workspace_id
        AND k.revoked_at IS NULL
    ), 'none');
  END IF;
  RETURN (SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(m.permissions_tasks, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END);
END;
$$;

-- ── 1b) contacts ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contacts_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_key uuid;
BEGIN
  v_key := public.module_api_key_id();
  IF v_key IS NOT NULL THEN
    RETURN coalesce((
      SELECT CASE lower(coalesce(k.scopes ->> 'contacts', 'none'))
        WHEN 'edit' THEN 'edit'
        WHEN 'view' THEN 'view'
        ELSE 'none'
      END
      FROM public.workspace_api_keys k
      WHERE k.id = v_key AND k.workspace_id = p_workspace_id
        AND k.revoked_at IS NULL
    ), 'none');
  END IF;
  RETURN (SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(m.permissions_tasks, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END);
END;
$$;

-- ── 1c) spine (links) ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.spine_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_key uuid;
BEGIN
  v_key := public.module_api_key_id();
  IF v_key IS NOT NULL THEN
    RETURN coalesce((
      SELECT CASE lower(coalesce(k.scopes ->> 'links', 'none'))
        WHEN 'edit' THEN 'edit'
        WHEN 'view' THEN 'view'
        ELSE 'none'
      END
      FROM public.workspace_api_keys k
      WHERE k.id = v_key AND k.workspace_id = p_workspace_id
        AND k.revoked_at IS NULL
    ), 'none');
  END IF;
  RETURN (SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(m.permissions_tasks, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END);
END;
$$;

-- ── 2) tasks_op_reschedule: schedule-from-NULL instead of quiet no-op ────────

CREATE OR REPLACE FUNCTION public.tasks_op_reschedule(
  p_workspace_id uuid,
  p_task_id uuid,
  p_scheduled_at timestamptz,
  p_days integer DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_from timestamptz;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Reschedule needs a new time.';
  END IF;
  -- v_from is NULL when the task had nothing scheduled — this now SCHEDULES it
  -- (the caller's intent) rather than silently returning unchanged.
  v_from := t.scheduled_at;
  UPDATE public.tasks
    SET scheduled_at = p_scheduled_at, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.reschedule',
    jsonb_build_object('from', v_from, 'to', p_scheduled_at, 'days', p_days)
  );
  RETURN t;
END;
$$;

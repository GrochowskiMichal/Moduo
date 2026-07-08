-- Intent ops + activity (improvement-plan Session 8; docs/moduo-module-contract.md).
--
-- Pillars implemented here:
--   1. Intent ops — tasks_op_* RPCs: permission check, invariants, write, and
--      an attributed activity row in ONE transaction. SECURITY DEFINER (that's
--      what lets ops write the append-only activity table clients can't touch);
--      workspace scoping is explicit inside each op.
--   2. Actor attribution — derived server-side from auth.uid(), never accepted
--      from the client. v1 grants ops to `authenticated` only, so actor_type is
--      always 'user'; 'agent' / 'api_key' are reserved for Session 9's keys.
--   3. Activity — one shared, cross-module, append-only `module_activity`
--      table. SELECT for workspace members; no insert/update/delete policies.
--   4. Permission mapping — tasks_module_permission() normalizes the existing
--      none/view/edit/admin ladder (legacy 'write'/'read' accepted); ops
--      require edit+. RLS alone only checked membership, not level.
--
-- Occurrence math (rrule) stays in the client engine; ops enforce structural
-- invariants only: forward-only moves, recurring-only, commit release, atomic
-- counters (see the contract doc, Pillar 1).

-- ── Pillar 4: permission helper ──────────────────────────────────────────────
-- SECURITY DEFINER so membership lookup bypasses RLS and can't recurse (same
-- pattern as tasks_module_can_access_workspace).
CREATE OR REPLACE FUNCTION public.tasks_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
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
        ELSE 'edit'                -- unknown → the client's historical default
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END;
$$;

REVOKE ALL ON FUNCTION public.tasks_module_permission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tasks_module_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_module_permission(uuid) TO service_role;

-- ── Pillar 3: the shared activity table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.module_activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  module       text NOT NULL,
  entity_type  text NOT NULL,
  -- No FK: entities live in per-module tables; trail rows outlive hard deletes.
  entity_id    uuid NOT NULL,
  op           text NOT NULL,
  actor_type   text NOT NULL CHECK (actor_type IN ('user', 'agent', 'api_key')),
  actor_id     uuid,
  actor_label  text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS module_activity_entity_idx
  ON public.module_activity (workspace_id, module, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS module_activity_workspace_idx
  ON public.module_activity (workspace_id, created_at DESC);

ALTER TABLE public.module_activity ENABLE ROW LEVEL SECURITY;

-- Append-only: members read; nobody writes directly (ops are SECURITY DEFINER).
DROP POLICY IF EXISTS module_activity_workspace_read ON public.module_activity;
CREATE POLICY module_activity_workspace_read ON public.module_activity
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

-- ── Pillar 2: the attributed log helper (op-internal, not client-callable) ───
CREATE OR REPLACE FUNCTION public.module_activity_log(
  p_workspace_id uuid,
  p_module text,
  p_entity_type text,
  p_entity_id uuid,
  p_op text,
  p_payload jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (
    p_workspace_id, p_module, p_entity_type, p_entity_id, p_op,
    'user',
    auth.uid(),
    (SELECT p.display_name FROM public.profiles p WHERE p.id = auth.uid()),
    coalesce(p_payload, '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.module_activity_log(uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.module_activity_log(uuid, text, text, uuid, text, jsonb) FROM authenticated;

-- ── op-internal guard: permission + scoped, live, locked task row ────────────
CREATE OR REPLACE FUNCTION public.tasks_op__guard(p_workspace_id uuid, p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  SELECT * INTO t FROM public.tasks
    WHERE id = p_task_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  RETURN t;
END;
$$;

REVOKE ALL ON FUNCTION public.tasks_op__guard(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasks_op__guard(uuid, uuid) FROM authenticated;

-- ── tasks.commit ──────────────────────────────────────────────────────────────
-- Adds the task to p_for's queue at the end (order race-safe under the row
-- lock); recommitting an already-committed task moves it to the end (Do last).
CREATE OR REPLACE FUNCTION public.tasks_op_commit(
  p_workspace_id uuid,
  p_task_id uuid,
  p_for date
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ── tasks.uncommit ───────────────────────────────────────────────────────────
-- Idempotent; un-commit is never intercepted (spec §5c).
CREATE OR REPLACE FUNCTION public.tasks_op_uncommit(
  p_workspace_id uuid,
  p_task_id uuid
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ── tasks.skip_today ─────────────────────────────────────────────────────────
-- Execute's Skip: leave today's queue + reschedule_count++ in one atomic step
-- (the ambient mirror counter never races between devices).
CREATE OR REPLACE FUNCTION public.tasks_op_skip_today(
  p_workspace_id uuid,
  p_task_id uuid
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
$$;

-- ── tasks.set_status ─────────────────────────────────────────────────────────
-- Status change with the recurrence pointer ride-along (advance-on-done, spec
-- §5d — pointer computed by the caller's engine, applied only on recurring
-- tasks) and an optional board position (drag-to-column appends).
CREATE OR REPLACE FUNCTION public.tasks_op_set_status(
  p_workspace_id uuid,
  p_task_id uuid,
  p_status text,
  p_recurrence jsonb DEFAULT NULL,
  p_position text DEFAULT NULL
)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_from text;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF p_status IS NULL OR p_status NOT IN ('todo', 'in_progress', 'done', 'archived') THEN
    RAISE EXCEPTION 'Unknown task status.';
  END IF;
  IF t.status = p_status AND p_position IS NULL AND p_recurrence IS NULL THEN
    RETURN t; -- no-op
  END IF;
  v_from := t.status;
  UPDATE public.tasks
    SET status = p_status,
        -- structural guard: the pointer only rides along on recurring tasks
        recurrence = CASE WHEN p_recurrence IS NOT NULL AND t.recurrence IS NOT NULL
                          THEN p_recurrence ELSE recurrence END,
        position = coalesce(p_position, position),
        updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  IF v_from <> t.status THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'tasks', 'task', t.id, 'tasks.set_status',
      jsonb_build_object('from', v_from, 'to', t.status,
                         'next_occurrence', p_recurrence ->> 'nextOccurrence')
    );
  END IF;
  RETURN t;
END;
$$;

-- ── tasks.reschedule ─────────────────────────────────────────────────────────
-- Drift-triage Reschedule: move the scheduled time (caller preserves the clock
-- time, spec §4). Never touches reschedule_count — that mirror counts skips
-- out of today, not triage.
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
  IF t.scheduled_at IS NULL THEN
    RETURN t; -- nothing scheduled to move (triage race) — quiet no-op
  END IF;
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

-- ── tasks.unschedule ─────────────────────────────────────────────────────────
-- Drift-triage Ignore: drop the stale scheduled time, keep the task (spec §4).
CREATE OR REPLACE FUNCTION public.tasks_op_unschedule(
  p_workspace_id uuid,
  p_task_id uuid
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
  IF t.scheduled_at IS NULL THEN
    RETURN t; -- already unscheduled
  END IF;
  v_from := t.scheduled_at;
  UPDATE public.tasks
    SET scheduled_at = NULL, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.unschedule',
    jsonb_build_object('from', v_from)
  );
  RETURN t;
END;
$$;

-- ── tasks.skip_occurrence ────────────────────────────────────────────────────
-- Jump an open recurring task past its pending occurrence (spec §5d). Forward-
-- only; the caller's engine computes the datetimes; never touches
-- reschedule_count (a skipped occurrence is a decision, not a slip).
CREATE OR REPLACE FUNCTION public.tasks_op_skip_occurrence(
  p_workspace_id uuid,
  p_task_id uuid,
  p_scheduled_at timestamptz,
  p_recurrence jsonb,
  p_release_commit boolean DEFAULT false
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
$$;

-- ── tasks.catch_up ───────────────────────────────────────────────────────────
-- The batched engine pass on app open / reload (spec §5d): one RPC, not N.
-- Items: [{task_id, kind: 'reopen'|'collapse'|'adopt', status?, scheduled_at?,
-- recurrence, clear_commit?}]. Applies only to live, recurring, non-archived
-- tasks; items that would move scheduled_at backwards are skipped (defensive
-- idempotency — a stale tab can't undo a fresher one). Returns updated rows.
CREATE OR REPLACE FUNCTION public.tasks_op_catch_up(
  p_workspace_id uuid,
  p_items jsonb
)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ── grants ───────────────────────────────────────────────────────────────────
-- Ops are callable by signed-in users only (v1). The service-role / API-key
-- grant arrives with Session 9's scoped-key model (contract Pillar 2).
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_commit(uuid, uuid, date)',
    'tasks_op_uncommit(uuid, uuid)',
    'tasks_op_skip_today(uuid, uuid)',
    'tasks_op_set_status(uuid, uuid, text, jsonb, text)',
    'tasks_op_reschedule(uuid, uuid, timestamptz, integer)',
    'tasks_op_unschedule(uuid, uuid)',
    'tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean)',
    'tasks_op_catch_up(uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;

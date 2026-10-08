-- TV-D3 · Time entries (specs/tasks-v2.md block 5).
--
-- Until now a task's tracked time was one number, tasks.time_spent_seconds,
-- written as an absolute total by whoever saved last. Two devices, or a stale
-- copy of the task, could overwrite each other's time.
--   * task_time_entries: one row per tracked stretch (focus, or waiting on
--     handed-off work), per correction (adjustment), and one legacy row per
--     task for the total it had before this migration. Who, when, how long.
--   * tasks_op_track_time is the only writer: it appends a stretch, appends an
--     adjustment (or the one that makes the total what was typed), or removes
--     your own adjustment (Undo). A save sent twice (a reload or a lost answer
--     makes the app resend it) carries the same key and is recorded once.
--   * A task's total is everything except waiting time. tasks.time_spent_seconds
--     keeps that total, so every surface and old app versions read the same
--     number. The op writes only that column: never the rest of the row, never
--     updated_at, so it can't put back anyone's edit.
--   * Totals: everyone who can see a task sees its total; tasks_time_totals adds
--     the caller's own share. Raw entries are readable by their author only.
--   * Old app versions keep writing time_spent_seconds. A trigger turns each
--     write into an adjustment that lands the total on the value written, except
--     a lower value from a whole-row save (an upsert of a task that exists, how
--     builds from before TV-D1 save every edit): its copy of the total may be
--     stale, so the total stays. Lowering the time still works from those builds
--     only through their time field, which current builds no longer write.
--   * Time ops write no module_activity rows: the entry table is the attributed
--     log (spec decision 5).
--
-- Deviation from the spec's wording ("opens/heartbeats/closes the caller's open
-- entry"): the Focus engine (TV-F1) keeps the clock on the device and saves
-- finished stretches every minute, so the op appends closed stretches and there
-- are no open entries to expire. Recorded in docs/decisions/tasks.md.
--
-- Expand only: time_spent_seconds and the shim stay until TV-D7.

-- ── 0. Preconditions ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regprocedure('public.can_access(text, uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.perm_actor_id()') IS NULL
     OR to_regprocedure('public.tasks_module_permission(uuid)') IS NULL
     OR to_regprocedure('public.perm_can_view(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'The sharing model (can_access, perm_actor_id, perm_can_view) must be applied first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tasks'
                   AND column_name = 'time_spent_seconds') THEN
    RAISE EXCEPTION 'tasks.time_spent_seconds (20260615120000_tasks_add_time_spent) must exist.';
  END IF;
END;
$$;

-- ── 1. The table ─────────────────────────────────────────────────────────────

CREATE TABLE public.task_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  -- Who tracked it. Deleting an account keeps its seconds in the task's total
  -- and forgets whose they were. NULL also on the legacy row (nobody knows).
  user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  kind text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  -- Signed: an adjustment can take time away.
  seconds integer NOT NULL,
  -- The Focus run it belongs to (TV-F2 adds focus_runs and its foreign key).
  run_id uuid,
  -- The app's key for one save, so a resend is recorded once.
  client_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_time_entries_kind_check CHECK (kind IN ('focus','waiting','adjustment','legacy')),
  CONSTRAINT task_time_entries_shape CHECK (
    (kind IN ('focus', 'waiting') AND seconds > 0
       AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at)
    OR (kind = 'adjustment' AND seconds <> 0)
    OR (kind = 'legacy' AND seconds > 0)
  ),
  CONSTRAINT task_time_entries_seconds_range CHECK (seconds BETWEEN -315360000 AND 315360000),
  CONSTRAINT task_time_entries_client_key_format
    CHECK (client_key IS NULL OR client_key ~ '^[A-Za-z0-9_-]{8,64}$')
);
CREATE INDEX task_time_entries_task_idx ON public.task_time_entries (task_id);
CREATE INDEX task_time_entries_user_idx ON public.task_time_entries (user_id, ended_at);
CREATE UNIQUE INDEX task_time_entries_client_key_key
  ON public.task_time_entries (task_id, client_key) WHERE client_key IS NOT NULL;
CREATE UNIQUE INDEX task_time_entries_one_legacy_key
  ON public.task_time_entries (task_id) WHERE kind = 'legacy';

COMMENT ON TABLE public.task_time_entries IS
  'Tracked time on tasks (TV-D3): focus and waiting stretches, adjustments, and one legacy row per task for its total before entries existed. Written only by tasks_op_track_time (and the time_spent_seconds shim for old app versions); each person reads their own rows, totals come from tasks_time_totals.';
COMMENT ON COLUMN public.task_time_entries.seconds IS
  'Length of the stretch, or the signed correction (adjustment). A task''s total is the sum of everything but waiting, never below zero.';

-- ── 2. Who can read it, who can write it ─────────────────────────────────────
-- Each person reads their own entries; nobody sees anyone else's share. Writes
-- only through the definer op and triggers below.

ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_time_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_time_entries TO authenticated;
GRANT ALL ON public.task_time_entries TO service_role;

CREATE POLICY task_time_entries_read_own ON public.task_time_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.perm_can_view(workspace_id, 'tasks'));

-- ── 3. Helpers ───────────────────────────────────────────────────────────────

-- A task's total: every entry but waiting, never below zero.
CREATE OR REPLACE FUNCTION public.tasks_time__total(p_task_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT least(greatest(coalesce(sum(e.seconds), 0), 0), 2147483647)::integer
  FROM public.task_time_entries e
  WHERE e.task_id = p_task_id AND e.kind <> 'waiting'
$$;

-- A person's share of it: their focus and adjustments, never below zero or
-- above the total.
CREATE OR REPLACE FUNCTION public.tasks_time__mine(p_task_id uuid, p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT least(greatest(coalesce(sum(e.seconds), 0), 0), public.tasks_time__total(p_task_id))::integer
  FROM public.task_time_entries e
  WHERE e.task_id = p_task_id AND e.user_id = p_user AND e.kind IN ('focus', 'adjustment')
$$;

-- Write the total to tasks.time_spent_seconds, and nothing else on the row.
-- The setting tells the shim (§6) this isn't an old app's write.
CREATE OR REPLACE FUNCTION public.tasks_time__store_total(p_task_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total integer := public.tasks_time__total(p_task_id);
BEGIN
  PERFORM set_config('tasks.time_op', 'op', true);
  UPDATE public.tasks SET time_spent_seconds = v_total
  WHERE id = p_task_id AND time_spent_seconds IS DISTINCT FROM v_total;
  PERFORM set_config('tasks.time_op', '', true);
  RETURN v_total;
END;
$$;

-- What the op answers: the task's total and the caller's share.
CREATE OR REPLACE FUNCTION public.tasks_time__answer(p_task_id uuid, p_user uuid, p_status text, p_entry_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status', p_status,
    'task_id', p_task_id,
    'entry_id', p_entry_id,
    'total_seconds', public.tasks_time__total(p_task_id),
    'my_seconds', public.tasks_time__mine(p_task_id, p_user),
    'my_waiting_seconds', (SELECT coalesce(sum(e.seconds), 0)::integer
                           FROM public.task_time_entries e
                           WHERE e.task_id = p_task_id AND e.user_id = p_user AND e.kind = 'waiting'))
$$;

-- ── 4. The op ────────────────────────────────────────────────────────────────
-- p_action:
--   'focus' / 'waiting'  a finished stretch of p_seconds (1 s … 7 days) that
--                        ended at p_ended_at (now when NULL; never later than
--                        now, never more than a year back);
--   'adjust'             add p_seconds (signed); taking away stops at zero;
--   'set_total'          the adjustment that makes the total p_seconds (none
--                        when it already is);
--   'undo'               remove your own adjustment p_entry_id.
-- p_client_key: the app's key for this save. The same key on the same task is
-- recorded once; a resend answers 'duplicate' with the first entry.
-- Answers {status, task_id, entry_id, total_seconds, my_seconds,
-- my_waiting_seconds}; status 'saved', 'duplicate', 'noop' (nothing to
-- change), or 'gone' (no such task in this workspace that you can see:
-- deleted for good, or not shared with you any more). A task in the trash
-- still takes its time, so it's there when the delete is undone.

CREATE OR REPLACE FUNCTION public.tasks_op_track_time(
  p_workspace_id uuid,
  p_task_id uuid,
  p_action text,
  p_seconds integer DEFAULT NULL,
  p_ended_at timestamptz DEFAULT NULL,
  p_client_key text DEFAULT NULL,
  p_entry_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_action text := lower(coalesce(p_action, ''));
  t public.tasks;
  v_entry uuid;
  v_seconds integer;
  v_ended timestamptz;
  v_status text := 'saved';
BEGIN
  IF v_action NOT IN ('focus','waiting','adjust','set_total','undo') THEN
    RAISE EXCEPTION 'Unknown time action: %', p_action USING ERRCODE = '22023';
  END IF;
  IF v_action IN ('focus', 'waiting') AND (p_seconds IS NULL OR p_seconds < 1 OR p_seconds > 604800) THEN
    RAISE EXCEPTION 'A tracked stretch is between a second and a week long.' USING ERRCODE = '22023';
  ELSIF v_action = 'adjust' AND (p_seconds IS NULL OR p_seconds = 0 OR abs(p_seconds) > 315360000) THEN
    RAISE EXCEPTION 'An adjustment needs a number of seconds.' USING ERRCODE = '22023';
  ELSIF v_action = 'set_total' AND (p_seconds IS NULL OR p_seconds < 0 OR p_seconds > 315360000) THEN
    RAISE EXCEPTION 'The total can''t be negative.' USING ERRCODE = '22023';
  ELSIF v_action = 'undo' AND p_entry_id IS NULL THEN
    RAISE EXCEPTION 'Undo needs the adjustment to remove.' USING ERRCODE = '22023';
  END IF;
  IF p_client_key IS NOT NULL AND p_client_key !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION 'That save key isn''t valid.' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Tracked time belongs to a person: sign in, or use an API key.' USING ERRCODE = '42501';
  END IF;
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;

  -- The task, locked: writes to one task's time go one at a time, so a resend
  -- waits for the first copy and then finds it.
  SELECT * INTO t FROM public.tasks
  WHERE id = p_task_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
    RETURN jsonb_build_object('status', 'gone', 'task_id', p_task_id);
  END IF;
  IF NOT public.can_access('task', t.id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
  END IF;

  IF p_client_key IS NOT NULL AND v_action <> 'undo' THEN
    SELECT e.id INTO v_entry FROM public.task_time_entries e
    WHERE e.task_id = t.id AND e.client_key = p_client_key;
    IF FOUND THEN
      RETURN public.tasks_time__answer(t.id, v_actor, 'duplicate', v_entry);
    END IF;
  END IF;

  IF v_action IN ('focus', 'waiting') THEN
    v_ended := least(coalesce(p_ended_at, now()), now());
    IF v_ended < now() - interval '1 year' THEN
      v_ended := now();
    END IF;
    INSERT INTO public.task_time_entries
      (workspace_id, task_id, user_id, kind, started_at, ended_at, seconds, client_key)
    VALUES
      (t.workspace_id, t.id, v_actor, v_action,
       v_ended - make_interval(secs => p_seconds), v_ended, p_seconds, p_client_key)
    RETURNING id INTO v_entry;
  ELSIF v_action IN ('adjust', 'set_total') THEN
    IF v_action = 'adjust' THEN
      v_seconds := greatest(p_seconds, -public.tasks_time__total(t.id));
    ELSE
      v_seconds := p_seconds - public.tasks_time__total(t.id);
    END IF;
    IF v_seconds = 0 THEN
      v_status := 'noop';
    ELSE
      INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds, client_key)
      VALUES (t.workspace_id, t.id, v_actor, 'adjustment', v_seconds, p_client_key)
      RETURNING id INTO v_entry;
    END IF;
  ELSE
    DELETE FROM public.task_time_entries e
    WHERE e.id = p_entry_id AND e.task_id = t.id AND e.user_id = v_actor AND e.kind = 'adjustment'
    RETURNING e.id INTO v_entry;
    IF v_entry IS NULL THEN
      v_status := 'noop';
    END IF;
  END IF;

  IF v_status <> 'noop' AND v_action <> 'waiting' THEN
    PERFORM public.tasks_time__store_total(t.id);
  END IF;
  RETURN public.tasks_time__answer(t.id, v_actor, v_status, v_entry);
END;
$$;

-- ── 5. Totals ────────────────────────────────────────────────────────────────
-- Per task the caller can see in the workspace (and that has any time): the
-- total, the caller's share, their waiting time, and with p_since their share
-- since then (Home's "this week"; legacy time has no date and never counts).

CREATE OR REPLACE FUNCTION public.tasks_time_totals(p_workspace_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS TABLE (
  task_id uuid,
  total_seconds integer,
  my_seconds integer,
  my_waiting_seconds integer,
  my_seconds_since integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH sums AS (
    SELECT e.task_id AS tid,
           least(greatest(coalesce(sum(e.seconds) FILTER (WHERE e.kind <> 'waiting'), 0), 0),
                 2147483647)::integer AS total,
           greatest(coalesce(sum(e.seconds) FILTER (
             WHERE e.user_id = v_actor AND e.kind IN ('focus', 'adjustment')), 0), 0) AS mine,
           coalesce(sum(e.seconds) FILTER (
             WHERE e.user_id = v_actor AND e.kind = 'waiting'), 0) AS waiting,
           greatest(coalesce(sum(e.seconds) FILTER (
             WHERE e.user_id = v_actor AND e.kind IN ('focus', 'adjustment')
               AND coalesce(e.ended_at, e.created_at) >= p_since), 0), 0) AS mine_since
    FROM public.task_time_entries e
    JOIN public.tasks t ON t.id = e.task_id
    WHERE e.workspace_id = p_workspace_id AND t.workspace_id = p_workspace_id
      AND t.deleted_at IS NULL
    GROUP BY e.task_id
  )
  SELECT s.tid,
         s.total,
         least(s.mine, s.total)::integer,
         least(s.waiting, 2147483647)::integer,
         CASE WHEN p_since IS NULL THEN NULL ELSE least(s.mine_since, s.total)::integer END
  FROM sums s
  WHERE public.can_access('task', s.tid, 'view', v_actor);
END;
$$;

-- ── 6. The legacy total: backfill, then old app versions' writes ─────────────
-- No task write may land between the backfill and the triggers, or its time
-- would be counted twice or not at all.

LOCK TABLE public.tasks IN SHARE ROW EXCLUSIVE MODE;

-- Every total there is today becomes the task's legacy entry (trashed tasks
-- too: a restore brings their time back).
INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds)
SELECT t.workspace_id, t.id, NULL, 'legacy', t.time_spent_seconds
FROM public.tasks t
WHERE t.time_spent_seconds > 0
ON CONFLICT (task_id) WHERE kind = 'legacy' DO NOTHING;

-- An old version (anything before TV-D3) writes time_spent_seconds as an
-- absolute total. Record the difference to the real total as the writer's
-- adjustment, so the total becomes what they wrote. A whole-row save (an upsert
-- of a task that exists: builds from before TV-D1 save every edit that way)
-- carries its copy of the total along, possibly stale: a lower value from one
-- is ignored, so nobody's tracked time is taken away by someone else's rename.
-- The upsert marks itself in its BEFORE INSERT pass; ON CONFLICT then runs the
-- UPDATE pass for the same row.
CREATE OR REPLACE FUNCTION public.tasks_time_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_upsert boolean;
  v_total integer;
  v_delta integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = NEW.id) THEN
      PERFORM set_config('tasks.time_upsert', NEW.id::text, true);
    END IF;
    RETURN NEW;
  END IF;

  v_upsert := current_setting('tasks.time_upsert', true) = NEW.id::text;
  IF v_upsert THEN
    PERFORM set_config('tasks.time_upsert', '', true);
  END IF;
  IF current_setting('tasks.time_op', true) = 'op'
     OR NEW.time_spent_seconds IS NOT DISTINCT FROM OLD.time_spent_seconds THEN
    RETURN NEW;
  END IF;
  v_total := public.tasks_time__total(NEW.id);
  v_delta := NEW.time_spent_seconds - v_total;
  IF v_upsert AND v_delta < 0 THEN
    NEW.time_spent_seconds := v_total;
    RETURN NEW;
  END IF;
  IF v_delta <> 0 THEN
    INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds)
    VALUES (NEW.workspace_id, NEW.id, public.perm_actor_id(), 'adjustment', v_delta);
  END IF;
  RETURN NEW;
END;
$$;

-- A task created with time already on it (an old version restoring or copying
-- one): that time is the creator's adjustment.
CREATE OR REPLACE FUNCTION public.tasks_time_legacy_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds)
  VALUES (NEW.workspace_id, NEW.id, public.perm_actor_id(), 'adjustment', NEW.time_spent_seconds);
  RETURN NULL;
END;
$$;

-- Named after perm_enforce_write, so a write it refuses never records time.
CREATE TRIGGER tasks_time_legacy_insert
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_time_legacy();
CREATE TRIGGER tasks_time_legacy_update
  BEFORE UPDATE OF time_spent_seconds ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_time_legacy();
CREATE TRIGGER tasks_time_legacy_created
  AFTER INSERT ON public.tasks
  FOR EACH ROW WHEN (NEW.time_spent_seconds > 0)
  EXECUTE FUNCTION public.tasks_time_legacy_created();

-- ── 7. Grants ────────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new functions to anon and authenticated directly,
-- so they are revoked by name (REVOKE … FROM PUBLIC alone leaves anon).
DO $$
DECLARE fn text;
BEGIN
  -- The op and the totals: signed-in users and the MCP connector (service role).
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_track_time(uuid, uuid, text, integer, timestamptz, text, uuid)',
    'tasks_time_totals(uuid, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Helpers and triggers: only the definer functions above call them.
  FOREACH fn IN ARRAY ARRAY[
    'tasks_time__total(uuid)',
    'tasks_time__mine(uuid, uuid)',
    'tasks_time__store_total(uuid)',
    'tasks_time__answer(uuid, uuid, text, uuid)',
    'tasks_time_legacy()',
    'tasks_time_legacy_created()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END;
$$;

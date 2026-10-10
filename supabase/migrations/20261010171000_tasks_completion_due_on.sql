-- TV-D9 · Completion and due dates (specs/tasks-v3.md block 9, §Assumptions
-- #4, #26, #27; REPLAN 77, 23, §6.4; decisions in docs/decisions/tasks.md
-- "TV-D9"). Applies after 20261010170000_project_statuses.
--
--   * tasks.completed_at / completed_by: when a task last entered a Done
--     status and who did it, kept by the server on every write path (cleared
--     when it leaves Done; the per-cycle history stays in task_completions,
--     which now also records a completion an old build writes directly).
--   * tasks.due_on (date) + tasks.due_time (time, optional): the due date is a
--     calendar date, the same for everyone. The old due_date (timestamptz)
--     stays until TV-D7 as a mirror both ways: a new write sets it to noon UTC
--     of due_on (which reads as that date from UTC-11 to UTC+11); an old
--     build's write of it sets due_on from the writer's zone. A due time is
--     the clock time in the task's zone (its assignee's, else its creator's).
--   * tasks_op_create / tasks_op_update take status_id, due_on and due_time
--     (a date-only due_date is read as due_on).
--   * The late state is computed on the server: tasks__late (Moduo's own
--     jobs) and tasks_late (a read for a task the caller can see). Backlog is
--     never late.
--   * Account erasure clears "completed by" in other people's workspaces.
--
-- Expand only: due_date and the legacy status stay until TV-D7. Verified on
-- the local stack by supabase/tests/dates.test.sql and statuses.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS completed_by uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_on date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_time time;
CREATE INDEX IF NOT EXISTS tasks_workspace_completed_at
  ON public.tasks (workspace_id, completed_at DESC) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_workspace_due_on
  ON public.tasks (workspace_id, due_on) WHERE due_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_completed_by
  ON public.tasks (completed_by) WHERE completed_by IS NOT NULL;

-- ── 2. Dates: zones and the date an instant stands for ──────────────────────

-- A person's saved zone (written by the app at every sign-in), or NULL.
CREATE OR REPLACE FUNCTION public.tasks__known_zone(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.time_zone FROM public.user_preferences p WHERE p.user_id = p_user
$$;

-- The calendar date a stored due instant stands for:
--   1. noon UTC is this migration's own mirror: its UTC date;
--   2. a local midnight in the zone we know (the writer's, or the task's
--      person's): that date (how the app has always written due dates);
--   3. anything else, or no zone: the nearest UTC day (a local midnight
--      anywhere from UTC-11 to UTC+12 lands on its own date, and so does the
--      UTC midnight an agent's "2026-11-08" became).
CREATE OR REPLACE FUNCTION public.tasks__due_on_of(p_at timestamptz, p_zone text)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_at IS NULL THEN NULL
    WHEN (p_at AT TIME ZONE 'UTC')::time = time '12:00' THEN (p_at AT TIME ZONE 'UTC')::date
    WHEN p_zone IS NOT NULL AND (p_at AT TIME ZONE p_zone)::time = time '00:00'
      THEN (p_at AT TIME ZONE p_zone)::date
    ELSE ((p_at + interval '12 hours') AT TIME ZONE 'UTC')::date
  END
$$;

-- The instant due_date mirrors for a due date: noon UTC.
CREATE OR REPLACE FUNCTION public.tasks__due_noon(p_on date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_on IS NULL THEN NULL ELSE (p_on + time '12:00') AT TIME ZONE 'UTC' END
$$;

-- ── 3. Backfill (before the triggers below exist) ───────────────────────────

-- Done tasks: their latest completion, else the trail's last "→ done", else
-- the last edit. Who: the completion's person, else the trail's.
UPDATE public.tasks t
SET completed_at = coalesce(
      (SELECT max(c.completed_at) FROM public.task_completions c
       WHERE c.task_id = t.id AND c.deleted_at IS NULL),
      (SELECT max(a.created_at) FROM public.module_activity a
       WHERE a.module = 'tasks' AND a.entity_type = 'task' AND a.entity_id = t.id
         AND a.op = 'tasks.set_status' AND a.payload ->> 'to' = 'done'),
      t.updated_at),
    completed_by = coalesce(
      (SELECT c.user_id FROM public.task_completions c
       WHERE c.task_id = t.id AND c.deleted_at IS NULL
       ORDER BY c.completed_at DESC, c.id DESC LIMIT 1),
      (SELECT a.actor_id FROM public.module_activity a
       WHERE a.module = 'tasks' AND a.entity_type = 'task' AND a.entity_id = t.id
         AND a.op = 'tasks.set_status' AND a.payload ->> 'to' = 'done' AND a.actor_type = 'user'
         AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = a.actor_id)
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1))
WHERE t.status_category = 'done' AND t.completed_at IS NULL;

-- Dated tasks: the date each due instant stands for, in the zone of the
-- task's person when we know it; due_date becomes that date's noon UTC.
UPDATE public.tasks t
SET due_on = d.on_date,
    due_date = public.tasks__due_noon(d.on_date)
FROM (SELECT x.id, public.tasks__due_on_of(x.due_date,
             public.tasks__known_zone(coalesce(x.assignee_id, x.owner_id))) AS on_date
      FROM public.tasks x
      WHERE x.due_date IS NOT NULL AND x.due_on IS NULL) d
WHERE t.id = d.id;

-- ── 4. Completion, kept by the status trigger ───────────────────────────────

-- 20261010170000's body, plus completion: entering a Done status stamps when
-- and who (the person, or the API key's person); leaving Done clears both;
-- otherwise they keep their stored values (a client can't write them). Moduo's
-- own work (no actor, or share.bypass) may set them, so account erasure can
-- clear "completed by".
CREATE OR REPLACE FUNCTION public.tasks__status_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_set uuid := public.tasks__status_set(NEW.bucket_id);
  s public.project_statuses;
  v_old public.project_statuses;
  v_cat text;
  v_system boolean := public.perm_actor_id() IS NULL OR coalesce(current_setting('share.bypass', true), '') = '1';
BEGIN
  IF NEW.status_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id) THEN
    SELECT * INTO s FROM public.project_statuses x WHERE x.id = NEW.status_id;
    IF NOT public.tasks__status_in_set(s, NEW.workspace_id, v_set) THEN
      RAISE EXCEPTION 'That status isn''t in this project.' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_cat := public.tasks__status_category_of(NEW.status);
    IF v_cat IS NULL THEN
      RAISE EXCEPTION 'Unknown task status.' USING ERRCODE = '22023';
    END IF;
    s := public.tasks__first_status(NEW.workspace_id, v_set, v_cat);
  ELSIF TG_OP = 'UPDATE' AND NEW.status_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.project_statuses x WHERE x.id = NEW.status_id;
    IF public.tasks__status_in_set(v_old, NEW.workspace_id, v_set) THEN
      s := v_old;
    ELSE
      -- Moved: the same name in the new project (same category), else the
      -- category's first status there.
      v_cat := coalesce(v_old.category, OLD.status_category,
                        public.tasks__status_category_of(OLD.status), 'todo');
      SELECT * INTO s FROM public.project_statuses x
      WHERE x.category = v_cat AND x.deleted_at IS NULL
        AND lower(btrim(x.name)) = lower(btrim(v_old.name))
        AND CASE WHEN v_set IS NULL THEN x.project_id IS NULL AND x.workspace_id = NEW.workspace_id
                 ELSE x.project_id = v_set END
      LIMIT 1;
      IF NOT FOUND THEN
        s := public.tasks__first_status(NEW.workspace_id, v_set, v_cat);
      END IF;
      -- The trail says so when the move changed the status's name (the
      -- project change is the op's own line).
      IF lower(btrim(s.name)) IS DISTINCT FROM lower(btrim(v_old.name))
         AND (auth.uid() IS NOT NULL OR public.module_api_key_id() IS NOT NULL) THEN
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.set_status',
          jsonb_build_object('from', OLD.status, 'to', public.tasks__legacy_status(s.category),
                             'from_category', v_cat, 'to_category', s.category,
                             'from_name', v_old.name, 'to_name', s.name, 'reason', 'moved'));
      END IF;
    END IF;
  ELSE
    v_cat := coalesce(public.tasks__status_category_of(NEW.status), 'todo');
    s := public.tasks__first_status(NEW.workspace_id, v_set, v_cat);
  END IF;

  -- Scheduling a backlog task moves it to To do (REPLAN 53).
  IF s.category = 'backlog' AND NEW.scheduled_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at) THEN
    s := public.tasks__first_status(NEW.workspace_id, v_set, 'todo');
    IF TG_OP = 'UPDATE' AND (auth.uid() IS NOT NULL OR public.module_api_key_id() IS NOT NULL) THEN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.set_status',
        jsonb_build_object('from', 'todo', 'to', 'todo',
                           'from_category', 'backlog', 'to_category', 'todo',
                           'to_name', s.name, 'reason', 'scheduled'));
    END IF;
  END IF;

  NEW.status_id := s.id;
  NEW.status_category := s.category;
  NEW.status := public.tasks__legacy_status(s.category);

  -- Completion (REPLAN 77).
  IF s.category = 'done' THEN
    IF TG_OP = 'INSERT' OR OLD.status_category IS DISTINCT FROM 'done' THEN
      NEW.completed_at := now();
      NEW.completed_by := public.perm_actor_id();
    ELSIF NOT v_system THEN
      NEW.completed_at := OLD.completed_at;
      NEW.completed_by := OLD.completed_by;
    END IF;
  ELSE
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_status_sync ON public.tasks;
CREATE TRIGGER tasks_status_sync
  BEFORE INSERT OR UPDATE OF status, status_id, status_category, bucket_id, scheduled_at,
    completed_at, completed_by ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__status_sync();

-- The per-cycle history for every path that finishes a task: the status op
-- records it itself (and takes it back on a reopen), and so does the create op
-- for a task created done; this adds an old build's direct status write. One
-- per cycle, so the op's own record and this one never double up.
CREATE OR REPLACE FUNCTION public.tasks__completion_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status_category = 'done' AND NEW.deleted_at IS NULL
     AND OLD.status_category IS DISTINCT FROM 'done' THEN
    PERFORM public.tasks__record_completion(NEW, coalesce(NEW.completed_at, now()));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_completion_record ON public.tasks;
CREATE TRIGGER tasks_completion_record
  AFTER UPDATE OF status, status_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__completion_record();

-- ── 5. The due date mirror ───────────────────────────────────────────────────

-- due_on / due_time lead when they're written; else an old build's write of
-- due_date sets due_on from the writer's zone (else the task's person's).
-- due_date always ends as due_on's noon UTC; no date clears the time.
CREATE OR REPLACE FUNCTION public.tasks__due_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.due_on IS NULL AND NEW.due_date IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.due_on IS NOT DISTINCT FROM OLD.due_on
         AND NEW.due_time IS NOT DISTINCT FROM OLD.due_time
         AND NEW.due_date IS DISTINCT FROM OLD.due_date) THEN
    v_zone := coalesce(public.tasks__known_zone(public.perm_actor_id()),
                       public.tasks__known_zone(coalesce(NEW.assignee_id, NEW.owner_id)));
    NEW.due_on := public.tasks__due_on_of(NEW.due_date, v_zone);
  END IF;
  IF NEW.due_on IS NULL THEN
    NEW.due_time := NULL;
  END IF;
  NEW.due_date := public.tasks__due_noon(NEW.due_on);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_due_sync ON public.tasks;
CREATE TRIGGER tasks_due_sync
  BEFORE INSERT OR UPDATE OF due_date, due_on, due_time ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__due_sync();

-- ── 6. The ops take status_id, due_on and due_time ──────────────────────────

-- A date-only due_date ("2026-11-08", how agents often send it) is a due_on.
CREATE OR REPLACE FUNCTION public.tasks__date_only(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_value ~ '^\s*\d{4}-\d{2}-\d{2}\s*$' THEN
    RETURN btrim(p_value)::date;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'That isn''t a date: %.', p_value USING ERRCODE = '22007';
END;
$$;

-- Production's body (TV-D8's 20261010160000, read from the catalog on
-- 2026-10-10), plus: status_id, due_on and due_time; the status (an id, a
-- category word or a project's status name) is read in the task's project;
-- a date-only due_date is the due date itself.
CREATE OR REPLACE FUNCTION public.tasks_op_create(p_workspace_id uuid, p_task jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_id uuid;
  v_bucket uuid;
  v_assignee uuid;
  v_status public.project_statuses;
  v_due_on date;
  v_due_date timestamptz;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_task, ARRAY[
    'id', 'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on', 'due_time',
    'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level', 'priority', 'status',
    'status_id', 'position', 'assignee_id']);

  v_id := coalesce(nullif(p_task ->> 'id', '')::uuid, gen_random_uuid());
  SELECT * INTO t FROM public.tasks WHERE id = v_id;
  IF FOUND THEN
    -- A resend of a create that landed: answer with that task.
    IF t.workspace_id IS DISTINCT FROM p_workspace_id
       OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.';
    END IF;
    RETURN t;
  END IF;

  PERFORM public.tasks__check_recurrence(public.tasks__json_object(p_task -> 'recurrence'));

  v_bucket := nullif(p_task ->> 'bucket_id', '')::uuid;
  IF v_bucket IS NULL THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'A task needs a project.';
    END IF;
    v_bucket := public.tasks__inbox(p_workspace_id, v_actor);
  ELSE
    PERFORM public.tasks__check_bucket(p_workspace_id, v_bucket);
  END IF;
  v_status := public.tasks__resolve_status(p_workspace_id, v_bucket,
    coalesce(nullif(p_task ->> 'status_id', ''), nullif(p_task ->> 'status', ''), 'todo'), NULL);

  IF p_task ? 'assignee_id' THEN
    v_assignee := nullif(p_task ->> 'assignee_id', '')::uuid;
  ELSE
    v_assignee := v_actor;
  END IF;
  IF v_assignee IS DISTINCT FROM v_actor THEN
    PERFORM public.tasks__check_assignee(p_workspace_id, v_assignee);
  END IF;
  PERFORM public.tasks__check_parent(p_workspace_id, nullif(p_task ->> 'parent_id', '')::uuid);

  IF p_task ? 'due_on' THEN
    v_due_on := nullif(p_task ->> 'due_on', '')::date;
  ELSE
    v_due_on := public.tasks__date_only(p_task ->> 'due_date');
    IF v_due_on IS NULL THEN
      v_due_date := (p_task ->> 'due_date')::timestamptz;
    END IF;
  END IF;

  -- perm_enforce_write checks the creator's role and the project; the number,
  -- creator, registry entry and any assignment notice come from the triggers.
  INSERT INTO public.tasks (
    id, workspace_id, bucket_id, parent_id, title, description, due_date, due_on, due_time,
    scheduled_at, duration_minutes, recurrence, energy_level, priority, status, status_id,
    position, assignee_id, owner_id, created_at, updated_at)
  VALUES (
    v_id, p_workspace_id, v_bucket, nullif(p_task ->> 'parent_id', '')::uuid,
    coalesce(p_task ->> 'title', ''), coalesce(p_task ->> 'description', ''),
    v_due_date, v_due_on, nullif(p_task ->> 'due_time', '')::time,
    (p_task ->> 'scheduled_at')::timestamptz,
    (p_task ->> 'duration_minutes')::numeric::integer,
    public.tasks__json_object(p_task -> 'recurrence'),
    nullif(p_task ->> 'energy_level', ''), nullif(p_task ->> 'priority', ''),
    public.tasks__legacy_status(v_status.category), v_status.id,
    coalesce(nullif(p_task ->> 'position', ''), public.tasks__end_position(v_bucket)),
    v_assignee, v_actor, now(), now())
  RETURNING * INTO t;

  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.create',
    jsonb_build_object('title', t.title, 'number', t.number, 'bucket_id', t.bucket_id));
  IF t.status_category = 'done' THEN
    PERFORM public.tasks__created_done(t);
  END IF;
  RETURN t;
END;
$function$;

-- Production's body (TV-D8's 20261010160000, read from the catalog on
-- 2026-10-10), plus: status_id (through the status path, like status),
-- due_on and due_time (a date-only due_date is a due_on); the trail line for
-- a date says the day as well as the mirrored instant.
CREATE OR REPLACE FUNCTION public.tasks_op_update(p_workspace_id uuid, p_task_id uuid, p_patch jsonb)
 RETURNS SETOF tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.tasks;
  t0 public.tasks;
  c public.tasks;
  v_carried public.tasks[] := '{}';
  v_restore boolean;
  v_delete boolean;
  v_fields text[] := '{}';
  v_payload jsonb := '{}';
  -- Who the trail row names: the person, or the API key.
  v_actor uuid := coalesce(public.module_api_key_id(), public.perm_actor_id());
  v_field text;
  v_bypass text;
  v_due_on date;
  v_set_due_on boolean;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on', 'due_time',
    'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level', 'priority', 'position',
    'status', 'status_id', 'assignee_id', 'deleted_at', 'committed_for', 'commit_order',
    'reschedule_count']);

  SELECT * INTO t FROM public.tasks
  WHERE id = p_task_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  v_restore := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null';
  v_delete := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') <> 'null';
  -- A task the caller can't see reads as missing (never answered with, even
  -- for a patch that changes nothing); writes are checked again row by row.
  IF NOT FOUND OR (t.deleted_at IS NOT NULL AND NOT v_restore)
     OR NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;

  -- Restore first, so the rest of the patch edits a live task.
  IF v_restore AND t.deleted_at IS NOT NULL THEN
    BEGIN
      UPDATE public.tasks SET deleted_at = NULL, updated_at = now()
      WHERE id = t.id RETURNING * INTO t;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'trash_expired' THEN
        RAISE EXCEPTION 'This task was deleted more than 30 days ago, so it can''t be restored.';
      END IF;
      RAISE;
    END;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.restore', '{}'::jsonb);
  END IF;

  IF p_patch ? 'recurrence' THEN
    PERFORM public.tasks__check_recurrence(public.tasks__json_object(p_patch -> 'recurrence'));
  END IF;
  IF p_patch ? 'bucket_id' THEN
    PERFORM public.tasks__check_bucket(p_workspace_id, nullif(p_patch ->> 'bucket_id', '')::uuid);
  END IF;
  IF p_patch ? 'parent_id' THEN
    PERFORM public.tasks__check_parent(p_workspace_id, nullif(p_patch ->> 'parent_id', '')::uuid);
  END IF;
  -- The due date: due_on leads; a date-only due_date is one too.
  IF p_patch ? 'due_on' THEN
    v_set_due_on := true;
    v_due_on := nullif(p_patch ->> 'due_on', '')::date;
  ELSIF p_patch ? 'due_date' AND public.tasks__date_only(p_patch ->> 'due_date') IS NOT NULL THEN
    v_set_due_on := true;
    v_due_on := public.tasks__date_only(p_patch ->> 'due_date');
  ELSE
    v_set_due_on := false;
  END IF;

  t0 := t;
  IF p_patch ?| ARRAY['title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on',
                      'due_time', 'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level',
                      'priority', 'position', 'committed_for', 'commit_order', 'reschedule_count'] THEN
    UPDATE public.tasks SET
      title = CASE WHEN p_patch ? 'title' THEN coalesce(p_patch ->> 'title', '') ELSE title END,
      description = CASE WHEN p_patch ? 'description' THEN coalesce(p_patch ->> 'description', '') ELSE description END,
      bucket_id = CASE WHEN p_patch ? 'bucket_id' THEN (p_patch ->> 'bucket_id')::uuid ELSE bucket_id END,
      parent_id = CASE WHEN p_patch ? 'parent_id' THEN nullif(p_patch ->> 'parent_id', '')::uuid ELSE parent_id END,
      due_on = CASE WHEN v_set_due_on THEN v_due_on ELSE due_on END,
      due_date = CASE WHEN v_set_due_on THEN due_date
                      WHEN p_patch ? 'due_date' THEN (p_patch ->> 'due_date')::timestamptz ELSE due_date END,
      due_time = CASE WHEN p_patch ? 'due_time' THEN nullif(p_patch ->> 'due_time', '')::time ELSE due_time END,
      scheduled_at = CASE WHEN p_patch ? 'scheduled_at' THEN (p_patch ->> 'scheduled_at')::timestamptz ELSE scheduled_at END,
      duration_minutes = CASE WHEN p_patch ? 'duration_minutes'
                              THEN (p_patch ->> 'duration_minutes')::numeric::integer ELSE duration_minutes END,
      recurrence = CASE WHEN p_patch ? 'recurrence' THEN public.tasks__json_object(p_patch -> 'recurrence') ELSE recurrence END,
      energy_level = CASE WHEN p_patch ? 'energy_level' THEN nullif(p_patch ->> 'energy_level', '') ELSE energy_level END,
      priority = CASE WHEN p_patch ? 'priority' THEN nullif(p_patch ->> 'priority', '') ELSE priority END,
      position = CASE WHEN p_patch ? 'position' THEN coalesce(p_patch ->> 'position', '') ELSE position END,
      committed_for = CASE WHEN p_patch ? 'committed_for' THEN (p_patch ->> 'committed_for')::date ELSE committed_for END,
      commit_order = CASE WHEN p_patch ? 'commit_order' THEN (p_patch ->> 'commit_order')::numeric::integer ELSE commit_order END,
      reschedule_count = CASE WHEN p_patch ? 'reschedule_count'
                              THEN coalesce((p_patch ->> 'reschedule_count')::numeric::integer, 0) ELSE reschedule_count END,
      updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;

    -- Moving a task takes its subtasks along, in this transaction: the ones
    -- the mover can edit. Anyone else's (say, a step in a private project)
    -- stays where it is, so the move never fails or hints at a task the mover
    -- can't see.
    IF t.bucket_id IS DISTINCT FROM t0.bucket_id THEN
      FOR c IN
        SELECT * FROM public.tasks x
        WHERE x.parent_id = t.id AND x.deleted_at IS NULL AND x.bucket_id IS DISTINCT FROM t.bucket_id
          AND public.can_access('task', x.id, 'edit', public.perm_actor_id())
        ORDER BY x.id
        FOR UPDATE
      LOOP
        UPDATE public.tasks SET bucket_id = t.bucket_id, updated_at = now()
        WHERE id = c.id RETURNING * INTO c;
        v_carried := v_carried || c;
      END LOOP;
    END IF;

    -- One trail line for what changed (status, assignee and delete log their own).
    FOREACH v_field IN ARRAY ARRAY['title', 'description', 'bucket_id', 'parent_id', 'due_date',
                                   'due_time', 'scheduled_at', 'duration_minutes', 'recurrence',
                                   'energy_level', 'priority'] LOOP
      IF to_jsonb(t) -> v_field IS DISTINCT FROM to_jsonb(t0) -> v_field THEN
        v_fields := v_fields || v_field;
        IF v_field = 'description' THEN
          CONTINUE; -- the text itself stays out of the trail
        ELSIF v_field = 'recurrence' THEN
          v_payload := v_payload || jsonb_build_object(v_field, jsonb_build_object(
            'from', to_jsonb(t0) -> v_field -> 'rrule', 'to', to_jsonb(t) -> v_field -> 'rrule'));
        ELSE
          v_payload := v_payload || jsonb_build_object(v_field, jsonb_build_object(
            'from', to_jsonb(t0) -> v_field, 'to', to_jsonb(t) -> v_field));
          IF v_field = 'due_date' THEN
            v_payload := v_payload || jsonb_build_object('due_on', jsonb_build_object(
              'from', to_jsonb(t0) -> 'due_on', 'to', to_jsonb(t) -> 'due_on'));
          END IF;
        END IF;
      END IF;
    END LOOP;
    IF cardinality(v_fields) > 0 THEN
      v_payload := v_payload || jsonb_build_object('fields', to_jsonb(v_fields));
      IF cardinality(v_carried) > 0 THEN
        v_payload := v_payload || jsonb_build_object('subtasks_moved', cardinality(v_carried));
      END IF;
      -- Typing in the description saves often: one line per stretch of editing
      -- (the same person's description edit in the last 10 minutes, with
      -- nothing logged on the task since).
      IF NOT (v_fields = ARRAY['description'] AND EXISTS (
            SELECT 1 FROM public.module_activity a
            WHERE a.workspace_id = p_workspace_id AND a.module = 'tasks'
              AND a.entity_type = 'task' AND a.entity_id = t.id
              AND a.op = 'tasks.update' AND a.actor_id IS NOT DISTINCT FROM v_actor
              AND a.payload -> 'fields' = '["description"]'::jsonb
              AND a.created_at > now() - interval '10 minutes'
              AND NOT EXISTS (
                SELECT 1 FROM public.module_activity b
                WHERE b.workspace_id = a.workspace_id AND b.module = 'tasks'
                  AND b.entity_type = 'task' AND b.entity_id = a.entity_id
                  AND b.created_at > a.created_at))) THEN
        PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.update', v_payload);
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'assignee_id' THEN
    t := public.tasks_op_assign(p_workspace_id, t.id, nullif(p_patch ->> 'assignee_id', '')::uuid);
  END IF;

  IF p_patch ? 'status' OR p_patch ? 'status_id' THEN
    t := public.tasks__apply_status(t, coalesce(nullif(p_patch ->> 'status_id', ''), p_patch ->> 'status'), NULL, NULL);
  END IF;

  IF v_delete AND t.deleted_at IS NULL THEN
    UPDATE public.tasks SET deleted_at = now(), updated_at = now()
    WHERE id = t.id RETURNING * INTO t;
    -- Its subtasks stay, at the top level (work is never lost with a parent).
    -- That's the server's own consequence of the delete, so it runs as
    -- system work: a subtask the caller can't edit doesn't refuse the delete,
    -- and the answer names only the subtasks the caller can see.
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    FOR c IN
      SELECT * FROM public.tasks x
      WHERE x.parent_id = t.id AND x.deleted_at IS NULL
      ORDER BY x.id
      FOR UPDATE
    LOOP
      UPDATE public.tasks SET parent_id = NULL, updated_at = now()
      WHERE id = c.id RETURNING * INTO c;
      IF public.can_access('task', c.id, 'view', public.perm_actor_id()) THEN
        v_carried := v_carried || c;
      END IF;
    END LOOP;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.delete', '{}'::jsonb);
  END IF;

  RETURN NEXT t;
  FOREACH c IN ARRAY v_carried LOOP
    RETURN NEXT c;
  END LOOP;
  RETURN;
END;
$function$;

-- ── 7. Late, on the server (REPLAN 23) ──────────────────────────────────────

-- The due moment of a task with a due time: that clock time on due_on in the
-- task's zone (its assignee's, else its creator's, else UTC). NULL without one.
CREATE OR REPLACE FUNCTION public.tasks__due_at(t public.tasks)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN t.due_on IS NULL OR t.due_time IS NULL THEN NULL
              ELSE (t.due_on + t.due_time) AT TIME ZONE public.tasks__zone_of(t) END
$$;

-- Late: open (To do or In progress; Backlog never is) and past due: a due
-- time that has passed, or a due date before today in the task's zone.
CREATE OR REPLACE FUNCTION public.tasks__late(t public.tasks, p_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.deleted_at IS NULL
     AND t.status_category IN ('todo', 'in_progress')
     AND t.due_on IS NOT NULL
     AND CASE WHEN t.due_time IS NULL
              THEN t.due_on < public.tasks__local_date(p_now, public.tasks__zone_of(t))
              ELSE public.tasks__due_at(t) < p_now END
$$;

-- The late flag as a read (a PostgREST computed field: select=*,late:tasks_late),
-- for a task the caller can see; it reads the stored row, never the one passed.
CREATE OR REPLACE FUNCTION public.tasks_late(t public.tasks)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tasks__late(x, now()) FROM public.tasks x
  WHERE x.id = t.id
    AND (public.perm_actor_id() IS NULL OR public.can_access('task', x.id, 'view', public.perm_actor_id()))
$$;

-- ── 8. Account erasure clears "completed by" (§Assumptions #26) ─────────────

-- Production's body (TV-D8's 20261010161000, read from the catalog on
-- 2026-10-10), plus: the "completed by" marks the person left on tasks in
-- other people's workspaces, counted in the preview and cleared with the rest
-- (the profile's foreign key would clear them too, later).

CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_owned uuid[];
  r record;
  v_new uuid;
  v_owner uuid;
  i integer;

  v_note_del uuid[] := '{}';     v_note_keep uuid[] := '{}';     v_note_to uuid[] := '{}';
  v_bucket_del uuid[] := '{}';   v_bucket_keep uuid[] := '{}';   v_bucket_to uuid[] := '{}';
  v_task_del uuid[] := '{}';     v_task_move uuid[] := '{}';     v_task_move_to uuid[] := '{}';
  v_contact_del uuid[] := '{}';  v_contact_keep uuid[] := '{}';  v_contact_to uuid[] := '{}';
  v_group_del uuid[] := '{}';    v_group_keep uuid[] := '{}';    v_group_to uuid[] := '{}';
  v_company_del uuid[] := '{}';  v_company_keep uuid[] := '{}';  v_company_to uuid[] := '{}';
  v_event_del uuid[];
  v_calendar_del uuid[];
  v_set_del uuid[];
  v_account_del uuid[];
  v_email_ref_del uuid[];
  v_email_account_del uuid[];
  v_channel_del uuid[];
  v_manager_channel uuid[] := '{}';
  v_manager_to uuid[] := '{}';
  v_task_unassign integer;
  v_notification_state integer;
  v_api_keys integer;
  v_member_grants integer;
  v_email text;
  v_invites integer;
  v_completions integer;
  v_completed_by integer;
  v_bypass text;

  v_keys text[];        -- 'type:id' of every deleted item
  v_id_texts text[];    -- every deleted id, for activity payloads (target_id)
  v_counts jsonb;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'account_erase_workspace_data: p_user is required';
  END IF;

  -- Workspaces the user owns are left to the auth cascade.
  SELECT coalesce(array_agg(w.id), '{}') INTO v_owned
  FROM public.workspaces w WHERE w.owner_id = p_user;

  -- ── Decide, before anything changes (every decision reads today's access) ──

  FOR r IN
    SELECT n.id, n.workspace_id FROM public.notes n
    WHERE n.created_by = p_user AND n.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('note', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_note_del := v_note_del || r.id;
    ELSE
      v_note_keep := v_note_keep || r.id;
      v_note_to := v_note_to || v_new;
    END IF;
  END LOOP;

  -- The Inbox is only ever its owner's, so it always goes.
  FOR r IN
    SELECT b.id, b.workspace_id FROM public.buckets b
    WHERE b.owner_id = p_user AND b.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('bucket', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_bucket_del := v_bucket_del || r.id;
    ELSE
      v_bucket_keep := v_bucket_keep || r.id;
      v_bucket_to := v_bucket_to || v_new;
    END IF;
  END LOOP;

  -- tasks.bucket_id is RESTRICT: every task in a bucket that goes either moves
  -- (someone else can see it, e.g. an assignee's grant) or goes too.
  FOR r IN
    SELECT t.id, t.workspace_id, t.assignee_id FROM public.tasks t WHERE t.bucket_id = ANY (v_bucket_del)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.resource_grants g
                   WHERE g.resource_type = 'task' AND g.resource_id = r.id) THEN
      -- can_access gives a task its own grants plus its bucket's access, and
      -- nobody else can see this bucket: without a grant the task is private.
      -- (A shortcut, so a big private bucket doesn't cost a search per task.)
      v_new := NULL;
    ELSIF r.assignee_id IS NOT NULL AND r.assignee_id <> p_user
          AND public.can_access('task', r.id, 'view', r.assignee_id) THEN
      -- The teammate it's assigned to keeps it, in their own Inbox.
      v_new := r.assignee_id;
    ELSE
      v_new := public.account_erasure_new_owner('task', r.id, r.workspace_id, p_user);
    END IF;
    IF v_new IS NULL THEN
      v_task_del := v_task_del || r.id;
    ELSE
      v_task_move := v_task_move || r.id;
      v_task_move_to := v_task_move_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.id, c.workspace_id FROM public.contacts c
    WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_contact_del := v_contact_del || r.id;
    ELSE
      v_contact_keep := v_contact_keep || r.id;
      v_contact_to := v_contact_to || v_new;
    END IF;
  END LOOP;

  FOR r IN
    SELECT g.id, g.workspace_id FROM public.contact_groups g
    WHERE g.owner_id = p_user AND g.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('contact_group', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_group_del := v_group_del || r.id;
    ELSE
      v_group_keep := v_group_keep || r.id;
      v_group_to := v_group_to || v_new;
    END IF;
  END LOOP;

  -- A company is visible through any contact the viewer can see that points at
  -- it. Contacts that go are private, so they never made a company visible.
  FOR r IN
    SELECT co.id, co.workspace_id FROM public.companies co
    WHERE co.owner_id = p_user AND co.workspace_id <> ALL (v_owned)
  LOOP
    v_new := public.account_erasure_new_owner('company', r.id, r.workspace_id, p_user);
    IF v_new IS NULL THEN
      v_company_del := v_company_del || r.id;
    ELSE
      v_company_keep := v_company_keep || r.id;
      v_company_to := v_company_to || v_new;
    END IF;
  END LOOP;

  -- Every event is filed in its owner's own calendar, so the user's calendars
  -- would only keep an empty name (integration calendars are often named after
  -- an email address). All of it goes.
  SELECT coalesce(array_agg(e.id), '{}') INTO v_event_del
  FROM public.calendar_events e
  WHERE e.owner_id = p_user AND e.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(c.id), '{}') INTO v_calendar_del
  FROM public.calendars c WHERE c.owner_id = p_user AND c.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(s.id), '{}') INTO v_set_del
  FROM public.calendar_sets s WHERE s.owner_id = p_user AND s.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(a.id), '{}') INTO v_account_del
  FROM public.calendar_accounts a WHERE a.owner_id = p_user AND a.workspace_id <> ALL (v_owned);

  -- Email has no sharing: everything is the owner's alone.
  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_ref_del
  FROM public.email_refs x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  SELECT coalesce(array_agg(x.id), '{}') INTO v_email_account_del
  FROM public.email_accounts x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);

  -- Chat rows outlive membership (someone who leaves keeps their chat_members
  -- and manager rows but can't open the workspace), so only people still in the
  -- workspace count below.
  -- A DM or private channel with nobody else still here in it, e.g. their DM
  -- with themselves.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_channel_del
  FROM public.chat_channels c
  WHERE c.workspace_id <> ALL (v_owned)
    AND (c.kind = 'dm' OR c.is_private)
    AND EXISTS (SELECT 1 FROM public.chat_members cm
                WHERE cm.channel_id = c.id AND cm.user_id = p_user)
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_members cm
      WHERE cm.channel_id = c.id AND cm.user_id <> p_user
        AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                     WHERE wm.workspace_id = c.workspace_id AND wm.user_id = cm.user_id)
             OR EXISTS (SELECT 1 FROM public.workspaces w
                        WHERE w.id = c.workspace_id AND w.owner_id = cm.user_id)));

  -- Channels the user managed alone: the workspace owner if they can see the
  -- channel, otherwise the earliest member still here.
  FOR r IN
    SELECT c.id, c.workspace_id, c.is_private
    FROM public.chat_channel_managers m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user
      AND c.workspace_id <> ALL (v_owned)
      AND NOT (c.id = ANY (v_channel_del))
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_channel_managers m2
        WHERE m2.channel_id = c.id AND m2.user_id <> p_user
          AND (EXISTS (SELECT 1 FROM public.workspace_members wm
                       WHERE wm.workspace_id = c.workspace_id AND wm.user_id = m2.user_id)
               OR EXISTS (SELECT 1 FROM public.workspaces w
                          WHERE w.id = c.workspace_id AND w.owner_id = m2.user_id)))
  LOOP
    v_new := NULL;
    SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = r.workspace_id;
    IF v_owner IS NOT NULL AND v_owner <> p_user
       AND (NOT r.is_private OR EXISTS (SELECT 1 FROM public.chat_members cm
                                        WHERE cm.channel_id = r.id AND cm.user_id = v_owner)) THEN
      v_new := v_owner;
    ELSE
      SELECT cm.user_id INTO v_new
      FROM public.chat_members cm
      JOIN public.workspace_members wm ON wm.workspace_id = r.workspace_id AND wm.user_id = cm.user_id
      WHERE cm.channel_id = r.id AND cm.user_id <> p_user
      ORDER BY cm.joined_at, cm.user_id
      LIMIT 1;
      IF v_new IS NULL AND NOT r.is_private THEN
        SELECT m.user_id INTO v_new
        FROM public.workspace_members m
        WHERE m.workspace_id = r.workspace_id AND m.user_id <> p_user
        ORDER BY m.joined_at, m.user_id
        LIMIT 1;
      END IF;
    END IF;
    IF v_new IS NOT NULL THEN
      v_manager_channel := v_manager_channel || r.id;
      v_manager_to := v_manager_to || v_new;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_task_unassign
  FROM public.tasks t
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  SELECT count(*) INTO v_notification_state
  FROM public.notification_state s WHERE s.user_id = p_user;

  SELECT count(*) INTO v_api_keys
  FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);

  SELECT count(*) INTO v_member_grants
  FROM public.resource_grants g
  WHERE g.subject_type = 'member' AND g.subject_id = p_user;

  -- Invitations they accepted keep their email address; they have no use once
  -- the person is in (pending ones are the inviter's and stay).
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user;
  SELECT count(*) INTO v_invites
  FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  -- TV-D8: the completions they recorded in other people's workspaces (their
  -- own workspaces' rows go with the workspace).
  SELECT count(*) INTO v_completions
  FROM public.task_completions c
  WHERE c.user_id = p_user AND c.workspace_id <> ALL (v_owned);

  -- TV-D9: who finished which task, in other people's workspaces (the task
  -- stays; the mark is cleared).
  SELECT count(*) INTO v_completed_by
  FROM public.tasks t
  WHERE t.completed_by = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  v_counts := jsonb_build_object(
    'preview', p_preview IS NOT FALSE,
    'notes_deleted', cardinality(v_note_del),
    'notes_handed_over', cardinality(v_note_keep),
    'buckets_deleted', cardinality(v_bucket_del),
    'buckets_handed_over', cardinality(v_bucket_keep),
    'tasks_deleted', cardinality(v_task_del),
    'tasks_moved', cardinality(v_task_move),
    'tasks_unassigned', v_task_unassign,
    'contacts_deleted', cardinality(v_contact_del),
    'contacts_handed_over', cardinality(v_contact_keep),
    'contact_groups_deleted', cardinality(v_group_del),
    'contact_groups_handed_over', cardinality(v_group_keep),
    'companies_deleted', cardinality(v_company_del),
    'companies_handed_over', cardinality(v_company_keep),
    'events_deleted', cardinality(v_event_del),
    'calendars_deleted', cardinality(v_calendar_del),
    'calendar_sets_deleted', cardinality(v_set_del),
    'calendar_accounts_deleted', cardinality(v_account_del),
    'email_refs_deleted', cardinality(v_email_ref_del),
    'email_accounts_deleted', cardinality(v_email_account_del),
    'chat_channels_deleted', cardinality(v_channel_del),
    'chat_managers_handed_over', cardinality(v_manager_channel),
    'notification_state_deleted', v_notification_state,
    'api_keys_deleted', v_api_keys,
    'member_grants_deleted', v_member_grants,
    'invites_deleted', v_invites,
    'task_completions_deleted', v_completions,
    'tasks_completed_by_cleared', v_completed_by
  );

  -- Only an explicit false deletes; NULL previews like the default.
  IF p_preview IS NOT FALSE THEN
    RETURN v_counts;
  END IF;

  -- ── Apply ──────────────────────────────────────────────────────────────────

  -- Restored before returning, so a caller's later statements aren't bypassed.
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  -- 1. Shared items get their new owner.
  UPDATE public.notes n SET created_by = x.to_user
  FROM unnest(v_note_keep, v_note_to) AS x(id, to_user) WHERE n.id = x.id;
  UPDATE public.buckets b SET owner_id = x.to_user
  FROM unnest(v_bucket_keep, v_bucket_to) AS x(id, to_user) WHERE b.id = x.id;
  UPDATE public.contacts c SET owner_id = x.to_user
  FROM unnest(v_contact_keep, v_contact_to) AS x(id, to_user) WHERE c.id = x.id;
  UPDATE public.contact_groups g SET owner_id = x.to_user
  FROM unnest(v_group_keep, v_group_to) AS x(id, to_user) WHERE g.id = x.id;
  UPDATE public.companies co SET owner_id = x.to_user
  FROM unnest(v_company_keep, v_company_to) AS x(id, to_user) WHERE co.id = x.id;

  -- 2. Shared tasks leave the buckets that go, into their new owner's Inbox.
  FOR i IN 1 .. cardinality(v_task_move) LOOP
    UPDATE public.tasks t
    SET bucket_id = public.account_erasure_inbox(t.workspace_id, v_task_move_to[i])
    WHERE t.id = v_task_move[i];
  END LOOP;

  -- 3. Tasks assigned to the user are unassigned (the moved ones included).
  UPDATE public.tasks t SET assignee_id = NULL
  WHERE t.assignee_id = p_user AND t.workspace_id <> ALL (v_owned)
    AND NOT (t.id = ANY (v_task_del));

  -- 3b. Who completed what (TV-D8), in workspaces they don't own.
  DELETE FROM public.task_completions c
  WHERE c.user_id = p_user AND c.workspace_id <> ALL (v_owned);

  -- 3c. Who finished which task (TV-D9), in workspaces they don't own.
  UPDATE public.tasks t SET completed_by = NULL
  WHERE t.completed_by = p_user AND t.workspace_id <> ALL (v_owned);

  -- 4. Chat: new managers first, then the user's manager rows, then channels
  --    with nobody else in them (members and messages cascade).
  INSERT INTO public.chat_channel_managers (channel_id, user_id)
  SELECT x.channel_id, x.user_id FROM unnest(v_manager_channel, v_manager_to) AS x(channel_id, user_id)
  ON CONFLICT DO NOTHING;
  DELETE FROM public.chat_channel_managers m
  USING public.chat_channels c
  WHERE c.id = m.channel_id AND m.user_id = p_user AND c.workspace_id <> ALL (v_owned);
  DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);

  -- 5. What points at the deleted items without a foreign key, addressed as
  --    'type:id' in every type the spine (perm_can_see_entity), activity and
  --    grants use for them.
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT 'note:' || x AS k FROM unnest(v_note_del) AS x
    UNION ALL SELECT 'bucket:' || x FROM unnest(v_bucket_del) AS x
    UNION ALL SELECT 'task:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'task_project:' || x FROM unnest(v_task_del) AS x
    UNION ALL SELECT 'contact:' || x FROM unnest(v_contact_del) AS x
    UNION ALL SELECT 'contact_group:' || x FROM unnest(v_group_del) AS x
    UNION ALL SELECT 'company:' || x FROM unnest(v_company_del) AS x
    UNION ALL SELECT 'event:' || x FROM unnest(v_event_del) AS x
    UNION ALL SELECT 'calendar:' || x FROM unnest(v_calendar_del) AS x
    UNION ALL SELECT 'calendar_set:' || x FROM unnest(v_set_del) AS x
    UNION ALL SELECT 'calendar_account:' || x FROM unnest(v_account_del) AS x
    UNION ALL SELECT 'email_thread:' || x FROM unnest(v_email_ref_del) AS x
    UNION ALL SELECT 'email_account:' || x FROM unnest(v_email_account_del) AS x
    UNION ALL SELECT 'chat_channel:' || x FROM unnest(v_channel_del) AS x
  ) s;

  SELECT coalesce(array_agg(split_part(k, ':', 2)), '{}') INTO v_id_texts
  FROM unnest(v_keys) AS k;

  -- Activity rows (notification state cascades), including links-module rows
  -- whose deleted item is only the payload's target.
  DELETE FROM public.module_activity a
  WHERE (a.entity_type || ':' || a.entity_id) = ANY (v_keys)
     OR (a.payload ->> 'target_id') = ANY (v_id_texts);
  -- Activity only the user could read (RLS shows calendar and email activity to
  -- the actor and the item's owner), also for items removed earlier. A calendar
  -- account's entries carry its label, often an email address.
  DELETE FROM public.module_activity a
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user
    AND (a.entity_type IN ('calendar_account', 'email_account', 'email_thread')
         OR (a.entity_type = 'event' AND NOT EXISTS (
               SELECT 1 FROM public.calendar_events e
               WHERE e.id = a.entity_id AND e.owner_id <> p_user)));
  -- The rest of their activity stays, without their name: module_activity_log
  -- copies the actor's display name into actor_label, and the app shows it.
  UPDATE public.module_activity a SET actor_label = NULL
  WHERE a.workspace_id <> ALL (v_owned)
    AND a.actor_type = 'user' AND a.actor_id = p_user AND a.actor_label IS NOT NULL;
  DELETE FROM public.tag_links tl
  WHERE (tl.entity_type || ':' || tl.entity_id) = ANY (v_keys);
  DELETE FROM public.link_suggestion_declines d
  WHERE split_part(d.pair_key, '|', 1) = ANY (v_keys)
     OR split_part(d.pair_key, '|', 2) = ANY (v_keys);
  -- Entities: their links (either end) and every comment on them cascade.
  DELETE FROM public.entities e
  WHERE (e.entity_type || ':' || e.entity_id) = ANY (v_keys);

  -- 6. The items. Children before parents where a foreign key restricts.
  DELETE FROM public.exposed_notes x WHERE x.note_id = ANY (v_note_del::text[]);
  -- note_shares has a foreign key whose delete rule no migration records.
  DELETE FROM public.note_shares s WHERE s.note_id = ANY (v_note_del);
  -- notes.parent_id is SET NULL: a teammate's sub-note under a deleted note
  -- moves to the top level. note_updates cascade.
  DELETE FROM public.notes n WHERE n.id = ANY (v_note_del);

  UPDATE public.slot_bookings b SET contact_id = NULL WHERE b.contact_id = ANY (v_contact_del);
  UPDATE public.slot_bookings b SET calendar_event_id = NULL WHERE b.calendar_event_id = ANY (v_event_del);

  DELETE FROM public.tasks t WHERE t.id = ANY (v_task_del);
  DELETE FROM public.buckets b WHERE b.id = ANY (v_bucket_del);
  -- Time blocks map a slot to a bucket id; drop the slots of buckets that went.
  UPDATE public.task_time_blocks tb
  SET blocks = coalesce((
        SELECT jsonb_object_agg(j.key, j.value)
        FROM jsonb_each(tb.blocks) AS j
        WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)
      ), '{}'::jsonb),
      updated_at = now()
  WHERE EXISTS (SELECT 1 FROM jsonb_each(tb.blocks) AS j
                WHERE (j.value #>> '{}') = ANY (v_bucket_del::text[]));

  -- Group memberships and private notes on contacts cascade; contacts.company_id
  -- is SET NULL.
  DELETE FROM public.contact_groups g WHERE g.id = ANY (v_group_del);
  DELETE FROM public.contacts c WHERE c.id = ANY (v_contact_del);
  DELETE FROM public.companies co WHERE co.id = ANY (v_company_del);

  -- Events before accounts: calendar_events.source_account_id is SET NULL.
  -- Set items cascade; deleting an account also deletes its calendar.
  DELETE FROM public.calendar_events e WHERE e.id = ANY (v_event_del);
  DELETE FROM public.calendar_sets s WHERE s.id = ANY (v_set_del);
  DELETE FROM public.calendars c WHERE c.id = ANY (v_calendar_del);
  DELETE FROM public.calendar_accounts a WHERE a.id = ANY (v_account_del);

  -- email_refs.account_id is SET NULL, so refs go first.
  DELETE FROM public.email_refs x WHERE x.id = ANY (v_email_ref_del);
  DELETE FROM public.email_accounts x WHERE x.id = ANY (v_email_account_del);

  -- 7. Grants on everything that went, every grant to the user, their read
  --    state, the API keys they created (keys stop working without a creator
  --    anyway) and the invitations they accepted.
  DELETE FROM public.resource_grants g
  WHERE (g.resource_type || ':' || g.resource_id) = ANY (v_keys)
     OR (g.subject_type = 'member' AND g.subject_id = p_user);
  DELETE FROM public.notification_state s WHERE s.user_id = p_user;
  DELETE FROM public.workspace_api_keys k
  WHERE k.created_by = p_user AND k.workspace_id <> ALL (v_owned);
  DELETE FROM public.workspace_invites i
  WHERE i.workspace_id <> ALL (v_owned) AND i.status = 'accepted'
    AND lower(i.email) = lower(v_email);

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN v_counts;
END;
$$;

-- ── 9. Grants ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks__known_zone(uuid)', 'tasks__status_sync()', 'tasks__completion_record()',
    'tasks__due_sync()', 'tasks__due_at(public.tasks)', 'tasks__late(public.tasks, timestamptz)',
    'account_erase_workspace_data(uuid, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
  -- Pure helpers that read only their arguments.
  FOREACH fn IN ARRAY ARRAY[
    'tasks__due_on_of(timestamptz, text)', 'tasks__due_noon(date)', 'tasks__date_only(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.tasks_late(public.tasks) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.tasks_late(public.tasks) FROM anon;
  GRANT EXECUTE ON FUNCTION public.tasks_late(public.tasks) TO authenticated, service_role;
END;
$$;

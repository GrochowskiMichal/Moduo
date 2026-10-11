-- TV-D10-fix · Work sessions, reminders and Waiting on… go through the task's
-- own gate on every path (specs/tasks-v3.md block 10, §Assumptions #4, #24;
-- REPLAN 24, 25, default d; decisions in docs/decisions/tasks.md "TV-D10-fix").
--
--   * One gate for a task, like TV-D10's for projects: tasks__visible /
--     tasks__editable (the caller) and tasks__visible_to / tasks__editable_to
--     (a given person) wrap can_access on the task. The three tables' RLS (and
--     so Realtime, which applies it to every subscriber), every op, the
--     schedule trigger, the reminder sender and the booking busy read ask them.
--   * Reads: a task's sessions and Waiting on… entries, only for whoever sees
--     the task; a reminder, only for its own person while they see the task.
--     An op never answers about a session, entry or reminder of a task the
--     caller can't see ("not found").
--   * Writes need edit on the task (reminders: seeing it, D10-10; they're the
--     caller's own). A session goes in the caller's own calendar or the task's
--     assignee's (scheduling the assignee's work), and only for someone who sees
--     the task and can work on tasks; that holds for the ops and for a write of
--     scheduled_at / duration_minutes (an old build, the app's picker, the
--     repeat engine). Moving, resizing or removing a session on a task you can
--     edit keeps its person.
--   * The reminder sender claims a reminder for delivery only while its person
--     can see the task; one whose person can't is retired at its time, unsent.
--   * Booking links read a host's work sessions through tasks__busy_sessions:
--     times only, of live open tasks the host can see.
--   * buckets__area_sync / buckets__project_check skipped the project edit gate
--     for any write another trigger made; now only for what a foreign key's
--     SET NULL does (clearing a project's area, lead or client).
--
-- Apply after TV-D10's three files (20261010180000, 181000, 182000).
-- Verified on the local stack by supabase/tests/sessions_access.test.sql (and
-- sessions.test.sql, structure.test.sql).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.task_sessions') IS NULL OR to_regclass('public.teams') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10 (20261010180000, 20261010181000, 20261010182000) before this migration.';
  END IF;
END;
$$;

-- ── 1. One gate for a task ──────────────────────────────────────────────────

-- Whether this person can see / change a task (its own sharing, else its
-- project's, within their role in the workspace).
CREATE OR REPLACE FUNCTION public.tasks__visible_to(p_task_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND public.can_access('task', p_task_id, 'view', p_user)
$$;

CREATE OR REPLACE FUNCTION public.tasks__editable_to(p_task_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND public.can_access('task', p_task_id, 'edit', p_user)
$$;

-- The same for the caller (RLS calls these, so they answer only for them).
CREATE OR REPLACE FUNCTION public.tasks__visible(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tasks__visible_to(p_task_id, public.perm_actor_id())
$$;

CREATE OR REPLACE FUNCTION public.tasks__editable(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tasks__editable_to(p_task_id, public.perm_actor_id())
$$;

-- ── 2. Reads ────────────────────────────────────────────────────────────────

-- Only SELECT for the app (every write is an op); Realtime streams a change
-- to a subscriber only when this policy lets them read the row.
DROP POLICY IF EXISTS task_sessions_read ON public.task_sessions;
CREATE POLICY task_sessions_read ON public.task_sessions
  FOR SELECT TO authenticated
  USING (public.tasks__visible(task_id));

DROP POLICY IF EXISTS task_waiting_read ON public.task_waiting;
CREATE POLICY task_waiting_read ON public.task_waiting
  FOR SELECT TO authenticated
  USING (public.tasks__visible(task_id));

DROP POLICY IF EXISTS task_reminders_read ON public.task_reminders;
CREATE POLICY task_reminders_read ON public.task_reminders
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.tasks__visible(task_id));

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['task_sessions', 'task_reminders', 'task_waiting'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
  END LOOP;
END;
$$;

-- ── 3. A task the caller may edit ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks__guard_edit(p_workspace_id uuid, p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF NOT public.tasks__visible(t.id) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF NOT public.tasks__editable(t.id) THEN
    RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
  END IF;
  RETURN t;
END;
$$;

-- ── 4. Whose calendar a session goes in ─────────────────────────────────────

-- The caller's own (they passed tasks__guard_edit), or the task's assignee's:
-- scheduling the assignee's work is the one way to put a block in someone
-- else's calendar (decisions "TV-D10-fix"), and only for an assignee who sees
-- the task and can work on tasks here.
CREATE OR REPLACE FUNCTION public.tasks__check_session_person(t public.tasks, p_user uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'A session is someone''s: pick who does the work.' USING ERRCODE = '22023';
  END IF;
  IF p_user = public.perm_actor_id() THEN
    RETURN;
  END IF;
  IF p_user IS DISTINCT FROM t.assignee_id THEN
    RAISE EXCEPTION 'A work session goes in your own calendar or the assignee''s.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks__check_assignee(t.workspace_id, p_user);
  IF NOT public.tasks__visible_to(t.id, p_user) THEN
    RAISE EXCEPTION 'A work session goes in your own calendar or the assignee''s.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Schedule a session. Keys: id, starts_at, ends_at, user_id (default: you; the
-- assignee to schedule their work). A resent add answers as the first did.
CREATE OR REPLACE FUNCTION public.tasks_op_session_add(p_workspace_id uuid, p_task_id uuid, p_session jsonb)
RETURNS SETOF public.task_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  s public.task_sessions;
  v_id uuid;
  v_user uuid;
  v_times record;
BEGIN
  PERFORM public.tasks__check_keys(p_session, ARRAY['id', 'starts_at', 'ends_at', 'user_id']);
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);
  v_id := coalesce(public.tasks__try_uuid(p_session ->> 'id'), gen_random_uuid());
  SELECT * INTO s FROM public.task_sessions WHERE id = v_id;
  IF FOUND THEN
    IF s.task_id IS DISTINCT FROM t.id THEN
      RAISE EXCEPTION 'That session belongs to another task.' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM public.tasks__sessions_of(t.id);
    RETURN;
  END IF;
  v_times := public.tasks__session_times(p_session, NULL, NULL);
  v_user := CASE WHEN p_session ? 'user_id' THEN public.tasks__try_uuid(p_session ->> 'user_id')
                 ELSE public.perm_actor_id() END;
  PERFORM public.tasks__check_session_person(t, v_user);
  INSERT INTO public.task_sessions (id, workspace_id, task_id, user_id, starts_at, ends_at)
  VALUES (v_id, p_workspace_id, t.id, v_user, v_times.starts_at, v_times.ends_at);
  PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.session_add',
    jsonb_build_object('starts_at', v_times.starts_at, 'ends_at', v_times.ends_at));
  -- Scheduling a backlog task moves it to To do (TV-D9's rule; the mirror's
  -- write doesn't count, so the op does it).
  PERFORM public.tasks__session_unbacklog(t.id);
  RETURN QUERY SELECT * FROM public.tasks__sessions_of(t.id);
END;
$$;

-- Move or resize a session (starts_at, ends_at), or hand it to someone
-- (user_id: you or the assignee). A session of a task the caller can't see
-- reads as missing.
CREATE OR REPLACE FUNCTION public.tasks_op_session_update(p_workspace_id uuid, p_session_id uuid, p_patch jsonb)
RETURNS SETOF public.task_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  s public.task_sessions;
  v_times record;
  v_user uuid;
BEGIN
  PERFORM public.tasks__check_keys(p_patch, ARRAY['starts_at', 'ends_at', 'user_id']);
  SELECT * INTO s FROM public.task_sessions x
  WHERE x.id = p_session_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible(s.task_id) THEN
    RAISE EXCEPTION 'Session not found.' USING ERRCODE = '22023';
  END IF;
  t := public.tasks__guard_edit(p_workspace_id, s.task_id);
  SELECT * INTO s FROM public.task_sessions WHERE id = s.id FOR UPDATE;
  v_times := public.tasks__session_times(p_patch, s.starts_at, s.ends_at);
  v_user := CASE WHEN p_patch ? 'user_id' THEN public.tasks__try_uuid(p_patch ->> 'user_id') ELSE s.user_id END;
  IF p_patch ? 'user_id' AND v_user IS DISTINCT FROM s.user_id THEN
    PERFORM public.tasks__check_session_person(t, v_user);
  END IF;
  IF row(v_times.starts_at, v_times.ends_at, v_user) IS DISTINCT FROM row(s.starts_at, s.ends_at, s.user_id) THEN
    UPDATE public.task_sessions SET starts_at = v_times.starts_at, ends_at = v_times.ends_at, user_id = v_user
    WHERE id = s.id;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.session_move',
      jsonb_build_object('from', s.starts_at, 'to', v_times.starts_at, 'ends_at', v_times.ends_at));
    PERFORM public.tasks__session_unbacklog(t.id);
  END IF;
  RETURN QUERY SELECT * FROM public.tasks__sessions_of(t.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tasks_op_session_remove(p_workspace_id uuid, p_session_id uuid)
RETURNS SETOF public.task_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  s public.task_sessions;
BEGIN
  SELECT * INTO s FROM public.task_sessions x
  WHERE x.id = p_session_id AND x.workspace_id = p_workspace_id;
  IF NOT FOUND OR NOT public.tasks__visible(s.task_id) THEN
    RAISE EXCEPTION 'Session not found.' USING ERRCODE = '22023';
  END IF;
  t := public.tasks__guard_edit(p_workspace_id, s.task_id);
  IF s.deleted_at IS NULL THEN
    UPDATE public.task_sessions SET deleted_at = now() WHERE id = s.id;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.session_remove',
      jsonb_build_object('starts_at', s.starts_at));
  END IF;
  RETURN QUERY SELECT * FROM public.tasks__sessions_of(t.id);
END;
$$;

-- ── 5. A write of scheduled_at / duration_minutes ───────────────────────────

-- tasks__session_legacy (TV-D10's body) behind the same gate as the ops: a
-- signed-in writer needs edit on the task (PERM-W's write check asks too; this
-- keeps the session side from depending on it), and a new session is the
-- assignee's only when they see the task, else the writer's (system work with
-- neither: the creator's). Moving the shown session keeps its person.
CREATE OR REPLACE FUNCTION public.tasks__session_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.task_sessions;
  v_len interval;
  v_user uuid;
  v_actor uuid := public.perm_actor_id();
  v_system boolean := v_actor IS NULL OR coalesce(current_setting('share.bypass', true), '') = '1';
BEGIN
  IF coalesce(current_setting('tasks.session_mirror', true), '') = '1' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.scheduled_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT v_system AND NOT public.tasks__editable_to(NEW.id, v_actor) THEN
    RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
  END IF;
  v_user := CASE WHEN NEW.assignee_id IS NOT NULL AND public.tasks__visible_to(NEW.id, NEW.assignee_id)
                   THEN NEW.assignee_id
                 ELSE coalesce(v_actor, NEW.owner_id) END;
  v_len := make_interval(mins => coalesce(nullif(NEW.duration_minutes, 0), 30));

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at)
    VALUES (NEW.workspace_id, NEW.id, v_user, NEW.scheduled_at, NEW.scheduled_at + v_len);
    RETURN NULL;
  END IF;

  IF OLD.scheduled_at IS NOT NULL THEN
    SELECT * INTO s FROM public.task_sessions x
    WHERE x.task_id = NEW.id AND x.deleted_at IS NULL AND x.starts_at = OLD.scheduled_at
    ORDER BY x.ends_at, x.id
    LIMIT 1;
    IF s.id IS NULL THEN
      s := public.tasks__next_session(NEW.id, now());
    END IF;
  END IF;

  IF NEW.scheduled_at IS NULL THEN
    IF s.id IS NOT NULL THEN
      IF coalesce(current_setting('tasks.session_op', true), '') = '1' THEN
        UPDATE public.task_sessions SET deleted_at = now() WHERE id = s.id;
      ELSE
        -- A raw clear may be a stale whole-row save: keep the session and
        -- put the time back.
        PERFORM public.tasks__session_mirror(NEW.id);
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  IF s.id IS NULL THEN
    INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at)
    VALUES (NEW.workspace_id, NEW.id, v_user, NEW.scheduled_at, NEW.scheduled_at + v_len);
  ELSE
    UPDATE public.task_sessions SET
      starts_at = NEW.scheduled_at,
      ends_at = NEW.scheduled_at + CASE
        WHEN NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN v_len
        ELSE s.ends_at - s.starts_at END
    WHERE id = s.id;
  END IF;
  RETURN NULL;
END;
$$;

-- tasks_op_unschedule (TV-D10's body) behind the edit gate (it removes the
-- shown session).
CREATE OR REPLACE FUNCTION public.tasks_op_unschedule(p_workspace_id uuid, p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_from timestamptz;
  v_flag text;
BEGIN
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);
  IF t.scheduled_at IS NULL THEN
    RETURN t; -- already unscheduled
  END IF;
  v_from := t.scheduled_at;
  v_flag := current_setting('tasks.session_op', true);
  PERFORM set_config('tasks.session_op', '1', true);
  UPDATE public.tasks
    SET scheduled_at = NULL, updated_at = now()
    WHERE id = t.id;
  PERFORM set_config('tasks.session_op', coalesce(v_flag, ''), true);
  SELECT * INTO t FROM public.tasks WHERE id = t.id;
  -- With another session left the task is still scheduled: say what happened.
  IF t.scheduled_at IS NULL THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'tasks', 'task', t.id, 'tasks.unschedule',
      jsonb_build_object('from', v_from));
  ELSE
    PERFORM public.module_activity_log(
      p_workspace_id, 'tasks', 'task', t.id, 'tasks.session_remove',
      jsonb_build_object('starts_at', v_from));
  END IF;
  RETURN t;
END;
$$;

-- ── 6. Busy for booking links (default d) ───────────────────────────────────

-- A host's work sessions in a window, as busy times only: live sessions in
-- their calendar, on live open tasks (Done and Won't do block nothing) that
-- they can see. booking-public calls it with the service role.
CREATE OR REPLACE FUNCTION public.tasks__busy_sessions(
  p_workspace_id uuid, p_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.starts_at, s.ends_at
  FROM public.task_sessions s
  JOIN public.tasks t ON t.id = s.task_id
  WHERE s.workspace_id = p_workspace_id AND s.user_id = p_user_id AND s.deleted_at IS NULL
    AND s.starts_at < p_to AND s.ends_at > p_from
    AND t.deleted_at IS NULL
    AND coalesce(t.status_category, public.tasks__status_category_of(t.status), 'todo') NOT IN ('done', 'wont_do')
    AND public.tasks__visible_to(s.task_id, p_user_id)
  ORDER BY s.starts_at, s.ends_at
$$;

-- ── 7. Reminders ────────────────────────────────────────────────────────────

-- The sender, a stub (TV-D10's, behind the gate): claims reminders that are
-- due on open tasks (To do, In progress). Only those whose person can see the
-- task count as claimed for delivery; the others are retired at their time,
-- unsent, since a notice names the task. TV-D12 replaces this body to deliver
-- each claimed one (the bell, the desktop app, web push), reading the title
-- for its person through tasks__visible_to again at send time, and to cancel
-- reminders on Backlog and Won't do.
CREATE OR REPLACE FUNCTION public.tasks__fire_reminders(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  WITH due AS (
    SELECT r.id, public.tasks__visible_to(r.task_id, r.user_id) AS deliver
    FROM public.task_reminders r
    JOIN public.tasks t ON t.id = r.task_id
    WHERE r.deleted_at IS NULL AND r.fired_at IS NULL AND r.at <= p_now
      AND t.deleted_at IS NULL AND t.status_category IN ('todo', 'in_progress')
    ORDER BY r.at
    LIMIT p_limit
    FOR UPDATE OF r SKIP LOCKED
  ), claimed AS (
    UPDATE public.task_reminders r SET fired_at = p_now
    FROM due WHERE r.id = due.id
    RETURNING due.deliver
  )
  SELECT count(*) FILTER (WHERE claimed.deliver) INTO v_n FROM claimed;
  RETURN v_n;
END;
$$;

-- Add one of your reminders to a task you can see (TV-D10's body, behind the
-- gate): kind 'at' (with p_at), 'day_before' or 'hour_before' (one each).
-- Answers with your reminders on the task. A reminder is yours alone, so
-- seeing the task is enough (D10-10).
CREATE OR REPLACE FUNCTION public.tasks_op_reminder_add(
  p_workspace_id uuid, p_task_id uuid, p_kind text, p_at timestamptz DEFAULT NULL)
RETURNS SETOF public.task_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  t public.tasks;
BEGIN
  IF v_actor IS NULL OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.tasks x
  WHERE x.id = p_task_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible_to(t.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('at', 'day_before', 'hour_before') THEN
    RAISE EXCEPTION 'A reminder is at a time, a day before due or an hour before due.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'at' THEN
    IF p_at IS NULL THEN
      RAISE EXCEPTION 'A reminder at a time needs the time.' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.task_reminders r
        WHERE r.task_id = t.id AND r.user_id = v_actor AND r.deleted_at IS NULL) >= 10 THEN
      RAISE EXCEPTION 'A task has at most 10 reminders for you.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.task_reminders (workspace_id, task_id, user_id, kind, at)
    VALUES (p_workspace_id, t.id, v_actor, 'at', p_at);
  ELSE
    INSERT INTO public.task_reminders (workspace_id, task_id, user_id, kind, at)
    VALUES (p_workspace_id, t.id, v_actor, p_kind, public.tasks__reminder_at(t, p_kind))
    ON CONFLICT (task_id, user_id, kind) WHERE deleted_at IS NULL AND kind <> 'at' DO NOTHING;
  END IF;
  RETURN QUERY SELECT * FROM public.tasks__reminders_of(t.id, v_actor);
END;
$$;

-- Remove one of your reminders; one on a task you no longer see reads as
-- missing (the sender retires it at its time).
CREATE OR REPLACE FUNCTION public.tasks_op_reminder_remove(p_workspace_id uuid, p_reminder_id uuid)
RETURNS SETOF public.task_reminders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  r public.task_reminders;
BEGIN
  SELECT * INTO r FROM public.task_reminders x
  WHERE x.id = p_reminder_id AND x.workspace_id = p_workspace_id AND x.user_id = v_actor;
  IF v_actor IS NULL OR NOT FOUND OR NOT public.tasks__visible_to(r.task_id, v_actor) THEN
    RAISE EXCEPTION 'Reminder not found.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.task_reminders SET deleted_at = now() WHERE id = r.id AND deleted_at IS NULL;
  RETURN QUERY SELECT * FROM public.tasks__reminders_of(r.task_id, v_actor);
END;
$$;

-- ── 8. Waiting on… ──────────────────────────────────────────────────────────

-- tasks_op_waiting_add goes through tasks__guard_edit (redefined above). The
-- remove op reads an entry of a task the caller can't see as missing.
CREATE OR REPLACE FUNCTION public.tasks_op_waiting_remove(p_workspace_id uuid, p_entry_id uuid)
RETURNS SETOF public.task_waiting
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.task_waiting;
  t public.tasks;
BEGIN
  SELECT * INTO w FROM public.task_waiting x
  WHERE x.id = p_entry_id AND x.workspace_id = p_workspace_id;
  IF NOT FOUND OR NOT public.tasks__visible(w.task_id) THEN
    RAISE EXCEPTION 'Waiting entry not found.' USING ERRCODE = '22023';
  END IF;
  t := public.tasks__guard_edit(p_workspace_id, w.task_id);
  IF w.deleted_at IS NULL THEN
    UPDATE public.task_waiting SET deleted_at = now() WHERE id = w.id;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.waiting_remove',
      jsonb_strip_nulls(jsonb_build_object('kind', w.kind, 'ref', w.ref, 'label', w.label)));
  END IF;
  RETURN QUERY SELECT * FROM public.tasks__waiting_of(t.id);
END;
$$;

-- ── 9. The project edit gate and writes other triggers make ─────────────────

-- buckets__area_sync (TV-D10's body). The edit gate skips a write another
-- trigger makes only when it is what a foreign key's SET NULL does: the
-- project's area cleared, its label untouched (an area deleted for good).
-- Anything else asks projects__editable, however deep it was made.
CREATE OR REPLACE FUNCTION public.buckets__area_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_area_leads boolean := false;
  v_label_leads boolean := false;
BEGIN
  -- An area's own rename relabels its projects (areas__mirror_labels).
  IF coalesce(current_setting('tasks.area_mirror', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_system THEN
    NEW.area_id := NULL;
    RETURN NEW;
  END IF;
  -- Filing a project under an area needs edit on the project (the single
  -- gate; system work aside, and so is a foreign key clearing the area).
  IF TG_OP = 'UPDATE'
     AND (NEW.area_id IS DISTINCT FROM OLD.area_id OR NEW.group_label IS DISTINCT FROM OLD.group_label)
     AND public.perm_actor_id() IS NOT NULL
     AND coalesce(current_setting('share.bypass', true), '') <> '1'
     AND NOT (pg_trigger_depth() > 1
              AND OLD.area_id IS NOT NULL AND NEW.area_id IS NULL
              AND NEW.group_label IS NOT DISTINCT FROM OLD.group_label)
     AND NOT public.projects__editable(NEW.id) THEN
    RAISE EXCEPTION 'You don''t have edit access to this project.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_area_leads := NEW.area_id IS NOT NULL;
    v_label_leads := NOT v_area_leads AND nullif(btrim(coalesce(NEW.group_label, '')), '') IS NOT NULL;
  ELSIF NEW.area_id IS DISTINCT FROM OLD.area_id THEN
    v_area_leads := true;
  ELSIF NEW.group_label IS DISTINCT FROM OLD.group_label THEN
    v_label_leads := true;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL AND NEW.area_id IS NULL
        AND nullif(btrim(coalesce(NEW.group_label, '')), '') IS NOT NULL THEN
    v_label_leads := true;
  END IF;

  IF v_area_leads THEN
    IF NEW.area_id IS NULL THEN
      NEW.group_label := NULL;
    ELSE
      SELECT a.name INTO v_name FROM public.areas a
      WHERE a.id = NEW.area_id AND a.workspace_id = NEW.workspace_id AND a.deleted_at IS NULL;
      -- The same gate as reading areas: an area the writer can't see reads
      -- as missing (system work aside).
      IF v_name IS NULL
         OR (public.perm_actor_id() IS NOT NULL
             AND coalesce(current_setting('share.bypass', true), '') <> '1'
             AND NOT public.areas__visible(NEW.area_id)) THEN
        RAISE EXCEPTION 'That area isn''t in this workspace.' USING ERRCODE = '22023';
      END IF;
      NEW.group_label := v_name;
    END IF;
  ELSIF v_label_leads THEN
    NEW.area_id := public.areas__find_or_create(NEW.workspace_id, NEW.group_label);
    IF NEW.area_id IS NULL THEN
      NEW.group_label := NULL;
    ELSE
      SELECT a.name INTO NEW.group_label FROM public.areas a WHERE a.id = NEW.area_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- buckets__project_check (TV-D10's body). The same narrowing: a write another
-- trigger makes skips the edit gate only when all it does is clear the lead or
-- the client (a profile or a contact deleted for good).
CREATE OR REPLACE FUNCTION public.buckets__project_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF NEW.is_system AND (NEW.status <> 'active' OR NEW.starts_on IS NOT NULL OR NEW.target_on IS NOT NULL
                        OR NEW.lead_id IS NOT NULL OR NEW.client_contact_id IS NOT NULL) THEN
    RAISE EXCEPTION 'The Inbox isn''t a project, so it has no project settings or sections.' USING ERRCODE = '22023';
  END IF;
  -- System hand-overs (member removal, account erasure) aren't checked.
  IF coalesce(current_setting('share.bypass', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  -- The same gate as the project ops: changing a project's fields needs edit
  -- on it (PERM-W's write check says so too; this keeps one helper).
  IF TG_OP = 'UPDATE' AND v_actor IS NOT NULL
     AND row(NEW.status, NEW.starts_on, NEW.target_on, NEW.lead_id, NEW.client_contact_id)
         IS DISTINCT FROM row(OLD.status, OLD.starts_on, OLD.target_on, OLD.lead_id, OLD.client_contact_id)
     AND NOT (pg_trigger_depth() > 1
              AND row(NEW.status, NEW.starts_on, NEW.target_on)
                  IS NOT DISTINCT FROM row(OLD.status, OLD.starts_on, OLD.target_on)
              AND (NEW.lead_id IS NOT DISTINCT FROM OLD.lead_id OR NEW.lead_id IS NULL)
              AND (NEW.client_contact_id IS NOT DISTINCT FROM OLD.client_contact_id OR NEW.client_contact_id IS NULL))
     AND NOT public.projects__editable(NEW.id) THEN
    RAISE EXCEPTION 'You don''t have edit access to this project.' USING ERRCODE = '42501';
  END IF;
  IF NEW.lead_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.lead_id IS DISTINCT FROM OLD.lead_id)
     AND NOT public.tasks__is_member(NEW.workspace_id, NEW.lead_id) THEN
    RAISE EXCEPTION 'A project''s lead has to be in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF NEW.client_contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.client_contact_id IS DISTINCT FROM OLD.client_contact_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.contacts c
                   WHERE c.id = NEW.client_contact_id AND c.workspace_id = NEW.workspace_id
                     AND c.deleted_at IS NULL)
       OR (v_actor IS NOT NULL AND NOT public.can_access('contact', NEW.client_contact_id, 'view', v_actor)) THEN
      RAISE EXCEPTION 'That contact isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 10. Grants ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Only other server functions (and the service role) call these.
  FOREACH fn IN ARRAY ARRAY[
    'tasks__visible_to(uuid, uuid)', 'tasks__editable_to(uuid, uuid)',
    'tasks__guard_edit(uuid, uuid)', 'tasks__check_session_person(public.tasks, uuid)',
    'tasks__session_legacy()', 'tasks__fire_reminders(timestamptz, integer)',
    'tasks__busy_sessions(uuid, uuid, timestamptz, timestamptz)',
    'buckets__area_sync()', 'buckets__project_check()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- The policies call these; they answer only for the caller.
  FOREACH fn IN ARRAY ARRAY['tasks__visible(uuid)', 'tasks__editable(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_session_add(uuid, uuid, jsonb)', 'tasks_op_session_update(uuid, uuid, jsonb)',
    'tasks_op_session_remove(uuid, uuid)', 'tasks_op_unschedule(uuid, uuid)',
    'tasks_op_reminder_add(uuid, uuid, text, timestamptz)', 'tasks_op_reminder_remove(uuid, uuid)',
    'tasks_op_waiting_remove(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

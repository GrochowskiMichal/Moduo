-- TV-D10 · Expand II, part 2 of 3: work sessions, reminders, Waiting on…
-- (specs/tasks-v3.md block 10, §Assumptions #4, #12, #24, #26, #27; §1–2;
-- REPLAN 24, 25, default d; decisions in docs/decisions/tasks.md "TV-D10").
--
--   * task_sessions: a task can be scheduled into several calendar blocks,
--     each someone's (user_id). Until TV-D7, tasks.scheduled_at and
--     duration_minutes mirror the task's next session: the earliest one that
--     hasn't ended, else the latest. The mirror follows every session change
--     and a 15-minute job moves it on when a session ends with a later one
--     waiting. A write of scheduled_at / duration_minutes that isn't the
--     mirror (builds from before TV-D10, the current app's schedule picker,
--     the repeat engine) edits the session the mirror showed, or makes the
--     first one. Clearing scheduled_at removes that session only through an op
--     (tasks_op_update, tasks_op_unschedule); a raw clear (a whole-row save
--     from an old build can carry a stale null) never deletes a session, and
--     the mirror puts the time back.
--   * Sessions count as busy for their person's booking links, with a switch
--     per link: the pseudo-calendar "tasks" in exposed_slot_links
--     .busy_calendar_ids, on for every link (default d). booking-public reads
--     the sessions; a guest never sees a title.
--   * task_reminders: "Remind me at…" (kind 'at') and 1 day / 1 hour before
--     due (kinds 'day_before', 'hour_before', recomputed when the due date,
--     due time or assignee changes; a date-only due reminds at 09:00 in the
--     task's zone). Each is one person's. A pg_cron stub claims due reminders
--     (fired_at) every 5 minutes; TV-D12 delivers them and cancels them for
--     Backlog and Won't do.
--   * task_waiting: Waiting on… is a list (default q): a person, an email
--     thread, an agent (API key) or free text, each with a "since".
--   * Ops: tasks_op_session_add/_update/_remove, tasks_op_reminder_add/_remove,
--     tasks_op_waiting_add/_remove; tasks_op_unschedule removes the shown
--     session.
--
-- Part 3 (20261010182000_teams.sql) redefines tasks_op_update (the op flag for
-- a schedule cleared through it) and account erasure. Apply all three, in
-- order. Expand only: nothing is dropped.
-- Verified on the local stack by supabase/tests/sessions.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Whose calendar holds the block.
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT task_sessions_range_check CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '7 days')
);
CREATE INDEX IF NOT EXISTS task_sessions_task
  ON public.task_sessions (task_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_sessions_user
  ON public.task_sessions (user_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_sessions_live_ends
  ON public.task_sessions (ends_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_sessions_workspace_updated
  ON public.task_sessions (workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS public.task_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  -- Who is reminded (reminders are personal).
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- When it fires. For a relative kind, from the due date; null while the
  -- task has no due date.
  at timestamptz,
  -- Claimed by the sender (tasks__fire_reminders).
  fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT task_reminders_kind_check CHECK (kind IN ('at','day_before','hour_before')),
  CONSTRAINT task_reminders_at_check CHECK (kind <> 'at' OR at IS NOT NULL)
);
-- One of each relative kind per person and task.
CREATE UNIQUE INDEX IF NOT EXISTS task_reminders_one_relative
  ON public.task_reminders (task_id, user_id, kind) WHERE deleted_at IS NULL AND kind <> 'at';
CREATE INDEX IF NOT EXISTS task_reminders_due
  ON public.task_reminders (at) WHERE deleted_at IS NULL AND fired_at IS NULL;
CREATE INDEX IF NOT EXISTS task_reminders_task ON public.task_reminders (task_id);
CREATE INDEX IF NOT EXISTS task_reminders_user ON public.task_reminders (user_id);
CREATE INDEX IF NOT EXISTS task_reminders_workspace_updated
  ON public.task_reminders (workspace_id, updated_at);

CREATE TABLE IF NOT EXISTS public.task_waiting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- person: a profile; email: an email thread (email_refs); agent: an API key.
  ref uuid,
  -- What a 'text' entry waits on. Never set for the others: their names come
  -- from the item, so a reader who can't open an email never sees its subject.
  label text,
  since timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT task_waiting_kind_check CHECK (kind IN ('person','email','agent','text')),
  CONSTRAINT task_waiting_shape_check CHECK (
    (kind = 'text' AND ref IS NULL AND label IS NOT NULL AND char_length(label) BETWEEN 1 AND 200)
    OR (kind <> 'text' AND ref IS NOT NULL AND label IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS task_waiting_one_per_ref
  ON public.task_waiting (task_id, kind, ref) WHERE deleted_at IS NULL AND ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_waiting_task ON public.task_waiting (task_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS task_waiting_ref ON public.task_waiting (kind, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_waiting_workspace_updated
  ON public.task_waiting (workspace_id, updated_at);

-- Sessions and Waiting on… follow the task's access; reminders are their
-- person's own. Every write goes through the ops below.
ALTER TABLE public.task_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_sessions_read ON public.task_sessions;
CREATE POLICY task_sessions_read ON public.task_sessions
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks') AND public.can_access('task', task_id, 'view'));

ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_reminders_read ON public.task_reminders;
CREATE POLICY task_reminders_read ON public.task_reminders
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.can_access('task', task_id, 'view'));

ALTER TABLE public.task_waiting ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_waiting_read ON public.task_waiting;
CREATE POLICY task_waiting_read ON public.task_waiting
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks') AND public.can_access('task', task_id, 'view'));

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['task_sessions', 'task_reminders', 'task_waiting'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at()', v_table);
    -- Live updates (the shared store, TV-D11a, listens).
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                         AND tablename = v_table) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

-- ── 2. A task the caller may edit ───────────────────────────────────────────

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
  IF NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  IF NOT public.can_access('task', t.id, 'edit', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
  END IF;
  RETURN t;
END;
$$;

-- ── 3. Sessions and the scheduled_at mirror ─────────────────────────────────

-- The session a task shows: the earliest that hasn't ended, else the latest.
CREATE OR REPLACE FUNCTION public.tasks__next_session(p_task_id uuid, p_now timestamptz)
RETURNS public.task_sessions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.* FROM public.task_sessions s
  WHERE s.task_id = p_task_id AND s.deleted_at IS NULL
  ORDER BY (s.ends_at <= p_now),
           CASE WHEN s.ends_at > p_now THEN s.starts_at END ASC NULLS LAST,
           s.starts_at DESC, s.id
  LIMIT 1
$$;

-- Write the mirror: scheduled_at = the shown session's start, duration_minutes
-- = its length (left as it is with no session, where it's only the estimate;
-- and left null for the app's default 30-minute block). No write when nothing
-- changes. tasks.session_mirror tells the other triggers this isn't an edit.
CREATE OR REPLACE FUNCTION public.tasks__session_mirror(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  s public.task_sessions;
  v_at timestamptz;
  v_minutes integer;
  v_flag text;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  s := public.tasks__next_session(p_task_id, now());
  IF s.id IS NULL THEN
    v_at := NULL;
    v_minutes := t.duration_minutes;
  ELSE
    v_at := s.starts_at;
    v_minutes := round(extract(epoch FROM s.ends_at - s.starts_at) / 60)::integer;
    IF t.duration_minutes IS NULL AND v_minutes = 30 THEN
      v_minutes := NULL;
    END IF;
  END IF;
  IF t.scheduled_at IS NOT DISTINCT FROM v_at AND t.duration_minutes IS NOT DISTINCT FROM v_minutes THEN
    RETURN;
  END IF;
  v_flag := current_setting('tasks.session_mirror', true);
  PERFORM set_config('tasks.session_mirror', '1', true);
  UPDATE public.tasks SET scheduled_at = v_at, duration_minutes = v_minutes, updated_at = now()
  WHERE id = p_task_id;
  PERFORM set_config('tasks.session_mirror', coalesce(v_flag, ''), true);
END;
$$;

-- AFTER every session change: the task's mirror follows.
CREATE OR REPLACE FUNCTION public.task_sessions__mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.tasks__session_mirror(coalesce(NEW.task_id, OLD.task_id));
  IF TG_OP = 'UPDATE' AND NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    PERFORM public.tasks__session_mirror(OLD.task_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS task_sessions_mirror ON public.task_sessions;
CREATE TRIGGER task_sessions_mirror
  AFTER INSERT OR UPDATE OR DELETE ON public.task_sessions
  FOR EACH ROW EXECUTE FUNCTION public.task_sessions__mirror();

-- AFTER a write of scheduled_at / duration_minutes that isn't the mirror: the
-- write edits the session the mirror showed (matched by its start, else the
-- task's next one), or makes the first. The session belongs to whoever
-- scheduled it (else the assignee, else the creator).
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
BEGIN
  IF coalesce(current_setting('tasks.session_mirror', true), '') = '1' THEN
    RETURN NULL;
  END IF;
  v_user := coalesce(public.perm_actor_id(), NEW.assignee_id, NEW.owner_id);
  v_len := make_interval(mins => coalesce(nullif(NEW.duration_minutes, 0), 30));

  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_at IS NOT NULL THEN
      INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at)
      VALUES (NEW.workspace_id, NEW.id, v_user, NEW.scheduled_at, NEW.scheduled_at + v_len);
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at
     AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes THEN
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

DROP TRIGGER IF EXISTS tasks_session_legacy ON public.tasks;
CREATE TRIGGER tasks_session_legacy
  AFTER INSERT OR UPDATE OF scheduled_at, duration_minutes ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__session_legacy();

-- Every 15 minutes: tasks whose shown session ended while a later one waits
-- show the later one (the mirror otherwise moves only on writes).
CREATE OR REPLACE FUNCTION public.tasks__session_mirror_refresh(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_n integer := 0;
BEGIN
  FOR v_id IN
    SELECT t.id FROM public.tasks t
    WHERE t.id IN (SELECT s.task_id FROM public.task_sessions s
                   WHERE s.deleted_at IS NULL AND s.ends_at > now())
      AND t.scheduled_at IS DISTINCT FROM (public.tasks__next_session(t.id, now())).starts_at
    LIMIT p_limit
  LOOP
    PERFORM public.tasks__session_mirror(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

SELECT cron.schedule(
  'tasks-session-mirror',
  '*/15 * * * *',
  $cron$SET statement_timeout = '60s'; SELECT public.tasks__session_mirror_refresh(1000)$cron$
);

-- Backfill: every scheduled task's block becomes its first session (with the
-- tasks' triggers off; the session triggers too, since the mirror would only
-- read back what it wrote).
ALTER TABLE public.task_sessions DISABLE TRIGGER USER;
INSERT INTO public.task_sessions (workspace_id, task_id, user_id, starts_at, ends_at, created_at, updated_at)
SELECT t.workspace_id, t.id, p.id, t.scheduled_at,
       t.scheduled_at + make_interval(mins => coalesce(nullif(t.duration_minutes, 0), 30)),
       now(), now()
FROM public.tasks t
LEFT JOIN public.profiles p ON p.id = coalesce(t.assignee_id, t.owner_id)
WHERE t.scheduled_at IS NOT NULL
  AND coalesce(nullif(t.duration_minutes, 0), 30) <= 7 * 24 * 60
  AND NOT EXISTS (SELECT 1 FROM public.task_sessions s WHERE s.task_id = t.id);
ALTER TABLE public.task_sessions ENABLE TRIGGER USER;

-- Session ops. Each needs edit on the task and answers with the task's live
-- sessions in time order; the trail names the change.

CREATE OR REPLACE FUNCTION public.tasks__sessions_of(p_task_id uuid)
RETURNS SETOF public.task_sessions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.task_sessions s
  WHERE s.task_id = p_task_id AND s.deleted_at IS NULL
  ORDER BY s.starts_at, s.id
$$;

CREATE OR REPLACE FUNCTION public.tasks__session_times(p_fields jsonb, p_starts timestamptz, p_ends timestamptz,
  OUT starts_at timestamptz, OUT ends_at timestamptz)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  starts_at := CASE WHEN p_fields ? 'starts_at' THEN public.tasks__try_ts(p_fields ->> 'starts_at') ELSE p_starts END;
  ends_at := CASE WHEN p_fields ? 'ends_at' THEN public.tasks__try_ts(p_fields ->> 'ends_at') ELSE p_ends END;
  IF starts_at IS NULL OR ends_at IS NULL THEN
    RAISE EXCEPTION 'A session needs a start and an end.' USING ERRCODE = '22023';
  END IF;
  IF ends_at <= starts_at THEN
    RAISE EXCEPTION 'A session has to end after it starts.' USING ERRCODE = '22023';
  END IF;
  IF ends_at > starts_at + interval '7 days' THEN
    RAISE EXCEPTION 'A session is at most 7 days long.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Schedule a session. Keys: id, starts_at, ends_at, user_id (default: you; a
-- teammate has to be someone who can work on tasks). A resent add answers as
-- the first did.
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
  IF v_user IS DISTINCT FROM public.perm_actor_id() THEN
    PERFORM public.tasks__check_assignee(p_workspace_id, v_user);
  END IF;
  INSERT INTO public.task_sessions (id, workspace_id, task_id, user_id, starts_at, ends_at)
  VALUES (v_id, p_workspace_id, t.id, v_user, v_times.starts_at, v_times.ends_at);
  PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.session_add',
    jsonb_build_object('starts_at', v_times.starts_at, 'ends_at', v_times.ends_at));
  RETURN QUERY SELECT * FROM public.tasks__sessions_of(t.id);
END;
$$;

-- Move or resize a session (starts_at, ends_at), or hand it to someone
-- (user_id).
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found.' USING ERRCODE = '22023';
  END IF;
  t := public.tasks__guard_edit(p_workspace_id, s.task_id);
  SELECT * INTO s FROM public.task_sessions WHERE id = s.id FOR UPDATE;
  v_times := public.tasks__session_times(p_patch, s.starts_at, s.ends_at);
  v_user := CASE WHEN p_patch ? 'user_id' THEN public.tasks__try_uuid(p_patch ->> 'user_id') ELSE s.user_id END;
  IF v_user IS DISTINCT FROM s.user_id AND v_user IS DISTINCT FROM public.perm_actor_id() THEN
    PERFORM public.tasks__check_assignee(p_workspace_id, v_user);
  END IF;
  IF row(v_times.starts_at, v_times.ends_at, v_user) IS DISTINCT FROM row(s.starts_at, s.ends_at, s.user_id) THEN
    UPDATE public.task_sessions SET starts_at = v_times.starts_at, ends_at = v_times.ends_at, user_id = v_user
    WHERE id = s.id;
    PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.session_move',
      jsonb_build_object('from', s.starts_at, 'to', v_times.starts_at, 'ends_at', v_times.ends_at));
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
  IF NOT FOUND THEN
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

-- tasks_op_unschedule (newest body: the catalog on 2026-10-10, TV-D8's guard
-- unchanged since): clearing the schedule through the op removes the session
-- it showed (the op flag), so another session, if any, shows next.
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
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF NOT public.can_access('task', t.id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
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
  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.unschedule',
    jsonb_build_object('from', v_from)
  );
  RETURN t;
END;
$$;

-- ── 4. Busy for booking links (default d) ───────────────────────────────────

-- The pseudo-calendar "tasks" in a link's busy list: the host's work sessions
-- block slots. On for every link, existing ones included; the link editor's
-- busy list switches it per link.
ALTER TABLE public.exposed_slot_links ALTER COLUMN busy_calendar_ids SET DEFAULT '["moduo", "tasks"]'::jsonb;
UPDATE public.exposed_slot_links
SET busy_calendar_ids = busy_calendar_ids || '["tasks"]'::jsonb
WHERE jsonb_typeof(busy_calendar_ids) = 'array' AND NOT busy_calendar_ids ? 'tasks';

-- ── 5. Reminders ────────────────────────────────────────────────────────────

-- When a reminder of this kind fires for the task: 'day_before' at the due
-- time (09:00 for a date-only due) the day before, 'hour_before' an hour
-- before it, in the task's zone (assignee, else creator). Null without a due
-- date, and for 'at'.
CREATE OR REPLACE FUNCTION public.tasks__reminder_at(t public.tasks, p_kind text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN t.due_on IS NULL THEN NULL
    WHEN p_kind = 'day_before' THEN
      ((t.due_on - 1) + coalesce(t.due_time, time '09:00')) AT TIME ZONE public.tasks__zone_of(t)
    WHEN p_kind = 'hour_before' THEN
      ((t.due_on + coalesce(t.due_time, time '09:00')) AT TIME ZONE public.tasks__zone_of(t)) - interval '1 hour'
  END
$$;

-- AFTER a due date, due time or person change: relative reminders follow; one
-- that moves into the future fires again.
CREATE OR REPLACE FUNCTION public.tasks__reminders_follow_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.task_reminders r SET
    at = public.tasks__reminder_at(NEW, r.kind),
    fired_at = CASE WHEN public.tasks__reminder_at(NEW, r.kind) > now() THEN NULL ELSE r.fired_at END
  WHERE r.task_id = NEW.id AND r.kind <> 'at' AND r.deleted_at IS NULL
    AND r.at IS DISTINCT FROM public.tasks__reminder_at(NEW, r.kind);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_reminders_follow_due ON public.tasks;
CREATE TRIGGER tasks_reminders_follow_due
  AFTER UPDATE OF due_on, due_time, assignee_id ON public.tasks
  FOR EACH ROW
  WHEN (OLD.due_on IS DISTINCT FROM NEW.due_on OR OLD.due_time IS DISTINCT FROM NEW.due_time
        OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id)
  EXECUTE FUNCTION public.tasks__reminders_follow_due();

-- The sender, a stub: claims reminders that are due on open tasks (To do, In
-- progress). TV-D12 replaces this body to deliver each one (the bell, the
-- desktop app, web push) and to cancel reminders on Backlog and Won't do.
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
    SELECT r.id FROM public.task_reminders r
    JOIN public.tasks t ON t.id = r.task_id
    WHERE r.deleted_at IS NULL AND r.fired_at IS NULL AND r.at <= p_now
      AND t.deleted_at IS NULL AND t.status_category IN ('todo', 'in_progress')
    ORDER BY r.at
    LIMIT p_limit
    FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE public.task_reminders r SET fired_at = p_now
  FROM due WHERE r.id = due.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

SELECT cron.schedule(
  'tasks-reminders',
  '*/5 * * * *',
  $cron$SET statement_timeout = '60s'; SELECT public.tasks__fire_reminders(now(), 500)$cron$
);

CREATE OR REPLACE FUNCTION public.tasks__reminders_of(p_task_id uuid, p_user uuid)
RETURNS SETOF public.task_reminders
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.task_reminders r
  WHERE r.task_id = p_task_id AND r.user_id = p_user AND r.deleted_at IS NULL
  ORDER BY r.at NULLS LAST, r.created_at, r.id
$$;

-- Add one of your reminders to a task you can see: kind 'at' (with p_at),
-- 'day_before' or 'hour_before' (one each). Answers with your reminders on
-- the task. A reminder is yours alone, so seeing the task is enough.
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
  IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
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
  IF v_actor IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'Reminder not found.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.task_reminders SET deleted_at = now() WHERE id = r.id AND deleted_at IS NULL;
  RETURN QUERY SELECT * FROM public.tasks__reminders_of(r.task_id, v_actor);
END;
$$;

-- ── 6. Waiting on… ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks__waiting_of(p_task_id uuid)
RETURNS SETOF public.task_waiting
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.task_waiting w
  WHERE w.task_id = p_task_id AND w.deleted_at IS NULL
  ORDER BY w.since, w.created_at, w.id
$$;

-- Add an entry. Keys: id, kind (person · email · agent · text), ref (the
-- person, email thread or API key), label (the text, for kind text), since
-- (default now). The same person, email or agent twice is one entry. Answers
-- with the task's live entries.
CREATE OR REPLACE FUNCTION public.tasks_op_waiting_add(p_workspace_id uuid, p_task_id uuid, p_entry jsonb)
RETURNS SETOF public.task_waiting
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_kind text := p_entry ->> 'kind';
  v_ref uuid;
  v_label text;
  v_since timestamptz;
  v_id uuid;
BEGIN
  PERFORM public.tasks__check_keys(p_entry, ARRAY['id', 'kind', 'ref', 'label', 'since']);
  t := public.tasks__guard_edit(p_workspace_id, p_task_id);
  IF v_kind IS NULL OR v_kind NOT IN ('person', 'email', 'agent', 'text') THEN
    RAISE EXCEPTION 'Waiting on is a person, an email, an agent or a note.' USING ERRCODE = '22023';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(p_entry ->> 'id'), gen_random_uuid());
  IF EXISTS (SELECT 1 FROM public.task_waiting w WHERE w.id = v_id) THEN
    RETURN QUERY SELECT * FROM public.tasks__waiting_of(t.id);
    RETURN;
  END IF;
  v_since := CASE WHEN p_entry ? 'since' AND jsonb_typeof(p_entry -> 'since') <> 'null'
                  THEN public.tasks__try_ts(p_entry ->> 'since') ELSE now() END;
  IF v_since IS NULL THEN
    RAISE EXCEPTION 'since is a date and time.' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'text' THEN
    v_label := btrim(coalesce(p_entry ->> 'label', ''));
    IF v_label = '' OR char_length(v_label) > 200 THEN
      RAISE EXCEPTION 'Say what this waits on (at most 200 characters).' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_ref := public.tasks__try_uuid(p_entry ->> 'ref');
    IF v_kind = 'person' AND NOT public.tasks__is_member(p_workspace_id, v_ref) THEN
      RAISE EXCEPTION 'That person isn''t a member of this workspace.' USING ERRCODE = '22023';
    ELSIF v_kind = 'email' AND (v_ref IS NULL
          OR NOT EXISTS (SELECT 1 FROM public.email_refs e WHERE e.id = v_ref AND e.workspace_id = p_workspace_id)
          OR NOT public.perm_can_see_entity(p_workspace_id, 'email_thread', v_ref)) THEN
      RAISE EXCEPTION 'That email isn''t in this workspace.' USING ERRCODE = '22023';
    ELSIF v_kind = 'agent' AND (v_ref IS NULL
          OR NOT EXISTS (SELECT 1 FROM public.workspace_api_keys k WHERE k.id = v_ref AND k.workspace_id = p_workspace_id)) THEN
      RAISE EXCEPTION 'That agent isn''t connected to this workspace.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.task_waiting w
               WHERE w.task_id = t.id AND w.kind = v_kind AND w.ref = v_ref AND w.deleted_at IS NULL) THEN
      RETURN QUERY SELECT * FROM public.tasks__waiting_of(t.id);
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.task_waiting (id, workspace_id, task_id, kind, ref, label, since, created_by)
  VALUES (v_id, p_workspace_id, t.id, v_kind, v_ref, v_label, v_since, public.perm_actor_id());
  PERFORM public.module_activity_log(p_workspace_id, 'tasks', 'task', t.id, 'tasks.waiting_add',
    jsonb_strip_nulls(jsonb_build_object('kind', v_kind, 'ref', v_ref, 'label', v_label)));
  RETURN QUERY SELECT * FROM public.tasks__waiting_of(t.id);
END;
$$;

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
  IF NOT FOUND THEN
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

-- ── 7. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks__guard_edit(uuid, uuid)', 'tasks__next_session(uuid, timestamptz)',
    'tasks__session_mirror(uuid)', 'task_sessions__mirror()', 'tasks__session_legacy()',
    'tasks__session_mirror_refresh(integer)', 'tasks__sessions_of(uuid)',
    'tasks__reminder_at(public.tasks, text)', 'tasks__reminders_follow_due()',
    'tasks__fire_reminders(timestamptz, integer)', 'tasks__reminders_of(uuid, uuid)',
    'tasks__waiting_of(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['tasks__session_times(jsonb, timestamptz, timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_session_add(uuid, uuid, jsonb)', 'tasks_op_session_update(uuid, uuid, jsonb)',
    'tasks_op_session_remove(uuid, uuid)', 'tasks_op_unschedule(uuid, uuid)',
    'tasks_op_reminder_add(uuid, uuid, text, timestamptz)', 'tasks_op_reminder_remove(uuid, uuid)',
    'tasks_op_waiting_add(uuid, uuid, jsonb)', 'tasks_op_waiting_remove(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

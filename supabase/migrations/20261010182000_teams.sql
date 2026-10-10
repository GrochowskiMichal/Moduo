-- TV-D10 · Expand II, part 3 of 3: teams, the task ops' new fields, account
-- erasure for every D10 table (specs/tasks-v3.md block 10, §Assumptions #12,
-- #20, #24, #26, #27; §1; REPLAN 54, 94, 95, defaults s–t; decisions in
-- docs/decisions/tasks.md "TV-D10").
--
--   * teams: named groups of members that route work (routing now, access
--     later: a team hides nothing). A team has a two-letter mark (made from
--     its name, editable), an optional colour and an optional default project.
--     team_members: who's in it (members who can work on tasks). Any member
--     who can edit Tasks makes a team and edits its members; only its creator,
--     the workspace owner or an admin deletes it (default t).
--   * tasks.team_id: a task's optional team, next to its one assignee. A task
--     for a team needs a project, since an Inbox is private: routing a task
--     that sits in an Inbox (or names no project) files it into the team's
--     default project, else it's refused (94). A team task moved into an Inbox
--     (by hand, a project's delete, an old build, account erasure) leaves its
--     team. A member leaving a team changes no task.
--   * tasks.imported_from {source, key}: unique per workspace among live
--     tasks, so an import run twice finds what it made (TV-D16 uses it).
--   * tasks_op_create / tasks_op_update (bodies from the catalog after TV-D9's
--     20261010171000) take section_id, team_id, estimate_minutes and, on
--     create, imported_from; clearing scheduled_at through the update op
--     removes the session it showed (part 2's op flag); both answer with the
--     row as it stands after the session mirror.
--   * account_erase_workspace_data (body from the catalog after TV-D9) also
--     erases the person's sessions, reminders and team memberships, the
--     Waiting on… entries that name them, and their project leads, in
--     workspaces they don't own; and their projects' slots in everyone's time
--     blocks.
--
-- Apply after 20261010180000 and 20261010181000. Expand only.
-- Verified on the local stack by supabase/tests/teams.test.sql (and
-- structure.test.sql, sessions.test.sql for the op fields and erasure).

SET LOCAL lock_timeout = '5s';

-- Part 1 and 2 first; and the erasure below builds on TV-D9's body.
DO $$
BEGIN
  IF to_regclass('public.sections') IS NULL OR to_regclass('public.task_sessions') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261010180000 and 20261010181000 before this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'account_erase_workspace_data'
                   AND prosrc LIKE '%tasks_completed_by_cleared%') THEN
    RAISE EXCEPTION 'Apply TV-D9 (20261010171000) before this migration.';
  END IF;
END;
$$;

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Two letters (95): made from the name, editable.
  mark text NOT NULL,
  color text,
  default_project_id uuid REFERENCES public.buckets(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT teams_name_check CHECK (char_length(name) BETWEEN 1 AND 60 AND name = btrim(name)),
  CONSTRAINT teams_mark_check CHECK (char_length(mark) BETWEEN 1 AND 2 AND mark = upper(mark)),
  CONSTRAINT teams_color_check CHECK (color IS NULL OR char_length(color) BETWEEN 1 AND 32)
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_per_workspace
  ON public.teams (workspace_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS teams_workspace_updated ON public.teams (workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS teams_default_project ON public.teams (default_project_id)
  WHERE default_project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_one_per_person
  ON public.team_members (team_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS team_members_user ON public.team_members (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS team_members_workspace_updated ON public.team_members (workspace_id, updated_at);

-- Teams hide nothing: whoever reads Tasks in the workspace reads them. Every
-- write goes through the ops below.
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teams_read ON public.teams;
CREATE POLICY teams_read ON public.teams
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks'));
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_members_read ON public.team_members;
CREATE POLICY team_members_read ON public.team_members
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks'));

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['teams', 'team_members'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.%I', v_table);
    EXECUTE format('CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at()', v_table);
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                         AND tablename = v_table) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS imported_from jsonb;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_imported_from_check;
ALTER TABLE public.tasks
  -- coalesce: a missing key reads NULL, and a NULL check passes.
  ADD CONSTRAINT tasks_imported_from_check CHECK (
    imported_from IS NULL OR coalesce(
      jsonb_typeof(imported_from) = 'object'
      AND jsonb_typeof(imported_from -> 'source') = 'string'
      AND jsonb_typeof(imported_from -> 'key') = 'string'
      AND char_length(imported_from ->> 'source') BETWEEN 1 AND 40
      AND char_length(imported_from ->> 'key') BETWEEN 1 AND 200, false));
CREATE INDEX IF NOT EXISTS tasks_team_id_idx ON public.tasks (team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_imported_from_key
  ON public.tasks (workspace_id, (imported_from ->> 'source'), (imported_from ->> 'key'))
  WHERE imported_from IS NOT NULL AND deleted_at IS NULL;

-- ── 2. Marks and routing ────────────────────────────────────────────────────

-- Two letters from a name: the initials of its first two words, else its first
-- letter and the next consonant (Design DS, Development DV).
CREATE OR REPLACE FUNCTION public.teams__auto_mark(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_words text[];
  v_word text;
  v_next text;
BEGIN
  SELECT coalesce(array_agg(w), '{}') INTO v_words
  FROM unnest(regexp_split_to_array(
         upper(regexp_replace(coalesce(p_name, ''), '[^[:alnum:][:space:]]+', '', 'g')), '[[:space:]]+')) AS w
  WHERE w <> '';
  IF cardinality(v_words) = 0 THEN
    RETURN '#';
  END IF;
  IF cardinality(v_words) >= 2 THEN
    RETURN left(v_words[1], 1) || left(v_words[2], 1);
  END IF;
  v_word := v_words[1];
  v_next := substring(substr(v_word, 2) FROM '[B-DF-HJ-NP-TV-Z]');
  RETURN left(v_word, 1) || coalesce(v_next, substr(v_word, 2, 1));
END;
$$;

-- BEFORE INSERT/UPDATE OF team_id, bucket_id on tasks: a team of this
-- workspace, and never in an Inbox. Routing a task in an Inbox to a team is
-- refused (the ops file it into the team's default project first); a team
-- task moved into an Inbox leaves its team (an Inbox is private), so a move
-- or a project's delete never fails over it.
CREATE OR REPLACE FUNCTION public.tasks__team_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
     AND NEW.bucket_id IS NOT DISTINCT FROM OLD.bucket_id THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.team_id IS DISTINCT FROM OLD.team_id)
     AND NOT EXISTS (SELECT 1 FROM public.teams x
                     WHERE x.id = NEW.team_id AND x.workspace_id = NEW.workspace_id AND x.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That team isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = NEW.bucket_id AND b.is_system) THEN
    IF (TG_OP = 'INSERT' OR NEW.team_id IS DISTINCT FROM OLD.team_id)
       AND coalesce(current_setting('share.bypass', true), '') <> '1'
       AND public.perm_actor_id() IS NOT NULL THEN
      RAISE EXCEPTION 'A task for a team needs a project. Pick one, or give the team a default project.'
        USING ERRCODE = '22023';
    END IF;
    NEW.team_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_team_check ON public.tasks;
CREATE TRIGGER tasks_team_check
  BEFORE INSERT OR UPDATE OF team_id, bucket_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__team_check();

-- The project a task for this team goes to when it names none (or sits in an
-- Inbox): the team's default project, if it's live and the caller can edit
-- it. Raises when there's none.
CREATE OR REPLACE FUNCTION public.teams__route_project(p_workspace_id uuid, p_team_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT b.id INTO v_project
  FROM public.teams x
  JOIN public.buckets b ON b.id = x.default_project_id
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
    AND b.deleted_at IS NULL AND NOT b.is_system;
  IF NOT EXISTS (SELECT 1 FROM public.teams x
                 WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That team isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'A task for a team needs a project. Pick one, or give the team a default project.'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_project;
END;
$$;

-- ── 3. Team ops ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.teams__members_of(p_team_id uuid)
RETURNS SETOF public.team_members
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.team_members m
  WHERE m.team_id = p_team_id AND m.deleted_at IS NULL
  ORDER BY m.created_at, m.id
$$;

CREATE OR REPLACE FUNCTION public.teams__check_name(p_workspace_id uuid, p_name text, p_except uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text := public.tasks__clean_name(p_name, 'A team', 60);
BEGIN
  IF EXISTS (SELECT 1 FROM public.teams x
             WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
               AND lower(x.name) = lower(v) AND x.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'There''s already a team called "%".', v USING ERRCODE = '23505';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.teams__check_mark(p_mark text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text := upper(btrim(coalesce(p_mark, '')));
BEGIN
  IF char_length(v) NOT BETWEEN 1 AND 2 OR v ~ '[[:space:]]' THEN
    RAISE EXCEPTION 'A team''s mark is one or two letters.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- A default project: a live project of the workspace the caller can see.
CREATE OR REPLACE FUNCTION public.teams__check_project(p_workspace_id uuid, p_project jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v uuid;
BEGIN
  IF p_project IS NULL OR jsonb_typeof(p_project) = 'null' THEN
    RETURN NULL;
  END IF;
  v := public.tasks__try_uuid(p_project #>> '{}');
  IF v IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.buckets b
       WHERE b.id = v AND b.workspace_id = p_workspace_id AND b.deleted_at IS NULL AND NOT b.is_system)
     OR NOT public.can_access('bucket', v, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- Add a member: someone in the workspace who can work on tasks.
CREATE OR REPLACE FUNCTION public.teams__add_member(t public.teams, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'That person isn''t a member of this workspace.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tasks__check_assignee(t.workspace_id, p_user);
  INSERT INTO public.team_members (workspace_id, team_id, user_id)
  VALUES (t.workspace_id, t.id, p_user)
  ON CONFLICT (team_id, user_id) WHERE deleted_at IS NULL DO NOTHING;
END;
$$;

-- Make a team. Keys: id, name, mark (default: from the name), color,
-- default_project_id, members (people to add). A resent create answers with
-- the team it made.
CREATE OR REPLACE FUNCTION public.teams_op_create(p_workspace_id uuid, p_team jsonb)
RETURNS public.teams
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.teams;
  v_id uuid;
  v_name text;
  v_user text;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(p_team, ARRAY['id', 'name', 'mark', 'color', 'default_project_id', 'members']);
  IF p_team ? 'members' AND jsonb_typeof(p_team -> 'members') <> 'array' THEN
    RAISE EXCEPTION 'members is a list of people.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('teams:' || p_workspace_id::text, 0));
  v_id := coalesce(public.tasks__try_uuid(p_team ->> 'id'), gen_random_uuid());
  SELECT * INTO t FROM public.teams WHERE id = v_id;
  IF FOUND THEN
    IF t.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'That team isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    RETURN t;
  END IF;
  v_name := public.teams__check_name(p_workspace_id, p_team ->> 'name', NULL);
  INSERT INTO public.teams (id, workspace_id, name, mark, color, default_project_id, created_by)
  VALUES (
    v_id, p_workspace_id, v_name,
    CASE WHEN nullif(btrim(coalesce(p_team ->> 'mark', '')), '') IS NULL THEN public.teams__auto_mark(v_name)
         ELSE public.teams__check_mark(p_team ->> 'mark') END,
    public.areas__check_color(p_team -> 'color'),
    public.teams__check_project(p_workspace_id, p_team -> 'default_project_id'),
    public.perm_actor_id())
  RETURNING * INTO t;
  FOR v_user IN SELECT jsonb_array_elements_text(coalesce(p_team -> 'members', '[]'::jsonb)) LOOP
    PERFORM public.teams__add_member(t, public.tasks__try_uuid(v_user));
  END LOOP;
  RETURN t;
END;
$$;

-- Rename, re-mark, recolour, set the default project (null clears it), delete
-- or restore ("deleted_at"; only its creator, the owner or an admin).
-- Deleting a team takes it off its tasks; their assignees stay.
CREATE OR REPLACE FUNCTION public.teams_op_update(p_workspace_id uuid, p_team_id uuid, p_patch jsonb)
RETURNS public.teams
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.teams;
  v_actor uuid := public.perm_actor_id();
  v_restore boolean;
  v_bypass text;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(p_patch, ARRAY['name', 'mark', 'color', 'default_project_id', 'deleted_at']);
  PERFORM pg_advisory_xact_lock(hashtextextended('teams:' || p_workspace_id::text, 0));
  v_restore := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null';
  SELECT * INTO t FROM public.teams x
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR (t.deleted_at IS NOT NULL AND NOT v_restore) THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'deleted_at'
     AND (v_restore = (t.deleted_at IS NOT NULL))
     AND NOT (t.created_by IS NOT DISTINCT FROM v_actor
              OR public.perm_is_owner(p_workspace_id, v_actor)
              OR public.perm_user_has(p_workspace_id, v_actor, 'ws.manage_roles')) THEN
    RAISE EXCEPTION 'Only the team''s creator, the workspace owner or an admin can delete a team.'
      USING ERRCODE = '42501';
  END IF;

  IF v_restore AND t.deleted_at IS NOT NULL THEN
    PERFORM public.teams__check_name(p_workspace_id, t.name, t.id);
    UPDATE public.teams SET deleted_at = NULL WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'name' THEN
    UPDATE public.teams SET name = public.teams__check_name(p_workspace_id, p_patch ->> 'name', t.id)
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'mark' THEN
    UPDATE public.teams SET mark = CASE
        WHEN nullif(btrim(coalesce(p_patch ->> 'mark', '')), '') IS NULL THEN public.teams__auto_mark(t.name)
        ELSE public.teams__check_mark(p_patch ->> 'mark') END
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'color' THEN
    UPDATE public.teams SET color = public.areas__check_color(p_patch -> 'color')
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'default_project_id' THEN
    UPDATE public.teams SET default_project_id = public.teams__check_project(p_workspace_id, p_patch -> 'default_project_id')
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'deleted_at' AND NOT v_restore AND t.deleted_at IS NULL THEN
    UPDATE public.teams SET deleted_at = now() WHERE id = t.id RETURNING * INTO t;
    -- The delete's own consequence: system work.
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    UPDATE public.tasks x SET team_id = NULL, updated_at = now() WHERE x.team_id = t.id;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  END IF;
  RETURN t;
END;
$$;

-- Add or remove a member. Answers with the team's members. Removing someone
-- changes no task: what they took stays theirs, what's unclaimed stays the
-- team's.
CREATE OR REPLACE FUNCTION public.teams_op_add_member(p_workspace_id uuid, p_team_id uuid, p_user_id uuid)
RETURNS SETOF public.team_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.teams;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  SELECT * INTO t FROM public.teams x
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.teams__add_member(t, p_user_id);
  RETURN QUERY SELECT * FROM public.teams__members_of(t.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teams_op_remove_member(p_workspace_id uuid, p_team_id uuid, p_user_id uuid)
RETURNS SETOF public.team_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.teams;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  SELECT * INTO t FROM public.teams x
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.team_members m SET deleted_at = now()
  WHERE m.team_id = t.id AND m.user_id = p_user_id AND m.deleted_at IS NULL;
  RETURN QUERY SELECT * FROM public.teams__members_of(t.id);
END;
$$;

-- ── 4. tasks_op_create (catalog body after 20261010171000, plus D10 fields) ──

CREATE OR REPLACE FUNCTION public.tasks_op_create(p_workspace_id uuid, p_task jsonb)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_team uuid;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_task, ARRAY[
    'id', 'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on', 'due_time',
    'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level', 'priority', 'status',
    'status_id', 'position', 'assignee_id',
    -- TV-D10
    'section_id', 'team_id', 'estimate_minutes', 'imported_from']);

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
  -- TV-D10: a task for a team with no project (or an Inbox) goes to the
  -- team's default project.
  v_team := nullif(p_task ->> 'team_id', '')::uuid;
  IF v_team IS NOT NULL AND (v_bucket IS NULL OR EXISTS (
       SELECT 1 FROM public.buckets b WHERE b.id = v_bucket AND b.is_system)) THEN
    v_bucket := public.teams__route_project(p_workspace_id, v_team);
  END IF;
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

  -- TV-D10: an import key names one live task per workspace.
  IF p_task ? 'imported_from' AND jsonb_typeof(p_task -> 'imported_from') <> 'null'
     AND EXISTS (SELECT 1 FROM public.tasks x
                 WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
                   AND x.imported_from ->> 'source' = p_task -> 'imported_from' ->> 'source'
                   AND x.imported_from ->> 'key' = p_task -> 'imported_from' ->> 'key') THEN
    RAISE EXCEPTION 'A task was already imported from that.' USING ERRCODE = '23505';
  END IF;

  -- perm_enforce_write checks the creator's role and the project; the number,
  -- creator, registry entry, any assignment notice, the section and team
  -- checks and the first work session come from the triggers.
  INSERT INTO public.tasks (
    id, workspace_id, bucket_id, parent_id, title, description, due_date, due_on, due_time,
    scheduled_at, duration_minutes, recurrence, energy_level, priority, status, status_id,
    position, assignee_id, owner_id, created_at, updated_at,
    section_id, team_id, estimate_minutes, imported_from)
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
    v_assignee, v_actor, now(), now(),
    nullif(p_task ->> 'section_id', '')::uuid, v_team,
    (p_task ->> 'estimate_minutes')::numeric::integer,
    CASE WHEN jsonb_typeof(p_task -> 'imported_from') = 'object' THEN p_task -> 'imported_from' END)
  RETURNING * INTO t;

  PERFORM public.module_activity_log(
    p_workspace_id, 'tasks', 'task', t.id, 'tasks.create',
    jsonb_build_object('title', t.title, 'number', t.number, 'bucket_id', t.bucket_id));
  IF t.status_category = 'done' THEN
    PERFORM public.tasks__created_done(t);
  END IF;
  -- The row as the session mirror left it.
  SELECT * INTO t FROM public.tasks WHERE id = t.id;
  RETURN t;
END;
$function$;

-- ── 5. tasks_op_update (catalog body after 20261010171000, plus D10 fields) ──

CREATE OR REPLACE FUNCTION public.tasks_op_update(p_workspace_id uuid, p_task_id uuid, p_patch jsonb)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  v_target uuid;
  v_session_flag text;
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.';
  END IF;
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'title', 'description', 'bucket_id', 'parent_id', 'due_date', 'due_on', 'due_time',
    'scheduled_at', 'duration_minutes', 'recurrence', 'energy_level', 'priority', 'position',
    'status', 'status_id', 'assignee_id', 'deleted_at', 'committed_for', 'commit_order',
    'reschedule_count',
    -- TV-D10
    'section_id', 'team_id', 'estimate_minutes']);

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

  -- TV-D10: routing a task in an Inbox to a team files it into the team's
  -- default project (refused when the team has none).
  IF p_patch ? 'team_id' AND nullif(p_patch ->> 'team_id', '') IS NOT NULL THEN
    v_target := CASE WHEN p_patch ? 'bucket_id' THEN nullif(p_patch ->> 'bucket_id', '')::uuid ELSE t.bucket_id END;
    IF v_target IS NULL OR EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = v_target AND b.is_system) THEN
      p_patch := p_patch || jsonb_build_object('bucket_id',
        public.teams__route_project(p_workspace_id, nullif(p_patch ->> 'team_id', '')::uuid));
    END IF;
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
                      'priority', 'position', 'committed_for', 'commit_order', 'reschedule_count',
                      'section_id', 'team_id', 'estimate_minutes'] THEN
    -- TV-D10: a schedule cleared through the op removes the session it showed.
    IF p_patch ? 'scheduled_at' THEN
      v_session_flag := current_setting('tasks.session_op', true);
      PERFORM set_config('tasks.session_op', '1', true);
    END IF;
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
      section_id = CASE WHEN p_patch ? 'section_id' THEN nullif(p_patch ->> 'section_id', '')::uuid ELSE section_id END,
      team_id = CASE WHEN p_patch ? 'team_id' THEN nullif(p_patch ->> 'team_id', '')::uuid ELSE team_id END,
      estimate_minutes = CASE WHEN p_patch ? 'estimate_minutes'
                              THEN (p_patch ->> 'estimate_minutes')::numeric::integer ELSE estimate_minutes END,
      updated_at = now()
    WHERE id = t.id;
    IF p_patch ? 'scheduled_at' THEN
      PERFORM set_config('tasks.session_op', coalesce(v_session_flag, ''), true);
    END IF;
    -- The row as the triggers (the session mirror included) left it.
    SELECT * INTO t FROM public.tasks WHERE id = t.id;

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
                                   'energy_level', 'priority', 'section_id', 'team_id',
                                   'estimate_minutes'] LOOP
      IF to_jsonb(t) -> v_field IS DISTINCT FROM to_jsonb(t0) -> v_field THEN
        -- The estimate mirrors duration_minutes for builds before TV-D10:
        -- name only the field the patch set.
        IF v_field IN ('duration_minutes', 'estimate_minutes') AND NOT p_patch ? v_field THEN
          CONTINUE;
        END IF;
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

-- ── 6. Account erasure (catalog body after 20261010171000, plus D10) ────────

CREATE OR REPLACE FUNCTION public.account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_sessions integer;
  v_reminders integer;
  v_team_members integer;
  v_waiting integer;
  v_leads integer;
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

  -- TV-D10: their work sessions, reminders and team memberships, the Waiting
  -- on… entries that name them, and the projects they lead (the project
  -- stays; the lead is cleared), in other people's workspaces.
  SELECT count(*) INTO v_sessions
  FROM public.task_sessions s WHERE s.user_id = p_user AND s.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_reminders
  FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_team_members
  FROM public.team_members m WHERE m.user_id = p_user AND m.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_waiting
  FROM public.task_waiting w
  WHERE w.kind = 'person' AND w.ref = p_user AND w.workspace_id <> ALL (v_owned);
  SELECT count(*) INTO v_leads
  FROM public.buckets b
  WHERE b.lead_id = p_user AND b.workspace_id <> ALL (v_owned) AND NOT (b.id = ANY (v_bucket_del));

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
    'tasks_completed_by_cleared', v_completed_by,
    'task_sessions_deleted', v_sessions,
    'task_reminders_deleted', v_reminders,
    'team_memberships_deleted', v_team_members,
    'waiting_entries_deleted', v_waiting,
    'project_leads_cleared', v_leads
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

  -- 3d. TV-D10: sessions, reminders, team memberships, Waiting on… them, the
  --     projects they lead, and their name on what they made, in workspaces
  --     they don't own.
  DELETE FROM public.task_sessions s WHERE s.user_id = p_user AND s.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);
  DELETE FROM public.team_members m WHERE m.user_id = p_user AND m.workspace_id <> ALL (v_owned);
  DELETE FROM public.task_waiting w
  WHERE w.kind = 'person' AND w.ref = p_user AND w.workspace_id <> ALL (v_owned);
  UPDATE public.task_waiting w SET created_by = NULL
  WHERE w.created_by = p_user AND w.workspace_id <> ALL (v_owned);
  UPDATE public.teams x SET created_by = NULL
  WHERE x.created_by = p_user AND x.workspace_id <> ALL (v_owned);
  UPDATE public.buckets b SET lead_id = NULL
  WHERE b.lead_id = p_user AND b.workspace_id <> ALL (v_owned);

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
  -- TV-D10: the same in everyone's own time blocks ({workspace: {slot: id}}).
  UPDATE public.user_preferences p
  SET task_time_blocks = (
        SELECT coalesce(jsonb_object_agg(w.key, CASE WHEN jsonb_typeof(w.value) = 'object' THEN coalesce((
                 SELECT jsonb_object_agg(j.key, j.value) FROM jsonb_each(w.value) AS j
                 WHERE NOT coalesce((j.value #>> '{}') = ANY (v_bucket_del::text[]), false)), '{}'::jsonb)
               ELSE w.value END), '{}'::jsonb)
        FROM jsonb_each(p.task_time_blocks) AS w)
  WHERE cardinality(v_bucket_del) > 0
    AND EXISTS (SELECT 1 FROM jsonb_each(p.task_time_blocks) AS w
                CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.value) = 'object'
                                                   THEN w.value ELSE '{}'::jsonb END) AS j
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
$function$;

-- ── 7. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks__team_check()', 'teams__route_project(uuid, uuid)', 'teams__members_of(uuid)',
    'teams__check_name(uuid, text, uuid)', 'teams__check_project(uuid, jsonb)',
    'teams__add_member(public.teams, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['teams__auto_mark(text)', 'teams__check_mark(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'teams_op_create(uuid, jsonb)', 'teams_op_update(uuid, uuid, jsonb)',
    'teams_op_add_member(uuid, uuid, uuid)', 'teams_op_remove_member(uuid, uuid, uuid)',
    'tasks_op_create(uuid, jsonb)', 'tasks_op_update(uuid, uuid, jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  -- Account erasure stays the service's (delete-account) alone.
  REVOKE ALL ON FUNCTION public.account_erase_workspace_data(uuid, boolean) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.account_erase_workspace_data(uuid, boolean) TO service_role;
END;
$$;

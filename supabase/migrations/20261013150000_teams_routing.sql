-- TV-D13 · Teams: routing, claims, notices, departures (specs/tasks-v3.md
-- block 28, §1, §13, §15, Edge cases "Structure moves"; REPLAN 20, 20a, 54,
-- 94, 95, defaults s and t; decisions in docs/decisions/tasks.md "TV-D13").
--
--   * A team works on what's routed to it. A live member of a task's team can
--     see and edit that task, even in a project they can't open (routing is
--     handing a task to a group, the way assigning hands it to a person; it
--     never opens the project). can_access is redefined for that, and for
--     20a: a task you created that sits in someone else's Inbox stays yours to
--     see and edit ("Created by me").
--   * Claiming: tasks_op_claim assigns an unclaimed team task to the member
--     who takes it (the team stays on it as context). Two people taking the
--     same task: the second is told someone already took it.
--   * An unfiled task given to someone goes into their Inbox (20): assigning
--     a top-level task that sits in an Inbox to someone else moves it, with
--     its subtasks, into that person's Inbox (tasks_op_assign, and so
--     tasks_op_update, and tasks_op_create for a task made for someone).
--   * Notices (§13, default s): a task becoming unclaimed for a team (routed
--     with nobody on it, or given back) tells the team's other members once,
--     gathered per person (or key) and team within the hour while nobody has
--     read it; `@Team` in a comment tells each member once
--     (comments_op_mention_teams; the author and anyone the comment already
--     reached hear nothing new); a team task still unclaimed after 3 days, or
--     from 9:00 the day before it's due, sends its creator one check-back
--     (tasks__team_check_backs, every 15 minutes). Each reaches only people
--     who can see the item.
--   * tasks.team_routed_at / team_check_back_at: when the task last became
--     unclaimed for its team, and whether its check-back went. Kept by Moduo.
--   * Someone leaving the workspace (AC5.6, the server half): their team
--     memberships end, the projects they led lose their lead, and their Inbox
--     is handed on: tasks others created go back to those creators' Inboxes,
--     the rest to whoever removed them (else the owner), with one quiet notice
--     per person who received something.
--   * The grant feed hears about every new way access changes: a task's team
--     changing, and someone joining or leaving a team that has tasks.
--
-- Apply after TV-D12's 20261013140000 and TV-U13's 20261013100000. Expand
-- only. Verified on the local stack by supabase/tests/teams.test.sql and
-- teams_routing.test.sql (bun run db:test).

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.teams') IS NULL OR to_regclass('public.notice_deliveries') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10 and TV-D12 before this migration.';
  END IF;
  IF to_regprocedure('public.tasks__notice(uuid, text, uuid, text, jsonb)') IS NULL
     OR to_regprocedure('public.access_changes__note(uuid, uuid, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D11b and TV-D12 before this migration.';
  END IF;
  IF to_regprocedure('public.comments__item_visible_to(uuid, text, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-U13 (20261013100000) before this migration.';
  END IF;
END;
$$;

-- ── 1. When a task became the team's, and its one check-back ───────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS team_routed_at timestamptz,
  ADD COLUMN IF NOT EXISTS team_check_back_at timestamptz;
COMMENT ON COLUMN public.tasks.team_routed_at IS
  'TV-D13: when the task last became unclaimed for its team (routed with nobody on it, or given back). Kept by Moduo.';
COMMENT ON COLUMN public.tasks.team_check_back_at IS
  'TV-D13: when the creator''s check-back for this stretch went (or was settled). Kept by Moduo.';

-- What the check-back job looks at: unclaimed team tasks still waiting.
CREATE INDEX IF NOT EXISTS tasks_team_unclaimed
  ON public.tasks (team_routed_at)
  WHERE team_id IS NOT NULL AND assignee_id IS NULL AND team_check_back_at IS NULL AND deleted_at IS NULL;

-- Team tasks routed before this migration start their clock where they were
-- last changed (a local stack only: no team exists on prod yet). Triggers off,
-- so nothing is stamped or notified.
ALTER TABLE public.tasks DISABLE TRIGGER USER;
UPDATE public.tasks t SET team_routed_at = t.updated_at
WHERE t.team_id IS NOT NULL AND t.team_routed_at IS NULL;
ALTER TABLE public.tasks ENABLE TRIGGER USER;

-- People don't write these: whatever a person (or key) sends for them is put
-- back. The team trigger and the check-back job keep them.
CREATE OR REPLACE FUNCTION public.tasks__routing_columns_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.perm_actor_id() IS NOT NULL
     AND coalesce(current_setting('share.bypass', true), '') <> '1'
     AND pg_trigger_depth() <= 1 THEN
    NEW.team_routed_at := OLD.team_routed_at;
    NEW.team_check_back_at := OLD.team_check_back_at;
  END IF;
  RETURN NEW;
END;
$$;

-- Sorts before tasks_team_check, which stamps them after it.
DROP TRIGGER IF EXISTS tasks_routing_columns_guard ON public.tasks;
CREATE TRIGGER tasks_routing_columns_guard
  BEFORE UPDATE OF team_routed_at, team_check_back_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__routing_columns_guard();

-- tasks__team_check (live body after TV-D10's 20261010182000), plus: a task
-- that becomes unclaimed for its team (routed with nobody on it, or its
-- assignee taken off) starts its clock again and may get a check-back again;
-- a task without a team keeps neither.
CREATE OR REPLACE FUNCTION public.tasks__team_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.team_id IS NULL THEN
    NEW.team_routed_at := NULL;
    NEW.team_check_back_at := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
     AND NEW.bucket_id IS NOT DISTINCT FROM OLD.bucket_id THEN
    -- TV-D13: given back to the team.
    IF OLD.assignee_id IS NOT NULL AND NEW.assignee_id IS NULL THEN
      NEW.team_routed_at := now();
      NEW.team_check_back_at := NULL;
    END IF;
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
    NEW.team_routed_at := NULL;
    NEW.team_check_back_at := NULL;
    RETURN NEW;
  END IF;
  -- TV-D13: a new routing starts its own clock and its own check-back.
  IF TG_OP = 'INSERT' OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR (OLD.assignee_id IS NOT NULL AND NEW.assignee_id IS NULL) THEN
    NEW.team_routed_at := now();
    NEW.team_check_back_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_team_check ON public.tasks;
CREATE TRIGGER tasks_team_check
  BEFORE INSERT OR UPDATE OF team_id, bucket_id, assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__team_check();

-- ── 2. Who sees a task: its team, and its creator while it's in an Inbox ────

-- can_access (live body after PERM-W / TV-D10), the task branch only:
--   * a live member of the task's live team works on it (Edit), so the team
--     sees what's routed to it and can take it, wherever it's filed;
--   * the task's creator keeps Edit while it sits in someone else's Inbox
--     (20a, "Created by me"), so handing an unfiled task over never loses it.
-- Both are capped by the person's role in Tasks, like everything else here.
CREATE OR REPLACE FUNCTION public.can_access(p_type text, p_id uuid, p_min text, p_user uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := coalesce(p_user, public.perm_actor_id());
  v_need int := public.grant_level_rank(p_min);
  v_rank int := 0;
  v_ws uuid;
  v_module text;
  v_id uuid;
  v_parent uuid;
  v_mode text;
  v_creator uuid;
  v_system boolean;
  v_bucket uuid;
  v_cal uuid;
  v_guard int := 0;
  v_team uuid;
  v_unknown boolean;
BEGIN
  IF v_user IS NULL OR p_id IS NULL OR v_need = 0 THEN
    RETURN false;
  END IF;

  IF p_type = 'note' THEN
    v_id := p_id;
    LOOP
      v_guard := v_guard + 1;
      EXIT WHEN v_guard > 100;
      SELECT workspace_id, parent_id, coalesce(share_mode, 'custom'), created_by
        INTO v_ws, v_parent, v_mode, v_creator
      FROM public.notes WHERE id = v_id;
      EXIT WHEN NOT FOUND;
      IF v_creator = v_user THEN v_rank := greatest(v_rank, 4); END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('note', v_id, v_user));
      EXIT WHEN v_mode IS DISTINCT FROM 'inherit' OR v_parent IS NULL;
      v_id := v_parent;
    END LOOP;
    v_module := 'notes';

  ELSIF p_type = 'bucket' THEN
    SELECT workspace_id, owner_id, is_system INTO v_ws, v_creator, v_system
    FROM public.buckets WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_system THEN
      v_rank := CASE WHEN v_creator = v_user THEN 4 ELSE 0 END;
    ELSE
      IF v_creator = v_user THEN v_rank := 4; END IF;
      v_rank := greatest(v_rank, public.share_direct_rank('bucket', p_id, v_user));
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'task' THEN
    SELECT workspace_id, bucket_id, team_id, owner_id, creator_unknown
      INTO v_ws, v_bucket, v_team, v_creator, v_unknown
    FROM public.tasks WHERE id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    v_rank := public.share_direct_rank('task', p_id, v_user);
    IF v_bucket IS NOT NULL THEN
      -- Inherit the bucket. Call the rank by re-entering for 'full' then scaling
      -- is wrong; read the bucket rank directly via a nested check's grant.
      IF public.can_access('bucket', v_bucket, 'full', v_user) THEN v_rank := greatest(v_rank, 4);
      ELSIF public.can_access('bucket', v_bucket, 'edit', v_user) THEN v_rank := greatest(v_rank, 3);
      ELSIF public.can_access('bucket', v_bucket, 'view', v_user) THEN v_rank := greatest(v_rank, 2);
      END IF;
    END IF;
    -- TV-D13 (54): the team a task is routed to works on it.
    IF v_rank < 3 AND v_team IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.team_members m
         JOIN public.teams x ON x.id = m.team_id AND x.deleted_at IS NULL
         WHERE m.team_id = v_team AND m.user_id = v_user AND m.deleted_at IS NULL) THEN
      v_rank := 3;
    END IF;
    -- TV-D13 (20a): a task you made that you handed, unfiled, to someone.
    IF v_rank < 3 AND v_creator = v_user AND NOT coalesce(v_unknown, false) AND v_bucket IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = v_bucket AND b.is_system) THEN
      v_rank := 3;
    END IF;
    v_module := 'tasks';

  ELSIF p_type = 'calendar' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator FROM public.calendars WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('calendar', p_id, v_user));
    v_module := 'calendar';

  ELSIF p_type = 'contact_group' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contact_groups WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact_group', p_id, v_user));
    v_module := 'contacts';

  ELSIF p_type = 'contact' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.contacts WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    v_rank := greatest(v_rank, public.share_direct_rank('contact', p_id, v_user));
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.contact_group_members gm
      JOIN public.contact_groups g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.contact_id = p_id AND public.can_access('contact_group', g.id, 'edit', v_user)
    ) THEN
      v_rank := greatest(v_rank, 3);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'company' THEN
    SELECT workspace_id, owner_id INTO v_ws, v_creator
    FROM public.companies WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN v_rank := 4; END IF;
    IF EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.company_id = p_id AND c.deleted_at IS NULL
        AND public.can_access('contact', c.id, 'view', v_user)
    ) THEN
      v_rank := greatest(v_rank, 2);
    END IF;
    v_module := 'contacts';

  ELSIF p_type = 'event' THEN
    SELECT workspace_id, owner_id, calendar_ref INTO v_ws, v_creator, v_cal
    FROM public.calendar_events WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_creator = v_user THEN
      v_rank := 4;
      v_module := 'calendar';
    ELSIF v_cal IS NOT NULL THEN
      RETURN public.can_access('calendar', v_cal, p_min, v_user);
    ELSE
      RETURN false;
    END IF;

  ELSE
    RETURN false;
  END IF;

  IF v_ws IS NULL THEN RETURN false; END IF;
  RETURN least(v_rank, public.perm_ceiling_rank(v_ws, v_user, v_module)) >= v_need;
END;
$function$;

-- ── 3. The grant feed hears about the new ways access changes ──────────────

-- A task's team changed: whoever was or is in either team checks it again.
CREATE OR REPLACE FUNCTION public.access_changes__task_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.access_changes__note(NEW.workspace_id, NULL, 'task', NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS access_changes_task_team ON public.tasks;
CREATE TRIGGER access_changes_task_team
  AFTER UPDATE OF team_id ON public.tasks
  FOR EACH ROW WHEN (OLD.team_id IS DISTINCT FROM NEW.team_id)
  EXECUTE FUNCTION public.access_changes__task_team();

-- Someone joined or left a team that has tasks: they check everything again.
CREATE OR REPLACE FUNCTION public.access_changes__team_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.team_id = NEW.team_id AND t.deleted_at IS NULL) THEN
    PERFORM public.access_changes__note(NEW.workspace_id, NEW.user_id, 'workspace', NEW.workspace_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS access_changes_team_member ON public.team_members;
CREATE TRIGGER access_changes_team_member
  AFTER INSERT OR UPDATE OF deleted_at ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.access_changes__team_member();

-- ── 4. An unfiled task given to someone goes to their Inbox (20, 20a) ───────

-- A top-level task in an Inbox whose assignee is someone other than that
-- Inbox's owner moves, with its subtasks, into the assignee's Inbox. The
-- move is the assignment's own consequence (nobody can write into another
-- person's Inbox), so it runs as system work. Answers with the task.
CREATE OR REPLACE FUNCTION public.tasks__hand_to_inbox(p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_from uuid;
  v_inbox uuid;
  v_bypass text;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = p_task_id;
  IF NOT FOUND OR t.deleted_at IS NOT NULL OR t.parent_id IS NOT NULL OR t.assignee_id IS NULL THEN
    RETURN t;
  END IF;
  SELECT b.owner_id INTO v_from FROM public.buckets b WHERE b.id = t.bucket_id AND b.is_system;
  IF NOT FOUND OR v_from IS NOT DISTINCT FROM t.assignee_id THEN
    RETURN t;
  END IF;
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  v_inbox := public.tasks__inbox(t.workspace_id, t.assignee_id);
  UPDATE public.tasks x SET bucket_id = v_inbox, updated_at = now()
  WHERE x.id = t.id
     OR (x.parent_id = t.id AND x.bucket_id = t.bucket_id AND x.deleted_at IS NULL);
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  SELECT * INTO t FROM public.tasks WHERE id = p_task_id;
  RETURN t;
END;
$$;

-- tasks_op_assign (live body after TV-D1 / TV-D8), plus the hand-over above.
CREATE OR REPLACE FUNCTION public.tasks_op_assign(p_workspace_id uuid, p_task_id uuid, p_assignee_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  t public.tasks;
BEGIN
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  -- Already so: nothing to check or write (a task can stay with someone who
  -- has since left).
  IF t.assignee_id IS NOT DISTINCT FROM p_assignee_id THEN
    -- The guard doesn't check access to this task, and the row goes back to
    -- the caller, so check it as the write would have.
    IF NOT public.can_access('task', t.id, 'edit', public.perm_actor_id()) THEN
      RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
    END IF;
    RETURN t;
  END IF;
  -- NULL unassigns. Anyone else has to be a member who can work on tasks.
  IF p_assignee_id IS NOT NULL THEN
    IF NOT public.perm_is_owner(p_workspace_id, p_assignee_id)
       AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
                       WHERE m.workspace_id = p_workspace_id AND m.user_id = p_assignee_id) THEN
      RAISE EXCEPTION 'That person isn''t a member of this workspace.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.perm_user_has(p_workspace_id, p_assignee_id, 'tasks.edit') THEN
      RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- perm_enforce_write still checks the caller's access to this task.
  -- tasks_notify_spine logs tasks.assigned (the assignee as the notify target)
  -- for this write, as for every other way a task gets an assignee, so the op
  -- doesn't log it a second time.
  UPDATE public.tasks
    SET assignee_id = p_assignee_id, updated_at = now()
    WHERE id = t.id
    RETURNING * INTO t;
  -- TV-D13 (20): an unfiled task given to someone goes into their Inbox.
  RETURN public.tasks__hand_to_inbox(t.id);
END;
$function$;

-- tasks_op_create (live body after TV-D10's 20261010182000), plus: a task
-- made in an Inbox for someone else lands in theirs.
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
  -- TV-D13 (20): made unfiled for someone else, it goes into their Inbox.
  IF t.assignee_id IS DISTINCT FROM v_actor THEN
    PERFORM public.tasks__hand_to_inbox(t.id);
  END IF;
  -- The row as the session mirror left it.
  SELECT * INTO t FROM public.tasks WHERE id = t.id;
  RETURN t;
END;
$function$;

-- ── 5. Take a team's task ───────────────────────────────────────────────────

-- A member of the task's team takes it: it becomes theirs, and the team stays
-- on it as context. Taking one you already have answers with it; one somebody
-- else took first is refused. Giving it back is an ordinary unassign.
CREATE OR REPLACE FUNCTION public.tasks_op_claim(p_workspace_id uuid, p_task_id uuid)
RETURNS public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_actor uuid := public.perm_actor_id();
  v_team public.teams;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  -- Edit access to Tasks, a live task of this workspace, locked: of two
  -- people taking it at once, the second waits and then finds it taken.
  t := public.tasks_op__guard(p_workspace_id, p_task_id);
  IF NOT public.can_access('task', t.id, 'view', v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  SELECT * INTO v_team FROM public.teams x WHERE x.id = t.team_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This task isn''t for a team.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members m
                 WHERE m.team_id = v_team.id AND m.user_id = v_actor AND m.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Only people in % can take its tasks.', v_team.name USING ERRCODE = '42501';
  END IF;
  IF t.assignee_id = v_actor THEN
    RETURN t;
  END IF;
  IF t.assignee_id IS NOT NULL THEN
    RAISE EXCEPTION 'Someone already took this task.' USING ERRCODE = '23505';
  END IF;
  IF t.status_category IN ('done', 'wont_do') THEN
    RAISE EXCEPTION 'This task is already closed.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tasks__check_assignee(p_workspace_id, v_actor);
  -- perm_enforce_write checks the write as usual (the team gives Edit);
  -- tasks_notify_spine logs it as taking the task.
  UPDATE public.tasks SET assignee_id = v_actor, updated_at = now()
  WHERE id = t.id
  RETURNING * INTO t;
  RETURN t;
END;
$$;

-- ── 6. A task becomes unclaimed for a team: its members hear once ─────────

-- tasks_notify_spine (live body after TV-D12's 20261013110000), plus the
-- "routed to your team" notice (§13, default s): when a task with nobody on
-- it gets a team, or a team task is given back, each other member of the
-- team who can see it hears once. Notices from one person (or key) to one
-- team within the hour gather on one while none of its recipients has read
-- or dismissed it ("Maciej routed 4 tasks to Design"); once one has, the next
-- starts a new one. The trail already says so through the op's own
-- tasks.update line, so tasks.routed is a notice only.
CREATE OR REPLACE FUNCTION public.tasks_notify_spine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_blocked RECORD;
  v_actor uuid := public.perm_actor_id();
  v_key uuid := public.module_api_key_id();
  v_assigned boolean := false;
  v_notify boolean;
  v_group uuid;
  v_from uuid;
  v_routed boolean := false;
  v_returned boolean := false;
  v_team_name text;
  v_members jsonb;
BEGIN
  -- Never notify about a soft-deleted row (a delete is an UPDATE that stamps
  -- deleted_at; it must not read as an assignment or an unblock).
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- System writes (no signed-in user, no API key) notify nobody.
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── assigned-to-you ──────────────────────────────────────────────────────
  -- Every way a task gets an assignee lands here (tasks_op_assign, a create,
  -- an old build's owner_id write), so this is the one place it is logged:
  -- a create for someone else, and every later change, attributed to the
  -- actor ({from, to}). Only someone other than the actor is notified
  -- (mentioned_user_ids): unassigning and taking a task stay out of bells but
  -- in the trail. The actor is compared through perm_actor_id(), so an API
  -- key assigning its own creator doesn't notify. Member removal unassigns
  -- under share.bypass and logs nothing. Wrapped so a notification failure
  -- can never fail the task write.
  IF TG_OP = 'INSERT' THEN
    v_assigned := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
  ELSE
    v_from := OLD.assignee_id;
    v_assigned := NEW.assignee_id IS DISTINCT FROM v_from
                  AND current_setting('share.bypass', true) IS DISTINCT FROM '1';
  END IF;
  IF v_assigned THEN
    BEGIN
      v_notify := NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM v_actor;
      v_group := NULL;
      IF v_notify THEN
        -- The open notice of this hour from the same actor (person or key)
        -- to the same person, if there is one.
        SELECT ma.id INTO v_group FROM public.module_activity ma
        WHERE ma.workspace_id = NEW.workspace_id AND ma.module = 'tasks'
          AND ma.op = 'tasks.assigned'
          AND ma.created_at > now() - interval '1 hour'
          AND CASE WHEN auth.uid() IS NOT NULL
                   THEN ma.actor_type = 'user' AND ma.actor_id = auth.uid()
                   ELSE ma.actor_type = 'api_key' AND ma.actor_id = v_key END
          AND (ma.payload -> 'mentioned_user_ids') @> jsonb_build_array(NEW.assignee_id::text)
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_state ns
            WHERE ns.activity_id = ma.id AND ns.user_id = NEW.assignee_id
              AND (ns.read_at IS NOT NULL OR ns.dismissed_at IS NOT NULL))
        ORDER BY ma.created_at DESC, ma.id DESC
        LIMIT 1
        FOR UPDATE;
      END IF;
      IF v_group IS NOT NULL THEN
        UPDATE public.module_activity ma SET payload =
          CASE WHEN ma.payload ->> 'project_id' IS NOT DISTINCT FROM NEW.bucket_id::text
               THEN ma.payload ELSE ma.payload - 'project_id' END
          || jsonb_build_object(
               'count', coalesce((ma.payload ->> 'count')::integer, 1) + 1,
               'task_ids', CASE WHEN jsonb_array_length(coalesce(ma.payload -> 'task_ids', '[]'::jsonb)) < 100
                                THEN coalesce(ma.payload -> 'task_ids', '[]'::jsonb) || jsonb_build_array(NEW.id::text)
                                ELSE ma.payload -> 'task_ids' END)
        WHERE ma.id = v_group;
      END IF;
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.assigned',
        jsonb_strip_nulls(jsonb_build_object(
          'mentioned_user_ids',
            CASE WHEN v_notify AND v_group IS NULL THEN jsonb_build_array(NEW.assignee_id::text) END,
          'task_ids', CASE WHEN v_notify AND v_group IS NULL THEN jsonb_build_array(NEW.id::text) END,
          'project_id', CASE WHEN v_notify AND v_group IS NULL THEN NEW.bucket_id END,
          'grouped_into', v_group,
          'title', NEW.title))
        -- from/to stay in when null (null = Unassigned). "self" is a person
        -- taking the task; an API key assigning its creator reads as an
        -- assignment.
        || jsonb_build_object(
             'from', v_from,
             'to', NEW.assignee_id,
             'self', v_key IS NULL AND NEW.assignee_id IS NOT DISTINCT FROM v_actor));
    EXCEPTION WHEN OTHERS THEN
      -- generation is a side-effect; it must never break completing/editing a task.
      -- Surface a WARNING (does not abort the txn) so a silent failure is debuggable.
      RAISE WARNING 'tasks_notify_spine: assigned notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── unclaimed for your team (TV-D13) ─────────────────────────────────────
  IF NEW.team_id IS NOT NULL AND NEW.assignee_id IS NULL
     AND current_setting('share.bypass', true) IS DISTINCT FROM '1' THEN
    IF TG_OP = 'INSERT' THEN
      v_routed := true;
    ELSIF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
      v_routed := true;
    ELSIF OLD.assignee_id IS NOT NULL THEN
      v_routed := true;
      v_returned := true;
    END IF;
  END IF;
  IF v_routed THEN
    BEGIN
      SELECT x.name INTO v_team_name FROM public.teams x WHERE x.id = NEW.team_id;
      SELECT coalesce(jsonb_agg(m.user_id::text ORDER BY m.created_at, m.id), '[]'::jsonb) INTO v_members
      FROM public.team_members m
      WHERE m.team_id = NEW.team_id AND m.deleted_at IS NULL
        AND m.user_id IS DISTINCT FROM v_actor
        AND public.tasks__visible_to(NEW.id, m.user_id);
      IF jsonb_array_length(v_members) > 0 THEN
        v_group := NULL;
        SELECT ma.id INTO v_group FROM public.module_activity ma
        WHERE ma.workspace_id = NEW.workspace_id AND ma.module = 'tasks'
          AND ma.op = 'tasks.routed'
          AND ma.created_at > now() - interval '1 hour'
          AND CASE WHEN auth.uid() IS NOT NULL
                   THEN ma.actor_type = 'user' AND ma.actor_id = auth.uid()
                   ELSE ma.actor_type = 'api_key' AND ma.actor_id = v_key END
          AND ma.payload ->> 'team_id' = NEW.team_id::text
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_state ns
            WHERE ns.activity_id = ma.id
              AND (ns.read_at IS NOT NULL OR ns.dismissed_at IS NOT NULL))
        ORDER BY ma.created_at DESC, ma.id DESC
        LIMIT 1
        FOR UPDATE;
        IF v_group IS NOT NULL THEN
          UPDATE public.module_activity ma SET payload =
            (ma.payload - 'returned')
            || jsonb_build_object(
                 'count', coalesce((ma.payload ->> 'count')::integer, 1) + 1,
                 'task_ids', CASE WHEN jsonb_array_length(coalesce(ma.payload -> 'task_ids', '[]'::jsonb)) < 100
                                  THEN coalesce(ma.payload -> 'task_ids', '[]'::jsonb) || jsonb_build_array(NEW.id::text)
                                  ELSE ma.payload -> 'task_ids' END,
                 -- Whoever joined the team (or can see it now) since hears too.
                 'mentioned_user_ids', (
                   SELECT coalesce(jsonb_agg(DISTINCT u), '[]'::jsonb)
                   FROM (SELECT jsonb_array_elements_text(coalesce(ma.payload -> 'mentioned_user_ids', '[]'::jsonb))
                         UNION SELECT jsonb_array_elements_text(v_members)) AS s(u)))
          WHERE ma.id = v_group;
        ELSE
          PERFORM public.module_activity_log(
            NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.routed',
            jsonb_strip_nulls(jsonb_build_object(
              'mentioned_user_ids', v_members,
              'task_ids', jsonb_build_array(NEW.id::text),
              'count', 1,
              'team_id', NEW.team_id,
              'team_name', v_team_name,
              'title', NEW.title,
              'returned', CASE WHEN v_returned THEN true END)));
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: team notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NULL;
  END IF;

  -- ── completed-by-someone-else ────────────────────────────────────────────
  -- The task just became done, and the person who did it isn't its creator:
  -- tell the creator. Only on the transition, so re-saving a done task can't
  -- notify again; never when the creator is unknown or can no longer see the
  -- task (the notification carries its title). Not for a repeating task, so a
  -- daily chore doesn't ping its creator every day (Maciej, 2026-10-08).
  IF OLD.status IS DISTINCT FROM 'done' AND NEW.status = 'done'
     AND (NEW.recurrence IS NULL OR jsonb_typeof(NEW.recurrence) = 'null')
     AND NEW.owner_id IS NOT NULL AND NOT NEW.creator_unknown
     AND NEW.owner_id IS DISTINCT FROM v_actor
     AND public.can_access('task', NEW.id, 'view', NEW.owner_id) THEN
    BEGIN
      PERFORM public.module_activity_log(
        NEW.workspace_id, 'tasks', 'task', NEW.id, 'tasks.completed',
        jsonb_build_object(
          'mentioned_user_ids', jsonb_build_array(NEW.owner_id::text),
          'title', NEW.title));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks_notify_spine: completed notification failed for task %: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- ── blocked-task-unblocked ───────────────────────────────────────────────
  -- This task just CLOSED (open → done/archived). For every task it blocked, if
  -- this was its LAST open blocker, notify that task's assignee, else its
  -- creator. "Open" mirrors the client isOpen set (status NOT IN done/archived).
  -- Only fires for a genuine open→closed transition, so re-saving an
  -- already-done task can't re-notify.
  IF OLD.status NOT IN ('done', 'archived')
     AND NEW.status IN ('done', 'archived') THEN
    BEGIN
      FOR v_blocked IN
        SELECT bt.id AS task_id,
               coalesce(bt.assignee_id,
                        CASE WHEN bt.creator_unknown
                               OR NOT public.can_access('task', bt.id, 'view', bt.owner_id)
                             THEN NULL ELSE bt.owner_id END) AS target_id,
               bt.title AS title
        FROM public.task_relations r
        JOIN public.tasks bt ON bt.id = r.blocked_task_id
        WHERE r.blocker_task_id = NEW.id
          AND r.workspace_id = NEW.workspace_id
          AND bt.deleted_at IS NULL
          -- Only nudge if the freed task is still actionable (not already closed).
          AND bt.status NOT IN ('done', 'archived')
          -- …and no OTHER open blocker remains on it.
          AND NOT EXISTS (
            SELECT 1
            FROM public.task_relations r2
            JOIN public.tasks ob ON ob.id = r2.blocker_task_id
            WHERE r2.blocked_task_id = r.blocked_task_id
              AND r2.blocker_task_id <> NEW.id
              AND ob.deleted_at IS NULL
              AND ob.status NOT IN ('done', 'archived')
          )
      LOOP
        CONTINUE WHEN v_blocked.target_id IS NULL;
        PERFORM public.module_activity_log(
          NEW.workspace_id, 'tasks', 'task', v_blocked.task_id, 'tasks.unblocked',
          jsonb_build_object(
            'notify_user_ids', jsonb_build_array(v_blocked.target_id::text),
            'title', v_blocked.title,
            'blocker_title', NEW.title));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- as above: never let the notification side-effect fail the task write.
      RAISE WARNING 'tasks_notify_spine: unblocked notification failed for blocker %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$function$;

-- The new notices reach only people who can see the item, on every path
-- (TV-D12's gate, its trigger recreated with the new ops).
DROP TRIGGER IF EXISTS module_activity_gate_recipients ON public.module_activity;
CREATE TRIGGER module_activity_gate_recipients
  BEFORE INSERT ON public.module_activity
  FOR EACH ROW
  WHEN (NEW.op = ANY (ARRAY[
    'comments.add', 'notes.mention', 'tasks.mentioned',
    'tasks.routed', 'tasks.team_check_back', 'tasks.handed_back', 'comments.team_mention']))
  EXECUTE FUNCTION public.module_activity__gate_recipients();

-- ── 7. The check-back on a team task nobody took (default s) ──────────────

-- The wall-clock time a moment reads in a zone (UTC for a zone that doesn't
-- read, like tasks__local_date).
CREATE OR REPLACE FUNCTION public.tasks__wall_clock(p_at timestamptz, p_zone text)
RETURNS timestamp
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN p_at AT TIME ZONE coalesce(nullif(p_zone, ''), 'UTC');
EXCEPTION WHEN OTHERS THEN
  RETURN p_at AT TIME ZONE 'UTC';
END;
$$;

-- Every 15 minutes: an open team task still unclaimed 3 days after it became
-- the team's, or from 9:00 the day before it's due (its creator's clock),
-- sends its creator one check-back (as "Moduo"), at least an hour after the
-- routing. Settled once per stretch: a creator who can't see it any more (or
-- an unknown one) gets nothing, and it isn't looked at again until the task
-- is routed or given back again. Archived projects wait.
CREATE OR REPLACE FUNCTION public.tasks__team_check_backs(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tasks;
  v_reason text;
  v_to uuid;
  v_team_name text;
  v_sent integer := 0;
BEGIN
  FOR t IN
    SELECT x.* FROM public.tasks x
    WHERE x.team_id IS NOT NULL AND x.assignee_id IS NULL AND x.team_check_back_at IS NULL
      AND x.deleted_at IS NULL AND x.team_routed_at IS NOT NULL
      AND x.team_routed_at <= p_now - interval '1 hour'
      AND x.status_category IN ('todo', 'in_progress')
      AND NOT EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = x.bucket_id AND b.archived_at IS NOT NULL)
      AND (x.team_routed_at <= p_now - interval '3 days'
           OR (x.due_on IS NOT NULL
               AND public.tasks__wall_clock(p_now, public.tasks__zone_of(x))
                   >= ((x.due_on - 1) + time '09:00')))
    ORDER BY x.team_routed_at, x.id
    LIMIT greatest(coalesce(p_limit, 500), 1)
    FOR UPDATE OF x SKIP LOCKED
  LOOP
    v_reason := CASE WHEN t.team_routed_at <= p_now - interval '3 days' THEN 'unclaimed' ELSE 'due' END;
    UPDATE public.tasks SET team_check_back_at = p_now WHERE id = t.id;
    v_to := CASE WHEN NOT t.creator_unknown THEN t.owner_id END;
    CONTINUE WHEN v_to IS NULL OR NOT public.tasks__visible_to(t.id, v_to);
    SELECT x.name INTO v_team_name FROM public.teams x WHERE x.id = t.team_id;
    BEGIN
      PERFORM public.tasks__notice(
        t.workspace_id, 'task', t.id, 'tasks.team_check_back',
        jsonb_strip_nulls(jsonb_build_object(
          'notify_user_ids', jsonb_build_array(v_to::text),
          'title', t.title,
          'team_id', t.team_id,
          'team_name', v_team_name,
          'reason', v_reason,
          'due_on', t.due_on)));
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tasks__team_check_backs: notice failed for task %: %', t.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_sent;
END;
$$;

-- ── 8. @Team in a comment (§13, 54) ─────────────────────────────────────────

-- Called by the comment's author right after posting (or editing) it, with
-- the teams the comment names. Each member of those teams who can see the
-- item hears once: never the author, nobody the comment already reached
-- (named in person, or through a team before), and a person in two named
-- teams once. A team named again in an edit is told nothing new. Answers
-- with how many people were told.
CREATE OR REPLACE FUNCTION public.comments_op_mention_teams(p_comment_id uuid, p_team_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.comments;
  v_actor uuid := auth.uid();
  v_teams uuid[];
  v_names jsonb;
  v_before jsonb;
  v_people jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.comments x WHERE x.id = p_comment_id;
  IF NOT FOUND OR c.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment isn''t there any more.' USING ERRCODE = 'P0002';
  END IF;
  IF c.author_kind <> 'user' OR c.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only its author can mention a team in a comment.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.spine_op__guard(c.workspace_id);
  IF cardinality(coalesce(p_team_ids, '{}'::uuid[])) > 20 THEN
    RAISE EXCEPTION 'A comment can mention up to 20 teams.' USING ERRCODE = '22023';
  END IF;

  -- Live teams of this workspace this comment hasn't told yet.
  SELECT array_agg(x.id ORDER BY lower(x.name), x.id), jsonb_agg(x.name ORDER BY lower(x.name), x.id)
    INTO v_teams, v_names
  FROM public.teams x
  WHERE x.id = ANY (coalesce(p_team_ids, '{}'::uuid[]))
    AND x.workspace_id = c.workspace_id AND x.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.module_activity a
      WHERE a.workspace_id = c.workspace_id AND a.module = 'comments'
        AND a.entity_type = c.entity_type AND a.entity_id = c.entity_id
        AND a.op = 'comments.team_mention'
        AND a.payload ->> 'comment_id' = c.id::text
        AND (a.payload -> 'team_ids') @> jsonb_build_array(x.id::text));
  IF v_teams IS NULL THEN
    RETURN 0;
  END IF;

  -- Everyone this comment already reached.
  SELECT coalesce(jsonb_agg(DISTINCT m.uid), '[]'::jsonb) INTO v_before
  FROM public.module_activity a,
       LATERAL jsonb_array_elements_text(coalesce(a.payload -> 'mentioned_user_ids', '[]'::jsonb)) AS m(uid)
  WHERE a.workspace_id = c.workspace_id AND a.module = 'comments'
    AND a.entity_type = c.entity_type AND a.entity_id = c.entity_id
    AND a.op IN ('comments.add', 'comments.edit', 'comments.team_mention')
    AND a.payload ->> 'comment_id' = c.id::text;

  SELECT coalesce(jsonb_agg(DISTINCT m.user_id::text), '[]'::jsonb) INTO v_people
  FROM public.team_members m
  WHERE m.team_id = ANY (v_teams) AND m.deleted_at IS NULL
    AND m.user_id <> v_actor
    AND NOT (v_before @> jsonb_build_array(m.user_id::text))
    AND public.comments__item_visible_to(c.workspace_id, c.entity_type, c.entity_id, m.user_id);

  PERFORM public.module_activity_log(
    c.workspace_id, 'comments', c.entity_type, c.entity_id, 'comments.team_mention',
    jsonb_build_object(
      'comment_id', c.id,
      -- A short excerpt for the notification card, never the full body.
      'excerpt', left(c.body, 140),
      'team_ids', to_jsonb(v_teams),
      'team_names', v_names,
      'mentioned_user_ids', v_people));
  RETURN jsonb_array_length(v_people);
END;
$$;

-- ── 9. Someone leaves the workspace (AC5.6, the server half) ───────────────

-- After share_member_removed (which unassigns their tasks there): their team
-- memberships end, the projects they led have no lead, and their Inbox is
-- handed on. A task in it that someone else created (and who can still work
-- on tasks here) goes back to that person's Inbox; the rest goes to whoever
-- removed them, else the workspace's owner. Subtasks go with their task. One
-- quiet notice per person who received something (never the remover). An
-- account's deletion already erased its Inbox (account_erase_workspace_data),
-- so only the memberships and leads are cleared then. Private projects are
-- handed to the owner as before (PRIV-2); asking first is TV-U16's.
CREATE OR REPLACE FUNCTION public.teams_member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_to uuid;
  v_name text;
  v_bypass text;
  v_inbox uuid;
  r record;
BEGIN
  SELECT w.owner_id INTO v_owner FROM public.workspaces w
  WHERE w.id = OLD.workspace_id AND w.deleted_at IS NULL;
  IF v_owner IS NULL OR v_owner = OLD.user_id THEN
    RETURN OLD;
  END IF;
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  UPDATE public.team_members m SET deleted_at = now()
  WHERE m.workspace_id = OLD.workspace_id AND m.user_id = OLD.user_id AND m.deleted_at IS NULL;
  UPDATE public.buckets b SET lead_id = NULL, updated_at = now()
  WHERE b.workspace_id = OLD.workspace_id AND b.lead_id = OLD.user_id;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
    v_to := auth.uid();
    IF v_to IS NULL OR v_to = OLD.user_id OR NOT public.tasks__is_member(OLD.workspace_id, v_to) THEN
      v_to := v_owner;
    END IF;
    SELECT coalesce(nullif(btrim(p.display_name), ''), 'A former member') INTO v_name
    FROM public.profiles p WHERE p.id = OLD.user_id;

    FOR r IN
      WITH inbox AS (
        SELECT x.id, x.parent_id, x.owner_id, x.creator_unknown
        FROM public.tasks x
        JOIN public.buckets b ON b.id = x.bucket_id
        WHERE b.workspace_id = OLD.workspace_id AND b.owner_id = OLD.user_id AND b.is_system
          AND x.deleted_at IS NULL
      ), tops AS (
        SELECT i.id,
               CASE WHEN NOT i.creator_unknown AND i.owner_id IS NOT NULL AND i.owner_id <> OLD.user_id
                         AND (public.perm_is_owner(OLD.workspace_id, i.owner_id)
                              OR (public.tasks__is_member(OLD.workspace_id, i.owner_id)
                                  AND public.perm_user_has(OLD.workspace_id, i.owner_id, 'tasks.edit')))
                    THEN i.owner_id ELSE v_to END AS person
        FROM inbox i
        WHERE i.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM inbox p WHERE p.id = i.parent_id)
      ), moves AS (
        SELECT t.id, t.person, true AS top FROM tops t
        UNION ALL
        SELECT s.id, t.person, false FROM inbox s JOIN tops t ON t.id = s.parent_id
      )
      SELECT mv.person, array_agg(mv.id) AS ids, count(*) FILTER (WHERE mv.top) AS tops
      FROM moves mv
      GROUP BY mv.person
    LOOP
      v_inbox := public.tasks__inbox(OLD.workspace_id, r.person);
      UPDATE public.tasks x SET bucket_id = v_inbox, updated_at = now()
      WHERE x.id = ANY (r.ids);
      IF r.person IS DISTINCT FROM auth.uid() THEN
        BEGIN
          PERFORM public.tasks__notice(
            OLD.workspace_id, 'bucket', v_inbox, 'tasks.handed_back',
            jsonb_build_object(
              'mentioned_user_ids', jsonb_build_array(r.person::text),
              'count', r.tops,
              'name', v_name));
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'teams_member_removed: notice failed for %: %', r.person, SQLERRM;
        END;
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS teams_member_removed ON public.workspace_members;
CREATE TRIGGER teams_member_removed
  AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.teams_member_removed();

-- ── 10. Grants and the schedule ─────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Server only.
  FOREACH fn IN ARRAY ARRAY[
    'tasks__routing_columns_guard()',
    'tasks__team_check()',
    'access_changes__task_team()',
    'access_changes__team_member()',
    'tasks__hand_to_inbox(uuid)',
    'tasks_notify_spine()',
    'tasks__team_check_backs(timestamptz, integer)',
    'tasks__wall_clock(timestamptz, text)',
    'teams_member_removed()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- People and keys.
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_claim(uuid, uuid)',
    'comments_op_mention_teams(uuid, uuid[])',
    'tasks_op_assign(uuid, uuid, uuid)',
    'tasks_op_create(uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tasks-team-check-backs') THEN
    PERFORM cron.unschedule('tasks-team-check-backs');
  END IF;
END;
$$;
SELECT cron.schedule(
  'tasks-team-check-backs',
  '*/15 * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.tasks__team_check_backs(now(), 500);$cron$
);

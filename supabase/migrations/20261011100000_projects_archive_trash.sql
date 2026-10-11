-- TV-U6 · Sidebar v3: project colours, archiving, deleting a project, and
-- Recently deleted (specs/tasks-v3.md block 13; REPLAN 14–16, 78, 98;
-- decisions in docs/decisions/tasks.md "TV-U6").
--
-- Re-scopes #328's 20261009140000_buckets_archive_trash.sql, which was never
-- applied anywhere: renumbered after TV-D10 (its file sorted before TV-D9's
-- and would have run after them), and rewritten where the re-plan decided
-- otherwise (REPLAN 78: a delete moves only the open work, each piece to its
-- assignee's Inbox, with one quiet notice per person; no "delete the tasks
-- too" choice).
--
--   1. buckets.color (a label hue name, like tags.color and areas.color; NULL
--      = neutral), buckets.archived_at, and the trash batch: buckets.
--      deleted_batch_id + tasks.deleted_batch_id (the finished tasks deleted
--      with a project share its batch id, and through AT-1's
--      attachments__task_trash their files go with them), buckets.
--      trash_moved_task_ids / trash_moved / trash_moved_at (the open tasks the
--      delete moved to Inboxes, where each one was, and when the move ended).
--   2. Restoring a row (deleted_at back to NULL, by any path) clears its batch.
--   3. Archiving a project takes its tasks out of every queue, as deleting
--      one does (tasks_queue_leave). Unarchiving never puts them back.
--      Archiving or unarchiving needs Full access to the project, like
--      deleting it (agent's choice, decisions/tasks.md "TV-U6"), on every
--      path (buckets__archive_check).
--   4. projects_op_create / projects_op_update take "color"; projects_op_update
--      takes "archived_at" (any non-null value = now, null = unarchive).
--   5. projects_op_delete (REPLAN 78): every task tree with open work (Backlog,
--      To do or In progress, in the task or one of its subtasks) moves to the
--      Inbox of the top task's assignee (unassigned, or someone who can no
--      longer work on tasks here: the deleter's), with one quiet notice per
--      person whose Inbox received something (op tasks.project_deleted, on
--      their Inbox); everything else goes with the project to Recently
--      deleted, in one batch.
--   6. tasks_op_trash_restore: a project comes back with its batch, and takes
--      back the tasks its delete moved, unless they've been edited or moved
--      out of the Inbox since (into the section and status they had); a task
--      comes back on its own (into the caller's Inbox when its project is
--      gone). Within 30 days.
--   7. tasks_op_trash_purge: Delete forever, from the trash only.
--
-- The moves into other people's Inboxes (and back) are the delete's and the
-- restore's own consequences, so they run as system work (share.bypass), as
-- TV-D10's area delete does; the caller's access is checked first.
-- The 30-day purge itself is AT-1's (purge-deleted, tasks__purge_expired),
-- unchanged. Verified on the local stack by supabase/tests/departures.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. Columns ─────────────────────────────────────────────────────────────

ALTER TABLE public.buckets
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_batch_id uuid,
  ADD COLUMN IF NOT EXISTS trash_moved_task_ids uuid[],
  ADD COLUMN IF NOT EXISTS trash_moved jsonb,
  ADD COLUMN IF NOT EXISTS trash_moved_at timestamptz;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_batch_id uuid;

ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_color_length;
ALTER TABLE public.buckets
  ADD CONSTRAINT buckets_color_length CHECK (color IS NULL OR char_length(color) BETWEEN 1 AND 32);
-- The Inbox is where tasks go; it can't be archived away.
ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_inbox_not_archived;
ALTER TABLE public.buckets
  ADD CONSTRAINT buckets_inbox_not_archived CHECK (NOT (is_system AND archived_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS tasks_deleted_batch_idx
  ON public.tasks (deleted_batch_id) WHERE deleted_batch_id IS NOT NULL;
-- Recently deleted reads a workspace's trash by date.
CREATE INDEX IF NOT EXISTS tasks_trash_idx
  ON public.tasks (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS buckets_trash_idx
  ON public.buckets (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.buckets.color IS
  'TV-U6: the project''s colour, a label hue name (src/components/tag-colors.ts); NULL = neutral.';
COMMENT ON COLUMN public.buckets.archived_at IS
  'TV-U6: set while the project is archived (hidden from the sidebar and lists, still searchable).';
COMMENT ON COLUMN public.buckets.deleted_batch_id IS
  'TV-U6: set while the project is in the trash; the tasks (and their files) deleted with it share it.';
COMMENT ON COLUMN public.buckets.trash_moved_task_ids IS
  'TV-U6: the open tasks its delete moved to Inboxes (REPLAN 78); a Restore takes back the unedited ones.';
COMMENT ON COLUMN public.buckets.trash_moved IS
  'TV-U6: {task id: {section_id, status_id}} as they were before the delete moved them, for Restore.';
COMMENT ON COLUMN public.buckets.trash_moved_at IS
  'TV-U6: when the delete''s moves ended; a moved task edited after it stays where it is on Restore.';
COMMENT ON COLUMN public.tasks.deleted_batch_id IS
  'TV-U6: set while the task is in the trash as part of a batch (a project deleted with it).';

-- ── 2. A restored row leaves its batch ─────────────────────────────────────
-- Whatever restores a task or project (an op, an Undo through a plain update,
-- an old build's whole-row save), it is no longer part of a batch.

CREATE OR REPLACE FUNCTION public.tasks__trash_restored()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    NEW.deleted_batch_id := NULL;
    IF TG_TABLE_NAME = 'buckets' THEN
      NEW.trash_moved_task_ids := NULL;
      NEW.trash_moved := NULL;
      NEW.trash_moved_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trash_restored ON public.tasks;
CREATE TRIGGER trash_restored
  BEFORE UPDATE OF deleted_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__trash_restored();
DROP TRIGGER IF EXISTS trash_restored ON public.buckets;
CREATE TRIGGER trash_restored
  BEFORE UPDATE OF deleted_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.tasks__trash_restored();

-- ── 3. Archiving: Full access on every path; archived projects leave queues ──

-- Archiving hides a project from everyone who shares it, like deleting it,
-- so it takes the same access (Full). The op checks it too; this trigger
-- covers a raw write. System work (hand-overs, erasure) isn't checked.
CREATE OR REPLACE FUNCTION public.buckets__archive_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at
     OR v_actor IS NULL
     OR coalesce(current_setting('share.bypass', true), '') = '1'
     OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF NOT public.can_access('bucket', OLD.id, 'full', v_actor) THEN
    RAISE EXCEPTION 'Only people with full access to this project can archive or unarchive it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS buckets_archive_check ON public.buckets;
CREATE TRIGGER buckets_archive_check
  BEFORE UPDATE OF archived_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.buckets__archive_check();

-- The live body (TV-D9's 20261010170000), plus archived_at on buckets.
CREATE OR REPLACE FUNCTION public.tasks_queue_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.status IN ('done', 'archived') OR NEW.status_category = 'backlog' OR NEW.deleted_at IS NOT NULL THEN
      DELETE FROM public.task_queue q WHERE q.task_id = NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'buckets' THEN
    -- Deleted with tasks still in it, or archived (TV-U6).
    IF NEW.deleted_at IS NOT NULL
       OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL) THEN
      DELETE FROM public.task_queue q
      USING public.tasks t
      WHERE t.id = q.task_id AND t.bucket_id = NEW.id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tasks_queue_leave ON public.buckets;
CREATE TRIGGER tasks_queue_leave
  AFTER UPDATE OF deleted_at, archived_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.tasks_queue_leave();

-- ── 4. Project ops take the colour and archiving ───────────────────────────
-- TV-D10's bodies (20261010180000), plus "color" (create and update) and
-- "archived_at" (update).

CREATE OR REPLACE FUNCTION public.projects__apply_fields(b public.buckets, p_fields jsonb)
RETURNS public.buckets
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_fields ? 'name' THEN
    b.name := public.tasks__clean_name(p_fields ->> 'name', 'A project', 120);
  END IF;
  IF p_fields ? 'status' THEN
    IF coalesce(p_fields ->> 'status', '') NOT IN ('active', 'on_hold', 'done') THEN
      RAISE EXCEPTION 'A project is Active, On hold or Done.' USING ERRCODE = '22023';
    END IF;
    b.status := p_fields ->> 'status';
  END IF;
  IF p_fields ? 'starts_on' THEN
    b.starts_on := public.tasks__patch_date(p_fields, 'starts_on');
  END IF;
  IF p_fields ? 'target_on' THEN
    b.target_on := public.tasks__patch_date(p_fields, 'target_on');
  END IF;
  IF b.starts_on IS NOT NULL AND b.target_on IS NOT NULL AND b.starts_on > b.target_on THEN
    RAISE EXCEPTION 'A project''s target date can''t be before its start.' USING ERRCODE = '22023';
  END IF;
  IF p_fields ? 'lead_id' THEN
    b.lead_id := public.tasks__try_uuid(p_fields ->> 'lead_id');
    IF p_fields ->> 'lead_id' IS NOT NULL AND b.lead_id IS NULL THEN
      RAISE EXCEPTION 'A project''s lead has to be in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_fields ? 'client_contact_id' THEN
    b.client_contact_id := public.tasks__try_uuid(p_fields ->> 'client_contact_id');
    IF p_fields ->> 'client_contact_id' IS NOT NULL AND b.client_contact_id IS NULL THEN
      RAISE EXCEPTION 'That contact isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_fields ? 'area_id' THEN
    b.area_id := public.tasks__try_uuid(p_fields ->> 'area_id');
    IF p_fields ->> 'area_id' IS NOT NULL AND b.area_id IS NULL THEN
      RAISE EXCEPTION 'That area isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_fields ? 'position' THEN
    b.position := coalesce(p_fields ->> 'position', '');
  END IF;
  -- TV-U6: a label hue name, or null for neutral (the same check as an area's).
  IF p_fields ? 'color' THEN
    b.color := public.areas__check_color(p_fields -> 'color');
  END IF;
  RETURN b;
END;
$$;

CREATE OR REPLACE FUNCTION public.projects_op_create(p_workspace_id uuid, p_project jsonb)
RETURNS public.buckets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
  v_id uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(p_project, ARRAY[
    'id', 'name', 'position', 'area_id', 'status', 'starts_on', 'target_on', 'lead_id',
    'client_contact_id', 'color']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A project needs an owner.' USING ERRCODE = '42501';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(p_project ->> 'id'), gen_random_uuid());
  SELECT * INTO b FROM public.buckets WHERE id = v_id;
  IF FOUND THEN
    IF b.workspace_id IS DISTINCT FROM p_workspace_id OR NOT public.projects__visible_to(b.id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    RETURN b;
  END IF;

  b.id := v_id;
  b.workspace_id := p_workspace_id;
  b.owner_id := v_actor;
  b.is_system := false;
  b.status := 'active';
  b := public.projects__apply_fields(b, p_project || jsonb_build_object('name', coalesce(p_project ->> 'name', '')));
  IF nullif(b.position, '') IS NULL THEN
    b.position := public.projects__end_position(p_workspace_id);
  END IF;

  -- perm_enforce_write checks the role; the triggers check the lead, the
  -- client and the area, and set group_label.
  INSERT INTO public.buckets (
    id, workspace_id, owner_id, name, is_system, position, status, starts_on, target_on,
    lead_id, client_contact_id, area_id, color, created_at, updated_at)
  VALUES (
    b.id, b.workspace_id, b.owner_id, b.name, false, b.position, b.status, b.starts_on, b.target_on,
    b.lead_id, b.client_contact_id, b.area_id, b.color, now(), now())
  RETURNING * INTO b;
  RETURN b;
END;
$$;

-- Edit a project's fields: name, status, starts_on, target_on, lead_id,
-- client_contact_id, area_id, position, color, archived_at (only the keys
-- given). Archiving or unarchiving needs Full access.
CREATE OR REPLACE FUNCTION public.projects_op_update(p_workspace_id uuid, p_project_id uuid, p_patch jsonb)
RETURNS public.buckets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.buckets;
  n public.buckets;
BEGIN
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'name', 'status', 'starts_on', 'target_on', 'lead_id', 'client_contact_id', 'area_id', 'position',
    'color', 'archived_at']);
  b := public.projects__guard(p_workspace_id, p_project_id);
  SELECT * INTO b FROM public.buckets WHERE id = b.id FOR UPDATE;
  n := public.projects__apply_fields(b, p_patch);
  IF p_patch ? 'archived_at' THEN
    n.archived_at := CASE WHEN jsonb_typeof(p_patch -> 'archived_at') = 'null' THEN NULL
                          ELSE coalesce(b.archived_at, now()) END;
    IF n.archived_at IS DISTINCT FROM b.archived_at
       AND NOT public.can_access('bucket', b.id, 'full', public.perm_actor_id()) THEN
      RAISE EXCEPTION 'Only people with full access to this project can archive or unarchive it.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF row(n.name, n.status, n.starts_on, n.target_on, n.lead_id, n.client_contact_id, n.area_id, n.position,
         n.color, n.archived_at)
     IS NOT DISTINCT FROM
     row(b.name, b.status, b.starts_on, b.target_on, b.lead_id, b.client_contact_id, b.area_id, b.position,
         b.color, b.archived_at) THEN
    RETURN b;
  END IF;
  UPDATE public.buckets SET
    name = n.name, status = n.status, starts_on = n.starts_on, target_on = n.target_on,
    lead_id = n.lead_id, client_contact_id = n.client_contact_id, area_id = n.area_id,
    position = n.position, color = n.color, archived_at = n.archived_at, updated_at = now()
  WHERE id = b.id
  RETURNING * INTO b;
  RETURN b;
END;
$$;

-- ── 5. Delete a project (REPLAN 78) ────────────────────────────────────────

-- Who may delete, restore or purge a project: Tasks at Edit and Full access
-- to the project. Answers with the actor.
CREATE OR REPLACE FUNCTION public.projects__guard_full(p_workspace_id uuid, b public.buckets)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to change projects.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks__guard_structure(p_workspace_id);
  IF b.id IS NULL OR b.workspace_id IS DISTINCT FROM p_workspace_id
     OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  IF b.is_system THEN
    RAISE EXCEPTION 'The Inbox can''t be deleted.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_access('bucket', b.id, 'full', v_actor) THEN
    RAISE EXCEPTION 'Only people with full access to this project can delete or restore it.'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

-- Answers {batch_id, moved, deleted, notified}. Deleting a project that's
-- already in the trash changes nothing.
CREATE OR REPLACE FUNCTION public.projects_op_delete(p_workspace_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b          public.buckets;
  v_actor    uuid;
  v_batch    uuid := gen_random_uuid();
  v_bypass   text;
  v_plan     jsonb;
  v_moved    uuid[] := '{}';
  v_map      jsonb;
  v_deleted  integer := 0;
  v_notified integer := 0;
  v_name     text;
  r          record;
BEGIN
  SELECT * INTO b FROM public.buckets x
  WHERE x.id = p_project_id AND x.workspace_id = p_workspace_id
  FOR UPDATE;
  v_actor := public.projects__guard_full(p_workspace_id, b);
  IF b.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('batch_id', b.deleted_batch_id, 'moved', 0, 'deleted', 0, 'notified', 0);
  END IF;

  -- The plan, read before anything moves: each live task of the project with
  -- the top of its tree (a subtask whose parent sits elsewhere is its own
  -- top), whether the tree has open work (Backlog, To do or In progress
  -- anywhere in it), and whose Inbox an open tree goes to: the top task's
  -- assignee, else (unassigned, or someone who can no longer work on tasks
  -- here) the deleter.
  WITH live AS (
    SELECT t.id, t.section_id, t.status_id, coalesce(par.id, t.id) AS root_id,
           coalesce(t.status_category,
                    CASE t.status WHEN 'done' THEN 'done' WHEN 'archived' THEN 'wont_do'
                                  ELSE 'todo' END) AS category
    FROM public.tasks t
    LEFT JOIN public.tasks par
      ON par.id = t.parent_id AND par.bucket_id = b.id AND par.deleted_at IS NULL
    WHERE t.bucket_id = b.id AND t.deleted_at IS NULL
  ), trees AS (
    SELECT l.root_id, bool_or(l.category NOT IN ('done', 'wont_do')) AS open_tree
    FROM live l GROUP BY l.root_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'task_id', l.id, 'root_id', l.root_id, 'open', tr.open_tree,
           'person', CASE
             WHEN NOT tr.open_tree THEN NULL
             WHEN top.assignee_id IS NOT NULL
                  AND public.perm_user_has(p_workspace_id, top.assignee_id, 'tasks.edit')
               THEN top.assignee_id
             ELSE v_actor END,
           'section_id', l.section_id, 'status_id', l.status_id)), '[]'::jsonb)
  INTO v_plan
  FROM live l
  JOIN trees tr ON tr.root_id = l.root_id
  JOIN public.tasks top ON top.id = l.root_id;

  -- The moves into other people's Inboxes are the delete's own consequence:
  -- system work, after the caller's checks above. A team task moved into an
  -- Inbox leaves its team (TV-D10's trigger).
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);

  FOR r IN
    SELECT x.person, array_agg(x.task_id) AS ids,
           count(*) FILTER (WHERE x.task_id = x.root_id) AS tops
    FROM jsonb_to_recordset(v_plan) AS x(task_id uuid, root_id uuid, open boolean, person uuid)
    WHERE x.open
    GROUP BY x.person
  LOOP
    UPDATE public.tasks t SET bucket_id = public.tasks__inbox(p_workspace_id, r.person)
    WHERE t.id = ANY (r.ids);
    v_moved := v_moved || r.ids;
    -- One quiet notice per person (never the deleter), on their own Inbox so
    -- it reaches them even when the project was private to others; it names
    -- the project only to someone who could see it.
    IF r.person IS DISTINCT FROM v_actor THEN
      v_name := CASE WHEN public.can_access('bucket', b.id, 'view', r.person) THEN b.name END;
      BEGIN
        PERFORM public.module_activity_log(
          p_workspace_id, 'tasks', 'bucket', public.tasks__inbox(p_workspace_id, r.person),
          'tasks.project_deleted',
          jsonb_strip_nulls(jsonb_build_object(
            'mentioned_user_ids', jsonb_build_array(r.person::text),
            'title', v_name,
            'count', r.tops)));
        v_notified := v_notified + 1;
      EXCEPTION WHEN OTHERS THEN
        -- A notice must never fail the delete.
        RAISE WARNING 'projects_op_delete: notice failed for %: %', r.person, SQLERRM;
      END;
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_object_agg(x.task_id::text,
           jsonb_strip_nulls(jsonb_build_object('section_id', x.section_id, 'status_id', x.status_id))),
         '{}'::jsonb)
  INTO v_map
  FROM jsonb_to_recordset(v_plan) AS x(task_id uuid, open boolean, section_id uuid, status_id uuid)
  WHERE x.open;

  -- Finished work goes with the project, in one batch.
  UPDATE public.tasks t SET deleted_at = now(), deleted_batch_id = v_batch
  FROM jsonb_to_recordset(v_plan) AS x(task_id uuid, open boolean)
  WHERE t.id = x.task_id AND NOT x.open;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.buckets SET
    deleted_at = now(), deleted_batch_id = v_batch,
    trash_moved_task_ids = v_moved, trash_moved = v_map, trash_moved_at = clock_timestamp()
  WHERE id = b.id;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);

  RETURN jsonb_build_object('batch_id', v_batch, 'moved', cardinality(v_moved), 'deleted', v_deleted,
                            'notified', v_notified);
END;
$$;

-- ── 6. Undo / Restore ──────────────────────────────────────────────────────
-- A project comes back with its batch, and takes back the tasks its delete
-- moved when they still sit in an Inbox and nobody edited them since (into
-- the section and status they had, when those still exist). A task comes
-- back on its own; when its project is gone it lands in the caller's Inbox.
-- Past 30 days nothing comes back. Restoring what isn't in the trash changes
-- nothing. Answers {projects, tasks, moved}.

CREATE OR REPLACE FUNCTION public.tasks_op_trash_restore(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  uuid := public.perm_actor_id();
  b        public.buckets;
  t        public.tasks;
  v_inbox  uuid;
  v_tasks  integer := 0;
  v_moved  integer := 0;
  v_bypass text;
BEGIN
  IF p_entity_type IN ('bucket', 'project') THEN
    SELECT * INTO b FROM public.buckets x
    WHERE x.id = p_entity_id AND x.workspace_id = p_workspace_id
    FOR UPDATE;
    PERFORM public.projects__guard_full(p_workspace_id, b);
    IF b.deleted_at IS NULL THEN
      RETURN jsonb_build_object('projects', 0, 'tasks', 0, 'moved', 0);
    END IF;
    IF b.deleted_at < now() - interval '30 days' THEN
      RAISE EXCEPTION 'That was deleted more than 30 days ago and can''t be restored.' USING ERRCODE = 'P0001';
    END IF;

    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    -- An area deleted meanwhile doesn't hold it any more.
    UPDATE public.buckets x SET deleted_at = NULL,
      area_id = CASE WHEN EXISTS (SELECT 1 FROM public.areas a WHERE a.id = x.area_id AND a.deleted_at IS NULL)
                     THEN x.area_id END
    WHERE x.id = b.id;
    IF b.deleted_batch_id IS NOT NULL THEN
      UPDATE public.tasks x SET deleted_at = NULL
      WHERE x.workspace_id = p_workspace_id AND x.deleted_batch_id = b.deleted_batch_id
        AND x.deleted_at IS NOT NULL;
      GET DIAGNOSTICS v_tasks = ROW_COUNT;
    END IF;
    IF coalesce(cardinality(b.trash_moved_task_ids), 0) > 0 THEN
      UPDATE public.tasks x SET
        bucket_id = b.id,
        section_id = CASE WHEN EXISTS (
            SELECT 1 FROM public.sections s
            WHERE s.id = public.tasks__try_uuid(b.trash_moved -> x.id::text ->> 'section_id')
              AND s.project_id = b.id AND s.deleted_at IS NULL)
          THEN public.tasks__try_uuid(b.trash_moved -> x.id::text ->> 'section_id') END,
        status_id = CASE WHEN EXISTS (
            SELECT 1 FROM public.project_statuses s
            WHERE s.id = public.tasks__try_uuid(b.trash_moved -> x.id::text ->> 'status_id')
              AND s.project_id = b.id AND s.deleted_at IS NULL)
          THEN public.tasks__try_uuid(b.trash_moved -> x.id::text ->> 'status_id')
          ELSE x.status_id END
      WHERE x.id = ANY (b.trash_moved_task_ids) AND x.workspace_id = p_workspace_id
        AND x.deleted_at IS NULL
        AND x.updated_at <= b.trash_moved_at
        AND EXISTS (SELECT 1 FROM public.buckets i WHERE i.id = x.bucket_id AND i.is_system);
      GET DIAGNOSTICS v_moved = ROW_COUNT;
    END IF;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
    RETURN jsonb_build_object('projects', 1, 'tasks', v_tasks, 'moved', v_moved);

  ELSIF p_entity_type = 'task' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Sign in to restore tasks.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.tasks__guard_structure(p_workspace_id);
    SELECT * INTO t FROM public.tasks x
    WHERE x.id = p_entity_id AND x.workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = 'P0002';
    END IF;
    IF t.deleted_at IS NULL THEN
      RETURN jsonb_build_object('projects', 0, 'tasks', 0, 'moved', 0);
    END IF;
    IF t.deleted_at < now() - interval '30 days' THEN
      RAISE EXCEPTION 'That was deleted more than 30 days ago and can''t be restored.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = t.bucket_id AND x.deleted_at IS NULL) THEN
      v_inbox := public.tasks__inbox(p_workspace_id, v_actor);
    END IF;
    -- perm_enforce_write checks Edit on the task (and on the Inbox it lands in).
    UPDATE public.tasks SET deleted_at = NULL, bucket_id = coalesce(v_inbox, bucket_id)
    WHERE id = t.id;
    RETURN jsonb_build_object('projects', 0, 'tasks', 1, 'moved', 0, 'inbox_id', v_inbox);
  END IF;

  RAISE EXCEPTION 'Only tasks and projects can be restored here.' USING ERRCODE = '22023';
END;
$$;

-- ── 7. Delete forever ──────────────────────────────────────────────────────
-- Only from the trash. A project goes with the tasks deleted with it; any
-- other task still pointing at it (one deleted on its own earlier) moves to
-- the caller's Inbox first, since tasks.bucket_id is ON DELETE RESTRICT.
-- Tasks go before their project, so perm_enforce_write can still read each
-- task's project. Links and registry entries are tombstoned the way
-- tasks__purge_expired does it. Answers {tasks, projects}.

CREATE OR REPLACE FUNCTION public.tasks_op_trash_purge(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := public.perm_actor_id();
  b          public.buckets;
  t          public.tasks;
  v_ids      uuid[];
  v_inbox    uuid;
  v_tasks    integer := 0;
  v_projects integer := 0;
BEGIN
  IF p_entity_type IN ('bucket', 'project') THEN
    SELECT * INTO b FROM public.buckets x
    WHERE x.id = p_entity_id AND x.workspace_id = p_workspace_id
    FOR UPDATE;
    PERFORM public.projects__guard_full(p_workspace_id, b);
    IF b.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Only something in Recently deleted can be deleted forever.' USING ERRCODE = 'P0001';
    END IF;
    IF b.deleted_batch_id IS NOT NULL THEN
      SELECT array_agg(x.id) INTO v_ids FROM public.tasks x
      WHERE x.workspace_id = p_workspace_id AND x.deleted_batch_id = b.deleted_batch_id
        AND x.deleted_at IS NOT NULL;
    END IF;
  ELSIF p_entity_type = 'task' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Sign in to delete tasks.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.tasks__guard_structure(p_workspace_id);
    SELECT * INTO t FROM public.tasks x
    WHERE x.id = p_entity_id AND x.workspace_id = p_workspace_id
    FOR UPDATE;
    IF NOT FOUND OR NOT public.can_access('task', t.id, 'view', v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = 'P0002';
    END IF;
    IF t.deleted_at IS NULL THEN
      RAISE EXCEPTION 'Only something in Recently deleted can be deleted forever.' USING ERRCODE = 'P0001';
    END IF;
    v_ids := ARRAY[t.id];
  ELSE
    RAISE EXCEPTION 'Only tasks and projects can be deleted here.' USING ERRCODE = '22023';
  END IF;

  IF v_ids IS NOT NULL THEN
    WITH d AS (
      DELETE FROM public.tasks x
      WHERE x.id = ANY (v_ids)
      RETURNING x.id, x.workspace_id
    ),
    links AS (
      UPDATE public.entity_links l
      SET deleted_at = now()
      FROM d
      WHERE l.workspace_id = d.workspace_id AND l.deleted_at IS NULL
        AND ((l.source_type = 'task' AND l.source_id = d.id)
          OR (l.target_type = 'task' AND l.target_id = d.id))
      RETURNING 1
    ),
    registry AS (
      UPDATE public.entities e
      SET deleted_at = now(), updated_at = now()
      FROM d
      WHERE e.workspace_id = d.workspace_id AND e.entity_type = 'task'
        AND e.entity_id = d.id AND e.deleted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_tasks FROM d;
  END IF;

  IF p_entity_type IN ('bucket', 'project') THEN
    IF EXISTS (SELECT 1 FROM public.tasks x WHERE x.bucket_id = b.id) THEN
      v_inbox := public.tasks__inbox(p_workspace_id, v_actor);
      UPDATE public.tasks x SET bucket_id = v_inbox WHERE x.bucket_id = b.id;
    END IF;
    DELETE FROM public.buckets WHERE id = b.id;
    GET DIAGNOSTICS v_projects = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('tasks', v_tasks, 'projects', v_projects);
END;
$$;

-- ── 8. Grants ──────────────────────────────────────────────────────────────
-- Ops: signed-in people and the connector's service role (anon revoked by
-- name: Supabase grants it directly). Helpers and triggers: definer-only.

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.projects_op_create(uuid, jsonb)',
    'public.projects_op_update(uuid, uuid, jsonb)',
    'public.projects_op_delete(uuid, uuid)',
    'public.tasks_op_trash_restore(uuid, text, uuid)',
    'public.tasks_op_trash_purge(uuid, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public.projects__apply_fields(public.buckets, jsonb)',
    'public.projects__guard_full(uuid, public.buckets)',
    'public.tasks__trash_restored()',
    'public.buckets__archive_check()',
    'public.tasks_queue_leave()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

-- Fail the migration if a grant drifted (gotchas: REVOKE FROM PUBLIC misses anon).
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.projects_op_delete(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks_op_trash_restore(uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tasks_op_trash_purge(uuid, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.projects__guard_full(uuid, public.buckets)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.buckets__archive_check()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.projects_op_delete(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.tasks_op_trash_restore(uuid, text, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.projects_op_update(uuid, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TV-U6 grants drifted: anon must not reach the ops, nor clients the helpers.';
  END IF;
END;
$$;

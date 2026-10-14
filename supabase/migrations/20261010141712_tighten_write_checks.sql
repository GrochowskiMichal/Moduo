-- Tighten write checks on projects, tags, dependencies and assignment access.
--
-- 1. A project's owner, workspace and Inbox status are set when it's created
--    and never change through a client or op write. Only system hand-overs
--    (member removal, account erasure) change an owner; they set
--    share.bypass. Tags keep their owner and workspace the same way.
-- 2. Nothing guarded by perm_enforce_write moves to another workspace, and a
--    task only goes into a project of its own workspace.
-- 3. Tags are workspace vocabulary: every member reads them; creating,
--    renaming, recolouring and deleting (soft) need Edit in some module. Tag
--    links follow the item they're on: you see the links on items you can see
--    and add or remove links on items you can edit. Deleting a tag takes it off
--    everything it was on.
-- 4. A dependency follows its two tasks: you see it when you can see both, add
--    it when you can edit the waiting task and see the one it waits on, and
--    remove it when you can edit the waiting task. Dependencies aren't
--    rewritten in place. The loop check still sees every dependency.
-- 5. The Edit an assignment gives (resource_grants.origin = 'assign') goes
--    when the task is reassigned or unassigned. A share made by hand
--    (origin = 'manual') stays at the level it was set to: an assignment
--    never lowers it, and one it raised goes back down (manual_level) when
--    the assignment ends.
--
-- Verified on the local stack with supabase/probes/write-checks.probe.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. Fixed columns ────────────────────────────────────────────────────────

-- BEFORE UPDATE: refuses a change to any column named in the trigger's
-- arguments. Columns are read through jsonb so one function serves every
-- table (a NEW.<column> a table lacks would fail to resolve). Definer, like
-- perm_enforce_write: perm_actor_id() isn't callable by client roles.
CREATE OR REPLACE FUNCTION public.perm_fixed_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_col text;
BEGIN
  -- System hand-overs (member removal, account erasure) and system work
  -- without an actor (service role without a key, cron, cascades).
  IF current_setting('share.bypass', true) = '1' OR public.perm_actor_id() IS NULL THEN
    RETURN NEW;
  END IF;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    IF v_new -> v_col IS DISTINCT FROM v_old -> v_col THEN
      RAISE EXCEPTION '%', CASE TG_TABLE_NAME
          WHEN 'buckets' THEN 'A project''s owner, workspace and Inbox can''t be changed.'
          WHEN 'tags' THEN 'A tag''s owner and workspace can''t be changed.'
          ELSE 'This can''t be changed.'
        END
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.perm_fixed_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS buckets_fixed_columns ON public.buckets;
CREATE TRIGGER buckets_fixed_columns
  BEFORE UPDATE ON public.buckets
  FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id
        OR OLD.is_system IS DISTINCT FROM NEW.is_system
        OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id)
  EXECUTE FUNCTION public.perm_fixed_columns('owner_id', 'is_system', 'workspace_id');

DROP TRIGGER IF EXISTS tags_fixed_columns ON public.tags;
CREATE TRIGGER tags_fixed_columns
  BEFORE UPDATE ON public.tags
  FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id
        OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id)
  EXECUTE FUNCTION public.perm_fixed_columns('owner_id', 'workspace_id');

-- ── 2. perm_enforce_write: rows stay in their workspace ─────────────────────
-- Newest body before this: 20261008150000_tasks_assignee_creator.sql. Two
-- changes: the workspace check right after the system-work exit (and that
-- exit no longer returns for a NULL workspace before it), and the tasks
-- branch's check that a task's project is in the task's workspace.

CREATE OR REPLACE FUNCTION public.perm_enforce_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module text := TG_ARGV[0];
  v_fixed  text := CASE WHEN TG_NARGS > 1 THEN TG_ARGV[1] ELSE NULL END;
  v_ws     uuid;
  v_actor  uuid;
  v_action text;
  v_verb   text;
  v_need   text;
  v_item   text;   -- 'edit' requirement for items inside a container
  v_assignee uuid; -- tasks: an assignee being set, to check
  v_moved boolean := false; -- tasks: going into a project (new, or a move)
BEGIN
  v_ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_actor := public.perm_actor_id();

  -- Member-removal archive writes notes the actor can't open. The removal
  -- function sets this for the rest of its transaction only.
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- System work (service role without a key, cron, migrations).
  IF v_actor IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- A row stays in the workspace it was made in (a NULL workspace included:
  -- checked before the NULL exit below).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'Items can''t move to another workspace.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_ws IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF v_fixed IS NOT NULL THEN
    v_action := v_fixed;
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'create';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
  ELSE
    v_action := 'edit';
  END IF;

  -- Mirrored external calendar events are the owner's own sync, not edits.
  IF TG_TABLE_NAME = 'calendar_events' THEN
    IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.source_account_id ELSE NEW.source_account_id END) IS NOT NULL THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- The first channel of a workspace is chat's own bootstrap (#general).
  IF TG_TABLE_NAME = 'chat_channels' THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_channels c
                   WHERE c.workspace_id = v_ws AND c.id IS DISTINCT FROM coalesce(NEW.id, OLD.id)) THEN
      RETURN coalesce(NEW, OLD);
    END IF;
  END IF;

  -- Soft delete / restore count as delete. Only tables guarded without a
  -- fixed action, all of which have deleted_at (chat_channels is INSERT-only).
  IF TG_OP = 'UPDATE' AND v_fixed IS NULL AND TG_TABLE_NAME <> 'chat_channels' THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      v_action := 'delete';
    ELSIF TG_TABLE_NAME = 'chat_messages' THEN
      -- Reactions / thread counters live on the message row; only a body
      -- change is an edit.
      IF NEW.body IS NOT DISTINCT FROM OLD.body THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF NOT public.perm_is_owner(v_ws, v_actor)
     AND NOT public.perm_user_has(v_ws, v_actor, v_module || '.' || v_action) THEN
    v_verb := CASE v_action WHEN 'create' THEN 'add' ELSE v_action END;
    RAISE EXCEPTION 'Your role can''t % % in this workspace.', v_verb,
      CASE v_module WHEN 'tasks' THEN 'tasks' WHEN 'notes' THEN 'notes' WHEN 'calendar' THEN 'events'
                    WHEN 'contacts' THEN 'contacts' WHEN 'chat' THEN 'messages' ELSE v_module END
      USING ERRCODE = '42501';
  END IF;

  v_need := CASE WHEN v_action = 'delete' THEN 'full' ELSE 'edit' END;
  v_item := 'edit';

  IF TG_TABLE_NAME = 'notes' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.publish_token IS NULL AND NEW.publish_token IS NOT NULL
         AND NOT public.perm_user_has(v_ws, v_actor, 'ws.publish') THEN
        RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.parent_id IS NOT NULL AND NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT public.can_access('note', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'note_updates' THEN
    IF NOT public.can_access('note', coalesce(NEW.note_id, OLD.note_id), 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'buckets' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('bucket', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'tasks' THEN
    -- A task goes only into a project of its own workspace (Edit on a
    -- project elsewhere, say in a workspace of your own, doesn't count).
    IF TG_OP = 'INSERT' THEN
      v_moved := true;
    ELSIF TG_OP = 'UPDATE' THEN
      v_moved := NEW.bucket_id IS DISTINCT FROM OLD.bucket_id;
    END IF;
    IF v_moved AND NEW.bucket_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.buckets b
                       WHERE b.id = NEW.bucket_id AND b.workspace_id = NEW.workspace_id) THEN
      RAISE EXCEPTION 'That project is in another workspace.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    ELSE
      -- Tasks are items inside a bucket: Edit covers deleting them.
      IF NOT public.can_access('task', OLD.id, v_item, v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this task.' USING ERRCODE = '42501';
      END IF;
      -- Moving a task into another bucket needs Edit there too.
      IF TG_OP = 'UPDATE' AND NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
         AND NOT public.can_access('bucket', NEW.bucket_id, 'edit', v_actor) THEN
        RAISE EXCEPTION 'You don''t have access to this bucket.' USING ERRCODE = '42501';
      END IF;
    END IF;
    -- Only someone who can work on tasks can be assigned one (TV-D1: the
    -- assignee is assignee_id, no longer owner_id). Checked when the assignee
    -- is set, not on every edit, so a teammate who later became a viewer or
    -- left doesn't freeze the task. An upsert of a row that already exists
    -- arrives here as an INSERT first; its UPDATE pass does the check.
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = NEW.id) THEN
        v_assignee := NEW.assignee_id;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        v_assignee := NEW.assignee_id;
      END IF;
    END IF;
    IF v_assignee IS NOT NULL AND NOT public.perm_user_has(v_ws, v_assignee, 'tasks.edit') THEN
      RAISE EXCEPTION 'Viewers can''t be assigned tasks.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'contacts' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('contact', OLD.id, v_need, v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this contact.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'companies' THEN
    IF TG_OP <> 'INSERT' AND NOT public.can_access('company', OLD.id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this company.' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'calendar_events' THEN
    -- Events are items inside a calendar: Edit covers deleting them.
    IF TG_OP <> 'INSERT' THEN
      IF OLD.owner_id IS DISTINCT FROM v_actor
         AND (OLD.calendar_ref IS NULL OR NOT public.can_access('calendar', OLD.calendar_ref, v_item, v_actor)) THEN
        RAISE EXCEPTION 'You don''t have access to this event.' USING ERRCODE = '42501';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'chat_messages' THEN
    IF v_action = 'delete' AND TG_OP <> 'INSERT' THEN
      IF OLD.author_id IS DISTINCT FROM v_actor
         AND NOT public.chat_has_cap(v_ws, v_actor, 'delete_others') THEN
        RAISE EXCEPTION 'Your role can''t delete other people''s messages.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN coalesce(NEW, OLD);
END;
$$;

-- ── 3. Tags and tag links ───────────────────────────────────────────────────

-- Whether the actor can change this item (the edit-level twin of
-- perm_can_see_entity). Types nothing tags are refused.
CREATE OR REPLACE FUNCTION public.perm_can_edit_entity(p_workspace_id uuid, p_type text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  -- The item has to be in the workspace the link is filed under.
  v_ws := CASE
    WHEN p_type = 'note' THEN (SELECT workspace_id FROM public.notes WHERE id = p_id)
    WHEN p_type IN ('task', 'task_project') THEN (SELECT workspace_id FROM public.tasks WHERE id = p_id)
    WHEN p_type = 'bucket' THEN (SELECT workspace_id FROM public.buckets WHERE id = p_id)
    WHEN p_type = 'contact' THEN (SELECT workspace_id FROM public.contacts WHERE id = p_id)
    WHEN p_type = 'company' THEN (SELECT workspace_id FROM public.companies WHERE id = p_id)
    WHEN p_type = 'event' THEN (SELECT workspace_id FROM public.calendar_events WHERE id = p_id)
    WHEN p_type = 'email_thread' THEN (SELECT workspace_id FROM public.email_refs WHERE id = p_id)
    WHEN p_type = 'email_account' THEN (SELECT workspace_id FROM public.email_accounts WHERE id = p_id)
    WHEN p_type = 'calendar_account' THEN (SELECT workspace_id FROM public.calendar_accounts WHERE id = p_id)
    ELSE NULL END;
  IF v_ws IS NULL OR v_ws IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;

  IF p_type = 'note' THEN RETURN public.can_access('note', p_id, 'edit');
  ELSIF p_type IN ('task', 'task_project') THEN RETURN public.can_access('task', p_id, 'edit');
  ELSIF p_type = 'bucket' THEN RETURN public.can_access('bucket', p_id, 'edit');
  ELSIF p_type = 'contact' THEN RETURN public.can_access('contact', p_id, 'edit');
  ELSIF p_type = 'company' THEN RETURN public.can_access('company', p_id, 'edit');
  ELSIF p_type = 'event' THEN RETURN public.can_access('event', p_id, 'edit');
  ELSE
    -- Owner-only items (email threads and accounts, calendar accounts):
    -- seeing one is owning it.
    RETURN public.perm_can_see_entity(p_workspace_id, p_type, p_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.perm_can_edit_entity(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perm_can_edit_entity(uuid, text, uuid) TO authenticated, service_role;

-- Whether the actor can write the workspace's tags: its owner, or a member
-- with Edit in some module (viewers can't).
CREATE OR REPLACE FUNCTION public.perm_can_tag(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.perm_is_owner(p_workspace_id, public.perm_actor_id())
      OR EXISTS (
        SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id = p_workspace_id AND m.user_id = public.perm_actor_id()
          AND m.perms && ARRAY['tasks.edit', 'notes.edit', 'contacts.edit', 'calendar.edit'])
$$;
REVOKE ALL ON FUNCTION public.perm_can_tag(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.perm_can_tag(uuid) TO authenticated, service_role;

-- A whole-row save (insert … on conflict update) of an existing tag passes
-- the insert check when it keeps the tag's owner; the update checks then
-- apply. A new row still has to be the creator's own.
CREATE OR REPLACE FUNCTION public.tags_insert_keeps_owner(p_id uuid, p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tags t
    WHERE t.id = p_id AND t.owner_id IS NOT DISTINCT FROM p_owner
      AND public.tasks_module_can_access_workspace(t.workspace_id))
$$;
REVOKE ALL ON FUNCTION public.tags_insert_keeps_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tags_insert_keeps_owner(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS tags_workspace_access ON public.tags;
DROP POLICY IF EXISTS tags_read ON public.tags;
CREATE POLICY tags_read ON public.tags
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id));
DROP POLICY IF EXISTS tags_insert ON public.tags;
CREATE POLICY tags_insert ON public.tags
  FOR INSERT TO authenticated
  WITH CHECK (public.perm_can_tag(workspace_id)
              AND (owner_id = (SELECT auth.uid()) OR public.tags_insert_keeps_owner(id, owner_id)));
DROP POLICY IF EXISTS tags_update ON public.tags;
CREATE POLICY tags_update ON public.tags
  FOR UPDATE TO authenticated
  USING (public.perm_can_tag(workspace_id))
  WITH CHECK (public.perm_can_tag(workspace_id));
-- No DELETE policy: tags are deleted softly (deleted_at).

-- Deleting a tag takes it off everything it was on, items the person deleting
-- it can't see included (the tag itself is what they're allowed to delete).
CREATE OR REPLACE FUNCTION public.tags_drop_links_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.tag_links WHERE tag_id = NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tags_drop_links_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tags_drop_links_on_delete ON public.tags;
CREATE TRIGGER tags_drop_links_on_delete
  AFTER UPDATE OF deleted_at ON public.tags
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.tags_drop_links_on_delete();

DROP POLICY IF EXISTS tag_links_workspace_access ON public.tag_links;
DROP POLICY IF EXISTS tag_links_read ON public.tag_links;
CREATE POLICY tag_links_read ON public.tag_links
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id)
         AND public.perm_can_see_entity(workspace_id, entity_type, entity_id));
DROP POLICY IF EXISTS tag_links_insert ON public.tag_links;
CREATE POLICY tag_links_insert ON public.tag_links
  FOR INSERT TO authenticated
  WITH CHECK (public.tasks_module_can_access_workspace(workspace_id)
              AND public.perm_can_edit_entity(workspace_id, entity_type, entity_id)
              AND EXISTS (SELECT 1 FROM public.tags t
                          WHERE t.id = tag_links.tag_id AND t.workspace_id = tag_links.workspace_id
                            AND t.deleted_at IS NULL));
DROP POLICY IF EXISTS tag_links_delete ON public.tag_links;
CREATE POLICY tag_links_delete ON public.tag_links
  FOR DELETE TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id)
         AND public.perm_can_edit_entity(workspace_id, entity_type, entity_id));
-- No UPDATE policy: a link is added or removed, never rewritten.

-- ── 4. Dependencies ─────────────────────────────────────────────────────────
-- perm_enforce_write('tasks', 'edit') stays on the table for the module check.

DROP POLICY IF EXISTS task_relations_workspace_access ON public.task_relations;
DROP POLICY IF EXISTS task_relations_read ON public.task_relations;
CREATE POLICY task_relations_read ON public.task_relations
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks')
         AND public.can_access('task', blocker_task_id, 'view')
         AND public.can_access('task', blocked_task_id, 'view'));
DROP POLICY IF EXISTS task_relations_insert ON public.task_relations;
CREATE POLICY task_relations_insert ON public.task_relations
  FOR INSERT TO authenticated
  WITH CHECK (public.perm_can_view(workspace_id, 'tasks')
              AND public.can_access('task', blocked_task_id, 'edit')
              AND public.can_access('task', blocker_task_id, 'view'));
DROP POLICY IF EXISTS task_relations_delete ON public.task_relations;
CREATE POLICY task_relations_delete ON public.task_relations
  FOR DELETE TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks')
         AND public.can_access('task', blocked_task_id, 'edit'));
-- No UPDATE policy: the spine link mirrors inserts and deletes only.

-- The loop check has to see every dependency, also the ones the reads above
-- now hide from the person adding one, or a loop through tasks they can't see
-- would get in. So it runs as the definer, and only for two tasks the person
-- can see: for others it answers what it answered before (as the invoker it
-- couldn't find them), and the insert policy refuses them anyway.
-- Newest body before this: 20260612140000_task_relations.sql.
CREATE OR REPLACE FUNCTION public.task_relations_forbid_cycles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks b, public.tasks d
    WHERE b.id = NEW.blocker_task_id
      AND d.id = NEW.blocked_task_id
      AND b.workspace_id = NEW.workspace_id
      AND d.workspace_id = NEW.workspace_id
  ) OR (public.perm_actor_id() IS NOT NULL
        AND NOT (public.can_access('task', NEW.blocker_task_id, 'view')
                 AND public.can_access('task', NEW.blocked_task_id, 'view'))) THEN
    RAISE EXCEPTION 'Dependencies link two tasks in the same workspace';
  END IF;

  IF EXISTS (
    WITH RECURSIVE downstream AS (
      SELECT r.blocked_task_id
      FROM public.task_relations r
      WHERE r.blocker_task_id = NEW.blocked_task_id
        AND r.workspace_id = NEW.workspace_id
      UNION
      SELECT r.blocked_task_id
      FROM public.task_relations r
      JOIN downstream ds ON r.blocker_task_id = ds.blocked_task_id
      WHERE r.workspace_id = NEW.workspace_id
    )
    SELECT 1 FROM downstream WHERE blocked_task_id = NEW.blocker_task_id
  ) THEN
    RAISE EXCEPTION 'Dependencies cannot form a cycle';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.task_relations_forbid_cycles() FROM PUBLIC, anon, authenticated;

-- ── 5. Assignment access ────────────────────────────────────────────────────

ALTER TABLE public.resource_grants ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual';
ALTER TABLE public.resource_grants DROP CONSTRAINT IF EXISTS resource_grants_origin_check;
ALTER TABLE public.resource_grants
  ADD CONSTRAINT resource_grants_origin_check CHECK (origin IN ('assign','manual'));

-- When an assignment raises a share made by hand (a View share, say) to Edit,
-- the row becomes the assignment's and keeps the hand-set level here, so it
-- goes back to that level when the assignment ends. Only levels below Edit
-- are ever raised.
ALTER TABLE public.resource_grants ADD COLUMN IF NOT EXISTS manual_level text;
ALTER TABLE public.resource_grants DROP CONSTRAINT IF EXISTS resource_grants_manual_level_check;
ALTER TABLE public.resource_grants
  ADD CONSTRAINT resource_grants_manual_level_check
  CHECK (manual_level IS NULL OR (origin = 'assign' AND manual_level IN ('freebusy','view')));

-- Backfill. Until now a grant didn't record where it came from. A member Edit
-- grant on a task held by the task's current assignee is what assigning
-- creates (the app shares single tasks no other way), so it's marked as the
-- assignment's and goes when the task is reassigned. Everything else stays
-- 'manual', including a task grant held by someone the task is no longer
-- assigned to: it may have been shared by hand, and taking access away on a
-- guess is worse than leaving it. (On 2026-10-10 production held no member
-- grants on tasks at all, so this changes nothing there.)
UPDATE public.resource_grants g
SET origin = 'assign'
FROM public.tasks t
WHERE g.resource_type = 'task' AND g.resource_id = t.id
  AND g.subject_type = 'member' AND g.subject_id = t.assignee_id
  AND g.level = 'edit' AND g.origin = 'manual';

-- Newest body before this: 20261008150000_tasks_assignee_creator.sql.
CREATE OR REPLACE FUNCTION public.share_task_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN RETURN NEW; END IF;
    -- The previous assignee loses what the assignment gave them: a share
    -- made by hand goes back to its own level, anything else goes.
    IF OLD.assignee_id IS NOT NULL THEN
      UPDATE public.resource_grants
      SET level = manual_level, origin = 'manual', manual_level = NULL
      WHERE resource_type = 'task' AND resource_id = NEW.id
        AND subject_type = 'member' AND subject_id = OLD.assignee_id
        AND origin = 'assign' AND manual_level IS NOT NULL;
      DELETE FROM public.resource_grants
      WHERE resource_type = 'task' AND resource_id = NEW.id
        AND subject_type = 'member' AND subject_id = OLD.assignee_id
        AND origin = 'assign';
    END IF;
  END IF;
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  IF public.can_access('bucket', NEW.bucket_id, 'edit', NEW.assignee_id) THEN RETURN NEW; END IF;
  -- A share made by hand at Edit or above is left as it is. One below Edit is
  -- raised to Edit and remembers its level (manual_level).
  INSERT INTO public.resource_grants
    (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by, origin)
  VALUES (NEW.workspace_id, 'task', NEW.id, 'member', NEW.assignee_id, 'edit', public.perm_actor_id(), 'assign')
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET
    level = CASE
      WHEN public.grant_level_rank(resource_grants.level) >= public.grant_level_rank('edit')
        THEN resource_grants.level
      ELSE 'edit' END,
    origin = CASE
      WHEN resource_grants.origin = 'manual'
           AND public.grant_level_rank(resource_grants.level) >= public.grant_level_rank('edit')
        THEN 'manual'
      ELSE 'assign' END,
    manual_level = CASE
      WHEN resource_grants.origin = 'manual'
           AND public.grant_level_rank(resource_grants.level) < public.grant_level_rank('edit')
        THEN resource_grants.level
      ELSE resource_grants.manual_level END;
  RETURN NEW;
END;
$$;

-- Newest body before this: 20261006210000_perm_sharing.sql. A share set by
-- hand is 'manual' at the level asked for. One exception: while someone is
-- assigned a task (and their project doesn't already give them Edit), they
-- keep the Edit the assignment gives them. A share set by hand for them below
-- Edit, or none, is kept underneath (manual_level) and applies once the
-- assignment ends.
CREATE OR REPLACE FUNCTION public.share_op_set(
  p_type text, p_id uuid, p_subject_type text, p_subject_id uuid, p_level text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
  v_ws uuid;
  v_below_edit boolean := p_level IS NULL OR p_level = 'private'
    OR public.grant_level_rank(p_level) < public.grant_level_rank('edit');
  v_assigned boolean := false;
BEGIN
  IF NOT public.can_access(p_type, p_id, 'full', v_user) THEN
    RAISE EXCEPTION 'You can''t change who has access to this.' USING ERRCODE = '42501';
  END IF;
  IF p_type = 'bucket' AND EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = p_id AND b.is_system) THEN
    RAISE EXCEPTION 'The Inbox stays private.' USING ERRCODE = '42501';
  END IF;
  SELECT CASE p_type
    WHEN 'note' THEN (SELECT workspace_id FROM public.notes WHERE id = p_id)
    WHEN 'bucket' THEN (SELECT workspace_id FROM public.buckets WHERE id = p_id)
    WHEN 'task' THEN (SELECT workspace_id FROM public.tasks WHERE id = p_id)
    WHEN 'calendar' THEN (SELECT workspace_id FROM public.calendars WHERE id = p_id)
    WHEN 'contact' THEN (SELECT workspace_id FROM public.contacts WHERE id = p_id)
    WHEN 'contact_group' THEN (SELECT workspace_id FROM public.contact_groups WHERE id = p_id)
    ELSE NULL END
  INTO v_ws;

  IF NOT (p_level IS NULL OR p_level = 'private')
     AND public.grant_level_rank(p_level) > public.perm_ceiling_rank(
       v_ws, v_user,
       CASE p_type WHEN 'note' THEN 'notes' WHEN 'bucket' THEN 'tasks' WHEN 'task' THEN 'tasks'
                   WHEN 'calendar' THEN 'calendar' ELSE 'contacts' END
     ) THEN
    RAISE EXCEPTION 'You can''t grant more access than you have.' USING ERRCODE = '42501';
  END IF;

  IF p_type = 'task' AND p_subject_type = 'member' AND v_below_edit THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = p_id AND t.assignee_id = p_subject_id
        AND NOT public.can_access('bucket', t.bucket_id, 'edit', p_subject_id))
    INTO v_assigned;
  END IF;

  IF v_assigned THEN
    INSERT INTO public.resource_grants
      (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by, origin, manual_level)
    VALUES (v_ws, p_type, p_id, p_subject_type, p_subject_id, 'edit', v_user, 'assign',
            CASE WHEN p_level IS NULL OR p_level = 'private' THEN NULL ELSE p_level END)
    ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
    DO UPDATE SET level = 'edit', origin = 'assign', manual_level = EXCLUDED.manual_level;
    RETURN;
  END IF;

  IF p_level IS NULL OR p_level = 'private' THEN
    DELETE FROM public.resource_grants
    WHERE resource_type = p_type AND resource_id = p_id
      AND subject_type = p_subject_type
      AND subject_id IS NOT DISTINCT FROM p_subject_id;
    RETURN;
  END IF;

  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by, origin)
  VALUES (v_ws, p_type, p_id, p_subject_type, p_subject_id, p_level, v_user, 'manual')
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key)
  DO UPDATE SET level = EXCLUDED.level, origin = 'manual', manual_level = NULL;

  IF p_type = 'note' THEN
    UPDATE public.notes SET share_mode = 'custom' WHERE id = p_id AND share_mode = 'inherit';
  END IF;
END;
$$;
-- CREATE OR REPLACE keeps grants; restated so this file alone is enough.
REVOKE ALL ON FUNCTION public.share_op_set(text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_op_set(text, uuid, text, uuid, text) TO authenticated, service_role;

-- TV-D11b · What the shared store needs at 10,000 tasks (specs/tasks-v3.md
-- block 12, §Assumptions #7 and #8; the TV-D11a deferrals in BUILD_ORDER).
--
--   1. Indexes the delta reads and the access check page through:
--      (workspace_id, updated_at, id) where a table had none, and the live
--      ids of tasks by (workspace_id, id).
--   2. Realtime: task_completions (a teammate's check-off history) and
--      attachments join supabase_realtime; so does the grant feed (4).
--   3. Tombstones for the hard-delete tables (task_queue, tag_links,
--      task_relations): each delete leaves (table, row id, when) in
--      sync_tombstones, and the three tables carry a server-stamped
--      updated_at, so the store reads their changes instead of all of them.
--      Kept 7 days (the store reads everything whole at least daily).
--   4. The grant feed, access_changes: one row per change in who can see a
--      project or a task (a share made, changed or removed; a task moved to
--      another project; a member's role or a role's permissions changed),
--      naming the thing and whom it concerns (a person, or everyone in the
--      workspace), never its contents. Clients read it live and with every
--      delta and check those rows at once. Kept 2 days.
--   5. tasks_search: every task you can see whose title or description text
--      has every word, newest change first (ids only).
--
-- Who sees what (owner, member, outsider):
--   * sync_tombstones: members who can open Tasks in the workspace (the same
--     test as resource_grants and tag_links). A row is a table name and a
--     random id of a row that no longer exists; the Realtime DELETE events of
--     task_queue and tag_links already hand every subscriber these ids.
--     Outsiders see nothing. Nobody writes it but the trigger.
--   * access_changes: a member reads the rows for them and the workspace's
--     (user_id null); not another member's. Every member can already read
--     every resource_grants row of the workspace (resource_grants_read), so
--     the feed reveals nothing new about shares; a task moved between
--     projects names the task's id to the workspace. Outsiders see nothing.
--     Nobody writes it but the triggers. A row concerning a person goes with
--     their account (ON DELETE CASCADE).
--   * tasks_search: SECURITY DEFINER so the text test runs before the
--     per-row access check (RLS would check all 10,000 first); it answers
--     only with tasks the caller can see (TV-D10-fix's one gate for a task,
--     tasks__visible_to), and nothing to anyone who can't view Tasks in the
--     workspace.
--
-- Apply after TV-U6 (20261011100000) and TV-D10-fix (20261011110000), whose
-- tasks__visible_to it calls. Idempotent where it can be (IF NOT EXISTS,
-- CREATE OR REPLACE, the publication guarded per table). Verified on the
-- local stack by supabase/tests/sync_feed.test.sql.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.tasks__visible_to(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D10-fix (20261011110000_task_sessions_access) before this migration.';
  END IF;
END;
$$;

-- ── 1. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS tasks_workspace_updated
  ON public.tasks (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS tasks_workspace_live_id
  ON public.tasks (workspace_id, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_workspace_updated
  ON public.comments (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS buckets_workspace_updated
  ON public.buckets (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS tags_workspace_updated
  ON public.tags (workspace_id, updated_at, id);

-- ── 3. Stamps and tombstones for the hard-delete tables ────────────────────

ALTER TABLE public.tag_links ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.task_relations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The server stamps every write (an old build's raw write too), like tasks'.
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.task_queue;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.task_queue
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.tag_links;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.tag_links
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.task_relations;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.task_relations
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

CREATE INDEX IF NOT EXISTS task_queue_workspace_updated
  ON public.task_queue (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS tag_links_workspace_updated
  ON public.tag_links (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS task_relations_workspace_updated
  ON public.task_relations (workspace_id, updated_at, id);

CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  table_name text NOT NULL CHECK (table_name IN ('task_queue','tag_links','task_relations')),
  row_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (table_name, row_id)
);
CREATE INDEX IF NOT EXISTS sync_tombstones_delta
  ON public.sync_tombstones (workspace_id, table_name, deleted_at, row_id);

ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_tombstones_read ON public.sync_tombstones;
CREATE POLICY sync_tombstones_read ON public.sync_tombstones
  FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id));
REVOKE ALL ON TABLE public.sync_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sync_tombstones TO authenticated;

CREATE OR REPLACE FUNCTION public.sync__tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- The workspace itself is going (its delete cascades here, an owner's
  -- account erasure included): nothing to tell, and a mark would point at a
  -- row that no longer exists.
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  INSERT INTO public.sync_tombstones (table_name, row_id, workspace_id, deleted_at)
  VALUES (TG_TABLE_NAME, OLD.id, OLD.workspace_id, clock_timestamp())
  ON CONFLICT (table_name, row_id)
    DO UPDATE SET deleted_at = excluded.deleted_at, workspace_id = excluded.workspace_id;
  -- Older than any delta reads back (the store reads whole at least daily).
  DELETE FROM public.sync_tombstones t
  WHERE t.workspace_id = OLD.workspace_id
    AND t.table_name = TG_TABLE_NAME
    AND t.deleted_at < clock_timestamp() - interval '7 days';
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.sync__tombstone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_tombstone ON public.task_queue;
CREATE TRIGGER sync_tombstone AFTER DELETE ON public.task_queue
  FOR EACH ROW EXECUTE FUNCTION public.sync__tombstone();
DROP TRIGGER IF EXISTS sync_tombstone ON public.tag_links;
CREATE TRIGGER sync_tombstone AFTER DELETE ON public.tag_links
  FOR EACH ROW EXECUTE FUNCTION public.sync__tombstone();
DROP TRIGGER IF EXISTS sync_tombstone ON public.task_relations;
CREATE TRIGGER sync_tombstone AFTER DELETE ON public.task_relations
  FOR EACH ROW EXECUTE FUNCTION public.sync__tombstone();

-- ── 4. The grant feed ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.access_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  -- Whom it concerns; null: everyone in the workspace.
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('bucket','task','workspace')),
  resource_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS access_changes_workspace_at
  ON public.access_changes (workspace_id, changed_at, id);
CREATE INDEX IF NOT EXISTS access_changes_user
  ON public.access_changes (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.access_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS access_changes_read ON public.access_changes;
CREATE POLICY access_changes_read ON public.access_changes
  FOR SELECT TO authenticated
  USING (
    (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND public.tasks_module_can_access_workspace(workspace_id)
  );
REVOKE ALL ON TABLE public.access_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.access_changes TO authenticated;

-- One row, and the feed's own clean-up (2 days: a client away longer reads
-- everything whole at its next sync anyway).
CREATE OR REPLACE FUNCTION public.access_changes__note(
  p_workspace_id uuid,
  p_user_id uuid,
  p_resource_type text,
  p_resource_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Nothing to tell when the workspace or the person is going (a delete
  -- cascading from either, an account's erasure): the row would point at
  -- something that no longer exists.
  IF p_workspace_id IS NULL OR p_resource_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id)
     OR (p_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id)) THEN
    RETURN;
  END IF;
  INSERT INTO public.access_changes (workspace_id, user_id, resource_type, resource_id)
  VALUES (p_workspace_id, p_user_id, p_resource_type, p_resource_id);
  DELETE FROM public.access_changes c
  WHERE c.workspace_id = p_workspace_id
    AND c.changed_at < clock_timestamp() - interval '2 days';
END;
$$;
REVOKE ALL ON FUNCTION public.access_changes__note(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- A share of a project or a task made, changed or removed: whom it concerns
-- (a member, or everyone for a workspace share; a public link concerns no
-- member).
CREATE OR REPLACE FUNCTION public.access_changes__grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.resource_type IN ('bucket', 'task')
     AND OLD.subject_type IN ('member', 'workspace') THEN
    PERFORM public.access_changes__note(
      OLD.workspace_id,
      CASE WHEN OLD.subject_type = 'member' THEN OLD.subject_id END,
      OLD.resource_type, OLD.resource_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.resource_type IN ('bucket', 'task')
     AND NEW.subject_type IN ('member', 'workspace') THEN
    IF TG_OP = 'UPDATE'
       AND (NEW.workspace_id, NEW.subject_type, NEW.subject_key, NEW.resource_type, NEW.resource_id)
           IS NOT DISTINCT FROM
           (OLD.workspace_id, OLD.subject_type, OLD.subject_key, OLD.resource_type, OLD.resource_id) THEN
      RETURN NULL; -- the same person and thing: the row above says it
    END IF;
    PERFORM public.access_changes__note(
      NEW.workspace_id,
      CASE WHEN NEW.subject_type = 'member' THEN NEW.subject_id END,
      NEW.resource_type, NEW.resource_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_changes__grant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS access_changes_grant ON public.resource_grants;
CREATE TRIGGER access_changes_grant
  AFTER INSERT OR UPDATE OR DELETE ON public.resource_grants
  FOR EACH ROW EXECUTE FUNCTION public.access_changes__grant();

-- A task moved to another project: who sees it may change. Realtime brings
-- the moved row to whoever can see it now; whoever could only see it before
-- learns it here.
CREATE OR REPLACE FUNCTION public.access_changes__task_moved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.access_changes__note(NEW.workspace_id, NULL, 'task', NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_changes__task_moved() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS access_changes_task_moved ON public.tasks;
CREATE TRIGGER access_changes_task_moved
  AFTER UPDATE OF bucket_id ON public.tasks
  FOR EACH ROW WHEN (OLD.bucket_id IS DISTINCT FROM NEW.bucket_id)
  EXECUTE FUNCTION public.access_changes__task_moved();

-- A member's role or permissions changed: everything they see may change.
CREATE OR REPLACE FUNCTION public.access_changes__member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.access_changes__note(NEW.workspace_id, NEW.user_id, 'workspace', NEW.workspace_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_changes__member() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS access_changes_member ON public.workspace_members;
CREATE TRIGGER access_changes_member
  AFTER UPDATE OF role, role_id, perms, overrides, permissions_tasks ON public.workspace_members
  FOR EACH ROW
  WHEN ((OLD.role, OLD.role_id, OLD.perms, OLD.overrides, OLD.permissions_tasks)
        IS DISTINCT FROM (NEW.role, NEW.role_id, NEW.perms, NEW.overrides, NEW.permissions_tasks))
  EXECUTE FUNCTION public.access_changes__member();

-- A role's permissions changed: everyone holding it, so the whole workspace.
CREATE OR REPLACE FUNCTION public.access_changes__role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.access_changes__note(NEW.workspace_id, NULL, 'workspace', NEW.workspace_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.access_changes__role() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS access_changes_role ON public.workspace_roles;
CREATE TRIGGER access_changes_role
  AFTER UPDATE OF permissions ON public.workspace_roles
  FOR EACH ROW WHEN (OLD.permissions IS DISTINCT FROM NEW.permissions)
  EXECUTE FUNCTION public.access_changes__role();

-- ── 2. Realtime ─────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
  FOREACH t IN ARRAY ARRAY['task_completions', 'attachments', 'access_changes'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'public.% is missing: apply the migrations that create it first.', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;

-- ── 5. tasks_search ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks_search(
  p_workspace_id uuid,
  p_query text,
  p_limit integer DEFAULT 200
)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
  v_words text[];
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_found integer := 0;
  v_id uuid;
BEGIN
  IF v_user IS NULL OR p_workspace_id IS NULL
     OR NOT public.perm_can_view(p_workspace_id, 'tasks') THEN
    RETURN;
  END IF;
  v_words := ARRAY(
    SELECT w FROM regexp_split_to_table(lower(btrim(coalesce(p_query, ''))), '\s+') AS w
    WHERE w <> '' LIMIT 8
  );
  IF coalesce(array_length(v_words, 1), 0) = 0 THEN
    RETURN;
  END IF;
  -- The text first (cheap), then the access check on the matches only.
  -- A task reads as its title and its description's text, lower-cased: the
  -- editor stores HTML, so tags go, the common entities are decoded, and a
  -- reference's stored text is never searchable (the app's
  -- `descriptionText`, which searches the device copy, follows the same rules).
  FOR v_id IN
    SELECT t.id
    FROM public.tasks t
    CROSS JOIN LATERAL (
      SELECT lower(
        t.title || E'\n' ||
        CASE
          WHEN t.description ~ '^\s*<' THEN
            replace(replace(replace(replace(replace(replace(
              regexp_replace(
                regexp_replace(t.description,
                  '<span[^>]*data-lexical-entity-ref[^>]*>[^<]*</span>', ' ', 'g'),
                '<[^>]*>', ' ', 'g'),
              '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
          ELSE t.description
        END
      ) AS hay
    ) AS h
    WHERE t.workspace_id = p_workspace_id
      AND t.deleted_at IS NULL
      AND (SELECT bool_and(strpos(h.hay, w) > 0) FROM unnest(v_words) AS w)
    ORDER BY t.updated_at DESC, t.id
  LOOP
    IF public.tasks__visible_to(v_id, v_user) THEN
      RETURN NEXT v_id;
      v_found := v_found + 1;
      EXIT WHEN v_found >= v_limit;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.tasks_search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasks_search(uuid, text, integer) TO authenticated;

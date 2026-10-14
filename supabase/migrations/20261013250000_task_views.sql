-- TV-U8 · Saved views (specs/tasks-v3.md block 21; REPLAN 29b–29e, 29d).
--
-- A saved view is a lens, never a copy. It keeps a base scope (All, My tasks,
-- Upcoming, or one project), the Filter's conditions and the Display choices
-- under a name. It stores no task, no result and no count: whoever opens it
-- sees only what their own access shows through it. My tasks and Upcoming
-- are each reader's own.
--
-- Views are yours until you share one with the workspace (`shared`). A shared
-- view that keeps a project shows only to people who can see that project:
-- its name and its filter never reach anyone else. The read policy and every
-- op ask the same question (`task_views__sees`); a view shared by someone
-- who has left the workspace reads as gone. A filter keeps only the
-- app's words and the ids of this workspace's people, teams and tags (never
-- a project or anything from another workspace); Display keeps only words.
-- Keeping your own views needs only Tasks view access; sharing one needs
-- edit access and that you still see its project. Only the maker renames,
-- edits, re-shares or moves a view; the workspace's owner or an admin can
-- also unshare or delete (and restore) a shared one they can see, to tidy
-- what the workspace shares (a view shared by someone who has left reads as
-- gone for everyone, admins too). API keys can't call the ops, whatever their
-- scope. Writes go through the ops only, and a view you can't see answers
-- like one that doesn't exist (a create that names an id someone else's view
-- already has is refused: that says only that a random id is taken).
--
-- `seed` names a view onboarding made for someone (TV-U17's role defaults):
-- one per person, workspace and seed, deleted ones included, so a resend or a
-- second device never makes it twice and a deleted one never comes back.
--
-- Views are read whole by the shared store on every sync (sharing changes
-- what you can see without moving a stamp); the table isn't published to
-- Realtime. Erasure takes a person's views, shared ones too.
-- Re-runnable.

-- ── 1. The table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  scope text NOT NULL,
  project_id uuid REFERENCES public.buckets(id) ON DELETE CASCADE,
  filters jsonb NOT NULL DEFAULT '[]'::jsonb,
  display jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared boolean NOT NULL DEFAULT false,
  position double precision NOT NULL DEFAULT 0,
  seed text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT task_views_name_check CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  CONSTRAINT task_views_scope_check CHECK (scope IN ('all','mine','upcoming','project')),
  CONSTRAINT task_views_project_check CHECK ((scope = 'project') = (project_id IS NOT NULL)),
  CONSTRAINT task_views_filters_check CHECK (jsonb_typeof(filters) = 'array' AND octet_length(filters::text) <= 32768),
  CONSTRAINT task_views_display_check CHECK (jsonb_typeof(display) = 'object' AND octet_length(display::text) <= 8192),
  CONSTRAINT task_views_seed_check CHECK (seed IS NULL OR seed ~ '^[a-z][a-z_]{0,39}$')
);

CREATE INDEX IF NOT EXISTS task_views_workspace ON public.task_views (workspace_id, id);
CREATE INDEX IF NOT EXISTS task_views_owner ON public.task_views (owner_id, workspace_id);
CREATE INDEX IF NOT EXISTS task_views_project ON public.task_views (project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_views_seed_once
  ON public.task_views (workspace_id, owner_id, seed) WHERE seed IS NOT NULL;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.task_views;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.task_views
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- ── 2. Who sees a view ─────────────────────────────────────────────────────

-- The maker always; anyone else while it's shared, its maker still works in
-- the workspace and, for a project view, only while they can see that
-- project. Service only.
DROP FUNCTION IF EXISTS public.task_views__sees(uuid, boolean, uuid, uuid);
CREATE OR REPLACE FUNCTION public.task_views__sees(
  p_workspace_id uuid, p_owner uuid, p_shared boolean, p_project uuid, p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_actor IS NOT NULL
     AND (p_owner = p_actor
          OR (coalesce(p_shared, false)
              AND public.tasks__is_member(p_workspace_id, p_owner)
              AND (p_project IS NULL OR public.projects__visible_to(p_project, p_actor))))
$$;

-- Whether the caller may read a view: live, Tasks open to them in its
-- workspace, and `task_views__sees`. The read policy's one question; it
-- answers only for the caller, about a view by its id.
CREATE OR REPLACE FUNCTION public.task_views__readable(p_view_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_views x
    WHERE x.id = p_view_id AND x.deleted_at IS NULL
      AND public.perm_can_view(x.workspace_id, 'tasks')
      AND public.task_views__sees(x.workspace_id, x.owner_id, x.shared, x.project_id,
                                  public.perm_actor_id()))
$$;

-- Read: your own, and the ones shared with the workspace you may see, while
-- you can see Tasks there. Deleted views are read by nobody (the store reads
-- the table whole, so a missing row is a gone row). Writes: the ops only.
ALTER TABLE public.task_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_views_read ON public.task_views;
CREATE POLICY task_views_read ON public.task_views FOR SELECT TO authenticated
  USING (public.task_views__readable(id));

REVOKE ALL ON public.task_views FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_views TO authenticated;
GRANT ALL ON public.task_views TO service_role;

-- ── 3. Shapes ──────────────────────────────────────────────────────────────

-- The Filter's conditions as the app keeps them (`FilterCondition`): at most
-- 30, each { dimension, operator: is | is_not | any_of, values: 1 to 100 }.
-- Only the app's dimensions (TASK_VIEW_ID_DIMENSIONS and
-- TASK_VIEW_WORD_DIMENSIONS in @contracts/vocabularies). A word dimension
-- holds short words ("week", "done"); a person, team or tag dimension holds
-- "none" or the id of someone or something in this same workspace: a person
-- who works here (or the assignee of a task the saver can see), a team or a
-- tag of the workspace. Nothing else is kept, so a view never carries
-- anything a reader of the workspace couldn't see already. Every refusal
-- reads the same, so saving a view tells nothing about an id.
DROP FUNCTION IF EXISTS public.task_views__check_filters(jsonb);
DROP FUNCTION IF EXISTS public.task_views__check_filters(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.task_views__check_filters(
  p_workspace_id uuid, p_actor uuid, p_filters jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  c jsonb;
  v jsonb;
  v_dim text;
  v_text text;
  v_id uuid;
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'array' THEN
    RAISE EXCEPTION 'A view''s filter is a list of conditions.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_filters) > 30 THEN
    RAISE EXCEPTION 'A view keeps at most 30 filter conditions.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_filters::text) > 32768 THEN
    RAISE EXCEPTION 'That filter is too large to save in a view.' USING ERRCODE = '22023';
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_filters) LOOP
    IF jsonb_typeof(c) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN ('dimension', 'operator', 'values'))
       OR jsonb_typeof(c -> 'dimension') IS DISTINCT FROM 'string'
       OR jsonb_typeof(c -> 'operator') IS DISTINCT FROM 'string'
       OR jsonb_typeof(c -> 'values') IS DISTINCT FROM 'array'
       OR (c ->> 'operator') NOT IN ('is', 'is_not', 'any_of')
       OR jsonb_array_length(c -> 'values') NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
    END IF;
    v_dim := c ->> 'dimension';
    IF v_dim NOT IN ('assignee', 'creator', 'team', 'tag')
       AND v_dim NOT IN ('status', 'completed', 'priority', 'energy', 'due', 'scheduled', 'queued', 'blocked', 'waiting', 'recurring', 'subtasks', 'attachments') THEN
      RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
    END IF;
    FOR v IN SELECT value FROM jsonb_array_elements(c -> 'values') LOOP
      IF jsonb_typeof(v) <> 'string' THEN
        RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
      END IF;
      v_text := v #>> '{}';
      IF v_text = 'none' THEN
        CONTINUE;
      END IF;
      IF v_dim NOT IN ('assignee', 'creator', 'team', 'tag') THEN
        IF v_text !~ '^[a-z][a-z_]{0,23}$' THEN
          RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
        END IF;
        CONTINUE;
      END IF;
      IF v_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
      END IF;
      v_id := v_text::uuid;
      -- A former member counts while they're on a task the saver can see:
      -- its assignee for Assignee, its maker (`owner_id`) for Creator.
      IF (v_dim = 'assignee' AND NOT (
            public.tasks__is_member(p_workspace_id, v_id)
            OR EXISTS (SELECT 1 FROM public.tasks t
                       WHERE t.assignee_id = v_id AND t.workspace_id = p_workspace_id
                         AND public.tasks__visible_to(t.id, p_actor))))
         OR (v_dim = 'creator' AND NOT (
            public.tasks__is_member(p_workspace_id, v_id)
            OR EXISTS (SELECT 1 FROM public.tasks t
                       WHERE t.owner_id = v_id AND t.workspace_id = p_workspace_id
                         AND public.tasks__visible_to(t.id, p_actor))))
         OR (v_dim = 'team' AND NOT EXISTS (
            SELECT 1 FROM public.teams x WHERE x.id = v_id AND x.workspace_id = p_workspace_id))
         OR (v_dim = 'tag' AND NOT EXISTS (
            SELECT 1 FROM public.tags x WHERE x.id = v_id AND x.workspace_id = p_workspace_id)) THEN
        RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  RETURN p_filters;
END;
$$;

-- Display's choices as the app keeps them: one level of short words
-- ("board", "detailed"), yes/no switches and lists of short words (Show on
-- rows). No ids, no free text. The app reads them back through its own
-- sanitiser; anything it doesn't know falls back.
CREATE OR REPLACE FUNCTION public.task_views__check_display(p_display jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  k text;
  v jsonb;
  w jsonb;
BEGIN
  IF p_display IS NULL OR jsonb_typeof(p_display) <> 'object' THEN
    RAISE EXCEPTION 'A view''s Display is a set of choices.' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_display::text) > 4096 THEN
    RAISE EXCEPTION 'That Display is too large to save in a view.' USING ERRCODE = '22023';
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_display) LOOP
    IF k !~ '^[a-zA-Z][a-zA-Z_]{0,39}$' THEN
      RAISE EXCEPTION 'That Display can''t be saved in a view.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v) = 'string' THEN
      IF (v #>> '{}') !~ '^[a-z][a-z_]{0,23}$' THEN
        RAISE EXCEPTION 'That Display can''t be saved in a view.' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(v) = 'array' THEN
      IF jsonb_array_length(v) > 20 THEN
        RAISE EXCEPTION 'That Display can''t be saved in a view.' USING ERRCODE = '22023';
      END IF;
      FOR w IN SELECT value FROM jsonb_array_elements(v) LOOP
        IF jsonb_typeof(w) <> 'string' OR (w #>> '{}') !~ '^[a-z][a-z_]{0,23}$' THEN
          RAISE EXCEPTION 'That Display can''t be saved in a view.' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSIF jsonb_typeof(v) <> 'boolean' THEN
      RAISE EXCEPTION 'That Display can''t be saved in a view.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN p_display;
END;
$$;

-- The caller, once they may keep views here: a signed-in person (never a
-- key) with Tasks access in the workspace.
CREATE OR REPLACE FUNCTION public.task_views__actor(p_workspace_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Views are changed in the app.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL
     OR coalesce(public.tasks_module_permission(p_workspace_id), 'none') NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'That view isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  RETURN v_actor;
END;
$$;

-- ── 4. The ops ─────────────────────────────────────────────────────────────

-- Save a view. Fields: id (a resend answers with what the first one made),
-- name, scope (all · mine · upcoming · project), project_id (a project view's
-- project, which you must see), filters, display, shared, seed. A seed that
-- was made before (deleted or not) answers with that view and makes nothing.
-- Answers with the view.
CREATE OR REPLACE FUNCTION public.task_views_op_create(p_workspace_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_actor uuid;
  v_id uuid;
  v_name text;
  v_scope text;
  v_project uuid;
  v_shared boolean := false;
  v_seed text;
  v_filters jsonb;
  v_display jsonb;
  v jsonb;
BEGIN
  PERFORM public.tasks__check_keys(v_fields,
    ARRAY['id', 'name', 'scope', 'project_id', 'filters', 'display', 'shared', 'seed']);
  v_actor := public.task_views__actor(p_workspace_id);

  v_id := coalesce(public.tasks__try_uuid(v_fields ->> 'id'), gen_random_uuid());
  SELECT to_jsonb(x) INTO v FROM public.task_views x WHERE x.id = v_id;
  IF v IS NOT NULL THEN
    IF (v ->> 'owner_id')::uuid IS DISTINCT FROM v_actor
       OR (v ->> 'workspace_id')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'That view can''t be saved.' USING ERRCODE = '22023';
    END IF;
    RETURN v;
  END IF;

  IF v_fields ? 'seed' AND jsonb_typeof(v_fields -> 'seed') <> 'null' THEN
    v_seed := v_fields ->> 'seed';
    IF jsonb_typeof(v_fields -> 'seed') <> 'string' OR v_seed !~ '^[a-z][a-z_]{0,39}$' THEN
      RAISE EXCEPTION 'That view can''t be saved.' USING ERRCODE = '22023';
    END IF;
    SELECT to_jsonb(x) INTO v FROM public.task_views x
    WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.seed = v_seed;
    IF v IS NOT NULL THEN
      RETURN v;
    END IF;
  END IF;

  v_name := public.tasks__clean_name(v_fields ->> 'name', 'A view', 80);
  v_scope := coalesce(v_fields ->> 'scope', 'all');
  IF v_scope NOT IN ('all', 'mine', 'upcoming', 'project') THEN
    RAISE EXCEPTION 'A view keeps All, My tasks, Upcoming or one project.' USING ERRCODE = '22023';
  END IF;
  IF v_scope = 'project' THEN
    v_project := public.tasks__try_uuid(v_fields ->> 'project_id');
    -- A project you can't see answers like one that isn't there.
    IF v_project IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.buckets b
                      WHERE b.id = v_project AND b.workspace_id = p_workspace_id
                        AND b.deleted_at IS NULL AND NOT b.is_system)
       OR NOT public.projects__visible_to(v_project, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t here any more.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_fields ? 'project_id' AND jsonb_typeof(v_fields -> 'project_id') <> 'null' THEN
    RAISE EXCEPTION 'Only a project view keeps a project.' USING ERRCODE = '22023';
  END IF;
  v_filters := public.task_views__check_filters(p_workspace_id, v_actor, coalesce(v_fields -> 'filters', '[]'::jsonb));
  v_display := public.task_views__check_display(coalesce(v_fields -> 'display', '{}'::jsonb));
  IF v_fields ? 'shared' THEN
    IF jsonb_typeof(v_fields -> 'shared') <> 'boolean' THEN
      RAISE EXCEPTION 'Shared is true or false.' USING ERRCODE = '22023';
    END IF;
    v_shared := (v_fields ->> 'shared')::boolean;
  END IF;
  IF v_shared THEN
    PERFORM public.tasks__guard_structure(p_workspace_id);
  END IF;
  IF (SELECT count(*) FROM public.task_views x
      WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.deleted_at IS NULL) >= 200 THEN
    RAISE EXCEPTION 'You have 200 views here; delete one to save another.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.task_views AS x
    (id, workspace_id, owner_id, name, scope, project_id, filters, display, shared, position, seed)
  VALUES (v_id, p_workspace_id, v_actor, v_name, v_scope, v_project, v_filters, v_display, v_shared,
          coalesce((SELECT max(y.position) FROM public.task_views y
                    WHERE y.workspace_id = p_workspace_id AND y.owner_id = v_actor), 0) + 1,
          v_seed)
  ON CONFLICT (workspace_id, owner_id, seed) WHERE seed IS NOT NULL DO NOTHING
  RETURNING to_jsonb(x) INTO v;
  IF v IS NULL THEN
    -- The same seed, saved a moment ago from another device.
    SELECT to_jsonb(x) INTO v FROM public.task_views x
    WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.seed = v_seed;
  END IF;
  RETURN v;
END;
$$;

-- Rename, save its filter and Display, share or unshare, delete or restore a
-- view. Patch keys: name, filters, display, shared, deleted. The maker does
-- all of it; the workspace's owner or an admin can unshare or delete (and
-- restore) a shared one they can see. Answers with the view.
CREATE OR REPLACE FUNCTION public.task_views_op_update(p_workspace_id uuid, p_view_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_actor uuid;
  r public.task_views;
  v_owner boolean;
  v_admin boolean;
  v_name text;
  v_filters jsonb;
  v_display jsonb;
  v_shared boolean;
  v_deleted timestamptz;
  v jsonb;
BEGIN
  PERFORM public.tasks__check_keys(v_patch, ARRAY['name', 'filters', 'display', 'shared', 'deleted']);
  v_actor := public.task_views__actor(p_workspace_id);
  IF v_patch ? 'shared' AND jsonb_typeof(v_patch -> 'shared') <> 'boolean' THEN
    RAISE EXCEPTION 'Shared is true or false.' USING ERRCODE = '22023';
  END IF;
  IF v_patch ? 'deleted' AND jsonb_typeof(v_patch -> 'deleted') <> 'boolean' THEN
    RAISE EXCEPTION 'Deleted is true or false.' USING ERRCODE = '22023';
  END IF;

  SELECT x.* INTO r FROM public.task_views x
  WHERE x.id = p_view_id AND x.workspace_id = p_workspace_id FOR UPDATE;
  v_owner := FOUND AND r.owner_id = v_actor;
  v_admin := public.perm_is_owner(p_workspace_id, v_actor)
          OR EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.workspace_id = p_workspace_id AND m.user_id = v_actor AND m.role = 'admin');
  -- Someone else's view is there for you only while it's shared and you may
  -- see it (and, for an admin, while its delete can still be undone).
  IF r.id IS NULL
     OR (NOT v_owner
         AND NOT (public.task_views__sees(p_workspace_id, r.owner_id, r.shared, r.project_id, v_actor)
                  AND (r.deleted_at IS NULL OR v_admin))) THEN
    RAISE EXCEPTION 'That view isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_owner AND (NOT v_admin OR v_patch ? 'name' OR v_patch ? 'filters' OR v_patch ? 'display'
                      OR coalesce((v_patch ->> 'shared')::boolean, false)) THEN
    RAISE EXCEPTION 'Only the person who made a view can change it.' USING ERRCODE = '42501';
  END IF;

  v_name := CASE WHEN v_patch ? 'name' THEN public.tasks__clean_name(v_patch ->> 'name', 'A view', 80)
                 ELSE r.name END;
  v_filters := CASE WHEN v_patch ? 'filters' THEN public.task_views__check_filters(p_workspace_id, v_actor, v_patch -> 'filters')
                    ELSE r.filters END;
  v_display := CASE WHEN v_patch ? 'display' THEN public.task_views__check_display(v_patch -> 'display')
                    ELSE r.display END;
  v_shared := CASE WHEN v_patch ? 'shared' THEN (v_patch ->> 'shared')::boolean ELSE r.shared END;
  -- Sharing asks for edit access, and that the maker still sees the project.
  IF v_shared AND NOT r.shared THEN
    PERFORM public.tasks__guard_structure(p_workspace_id);
    IF r.project_id IS NOT NULL AND NOT public.projects__visible_to(r.project_id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t here any more.' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_deleted := CASE WHEN NOT v_patch ? 'deleted' THEN r.deleted_at
                    WHEN (v_patch ->> 'deleted')::boolean THEN coalesce(r.deleted_at, now())
                    ELSE NULL END;

  UPDATE public.task_views x
  SET name = v_name, filters = v_filters, display = v_display, shared = v_shared, deleted_at = v_deleted
  WHERE x.id = r.id
  RETURNING to_jsonb(x) INTO v;
  RETURN v;
END;
$$;

-- Move one of your views a place up or down among your own. Answers with
-- your live views here, in order.
CREATE OR REPLACE FUNCTION public.task_views_op_move(p_workspace_id uuid, p_view_id uuid, p_direction text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid;
  r public.task_views;
  v_at double precision;
  v_other uuid;
BEGIN
  v_actor := public.task_views__actor(p_workspace_id);
  IF p_direction IS NULL OR p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'A view moves up or down.' USING ERRCODE = '22023';
  END IF;
  SELECT x.* INTO r FROM public.task_views x
  WHERE x.id = p_view_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF r.id IS NULL OR NOT public.task_views__sees(p_workspace_id, r.owner_id, r.shared, r.project_id, v_actor) THEN
    RAISE EXCEPTION 'That view isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  IF r.owner_id <> v_actor THEN
    RAISE EXCEPTION 'Only the person who made a view can move it.' USING ERRCODE = '42501';
  END IF;

  -- One place each, in the order they show, so a swap is always a move.
  PERFORM 1 FROM public.task_views x
  WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.deleted_at IS NULL FOR UPDATE;
  WITH ordered AS (
    SELECT x.id, row_number() OVER (ORDER BY x.position, x.created_at, x.id)::double precision AS rn
    FROM public.task_views x
    WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.deleted_at IS NULL)
  UPDATE public.task_views x SET position = o.rn
  FROM ordered o WHERE x.id = o.id AND x.position IS DISTINCT FROM o.rn;

  SELECT x.position INTO v_at FROM public.task_views x WHERE x.id = p_view_id;
  SELECT x.id INTO v_other FROM public.task_views x
  WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.deleted_at IS NULL
    AND x.position = v_at + CASE WHEN p_direction = 'up' THEN -1 ELSE 1 END;
  IF v_other IS NOT NULL THEN
    UPDATE public.task_views x
    SET position = CASE WHEN x.id = p_view_id THEN x.position + CASE WHEN p_direction = 'up' THEN -1 ELSE 1 END
                        ELSE v_at END
    WHERE x.id IN (p_view_id, v_other);
  END IF;

  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.position, x.created_at, x.id)
                   FROM public.task_views x
                   WHERE x.workspace_id = p_workspace_id AND x.owner_id = v_actor AND x.deleted_at IS NULL),
                  '[]'::jsonb);
END;
$$;

-- ── 5. Account erasure covers the new table ────────────────────────────────

-- A person's views go with them, shared ones too (their own workspaces' go
-- with those). Patched into the live body by anchored replace.
DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
BEGIN
  IF position('task_views' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position('v_templates integer;' IN v_def) = 0
     OR position('    INTO v_templates;' IN v_def) = 0
     OR position('''templates_deleted'', v_templates,' IN v_def) = 0
     OR position('DELETE FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_new := replace(v_def, 'v_templates integer;',
    'v_templates integer;' || E'\n  v_views integer;');
  v_new := replace(v_new, '    INTO v_templates;',
    '    INTO v_templates;'
    || E'\n  SELECT count(*) INTO v_views'
    || E'\n  FROM public.task_views x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);');
  v_new := replace(v_new, '''templates_deleted'', v_templates,',
    '''templates_deleted'', v_templates,'
    || E'\n    ''views_deleted'', v_views,');
  v_new := replace(v_new,
    'DELETE FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);',
    'DELETE FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  DELETE FROM public.task_views x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);');
  EXECUTE v_new;
END;
$erase$;

-- ── 6. Grants ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'task_views__sees(uuid, uuid, boolean, uuid, uuid)',
    'task_views__check_filters(uuid, uuid, jsonb)', 'task_views__check_display(jsonb)',
    'task_views__actor(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['task_views__readable(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'task_views_op_create(uuid, jsonb)',
    'task_views_op_update(uuid, uuid, jsonb)',
    'task_views_op_move(uuid, uuid, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

COMMENT ON TABLE public.task_views IS
  'TV-U8 saved views: a name over a base scope, filter and Display; personal until shared. Writes through task_views_op_*.';

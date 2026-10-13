-- TV-D15 · Templates and "Duplicate project…" (specs/tasks-v3.md §15, block 30;
-- REPLAN 9 and 79; §Assumptions #19 and #26).
--
-- A template is a saved copy of the work, never of a run of it:
--  - a task template keeps the task and its subtasks (title, description,
--    priority, energy, estimate, tags, assignee, team, links to notes and
--    contacts, dependencies between them, dates as offsets) and drops comments,
--    activity, time, done states, repeats, sessions, reminders, Waiting on,
--    queue places, files and links to one-off things (emails, events);
--  - a project template keeps the project's statuses, sections (dates as
--    offsets) and open tasks (Backlog, To do, In progress) with their subtasks;
--    nothing done, commented or tracked.
-- "Duplicate project…" reads a live project the way a project template would
-- and applies it at once.
--
-- The body carries no row ids of the source's own structure (statuses,
-- sections, tasks and parents are positions in the body), so the same body
-- can be applied in any workspace: `project_templates__apply_body` takes the
-- target workspace, and a later "copy into N workspaces" calls it once per
-- workspace. People, teams, tags and linked notes or contacts are resolved
-- again on every apply (a tag by name when its id isn't there; anyone who
-- can't take tasks there, or a team or a note that isn't there, is left out).
--
-- Every task is created through `tasks_op_create` (handles, the registry,
-- activity, the creator's checks); the project through `projects_op_create`.
-- Both are called by name, so later redefinitions of them hold here too.
--
-- Templates are yours until shared with the workspace (`shared`). Saving one
-- needs only to see what it copies; sharing it is sharing what it copies, so
-- only someone with Full access to every task and project it was saved from
-- can share it (`shareable`, read when it's saved). One saved from a project
-- the workspace can't see (`private_source`) is never shared by itself, the
-- app asks before sharing it, and a project made from it while it's private
-- is private. Only the owner edits a template; the workspace's owner or an
-- admin can also unshare or delete a shared one. An API key can save and use
-- templates but never shares, edits or deletes them.
--
-- Copies grant nothing: a copy is a new project (or new tasks) of the person
-- who made it. Grants, shares, comments, activity, claims, work sessions,
-- reminders, Waiting on and tracked time stay with the source; a copied team
-- task starts unclaimed. People stay assigned only when asked, and only
-- people who can take tasks there.
-- Re-runnable.

-- ── 1. Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  shared boolean NOT NULL DEFAULT false,
  private_source boolean NOT NULL DEFAULT false,
  shareable boolean NOT NULL DEFAULT false,
  body jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT task_templates_name_check CHECK (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)),
  CONSTRAINT task_templates_body_check CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 2097152)
);

CREATE TABLE IF NOT EXISTS public.project_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  shared boolean NOT NULL DEFAULT false,
  private_source boolean NOT NULL DEFAULT false,
  shareable boolean NOT NULL DEFAULT false,
  body jsonb NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT project_templates_name_check CHECK (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)),
  CONSTRAINT project_templates_body_check CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 2097152)
);

CREATE INDEX IF NOT EXISTS task_templates_workspace_updated ON public.task_templates (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS task_templates_owner ON public.task_templates (owner_id);
CREATE INDEX IF NOT EXISTS project_templates_workspace_updated ON public.project_templates (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS project_templates_owner ON public.project_templates (owner_id);

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.task_templates;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.project_templates;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.project_templates
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- Read: your own, and the ones shared with the workspace, while you can see
-- Tasks there. Writes go through the ops only.
ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_templates_read ON public.task_templates;
CREATE POLICY task_templates_read ON public.task_templates FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.perm_can_view(workspace_id, 'tasks')
         AND (owner_id = (SELECT auth.uid()) OR shared));
DROP POLICY IF EXISTS project_templates_read ON public.project_templates;
CREATE POLICY project_templates_read ON public.project_templates FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.perm_can_view(workspace_id, 'tasks')
         AND (owner_id = (SELECT auth.uid()) OR shared));

REVOKE ALL ON public.task_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.project_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_templates TO authenticated;
GRANT SELECT ON public.project_templates TO authenticated;
GRANT ALL ON public.task_templates TO service_role;
GRANT ALL ON public.project_templates TO service_role;

-- ── 2. Small helpers ───────────────────────────────────────────────────────

-- Days from the anchor, or null when either is missing.
CREATE OR REPLACE FUNCTION public.templates__offset(p_date date, p_anchor date)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_date IS NULL OR p_anchor IS NULL THEN NULL ELSE p_date - p_anchor END
$$;

-- The project is shared with the whole workspace (a workspace grant).
CREATE OR REPLACE FUNCTION public.templates__workspace_sees(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.buckets b
                 WHERE b.id = p_project_id AND NOT b.is_system)
     AND EXISTS (SELECT 1 FROM public.resource_grants g
                 WHERE g.resource_type = 'bucket' AND g.resource_id = p_project_id
                   AND g.subject_type = 'workspace')
$$;

-- Someone who can take tasks in a workspace (tasks__check_assignee, as a test).
CREATE OR REPLACE FUNCTION public.templates__can_take(p_workspace_id uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL
     AND (public.perm_is_owner(p_workspace_id, p_user)
          OR EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user))
     AND public.perm_user_has(p_workspace_id, p_user, 'tasks.edit')
$$;

-- One task as a body entry. `p_parent`, `p_status` and `p_section` are
-- positions in the body (or null); dates count from `p_anchor`.
CREATE OR REPLACE FUNCTION public.templates__task_entry(
  t public.tasks, p_anchor date, p_parent integer, p_status integer, p_section integer,
  p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tags jsonb;
  v_links jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color)
                            ORDER BY lower(g.name), g.id), '[]'::jsonb)
    INTO v_tags
  FROM public.tag_links l
  JOIN public.tags g ON g.id = l.tag_id AND g.deleted_at IS NULL
  WHERE l.workspace_id = t.workspace_id AND l.entity_type = 'task' AND l.entity_id = t.id;

  -- Links to lasting things the saver can open: notes and contacts.
  SELECT coalesce(jsonb_agg(jsonb_build_object('type', x.kind, 'id', x.ref) ORDER BY x.kind, x.ref),
                  '[]'::jsonb)
    INTO v_links
  FROM (
    SELECT DISTINCT
      CASE WHEN e.source_type = 'task' AND e.source_id = t.id THEN e.target_type ELSE e.source_type END AS kind,
      CASE WHEN e.source_type = 'task' AND e.source_id = t.id THEN e.target_id ELSE e.source_id END AS ref
    FROM public.entity_links e
    WHERE e.workspace_id = t.workspace_id AND e.deleted_at IS NULL
      AND ((e.source_type = 'task' AND e.source_id = t.id)
           OR (e.target_type = 'task' AND e.target_id = t.id))
  ) x
  WHERE x.kind IN ('note', 'contact') AND public.can_access(x.kind, x.ref, 'view', p_actor);

  RETURN jsonb_build_object(
    'title', t.title,
    'description', t.description,
    'parent', p_parent,
    'status', p_status,
    'section', p_section,
    'position', nullif(t.position, ''),
    'priority', t.priority,
    'energy', t.energy_level,
    'estimate', t.estimate_minutes,
    'due', public.templates__offset(t.due_on, p_anchor),
    'due_time', CASE WHEN t.due_on IS NOT NULL AND p_anchor IS NOT NULL
                     THEN to_char(t.due_time, 'HH24:MI') END,
    'assignee', t.assignee_id,
    'team', t.team_id,
    'tags', v_tags,
    'links', v_links);
END;
$$;

-- ── 3. Checking a body ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.templates__int(p_value jsonb, p_what text, p_min integer, p_max integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_value) <> 'number' THEN
    RAISE EXCEPTION 'A template''s % is a whole number.', p_what USING ERRCODE = '22023';
  END IF;
  v := (p_value #>> '{}')::numeric;
  IF v <> trunc(v) OR v < p_min OR v > p_max THEN
    RAISE EXCEPTION 'A template''s % is out of range.', p_what USING ERRCODE = '22023';
  END IF;
  RETURN v::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.templates__text(p_value jsonb, p_what text, p_max integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'A template''s % is text.', p_what USING ERRCODE = '22023';
  END IF;
  IF char_length(p_value #>> '{}') > p_max THEN
    RAISE EXCEPTION 'A template''s % is too long.', p_what USING ERRCODE = '22023';
  END IF;
  RETURN p_value #>> '{}';
END;
$$;

CREATE OR REPLACE FUNCTION public.templates__uuid(p_value jsonb, p_what text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_value) <> 'string'
     OR (p_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'A template''s % isn''t an id.', p_what USING ERRCODE = '22023';
  END IF;
  RETURN (p_value #>> '{}')::uuid;
END;
$$;

-- What a template holds is checked whenever it's written, so an apply can
-- trust the shape (the ops it calls still check every value again).
CREATE OR REPLACE FUNCTION public.templates__check_body(p_kind text, p_body jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_tasks jsonb := p_body -> 'tasks';
  v_statuses jsonb := p_body -> 'statuses';
  v_sections jsonb := p_body -> 'sections';
  v_n integer;
  v_ns integer := 0;
  v_nsec integer := 0;
  v_i integer;
  v_e jsonb;
  v_parent integer;
  v_k text;
  v_cats text[] := '{}';
  v_starts integer;
  v_ends integer;
  v_a integer;
  v_b integer;
BEGIN
  IF p_kind NOT IN ('task', 'project') THEN
    RAISE EXCEPTION 'A template is a task or a project template.' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' OR p_body ->> 'kind' IS DISTINCT FROM p_kind
     OR (p_body -> 'v') IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'That isn''t a % template this version can read.', p_kind USING ERRCODE = '22023';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(p_body) LOOP
    IF NOT v_k = ANY (CASE WHEN p_kind = 'task'
        THEN ARRAY['v', 'kind', 'anchor', 'project', 'section', 'tasks', 'relations']
        ELSE ARRAY['v', 'kind', 'name', 'description', 'color', 'starts', 'target', 'statuses',
                   'sections', 'tasks', 'relations'] END) THEN
      RAISE EXCEPTION 'A % template has no "%".', p_kind, v_k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF jsonb_typeof(v_tasks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A template lists its tasks.' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(v_tasks);
  IF v_n > 2000 THEN
    RAISE EXCEPTION 'A template holds up to 2,000 tasks.' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'task' THEN
    IF v_n = 0 THEN
      RAISE EXCEPTION 'A task template needs its task.' USING ERRCODE = '22023';
    END IF;
    IF coalesce(p_body ->> 'anchor', '') NOT IN ('due', 'start') THEN
      RAISE EXCEPTION 'A task template counts its dates from the due date or the start.' USING ERRCODE = '22023';
    END IF;
    PERFORM public.templates__uuid(p_body -> 'project', 'project');
    PERFORM public.templates__uuid(p_body -> 'section', 'section');
  ELSE
    PERFORM public.tasks__clean_name(public.templates__text(p_body -> 'name', 'name', 120), 'A project', 120);
    PERFORM public.templates__text(p_body -> 'description', 'description', 20000);
    PERFORM public.templates__text(p_body -> 'color', 'colour', 32);
    v_starts := public.templates__int(p_body -> 'starts', 'start', -3650, 3650);
    v_ends := public.templates__int(p_body -> 'target', 'target', -3650, 3650);
    IF v_starts IS NOT NULL AND v_ends IS NOT NULL AND v_starts > v_ends THEN
      RAISE EXCEPTION 'A project template''s target can''t be before its start.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_statuses) IS DISTINCT FROM 'array' OR jsonb_array_length(v_statuses) > 200 THEN
      RAISE EXCEPTION 'A project template lists its statuses.' USING ERRCODE = '22023';
    END IF;
    v_ns := jsonb_array_length(v_statuses);
    FOR v_i IN 0 .. v_ns - 1 LOOP
      v_e := v_statuses -> v_i;
      IF jsonb_typeof(v_e) <> 'object'
         OR coalesce(v_e ->> 'category', '') NOT IN ('backlog', 'todo', 'in_progress', 'done', 'wont_do')
         OR jsonb_typeof(v_e -> 'name') IS DISTINCT FROM 'string'
         OR char_length(btrim(v_e ->> 'name')) NOT BETWEEN 1 AND 60
         OR coalesce(jsonb_typeof(v_e -> 'hidden'), 'boolean') <> 'boolean' THEN
        RAISE EXCEPTION 'A project template''s status % isn''t readable.', v_i + 1 USING ERRCODE = '22023';
      END IF;
      v_cats := v_cats || (v_e ->> 'category');
    END LOOP;
    IF jsonb_typeof(v_sections) IS DISTINCT FROM 'array' OR jsonb_array_length(v_sections) > 500 THEN
      RAISE EXCEPTION 'A project template lists its sections.' USING ERRCODE = '22023';
    END IF;
    v_nsec := jsonb_array_length(v_sections);
    FOR v_i IN 0 .. v_nsec - 1 LOOP
      v_e := v_sections -> v_i;
      IF jsonb_typeof(v_e) <> 'object' THEN
        RAISE EXCEPTION 'A project template''s section % isn''t readable.', v_i + 1 USING ERRCODE = '22023';
      END IF;
      PERFORM public.tasks__clean_name(public.templates__text(v_e -> 'name', 'section name', 120), 'A section', 120);
      v_starts := public.templates__int(v_e -> 'starts', 'section start', -3650, 3650);
      v_ends := public.templates__int(v_e -> 'ends', 'section end', -3650, 3650);
      IF v_starts IS NOT NULL AND (v_ends IS NULL OR v_starts > v_ends) THEN
        RAISE EXCEPTION 'A section with a start needs an end after it.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  FOR v_i IN 0 .. v_n - 1 LOOP
    v_e := v_tasks -> v_i;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'A template''s task % isn''t readable.', v_i + 1 USING ERRCODE = '22023';
    END IF;
    FOR v_k IN SELECT jsonb_object_keys(v_e) LOOP
      IF NOT v_k = ANY (ARRAY['title', 'description', 'parent', 'status', 'section', 'position',
                              'priority', 'energy', 'estimate', 'due', 'due_time', 'assignee',
                              'team', 'tags', 'links']) THEN
        RAISE EXCEPTION 'A template''s task has no "%".', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    PERFORM public.templates__text(v_e -> 'title', 'task title', 1000);
    PERFORM public.templates__text(v_e -> 'description', 'task description', 200000);
    PERFORM public.templates__text(v_e -> 'position', 'task position', 200);
    v_parent := public.templates__int(v_e -> 'parent', 'parent', 0, 1999);
    IF v_parent IS NOT NULL THEN
      -- One level of subtasks, and a parent comes before its subtasks.
      IF v_parent >= v_i OR (v_tasks -> v_parent ->> 'parent') IS NOT NULL THEN
        RAISE EXCEPTION 'A template''s subtask % has no parent before it.', v_i + 1 USING ERRCODE = '22023';
      END IF;
    ELSIF p_kind = 'task' AND v_i > 0 THEN
      RAISE EXCEPTION 'Everything in a task template but the task is its subtask.' USING ERRCODE = '22023';
    END IF;
    IF p_kind = 'task' AND v_i = 0 AND v_parent IS NOT NULL THEN
      RAISE EXCEPTION 'A task template''s task comes first.' USING ERRCODE = '22023';
    END IF;
    IF public.templates__int(v_e -> 'status', 'status', 0, 199) >= v_ns
       OR (p_kind = 'task' AND jsonb_typeof(v_e -> 'status') IS DISTINCT FROM 'null' AND v_e ? 'status') THEN
      RAISE EXCEPTION 'A template''s task % has an unknown status.', v_i + 1 USING ERRCODE = '22023';
    END IF;
    IF public.templates__int(v_e -> 'section', 'section', 0, 499) >= v_nsec
       OR (p_kind = 'task' AND jsonb_typeof(v_e -> 'section') IS DISTINCT FROM 'null' AND v_e ? 'section') THEN
      RAISE EXCEPTION 'A template''s task % has an unknown section.', v_i + 1 USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_e ->> 'priority', 'low') NOT IN ('low', 'medium', 'high')
       OR coalesce(v_e ->> 'energy', 'low') NOT IN ('low', 'medium', 'high') THEN
      RAISE EXCEPTION 'A template''s task % has an unknown priority or energy.', v_i + 1 USING ERRCODE = '22023';
    END IF;
    PERFORM public.templates__int(v_e -> 'estimate', 'estimate', 0, 100000);
    PERFORM public.templates__int(v_e -> 'due', 'due date', -3650, 3650);
    IF public.templates__text(v_e -> 'due_time', 'due time', 5) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'A template''s due time is HH:MM.' USING ERRCODE = '22023';
    END IF;
    PERFORM public.templates__uuid(v_e -> 'assignee', 'assignee');
    PERFORM public.templates__uuid(v_e -> 'team', 'team');
    IF coalesce(jsonb_typeof(v_e -> 'tags'), 'array') <> 'array'
       OR coalesce(jsonb_array_length(v_e -> 'tags'), 0) > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_e -> 'tags', '[]'::jsonb)) g
                  WHERE jsonb_typeof(g) <> 'object'
                     OR jsonb_typeof(g -> 'name') IS DISTINCT FROM 'string'
                     OR char_length(btrim(g ->> 'name')) NOT BETWEEN 1 AND 60
                     OR coalesce(jsonb_typeof(g -> 'color'), 'null') NOT IN ('null', 'string')
                     OR char_length(coalesce(g ->> 'color', '')) > 32
                     OR (coalesce(jsonb_typeof(g -> 'id'), 'null') <> 'null'
                         AND (g ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) THEN
      RAISE EXCEPTION 'A template''s task % has unreadable tags.', v_i + 1 USING ERRCODE = '22023';
    END IF;
    IF coalesce(jsonb_typeof(v_e -> 'links'), 'array') <> 'array'
       OR coalesce(jsonb_array_length(v_e -> 'links'), 0) > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_e -> 'links', '[]'::jsonb)) l
                  WHERE jsonb_typeof(l) <> 'object'
                     OR coalesce(l ->> 'type', '') NOT IN ('note', 'contact')
                     OR coalesce(l ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'A template''s task % has unreadable links.', v_i + 1 USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF coalesce(jsonb_typeof(p_body -> 'relations'), 'array') <> 'array'
     OR coalesce(jsonb_array_length(p_body -> 'relations'), 0) > 5000 THEN
    RAISE EXCEPTION 'A template''s dependencies aren''t readable.' USING ERRCODE = '22023';
  END IF;
  FOR v_e IN SELECT r FROM jsonb_array_elements(coalesce(p_body -> 'relations', '[]'::jsonb)) r LOOP
    IF jsonb_typeof(v_e) <> 'array' OR jsonb_array_length(v_e) <> 2 THEN
      RAISE EXCEPTION 'A template''s dependency is a pair of its tasks.' USING ERRCODE = '22023';
    END IF;
    v_a := public.templates__int(v_e -> 0, 'dependency', 0, 1999);
    v_b := public.templates__int(v_e -> 1, 'dependency', 0, 1999);
    IF v_a IS NULL OR v_b IS NULL OR v_a >= v_n OR v_b >= v_n OR v_a = v_b THEN
      RAISE EXCEPTION 'A template''s dependency names a task it doesn''t have.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;

-- What the lists show without reading a body.
CREATE OR REPLACE FUNCTION public.templates__summary(p_body jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'tasks', jsonb_array_length(coalesce(p_body -> 'tasks', '[]'::jsonb)),
    'top', (SELECT count(*) FROM jsonb_array_elements(coalesce(p_body -> 'tasks', '[]'::jsonb)) t
            WHERE coalesce(jsonb_typeof(t -> 'parent'), 'null') = 'null'),
    'sections', jsonb_array_length(coalesce(p_body -> 'sections', '[]'::jsonb)),
    'dated', (p_body -> 'starts') IS NOT NULL AND jsonb_typeof(p_body -> 'starts') <> 'null'
          OR (p_body -> 'target') IS NOT NULL AND jsonb_typeof(p_body -> 'target') <> 'null'
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_body -> 'tasks', '[]'::jsonb)) t
                     WHERE jsonb_typeof(t -> 'due') = 'number')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_body -> 'sections', '[]'::jsonb)) s
                     WHERE jsonb_typeof(s -> 'ends') = 'number'),
    'people', EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_body -> 'tasks', '[]'::jsonb)) t
                      WHERE jsonb_typeof(t -> 'assignee') = 'string'),
    'anchor', p_body -> 'anchor',
    'title', p_body -> 'tasks' -> 0 -> 'title',
    'project', p_body -> 'project')
$$;

-- ── 4. Reading a body from live work ───────────────────────────────────────

-- A project as a project template holds it: its statuses, sections and open
-- tasks (Backlog, To do, In progress; an In progress task starts again at the
-- first To do status), dates as offsets from the project's start (else its
-- first date). The reader must see the project.
CREATE OR REPLACE FUNCTION public.project_templates__body_of(p_project_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.buckets;
  v_anchor date;
  v_status_ids uuid[];
  v_status_cats text[];
  v_first_todo integer;
  v_section_ids uuid[];
  v_top uuid[];
  v_sub uuid[];
  v_ids uuid[];
  v_tasks jsonb := '[]'::jsonb;
  v_statuses jsonb;
  v_sections jsonb;
  v_relations jsonb;
  t public.tasks;
  v_parent integer;
  v_status integer;
  v_pos integer;
BEGIN
  SELECT * INTO b FROM public.buckets x WHERE x.id = p_project_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.projects__visible_to(b.id, p_actor) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF b.is_system THEN
    RAISE EXCEPTION 'The Inbox isn''t a project, so it can''t be copied.' USING ERRCODE = '22023';
  END IF;

  -- The statuses: the project's own set (the workspace default when it has none).
  SELECT coalesce(array_agg(s.id ORDER BY public.tasks__category_rank(s.category), s.position, s.created_at, s.id), '{}'),
         coalesce(array_agg(s.category ORDER BY public.tasks__category_rank(s.category), s.position, s.created_at, s.id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('category', s.category, 'name', s.name, 'hidden', s.hidden)
                            ORDER BY public.tasks__category_rank(s.category), s.position, s.created_at, s.id), '[]')
    INTO v_status_ids, v_status_cats, v_statuses
  FROM public.project_statuses s
  WHERE s.deleted_at IS NULL
    AND CASE WHEN EXISTS (SELECT 1 FROM public.project_statuses y
                          WHERE y.project_id = b.id AND y.deleted_at IS NULL)
             THEN s.project_id = b.id
             ELSE s.project_id IS NULL AND s.workspace_id = b.workspace_id END;
  v_first_todo := array_position(v_status_cats, 'todo');

  -- The open tasks: top-level first (in the project's order), then subtasks
  -- under the parent they came with. A subtask whose parent isn't copied
  -- comes along as a task of its own.
  IF (SELECT count(*) FROM public.tasks x
      WHERE x.bucket_id = b.id AND x.deleted_at IS NULL
        AND x.status_category IN ('backlog', 'todo', 'in_progress')) > 2000 THEN
    RAISE EXCEPTION 'A project with more than 2,000 open tasks can''t be copied.' USING ERRCODE = '22023';
  END IF;
  WITH k AS (
    SELECT x.id, x.parent_id, x.position, x.created_at FROM public.tasks x
    WHERE x.bucket_id = b.id AND x.deleted_at IS NULL
      AND x.status_category IN ('backlog', 'todo', 'in_progress'))
  SELECT coalesce(array_agg(k.id ORDER BY k.position COLLATE "C", k.created_at, k.id), '{}') INTO v_top
  FROM k
  WHERE k.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM k p WHERE p.id = k.parent_id);
  SELECT coalesce(array_agg(x.id ORDER BY array_position(v_top, x.parent_id), x.position COLLATE "C", x.created_at, x.id), '{}')
    INTO v_sub
  FROM public.tasks x
  WHERE x.parent_id = ANY (v_top) AND x.bucket_id = b.id AND x.deleted_at IS NULL
    AND x.status_category IN ('backlog', 'todo', 'in_progress');
  v_ids := v_top || v_sub;

  -- The sections, and the date everything counts from.
  SELECT coalesce(array_agg(s.id ORDER BY s.position, s.created_at, s.id), '{}') INTO v_section_ids
  FROM public.sections s WHERE s.project_id = b.id AND s.deleted_at IS NULL;
  v_anchor := coalesce(b.starts_on, LEAST(
    b.target_on,
    (SELECT min(least(s.starts_on, s.ends_on)) FROM public.sections s WHERE s.id = ANY (v_section_ids)),
    (SELECT min(x.due_on) FROM public.tasks x WHERE x.id = ANY (v_ids))));
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', s.name,
           'starts', public.templates__offset(s.starts_on, v_anchor),
           'ends', public.templates__offset(s.ends_on, v_anchor))
         ORDER BY array_position(v_section_ids, s.id)), '[]')
    INTO v_sections
  FROM public.sections s WHERE s.id = ANY (v_section_ids);

  FOR v_pos IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
    SELECT * INTO t FROM public.tasks x WHERE x.id = v_ids[v_pos];
    v_parent := array_position(v_top, t.parent_id) - 1;
    v_status := array_position(v_status_ids, t.status_id);
    IF v_status IS NOT NULL AND v_status_cats[v_status] = 'in_progress' THEN
      v_status := v_first_todo;
    END IF;
    v_tasks := v_tasks || jsonb_build_array(public.templates__task_entry(
      t, v_anchor, v_parent, v_status - 1, array_position(v_section_ids, t.section_id) - 1, p_actor));
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_array(array_position(v_ids, r.blocker_task_id) - 1,
                                              array_position(v_ids, r.blocked_task_id) - 1)
                            ORDER BY r.created_at, r.id), '[]')
    INTO v_relations
  FROM public.task_relations r
  WHERE r.blocker_task_id = ANY (v_ids) AND r.blocked_task_id = ANY (v_ids);

  RETURN jsonb_build_object(
    'v', 1, 'kind', 'project',
    'name', b.name,
    'description', '',
    'color', b.color,
    'starts', public.templates__offset(b.starts_on, v_anchor),
    'target', public.templates__offset(b.target_on, v_anchor),
    'statuses', v_statuses,
    'sections', v_sections,
    'tasks', v_tasks,
    'relations', v_relations);
END;
$$;

-- A task as a task template holds it: the task and every subtask (all start
-- open), dates as offsets from its due date (else from the day it's saved).
CREATE OR REPLACE FUNCTION public.task_templates__body_of(p_task_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.tasks;
  t public.tasks;
  v_ids uuid[];
  v_anchor date;
  v_tasks jsonb := '[]'::jsonb;
  v_relations jsonb;
  v_pos integer;
  b public.buckets;
BEGIN
  SELECT * INTO r FROM public.tasks x WHERE x.id = p_task_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible_to(r.id, p_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO b FROM public.buckets x WHERE x.id = r.bucket_id;
  v_ids := ARRAY[r.id] || coalesce((
    SELECT array_agg(x.id ORDER BY x.position COLLATE "C", x.created_at, x.id)
    FROM public.tasks x
    WHERE x.parent_id = r.id AND x.deleted_at IS NULL AND public.tasks__visible_to(x.id, p_actor)
  ), '{}');
  IF array_length(v_ids, 1) > 2000 THEN
    RAISE EXCEPTION 'A task template holds up to 2,000 tasks.' USING ERRCODE = '22023';
  END IF;
  v_anchor := coalesce(r.due_on, public.tasks__local_date(now(), public.tasks__known_zone(p_actor)));

  FOR v_pos IN 1 .. array_length(v_ids, 1) LOOP
    SELECT * INTO t FROM public.tasks x WHERE x.id = v_ids[v_pos];
    v_tasks := v_tasks || jsonb_build_array(public.templates__task_entry(
      t, v_anchor, CASE WHEN v_pos > 1 THEN 0 END, NULL, NULL, p_actor) - 'status' - 'section');
  END LOOP;
  -- The task itself goes to the end of wherever it's made.
  v_tasks := jsonb_set(v_tasks, '{0,position}', 'null'::jsonb);

  SELECT coalesce(jsonb_agg(jsonb_build_array(array_position(v_ids, x.blocker_task_id) - 1,
                                              array_position(v_ids, x.blocked_task_id) - 1)
                            ORDER BY x.created_at, x.id), '[]')
    INTO v_relations
  FROM public.task_relations x
  WHERE x.blocker_task_id = ANY (v_ids) AND x.blocked_task_id = ANY (v_ids);

  RETURN jsonb_build_object(
    'v', 1, 'kind', 'task',
    'anchor', CASE WHEN r.due_on IS NOT NULL THEN 'due' ELSE 'start' END,
    'project', CASE WHEN b.is_system THEN NULL ELSE r.bucket_id END,
    'section', CASE WHEN b.is_system THEN NULL ELSE r.section_id END,
    'tasks', v_tasks,
    'relations', v_relations);
END;
$$;

-- ── 5. Applying a body ─────────────────────────────────────────────────────

-- Create a body's tasks in one project (null: each one's Inbox), dates from
-- `p_start` (null: no dates). `p_root` sets the first task's id, title,
-- section and assignee (task templates). Answers with the new ids, in the
-- body's order (null where a task wasn't made).
CREATE OR REPLACE FUNCTION public.templates__create_tasks(
  p_workspace_id uuid, p_body jsonb, p_project_id uuid, p_status_ids uuid[],
  p_section_ids uuid[], p_start date, p_keep_people boolean, p_root jsonb)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_tasks jsonb := coalesce(p_body -> 'tasks', '[]'::jsonb);
  v_ids uuid[] := '{}';
  v_tag_ids jsonb := '{}'::jsonb;
  v_can_tag boolean := public.perm_can_tag(p_workspace_id);
  v_e jsonb;
  v_g jsonb;
  v_l jsonb;
  v_i integer;
  v_task jsonb;
  v_parent integer;
  v_status integer;
  v_section integer;
  v_person uuid;
  v_team uuid;
  v_tag uuid;
  v_key text;
  v_bucket uuid;
  v_project_bucket boolean;
  t public.tasks;
  v_rel jsonb;
BEGIN
  FOR v_i IN 0 .. jsonb_array_length(v_tasks) - 1 LOOP
    v_e := v_tasks -> v_i;
    v_parent := (v_e ->> 'parent')::integer;
    v_status := (v_e ->> 'status')::integer;
    v_section := (v_e ->> 'section')::integer;
    -- A subtask goes where its parent went.
    v_bucket := CASE WHEN v_parent IS NOT NULL
                     THEN (SELECT x.bucket_id FROM public.tasks x WHERE x.id = v_ids[v_parent + 1])
                     ELSE p_project_id END;
    v_project_bucket := v_bucket IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = v_bucket AND NOT x.is_system);
    v_task := jsonb_build_object(
      'title', coalesce(v_e ->> 'title', ''),
      'description', coalesce(v_e ->> 'description', ''),
      'status', 'todo');
    IF v_bucket IS NOT NULL THEN
      v_task := v_task || jsonb_build_object('bucket_id', v_bucket);
    END IF;
    IF v_parent IS NOT NULL THEN
      v_task := v_task || jsonb_build_object('parent_id', v_ids[v_parent + 1]);
    END IF;
    IF v_status IS NOT NULL AND p_status_ids IS NOT NULL AND p_status_ids[v_status + 1] IS NOT NULL THEN
      v_task := (v_task - 'status') || jsonb_build_object('status_id', p_status_ids[v_status + 1]);
    END IF;
    IF v_section IS NOT NULL AND p_section_ids IS NOT NULL AND p_section_ids[v_section + 1] IS NOT NULL
       AND v_project_bucket THEN
      v_task := v_task || jsonb_build_object('section_id', p_section_ids[v_section + 1]);
    END IF;
    IF nullif(v_e ->> 'position', '') IS NOT NULL THEN
      v_task := v_task || jsonb_build_object('position', v_e ->> 'position');
    END IF;
    IF p_start IS NOT NULL AND jsonb_typeof(v_e -> 'due') = 'number' THEN
      v_task := v_task || jsonb_build_object('due_on', p_start + (v_e ->> 'due')::integer);
      IF nullif(v_e ->> 'due_time', '') IS NOT NULL THEN
        v_task := v_task || jsonb_build_object('due_time', v_e ->> 'due_time');
      END IF;
    END IF;
    v_task := v_task || jsonb_strip_nulls(jsonb_build_object(
      'priority', v_e -> 'priority', 'energy_level', v_e -> 'energy',
      'estimate_minutes', v_e -> 'estimate'));
    -- People: kept only when asked and when they can take tasks here;
    -- otherwise the task is unassigned (never the copier by default).
    v_person := NULL;
    IF p_keep_people THEN
      v_person := nullif(v_e ->> 'assignee', '')::uuid;
      IF v_person IS NOT NULL AND NOT public.templates__can_take(p_workspace_id, v_person) THEN
        v_person := NULL;
      END IF;
    END IF;
    -- A team only where it exists here and the task is in a project. A
    -- copied team task starts unclaimed with a fresh routing (the team picks
    -- it up again), so it keeps no assignee.
    v_team := nullif(v_e ->> 'team', '')::uuid;
    IF v_team IS NOT NULL AND v_project_bucket AND EXISTS (
         SELECT 1 FROM public.teams x
         WHERE x.id = v_team AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL) THEN
      v_task := v_task || jsonb_build_object('team_id', v_team);
      v_person := NULL;
    END IF;
    v_task := v_task || jsonb_build_object('assignee_id', v_person);
    IF v_i = 0 AND p_root IS NOT NULL THEN
      IF nullif(p_root ->> 'id', '') IS NOT NULL THEN
        v_task := v_task || jsonb_build_object('id', p_root ->> 'id');
      END IF;
      IF nullif(btrim(coalesce(p_root ->> 'title', '')), '') IS NOT NULL THEN
        v_task := v_task || jsonb_build_object('title', btrim(p_root ->> 'title'));
      END IF;
      IF p_root ? 'section_id' THEN
        v_task := (v_task - 'section_id')
          || CASE WHEN nullif(p_root ->> 'section_id', '') IS NOT NULL AND v_project_bucket
                  THEN jsonb_build_object('section_id', p_root ->> 'section_id') ELSE '{}'::jsonb END;
      END IF;
      IF p_root ? 'assignee_id' THEN
        v_task := v_task || jsonb_build_object('assignee_id', nullif(p_root ->> 'assignee_id', ''));
      END IF;
    END IF;

    t := public.tasks_op_create(p_workspace_id, v_task);
    v_ids := v_ids || t.id;

    -- Tags: the same tag when it's here, else one of the same name, else a
    -- new one (when this person may make tags).
    FOR v_g IN SELECT g FROM jsonb_array_elements(coalesce(v_e -> 'tags', '[]'::jsonb)) g LOOP
      v_key := lower(btrim(v_g ->> 'name'));
      IF v_tag_ids ? v_key THEN
        v_tag := (v_tag_ids ->> v_key)::uuid;
      ELSE
        SELECT x.id INTO v_tag FROM public.tags x
        WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
          AND x.id = public.tasks__try_uuid(v_g ->> 'id');
        IF v_tag IS NULL THEN
          SELECT x.id INTO v_tag FROM public.tags x
          WHERE x.workspace_id = p_workspace_id AND x.deleted_at IS NULL AND lower(btrim(x.name)) = v_key
          ORDER BY x.created_at, x.id LIMIT 1;
        END IF;
        IF v_tag IS NULL AND v_can_tag AND v_actor IS NOT NULL THEN
          INSERT INTO public.tags (workspace_id, owner_id, name, color)
          VALUES (p_workspace_id, v_actor, btrim(v_g ->> 'name'), nullif(v_g ->> 'color', ''))
          RETURNING id INTO v_tag;
        END IF;
        v_tag_ids := v_tag_ids || jsonb_build_object(v_key, v_tag);
      END IF;
      IF v_tag IS NOT NULL THEN
        INSERT INTO public.tag_links (workspace_id, tag_id, entity_type, entity_id)
        VALUES (p_workspace_id, v_tag, 'task', t.id)
        ON CONFLICT (workspace_id, tag_id, entity_type, entity_id) DO NOTHING;
      END IF;
    END LOOP;

    -- Links to notes and contacts that are here and that this person can open.
    FOR v_l IN SELECT l FROM jsonb_array_elements(coalesce(v_e -> 'links', '[]'::jsonb)) l LOOP
      IF EXISTS (SELECT 1 FROM public.entities x
                 WHERE x.workspace_id = p_workspace_id AND x.entity_type = v_l ->> 'type'
                   AND x.entity_id = (v_l ->> 'id')::uuid)
         AND public.can_access(v_l ->> 'type', (v_l ->> 'id')::uuid, 'view', v_actor) THEN
        -- A link is a nice-to-have: one this person can't make is left out.
        BEGIN
          PERFORM public.links_op_create(p_workspace_id, 'task', t.id, v_l ->> 'type',
                                         (v_l ->> 'id')::uuid, 'references', 'manual');
        EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
          NULL;
        END;
      END IF;
    END LOOP;
  END LOOP;

  -- Dependencies between the new tasks.
  FOR v_rel IN SELECT r FROM jsonb_array_elements(coalesce(p_body -> 'relations', '[]'::jsonb)) r LOOP
    INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
    VALUES (p_workspace_id, v_ids[(v_rel ->> 0)::integer + 1], v_ids[(v_rel ->> 1)::integer + 1])
    ON CONFLICT (workspace_id, blocker_task_id, blocked_task_id) DO NOTHING;
  END LOOP;
  RETURN v_ids;
END;
$$;

-- Make a project from a body in a workspace: the project (through
-- `projects_op_create`), the body's statuses in place of the seeded ones, its
-- sections and its tasks. `p_fields`: id (the new project's, for a resend),
-- name, starts_on (where the body's offsets count from; null = no dates),
-- area_id, keep_people. `p_private`: the copy stays with its maker (no
-- workspace grant). Answers with the project's id.
CREATE OR REPLACE FUNCTION public.project_templates__apply_body(
  p_workspace_id uuid, p_body jsonb, p_fields jsonb, p_private boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
  v_start date := public.tasks__patch_date(p_fields, 'starts_on');
  v_project jsonb;
  v_status_ids uuid[] := '{}';
  v_section_ids uuid[] := '{}';
  v_e jsonb;
  v_i integer;
  v_id uuid;
  v_cat text;
  v_pos integer;
  v_last_cat text := NULL;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.templates__check_body('project', p_body);
  PERFORM public.tasks__check_keys(p_fields, ARRAY['id', 'name', 'starts_on', 'area_id', 'keep_people']);

  v_project := jsonb_build_object(
    'name', coalesce(nullif(btrim(coalesce(p_fields ->> 'name', '')), ''), p_body ->> 'name'),
    'color', p_body -> 'color');
  IF nullif(p_fields ->> 'id', '') IS NOT NULL THEN
    v_project := v_project || jsonb_build_object('id', p_fields ->> 'id');
  END IF;
  IF nullif(p_fields ->> 'area_id', '') IS NOT NULL THEN
    v_project := v_project || jsonb_build_object('area_id', p_fields ->> 'area_id');
  END IF;
  IF v_start IS NOT NULL THEN
    v_project := v_project || jsonb_strip_nulls(jsonb_build_object(
      'starts_on', v_start + (p_body ->> 'starts')::integer,
      'target_on', v_start + (p_body ->> 'target')::integer));
  END IF;
  b := public.projects_op_create(p_workspace_id, v_project);

  -- The body's statuses take the seeded set's place (each category keeps at
  -- least one: the workspace default's fill a category the body lacks).
  UPDATE public.project_statuses s SET deleted_at = now()
  WHERE s.project_id = b.id AND s.deleted_at IS NULL;
  FOR v_i IN 0 .. jsonb_array_length(p_body -> 'statuses') - 1 LOOP
    v_e := p_body -> 'statuses' -> v_i;
    v_cat := v_e ->> 'category';
    v_pos := CASE WHEN v_cat IS DISTINCT FROM v_last_cat THEN 1 ELSE v_pos + 1 END;
    v_last_cat := v_cat;
    -- Two statuses of one name in a set aren't allowed: the second is left out.
    IF EXISTS (SELECT 1 FROM public.project_statuses x
               WHERE x.project_id = b.id AND x.deleted_at IS NULL
                 AND lower(btrim(x.name)) = lower(btrim(v_e ->> 'name'))) THEN
      v_status_ids := v_status_ids || NULL::uuid;
      CONTINUE;
    END IF;
    INSERT INTO public.project_statuses (workspace_id, project_id, category, name, position, hidden)
    VALUES (p_workspace_id, b.id, v_cat, btrim(v_e ->> 'name'), v_pos,
            coalesce((v_e ->> 'hidden')::boolean, false))
    RETURNING id INTO v_id;
    v_status_ids := v_status_ids || v_id;
  END LOOP;
  INSERT INTO public.project_statuses (workspace_id, project_id, category, name, position, hidden)
  SELECT p_workspace_id, b.id, d.category, d.name, d.position, d.hidden
  FROM public.project_statuses d
  WHERE d.workspace_id = p_workspace_id AND d.project_id IS NULL AND d.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.project_statuses x
                    WHERE x.project_id = b.id AND x.deleted_at IS NULL
                      AND (x.category = d.category OR lower(btrim(x.name)) = lower(btrim(d.name))));
  -- A category whose every status is hidden shows its first.
  UPDATE public.project_statuses s SET hidden = false
  WHERE s.project_id = b.id AND s.deleted_at IS NULL
    AND s.id IN (SELECT DISTINCT ON (y.category) y.id FROM public.project_statuses y
                 WHERE y.project_id = b.id AND y.deleted_at IS NULL
                 ORDER BY y.category, y.position, y.created_at)
    AND NOT EXISTS (SELECT 1 FROM public.project_statuses z
                    WHERE z.project_id = b.id AND z.deleted_at IS NULL
                      AND z.category = s.category AND NOT z.hidden);

  FOR v_i IN 0 .. jsonb_array_length(p_body -> 'sections') - 1 LOOP
    v_e := p_body -> 'sections' -> v_i;
    INSERT INTO public.sections (workspace_id, project_id, name, position, starts_on, ends_on)
    VALUES (p_workspace_id, b.id, public.tasks__clean_name(v_e ->> 'name', 'A section', 120), v_i + 1,
            CASE WHEN v_start IS NOT NULL AND jsonb_typeof(v_e -> 'ends') = 'number'
                 THEN v_start + (v_e ->> 'starts')::integer END,
            CASE WHEN v_start IS NOT NULL THEN v_start + (v_e ->> 'ends')::integer END)
    RETURNING id INTO v_id;
    v_section_ids := v_section_ids || v_id;
  END LOOP;

  PERFORM public.templates__create_tasks(
    p_workspace_id, p_body, b.id, v_status_ids, v_section_ids, v_start,
    coalesce((p_fields ->> 'keep_people')::boolean, false), NULL);

  -- A copy of something the workspace couldn't see stays with its maker.
  IF p_private THEN
    DELETE FROM public.resource_grants g
    WHERE g.resource_type = 'bucket' AND g.resource_id = b.id AND g.subject_type = 'workspace';
  END IF;
  RETURN b.id;
END;
$$;

-- Everything an apply made, as raw rows the app's store reads: the project,
-- its statuses and sections, the tasks, their tag links and dependencies.
CREATE OR REPLACE FUNCTION public.templates__bundle(p_project_id uuid, p_task_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[] := coalesce(p_task_ids, '{}');
BEGIN
  IF p_project_id IS NOT NULL THEN
    SELECT coalesce(array_agg(x.id), '{}') INTO v_ids
    FROM public.tasks x WHERE x.bucket_id = p_project_id AND x.deleted_at IS NULL;
  END IF;
  RETURN jsonb_build_object(
    'buckets', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM public.buckets b WHERE b.id = p_project_id), '[]'),
    'statuses', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.project_statuses s
                          WHERE s.project_id = p_project_id AND s.deleted_at IS NULL), '[]'),
    'sections', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.sections s
                          WHERE s.project_id = p_project_id AND s.deleted_at IS NULL), '[]'),
    'tasks', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM public.tasks t WHERE t.id = ANY (v_ids)), '[]'),
    'tagLinks', coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM public.tag_links l
                          WHERE l.entity_type = 'task' AND l.entity_id = ANY (v_ids)), '[]'),
    'relations', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.task_relations r
                           WHERE r.blocked_task_id = ANY (v_ids) OR r.blocker_task_id = ANY (v_ids)), '[]'));
END;
$$;

-- A template you can use here: yours, or one shared with the workspace.
CREATE OR REPLACE FUNCTION public.templates__usable(p_workspace_id uuid, p_kind text, p_template_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v jsonb;
BEGIN
  IF p_kind = 'task' THEN
    SELECT to_jsonb(x) INTO v FROM public.task_templates x
    WHERE x.id = p_template_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
      AND (x.owner_id = v_actor OR x.shared);
  ELSE
    SELECT to_jsonb(x) INTO v FROM public.project_templates x
    WHERE x.id = p_template_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
      AND (x.owner_id = v_actor OR x.shared);
  END IF;
  IF v IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'That template isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- ── 6. The ops ─────────────────────────────────────────────────────────────

-- "Duplicate project…": the project's statuses, sections and open tasks in a
-- new project, every date shifted to start on `starts_on`. Fields: id (mint
-- it, so a resend answers with the same copy), name, starts_on, area_id
-- (default: the source's), keep_people (default true). A copy of a project
-- the workspace can't see stays private; grants are never copied.
CREATE OR REPLACE FUNCTION public.projects_op_duplicate(p_workspace_id uuid, p_project_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
  v_id uuid;
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_new uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(v_fields, ARRAY['id', 'name', 'starts_on', 'area_id', 'keep_people']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A project needs an owner.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.buckets x
  WHERE x.id = p_project_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.projects__visible_to(b.id, v_actor) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  v_id := public.tasks__try_uuid(v_fields ->> 'id');
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = v_id) THEN
    -- A resend of a duplicate that landed.
    IF NOT EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = v_id AND x.workspace_id = p_workspace_id)
       OR NOT public.projects__visible_to(v_id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    RETURN public.templates__bundle(v_id, NULL);
  END IF;
  IF NOT v_fields ? 'area_id' AND b.area_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.areas a WHERE a.id = b.area_id AND a.deleted_at IS NULL) THEN
    v_fields := v_fields || jsonb_build_object('area_id', b.area_id);
  END IF;
  IF NOT v_fields ? 'keep_people' THEN
    v_fields := v_fields || '{"keep_people": true}'::jsonb;
  END IF;
  v_new := public.project_templates__apply_body(
    p_workspace_id, public.project_templates__body_of(b.id, v_actor), v_fields,
    NOT public.templates__workspace_sees(b.id));
  RETURN public.templates__bundle(v_new, NULL);
END;
$$;

-- "Save as template" on a project. Fields: id, name (default: the project's).
CREATE OR REPLACE FUNCTION public.project_templates_op_save(p_workspace_id uuid, p_project_id uuid, p_fields jsonb)
RETURNS public.project_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
  v_id uuid;
  v_body jsonb;
  x public.project_templates;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(coalesce(p_fields, '{}'::jsonb), ARRAY['id', 'name']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A template needs an owner.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO b FROM public.buckets y
  WHERE y.id = p_project_id AND y.workspace_id = p_workspace_id AND y.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.projects__visible_to(b.id, v_actor) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(p_fields ->> 'id'), gen_random_uuid());
  SELECT * INTO x FROM public.project_templates y WHERE y.id = v_id;
  IF FOUND THEN
    IF x.workspace_id IS DISTINCT FROM p_workspace_id OR x.owner_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'That template isn''t here any more.' USING ERRCODE = '22023';
    END IF;
    RETURN x;
  END IF;
  v_body := public.project_templates__body_of(b.id, v_actor);
  PERFORM public.templates__check_body('project', v_body);
  -- Templates deleted more than 30 days ago go for good.
  DELETE FROM public.project_templates y
  WHERE y.owner_id = v_actor AND y.deleted_at < now() - interval '30 days';
  INSERT INTO public.project_templates (id, workspace_id, owner_id, name, shared, private_source,
                                       shareable, body, summary)
  VALUES (v_id, p_workspace_id, v_actor,
          public.tasks__clean_name(coalesce(nullif(btrim(coalesce(p_fields ->> 'name', '')), ''), b.name), 'A template', 120),
          false, NOT public.templates__workspace_sees(b.id),
          public.can_access('bucket', b.id, 'full', v_actor),
          v_body, public.templates__summary(v_body))
  RETURNING * INTO x;
  RETURN x;
END;
$$;

-- "Save as template" on a task. Fields: id, name (default: the task's title).
CREATE OR REPLACE FUNCTION public.task_templates_op_save(p_workspace_id uuid, p_task_id uuid, p_fields jsonb)
RETURNS public.task_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  r public.tasks;
  v_id uuid;
  v_body jsonb;
  x public.task_templates;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(coalesce(p_fields, '{}'::jsonb), ARRAY['id', 'name']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A template needs an owner.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.tasks y
  WHERE y.id = p_task_id AND y.workspace_id = p_workspace_id AND y.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.tasks__visible_to(r.id, v_actor) THEN
    RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = '22023';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(p_fields ->> 'id'), gen_random_uuid());
  SELECT * INTO x FROM public.task_templates y WHERE y.id = v_id;
  IF FOUND THEN
    IF x.workspace_id IS DISTINCT FROM p_workspace_id OR x.owner_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'That template isn''t here any more.' USING ERRCODE = '22023';
    END IF;
    RETURN x;
  END IF;
  v_body := public.task_templates__body_of(r.id, v_actor);
  PERFORM public.templates__check_body('task', v_body);
  DELETE FROM public.task_templates y
  WHERE y.owner_id = v_actor AND y.deleted_at < now() - interval '30 days';
  INSERT INTO public.task_templates (id, workspace_id, owner_id, name, shared, private_source,
                                    shareable, body, summary)
  VALUES (v_id, p_workspace_id, v_actor,
          public.tasks__clean_name(coalesce(nullif(btrim(coalesce(p_fields ->> 'name', '')), ''),
                                            left(btrim(r.title), 120)), 'A template', 120),
          false, NOT public.templates__workspace_sees(r.bucket_id),
          -- Full access to the task and every subtask it copied.
          NOT EXISTS (SELECT 1 FROM public.tasks y
                      WHERE (y.id = r.id OR (y.parent_id = r.id AND y.deleted_at IS NULL
                                             AND public.tasks__visible_to(y.id, v_actor)))
                        AND NOT public.can_access('task', y.id, 'full', v_actor)),
          v_body, public.templates__summary(v_body))
  RETURNING * INTO x;
  RETURN x;
END;
$$;

-- Rename, share or unshare, edit the body, delete or restore a template.
-- `p_kind`: 'task' or 'project'. Patch keys: name, shared, body, deleted.
-- The owner does all of it; the workspace's owner or an admin can unshare or
-- delete a shared one. Answers with the template (its body included).
CREATE OR REPLACE FUNCTION public.templates_op_update(
  p_workspace_id uuid, p_kind text, p_template_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v jsonb;
  v_owner boolean;
  v_admin boolean;
  v_name text;
  v_shared boolean;
  v_body jsonb;
  v_deleted timestamptz;
BEGIN
  IF p_kind NOT IN ('task', 'project') THEN
    RAISE EXCEPTION 'A template is a task or a project template.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.tasks__check_keys(coalesce(p_patch, '{}'::jsonb), ARRAY['name', 'shared', 'body', 'deleted']);
  IF public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Templates are changed in the app.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(public.tasks_module_permission(p_workspace_id), 'none') NOT IN ('view', 'edit', 'admin')
     OR v_actor IS NULL THEN
    RAISE EXCEPTION 'That template isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'task' THEN
    SELECT to_jsonb(x) INTO v FROM public.task_templates x
    WHERE x.id = p_template_id AND x.workspace_id = p_workspace_id FOR UPDATE;
  ELSE
    SELECT to_jsonb(x) INTO v FROM public.project_templates x
    WHERE x.id = p_template_id AND x.workspace_id = p_workspace_id FOR UPDATE;
  END IF;
  v_owner := v IS NOT NULL AND (v ->> 'owner_id')::uuid IS NOT DISTINCT FROM v_actor;
  v_admin := public.perm_is_owner(p_workspace_id, v_actor)
          OR EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.workspace_id = p_workspace_id AND m.user_id = v_actor AND m.role = 'admin');
  -- Someone else's template is there for you only while it's shared (and,
  -- for an admin, while its delete can still be undone).
  IF v IS NULL OR (NOT v_owner AND NOT (coalesce((v ->> 'shared')::boolean, false)
                                        AND ((v ->> 'deleted_at') IS NULL OR v_admin))) THEN
    RAISE EXCEPTION 'That template isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_owner AND (NOT v_admin OR p_patch ? 'name' OR p_patch ? 'body'
                      OR coalesce((p_patch ->> 'shared')::boolean, false)) THEN
    RAISE EXCEPTION 'Only the person who made a template can change it.' USING ERRCODE = '42501';
  END IF;
  IF v_owner AND (p_patch ? 'name' OR p_patch ? 'body' OR coalesce((p_patch ->> 'shared')::boolean, false)) THEN
    PERFORM public.tasks__guard_structure(p_workspace_id);
  END IF;

  v_name := CASE WHEN p_patch ? 'name' THEN public.tasks__clean_name(p_patch ->> 'name', 'A template', 120)
                 ELSE v ->> 'name' END;
  IF p_patch ? 'shared' AND jsonb_typeof(p_patch -> 'shared') <> 'boolean' THEN
    RAISE EXCEPTION 'Shared is true or false.' USING ERRCODE = '22023';
  END IF;
  v_shared := CASE WHEN p_patch ? 'shared' THEN (p_patch ->> 'shared')::boolean ELSE (v ->> 'shared')::boolean END;
  -- Sharing a template shares what it copied: only with Full access to it.
  IF v_shared AND NOT (v ->> 'shared')::boolean AND NOT coalesce((v ->> 'shareable')::boolean, false) THEN
    RAISE EXCEPTION 'Only someone with full access to what this template was saved from can share it.'
      USING ERRCODE = '42501';
  END IF;
  v_body := CASE WHEN p_patch ? 'body' THEN p_patch -> 'body' ELSE v -> 'body' END;
  IF p_patch ? 'body' THEN
    PERFORM public.templates__check_body(p_kind, v_body);
  END IF;
  IF p_patch ? 'deleted' AND jsonb_typeof(p_patch -> 'deleted') <> 'boolean' THEN
    RAISE EXCEPTION 'Deleted is true or false.' USING ERRCODE = '22023';
  END IF;
  v_deleted := CASE WHEN NOT p_patch ? 'deleted' THEN (v ->> 'deleted_at')::timestamptz
                    WHEN (p_patch ->> 'deleted')::boolean THEN coalesce((v ->> 'deleted_at')::timestamptz, now())
                    ELSE NULL END;

  IF p_kind = 'task' THEN
    UPDATE public.task_templates x
    SET name = v_name, shared = v_shared, body = v_body, deleted_at = v_deleted,
        summary = CASE WHEN p_patch ? 'body' THEN public.templates__summary(v_body) ELSE x.summary END
    WHERE x.id = p_template_id
    RETURNING to_jsonb(x) INTO v;
  ELSE
    UPDATE public.project_templates x
    SET name = v_name, shared = v_shared, body = v_body, deleted_at = v_deleted,
        summary = CASE WHEN p_patch ? 'body' THEN public.templates__summary(v_body) ELSE x.summary END
    WHERE x.id = p_template_id
    RETURNING to_jsonb(x) INTO v;
  END IF;
  RETURN v || jsonb_build_object('kind', p_kind);
END;
$$;

-- "New project → From template…". Fields: id, name (default: the
-- template's), starts_on, area_id, keep_people (default true). A private
-- template saved from a project the workspace couldn't see makes a private
-- project.
CREATE OR REPLACE FUNCTION public.project_templates_op_apply(p_workspace_id uuid, p_template_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v jsonb;
  v_id uuid;
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_new uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(v_fields, ARRAY['id', 'name', 'starts_on', 'area_id', 'keep_people']);
  v := public.templates__usable(p_workspace_id, 'project', p_template_id);
  v_id := public.tasks__try_uuid(v_fields ->> 'id');
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = v_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = v_id AND x.workspace_id = p_workspace_id)
       OR NOT public.projects__visible_to(v_id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
    END IF;
    RETURN public.templates__bundle(v_id, NULL);
  END IF;
  IF NOT v_fields ? 'name' OR nullif(btrim(coalesce(v_fields ->> 'name', '')), '') IS NULL THEN
    v_fields := v_fields || jsonb_build_object('name', v ->> 'name');
  END IF;
  IF NOT v_fields ? 'keep_people' THEN
    v_fields := v_fields || '{"keep_people": true}'::jsonb;
  END IF;
  v_new := public.project_templates__apply_body(
    p_workspace_id, v -> 'body', v_fields,
    NOT (v ->> 'shared')::boolean AND (v ->> 'private_source')::boolean);
  RETURN public.templates__bundle(v_new, NULL);
END;
$$;

-- "From template…" for a task (capture's `/template`, New → From
-- template…). Fields: id (the task's, for a resend), title (default: the
-- template's), project_id and section_id (default: the template's, when
-- you can add tasks there; else your Inbox), date (where its offsets count
-- from; null = no dates), assignee_id (the task's own; subtasks keep theirs).
CREATE OR REPLACE FUNCTION public.task_templates_op_apply(p_workspace_id uuid, p_template_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v jsonb;
  v_body jsonb;
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_id uuid;
  v_project uuid;
  v_section uuid;
  v_root jsonb;
  v_ids uuid[];
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks__check_keys(v_fields,
    ARRAY['id', 'title', 'project_id', 'section_id', 'date', 'assignee_id']);
  v := public.templates__usable(p_workspace_id, 'task', p_template_id);
  v_body := v -> 'body';
  v_id := public.tasks__try_uuid(v_fields ->> 'id');
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = v_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = v_id AND x.workspace_id = p_workspace_id)
       OR NOT public.tasks__visible_to(v_id, v_actor) THEN
      RAISE EXCEPTION 'Task not found in this workspace.' USING ERRCODE = '22023';
    END IF;
    RETURN public.templates__bundle(NULL, ARRAY[v_id] || coalesce((
      SELECT array_agg(x.id) FROM public.tasks x WHERE x.parent_id = v_id AND x.deleted_at IS NULL), '{}'));
  END IF;

  -- Where it goes: the project asked for, else the template's while you can
  -- add tasks there, else your Inbox.
  IF v_fields ? 'project_id' THEN
    v_project := public.tasks__try_uuid(v_fields ->> 'project_id');
    v_section := public.tasks__try_uuid(v_fields ->> 'section_id');
    -- Only somewhere you can add tasks: a project you can edit, or your Inbox.
    IF v_project IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.buckets x
         WHERE x.id = v_project AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
           AND x.archived_at IS NULL
           AND CASE WHEN x.is_system THEN x.owner_id = v_actor
                    ELSE public.projects__editable_to(x.id, v_actor) END) THEN
      RAISE EXCEPTION 'You can''t add tasks to that project.' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_project := public.tasks__try_uuid(v_body ->> 'project');
    v_section := public.tasks__try_uuid(v_body ->> 'section');
    IF v_project IS NOT NULL AND NOT (
         EXISTS (SELECT 1 FROM public.buckets x
                 WHERE x.id = v_project AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
                   AND x.archived_at IS NULL AND NOT x.is_system)
         AND public.projects__editable_to(v_project, v_actor)) THEN
      v_project := NULL;
    END IF;
  END IF;
  IF v_section IS NOT NULL AND (v_project IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.sections s
       WHERE s.id = v_section AND s.project_id = v_project AND s.deleted_at IS NULL)) THEN
    v_section := NULL;
  END IF;
  v_root := jsonb_build_object('section_id', v_section);
  IF v_id IS NOT NULL THEN
    v_root := v_root || jsonb_build_object('id', v_id);
  END IF;
  IF nullif(btrim(coalesce(v_fields ->> 'title', '')), '') IS NOT NULL THEN
    v_root := v_root || jsonb_build_object('title', v_fields ->> 'title');
  END IF;
  IF v_fields ? 'assignee_id' THEN
    v_root := v_root || jsonb_build_object('assignee_id', v_fields -> 'assignee_id');
  END IF;
  v_ids := public.templates__create_tasks(
    p_workspace_id, v_body, v_project, NULL, NULL, public.tasks__patch_date(v_fields, 'date'),
    true, v_root);
  RETURN public.templates__bundle(NULL, v_ids);
END;
$$;

-- ── 7. Account erasure covers the new tables (§Assumptions #26) ────────────

DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
BEGIN
  IF position('task_templates' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  IF position('v_reminders integer;' IN v_def) = 0
     OR position('''task_reminders_deleted'', v_reminders,' IN v_def) = 0
     OR position('SELECT count(*) INTO v_reminders' IN v_def) = 0
     OR position('DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);' IN v_def) = 0 THEN
    RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects; redefine it by hand.';
  END IF;
  v_new := replace(v_def, 'v_reminders integer;',
    'v_reminders integer;' || E'\n  v_templates integer;');
  v_new := replace(v_new, 'SELECT count(*) INTO v_reminders',
    'SELECT (SELECT count(*) FROM public.task_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned))'
    || E'\n       + (SELECT count(*) FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned))'
    || E'\n    INTO v_templates;'
    || E'\n  SELECT count(*) INTO v_reminders');
  v_new := replace(v_new, '''task_reminders_deleted'', v_reminders,',
    '''task_reminders_deleted'', v_reminders,'
    || E'\n    ''templates_deleted'', v_templates,');
  -- A person's templates go with them, shared ones too.
  v_new := replace(v_new,
    'DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);',
    'DELETE FROM public.task_reminders x WHERE x.user_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  DELETE FROM public.task_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);'
    || E'\n  DELETE FROM public.project_templates x WHERE x.owner_id = p_user AND x.workspace_id <> ALL (v_owned);');
  EXECUTE v_new;
END;
$erase$;

-- ── 8. Grants ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'templates__workspace_sees(uuid)', 'templates__can_take(uuid, uuid)',
    'templates__task_entry(public.tasks, date, integer, integer, integer, uuid)',
    'project_templates__body_of(uuid, uuid)', 'task_templates__body_of(uuid, uuid)',
    'templates__create_tasks(uuid, jsonb, uuid, uuid[], uuid[], date, boolean, jsonb)',
    'project_templates__apply_body(uuid, jsonb, jsonb, boolean)',
    'templates__bundle(uuid, uuid[])', 'templates__usable(uuid, text, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'templates__offset(date, date)', 'templates__int(jsonb, text, integer, integer)',
    'templates__text(jsonb, text, integer)', 'templates__uuid(jsonb, text)',
    'templates__check_body(text, jsonb)', 'templates__summary(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'projects_op_duplicate(uuid, uuid, jsonb)',
    'project_templates_op_save(uuid, uuid, jsonb)', 'task_templates_op_save(uuid, uuid, jsonb)',
    'templates_op_update(uuid, text, uuid, jsonb)',
    'project_templates_op_apply(uuid, uuid, jsonb)', 'task_templates_op_apply(uuid, uuid, jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

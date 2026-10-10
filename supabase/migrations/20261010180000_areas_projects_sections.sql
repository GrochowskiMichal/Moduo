-- TV-D10 · Expand II, part 1 of 3: areas, project fields, sections, the
-- estimate, time blocks per person (specs/tasks-v3.md block 10, §Assumptions
-- #4, #12, #24, #26, #27; REPLAN 13–19; decisions in docs/decisions/tasks.md
-- "TV-D10").
--
--   * areas: optional groups of projects in the sidebar (name, colour, order;
--     no permissions, no page, no tasks). Today's rail sections
--     (buckets.group_label) become areas in sidebar order. Until TV-D7
--     group_label stays a mirror of the area's name both ways: a build from
--     before this migration writes group_label and lands in (or makes) the area
--     of that name; renaming an area relabels its projects; deleting one makes
--     its projects area-less. An area is read by whoever can see one of its
--     projects (by every Tasks reader while it's empty), so a label typed only
--     on private projects stays as private as they are; sections and project
--     fields follow the project's own access.
--   * Project fields on buckets (projects keep the table name until TV-D7):
--     status Active · On hold · Done (@contracts PROJECT_STATES), starts_on,
--     target_on, lead_id (a member), client_contact_id (a contact the setter
--     can see), area_id. #328's color and archived_at come with TV-U6.
--   * sections: the ordered parts of a project, each with a date range or an
--     end date only; tasks.section_id. A section never spans projects: moving a
--     task to another project leaves it in "No section" there; deleting a
--     section does the same for its tasks.
--   * tasks.estimate_minutes: the estimate gets its own column, because
--     duration_minutes becomes the mirror of the next work session's length in
--     part 2. While a task is unscheduled the two are one value both ways
--     (builds from before TV-D10 read duration_minutes as the estimate); once it
--     is scheduled, duration_minutes is the block's length and never touches
--     the estimate (a calendar drop or resize leaves it alone).
--   * user_preferences.task_time_blocks: the time-of-day slots (morning,
--     afternoon, evening → a project), now per person and keyed by workspace.
--     The workspace table task_time_blocks stays until TV-D7; a write to it (a
--     build from before TV-D10) lands in the writer's own preferences.
--   * Ops: areas_op_create/_update/_move, projects_op_create/_update/_move,
--     sections_op_create/_update/_move, tasks_op_set_time_blocks. The app's
--     "bucket" calls stay as aliases on top of them.
--
-- Part 3 (20261010182000_teams.sql) adds section_id and estimate_minutes to
-- tasks_op_create/_update and redefines account erasure for every D10 table.
-- Apply all three, in order. Expand only: nothing is dropped.
-- Verified on the local stack by supabase/tests/structure.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. Areas ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  -- Order in the sidebar (1, 2, …).
  position integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT areas_name_check CHECK (char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)),
  CONSTRAINT areas_color_check CHECK (color IS NULL OR char_length(color) BETWEEN 1 AND 32)
);

-- One live area per name (as typed; the old rail told "Clients" and "clients"
-- apart, so the backfill does too).
CREATE UNIQUE INDEX IF NOT EXISTS areas_name_per_workspace
  ON public.areas (workspace_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS areas_workspace_position
  ON public.areas (workspace_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS areas_workspace_updated
  ON public.areas (workspace_id, updated_at);

-- Read access is set after the project columns (section 2b); every write goes
-- through the ops below.
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.areas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.areas TO authenticated;
GRANT ALL ON public.areas TO service_role;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.areas;
CREATE TRIGGER zz_stamp_updated_at
  BEFORE INSERT OR UPDATE ON public.areas
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- ── 2. Project fields on buckets ────────────────────────────────────────────

ALTER TABLE public.buckets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS target_on date,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.areas(id) ON DELETE SET NULL;

ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_status_check;
ALTER TABLE public.buckets
  ADD CONSTRAINT buckets_status_check CHECK (status IN ('active','on_hold','done'));
ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_dates_check;
ALTER TABLE public.buckets
  ADD CONSTRAINT buckets_dates_check CHECK (starts_on IS NULL OR target_on IS NULL OR starts_on <= target_on);

CREATE INDEX IF NOT EXISTS buckets_area_id_idx ON public.buckets (area_id) WHERE area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS buckets_lead_id_idx ON public.buckets (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS buckets_client_contact_id_idx
  ON public.buckets (client_contact_id) WHERE client_contact_id IS NOT NULL;

-- ── 2b. Who sees an area ────────────────────────────────────────────────────

-- Areas carry no permissions of their own, but a name can say something: a
-- rail section label lived only on the projects it was typed on, so one used
-- only on private projects was never seen by anyone else. An area is visible
-- to whoever can read Tasks in the workspace when it holds no live project,
-- or when they can see at least one of its projects. Never the projects
-- themselves: a project stays as private as its own sharing says.
CREATE OR REPLACE FUNCTION public.areas__visible(p_area_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.buckets b
                     WHERE b.area_id = p_area_id AND b.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.buckets b
                 WHERE b.area_id = p_area_id AND b.deleted_at IS NULL
                   AND public.can_access('bucket', b.id, 'view', public.perm_actor_id()))
$$;

DROP POLICY IF EXISTS areas_read ON public.areas;
CREATE POLICY areas_read ON public.areas
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks') AND public.areas__visible(id));

-- ── 3. Sections ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Order inside the project (1, 2, …).
  position integer NOT NULL DEFAULT 1,
  -- A range, or an end date only (a milestone, a deadline week).
  starts_on date,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT sections_name_check CHECK (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)),
  CONSTRAINT sections_dates_check CHECK (starts_on IS NULL OR (ends_on IS NOT NULL AND starts_on <= ends_on))
);

CREATE INDEX IF NOT EXISTS sections_project_position
  ON public.sections (project_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sections_workspace_updated
  ON public.sections (workspace_id, updated_at);

-- Sections inherit the project's access; every write goes through the ops.
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sections_read ON public.sections;
CREATE POLICY sections_read ON public.sections
  FOR SELECT TO authenticated
  USING (public.perm_can_view(workspace_id, 'tasks') AND public.can_access('bucket', project_id, 'view'));
REVOKE ALL ON public.sections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sections TO authenticated;
GRANT ALL ON public.sections TO service_role;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.sections;
CREATE TRIGGER zz_stamp_updated_at
  BEFORE INSERT OR UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

-- ── 4. Task columns: section, estimate ──────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimate_minutes integer;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_estimate_minutes_check;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_estimate_minutes_check CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0);
CREATE INDEX IF NOT EXISTS tasks_section_id_idx ON public.tasks (section_id) WHERE section_id IS NOT NULL;

-- ── 5. Time blocks per person ───────────────────────────────────────────────

-- { "<workspace id>": { "morning": "<project id>", … } }. Not a synced prefs
-- domain: the app writes it through tasks_op_set_time_blocks only, like
-- TV-D8's time_zone, so a prefs push never carries it.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS task_time_blocks jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 6. Live updates (the shared store, TV-D11a, listens) ────────────────────

DO $$
DECLARE
  v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['areas', 'sections'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ── 7. Shared helpers ───────────────────────────────────────────────────────

-- p_order with p_id moved right after p_after (first when p_after is NULL).
CREATE OR REPLACE FUNCTION public.tasks__reorder(p_order uuid[], p_id uuid, p_after uuid)
RETURNS uuid[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v uuid[] := array_remove(coalesce(p_order, '{}'), p_id);
  i integer;
BEGIN
  IF p_after IS NULL THEN
    RETURN p_id || v;
  END IF;
  i := array_position(v, p_after);
  IF i IS NULL THEN
    RETURN v || p_id;
  END IF;
  RETURN v[1:i] || p_id || v[i + 1:];
END;
$$;

-- Whether someone is in the workspace (its owner or a member, any role).
CREATE OR REPLACE FUNCTION public.tasks__is_member(p_workspace_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND (
    public.perm_is_owner(p_workspace_id, p_user)
    OR EXISTS (SELECT 1 FROM public.workspace_members m
               WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user))
$$;

-- A name as the structure ops store it: trimmed, required, capped.
CREATE OR REPLACE FUNCTION public.tasks__clean_name(p_name text, p_what text, p_max integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text := btrim(coalesce(p_name, ''));
BEGIN
  IF v = '' THEN
    RAISE EXCEPTION '% needs a name.', p_what USING ERRCODE = '22023';
  END IF;
  IF char_length(v) > p_max THEN
    RAISE EXCEPTION '% name is at most % characters.', p_what, p_max USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- An optional date field from a patch (null clears it).
CREATE OR REPLACE FUNCTION public.tasks__patch_date(p_patch jsonb, p_key text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_patch -> p_key IS NULL OR jsonb_typeof(p_patch -> p_key) = 'null' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN (p_patch ->> p_key)::date;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '% is a date (YYYY-MM-DD).', p_key USING ERRCODE = '22023';
  END;
END;
$$;

-- Whoever may change the workspace's structure (areas): Tasks at Edit.
CREATE OR REPLACE FUNCTION public.tasks__guard_structure(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.tasks_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- A project the caller may change: live, in the workspace, visible, editable,
-- and not an Inbox (an Inbox is nobody's project).
CREATE OR REPLACE FUNCTION public.projects__guard(p_workspace_id uuid, p_project_id uuid)
RETURNS public.buckets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  SELECT * INTO b FROM public.buckets x
  WHERE x.id = p_project_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF b.is_system THEN
    RAISE EXCEPTION 'The Inbox isn''t a project, so it has no project settings or sections.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_access('bucket', b.id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You don''t have edit access to this project.' USING ERRCODE = '42501';
  END IF;
  RETURN b;
END;
$$;

-- ── 8. Areas ↔ group_label ──────────────────────────────────────────────────

-- The live area of this name in the workspace, made at the end of the sidebar
-- when there's none. NULL for an empty name.
CREATE OR REPLACE FUNCTION public.areas__find_or_create(p_workspace_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_id uuid;
BEGIN
  v_name := btrim(v_name);
  IF v_name = '' THEN
    RETURN NULL;
  END IF;
  SELECT a.id INTO v_id FROM public.areas a
  WHERE a.workspace_id = p_workspace_id AND a.name = v_name AND a.deleted_at IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.areas (workspace_id, name, position)
  SELECT p_workspace_id, v_name, coalesce(max(a.position), 0) + 1
  FROM public.areas a WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL
  ON CONFLICT (workspace_id, name) WHERE deleted_at IS NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT a.id INTO v_id FROM public.areas a
    WHERE a.workspace_id = p_workspace_id AND a.name = v_name AND a.deleted_at IS NULL;
  END IF;
  RETURN v_id;
END;
$$;

-- BEFORE INSERT/UPDATE on buckets: whichever of area_id and group_label the
-- write changed leads, and the other follows. A write of group_label alone is
-- a build from before TV-D10 (its rail "Section" menu): it lands in the area
-- of that name, made if needed; clearing it leaves the area. Restoring a
-- project whose label has no area yet gives it one. The Inbox never has one.
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
      IF v_name IS NULL THEN
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

DROP TRIGGER IF EXISTS buckets_area_sync ON public.buckets;
CREATE TRIGGER buckets_area_sync
  BEFORE INSERT OR UPDATE OF area_id, group_label, deleted_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.buckets__area_sync();

-- AFTER UPDATE OF name on areas: the projects' labels follow (builds from
-- before TV-D10 read them). The relabel is the rename's own consequence, so it
-- runs as system work: a project the renamer can't edit still follows.
CREATE OR REPLACE FUNCTION public.areas__mirror_labels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bypass text := current_setting('share.bypass', true);
  v_mirror text := current_setting('tasks.area_mirror', true);
BEGIN
  PERFORM set_config('share.bypass', '1', true);
  PERFORM set_config('tasks.area_mirror', '1', true);
  UPDATE public.buckets b SET group_label = NEW.name
  WHERE b.area_id = NEW.id AND b.group_label IS DISTINCT FROM NEW.name;
  PERFORM set_config('tasks.area_mirror', coalesce(v_mirror, ''), true);
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS areas_mirror_labels ON public.areas;
CREATE TRIGGER areas_mirror_labels
  AFTER UPDATE OF name ON public.areas
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.areas__mirror_labels();

-- ── 9. Project fields: checks on every write path ───────────────────────────

-- A lead is someone in the workspace; a client is a live contact of this
-- workspace that the setter can see; the Inbox has no project fields.
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

DROP TRIGGER IF EXISTS buckets_project_check ON public.buckets;
CREATE TRIGGER buckets_project_check
  BEFORE INSERT OR UPDATE OF status, starts_on, target_on, lead_id, client_contact_id, is_system
  ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.buckets__project_check();

-- ── 10. A task's section is in its project ──────────────────────────────────

-- BEFORE INSERT/UPDATE OF section_id, bucket_id on tasks. A task moved to
-- another project without a section named (builds from before TV-D10, a
-- parent carrying its subtasks) goes to "No section" there.
CREATE OR REPLACE FUNCTION public.tasks__section_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.section_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
     AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id THEN
    NEW.section_id := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sections s
                 WHERE s.id = NEW.section_id AND s.project_id = NEW.bucket_id AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That section isn''t in this task''s project.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_section_check ON public.tasks;
CREATE TRIGGER tasks_section_check
  BEFORE INSERT OR UPDATE OF section_id, bucket_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__section_check();

-- ── 11. The estimate and duration_minutes ───────────────────────────────────

-- BEFORE INSERT/UPDATE OF duration_minutes, estimate_minutes on tasks.
-- duration_minutes is what builds from before TV-D10 read as the estimate and
-- as a scheduled block's length; from part 2 on it mirrors the next work
-- session (that write sets tasks.session_mirror and is skipped here).
--   * the estimate leads: it reaches duration_minutes while nothing is
--     scheduled (the block's length stays the session's);
--   * duration_minutes leads on an unscheduled task (an old build's estimate):
--     it is the estimate too. On a scheduled task it is the block's length (a
--     calendar drop or resize, an old build's block), and the estimate stays.
CREATE OR REPLACE FUNCTION public.tasks__estimate_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('tasks.session_mirror', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_at IS NOT NULL THEN
      RETURN NEW;
    ELSIF NEW.estimate_minutes IS NULL THEN
      NEW.estimate_minutes := NEW.duration_minutes;
    ELSIF NEW.duration_minutes IS NULL THEN
      NEW.duration_minutes := NEW.estimate_minutes;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.estimate_minutes IS DISTINCT FROM OLD.estimate_minutes THEN
    IF NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes AND NEW.scheduled_at IS NULL THEN
      NEW.duration_minutes := NEW.estimate_minutes;
    END IF;
  ELSIF NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes AND NEW.scheduled_at IS NULL THEN
    NEW.estimate_minutes := NEW.duration_minutes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_estimate_sync ON public.tasks;
CREATE TRIGGER tasks_estimate_sync
  BEFORE INSERT OR UPDATE OF duration_minutes, estimate_minutes ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks__estimate_sync();

-- ── 12. Time blocks: per person ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.tasks__clean_time_blocks(uuid, jsonb);

-- The slots of a time-block map that name a live project of the workspace
-- that this person can see.
CREATE OR REPLACE FUNCTION public.tasks__clean_time_blocks(p_workspace_id uuid, p_blocks jsonb, p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(j.key, j.value), '{}'::jsonb)
  FROM jsonb_each(CASE WHEN jsonb_typeof(p_blocks) = 'object' THEN p_blocks ELSE '{}'::jsonb END) AS j
  WHERE j.key IN ('morning', 'afternoon', 'evening')
    AND jsonb_typeof(j.value) = 'string'
    AND EXISTS (SELECT 1 FROM public.buckets b
                WHERE b.id = public.tasks__try_uuid(j.value #>> '{}')
                  AND b.workspace_id = p_workspace_id AND b.deleted_at IS NULL
                  AND public.can_access('bucket', b.id, 'view', p_user))
$$;

-- Put one person's map for one workspace into their preferences.
CREATE OR REPLACE FUNCTION public.tasks__put_time_blocks(p_user uuid, p_workspace_id uuid, p_blocks jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.user_preferences AS p (user_id, task_time_blocks)
  VALUES (p_user, jsonb_build_object(p_workspace_id::text, p_blocks))
  ON CONFLICT (user_id) DO UPDATE
    SET task_time_blocks = p.task_time_blocks || jsonb_build_object(p_workspace_id::text, p_blocks)
$$;

-- Set the caller's time blocks in a workspace. Answers with what was kept.
CREATE OR REPLACE FUNCTION public.tasks_op_set_time_blocks(p_workspace_id uuid, p_blocks jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_clean jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.perm_can_view(p_workspace_id, 'tasks') THEN
    RAISE EXCEPTION 'You don''t have access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'object' THEN
    RAISE EXCEPTION 'Expected an object of time blocks.' USING ERRCODE = '22023';
  END IF;
  v_clean := public.tasks__clean_time_blocks(p_workspace_id, p_blocks, v_actor);
  PERFORM public.tasks__put_time_blocks(v_actor, p_workspace_id, v_clean);
  RETURN v_clean;
END;
$$;

-- A build from before TV-D10 still writes the workspace table: that lands in
-- the writer's own preferences.
CREATE OR REPLACE FUNCTION public.task_time_blocks__legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF v_actor IS NOT NULL THEN
    PERFORM public.tasks__put_time_blocks(v_actor, NEW.workspace_id,
      public.tasks__clean_time_blocks(NEW.workspace_id, NEW.blocks, v_actor));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS task_time_blocks_legacy ON public.task_time_blocks;
CREATE TRIGGER task_time_blocks_legacy
  AFTER INSERT OR UPDATE OF blocks ON public.task_time_blocks
  FOR EACH ROW EXECUTE FUNCTION public.task_time_blocks__legacy();

-- ── 13. Area ops ────────────────────────────────────────────────────────────

-- The workspace's live areas the caller can see, in sidebar order.
CREATE OR REPLACE FUNCTION public.areas__list(p_workspace_id uuid)
RETURNS SETOF public.areas
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.areas a
  WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL
    AND (public.perm_actor_id() IS NULL OR public.areas__visible(a.id))
  ORDER BY a.position, a.created_at, a.id
$$;

-- Every live area in sidebar order, hidden ones included (for renumbering).
CREATE OR REPLACE FUNCTION public.areas__order(p_workspace_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(a.id ORDER BY a.position, a.created_at, a.id), '{}')
  FROM public.areas a
  WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.areas__check_name(p_workspace_id uuid, p_name text, p_except uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v text := public.tasks__clean_name(p_name, 'An area', 80);
BEGIN
  IF EXISTS (SELECT 1 FROM public.areas a
             WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL
               AND a.name = v AND a.id IS DISTINCT FROM p_except) THEN
    RAISE EXCEPTION 'There''s already an area called "%".', v USING ERRCODE = '23505';
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.areas__check_color(p_color jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_color IS NULL OR jsonb_typeof(p_color) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_color) <> 'string' OR char_length(p_color #>> '{}') NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'A colour is a short name.' USING ERRCODE = '22023';
  END IF;
  RETURN p_color #>> '{}';
END;
$$;

-- Add an area at the end of the sidebar. Answers with every live area.
CREATE OR REPLACE FUNCTION public.areas_op_create(p_workspace_id uuid, p_name text, p_color text DEFAULT NULL)
RETURNS SETOF public.areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('areas:' || p_workspace_id::text, 0));
  v_name := public.areas__check_name(p_workspace_id, p_name, NULL);
  INSERT INTO public.areas (workspace_id, name, color, position)
  SELECT p_workspace_id, v_name, public.areas__check_color(to_jsonb(p_color)), coalesce(max(a.position), 0) + 1
  FROM public.areas a WHERE a.workspace_id = p_workspace_id AND a.deleted_at IS NULL;
  RETURN QUERY SELECT * FROM public.areas__list(p_workspace_id);
END;
$$;

-- Rename ("name"), recolour ("color"), delete or restore ("deleted_at": any
-- time deletes, null restores). Deleting an area leaves its projects
-- area-less; nothing else changes. Answers with every live area.
CREATE OR REPLACE FUNCTION public.areas_op_update(p_workspace_id uuid, p_area_id uuid, p_patch jsonb)
RETURNS SETOF public.areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.areas;
  v_key text;
  v_bypass text;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Expected an object of area fields.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('name', 'color', 'deleted_at') THEN
      RAISE EXCEPTION 'Areas have no field "%".', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('areas:' || p_workspace_id::text, 0));
  SELECT * INTO a FROM public.areas x
  WHERE x.id = p_area_id AND x.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.areas__visible(a.id)
     OR (a.deleted_at IS NOT NULL
         AND NOT (p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null')) THEN
    RAISE EXCEPTION 'Area not found.' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null' AND a.deleted_at IS NOT NULL THEN
    PERFORM public.areas__check_name(p_workspace_id, a.name, a.id);
    BEGIN
      UPDATE public.areas SET deleted_at = NULL WHERE id = a.id RETURNING * INTO a;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'trash_expired' THEN
        RAISE EXCEPTION 'This area was deleted more than 30 days ago, so it can''t be restored.';
      END IF;
      RAISE;
    END;
  END IF;
  IF p_patch ? 'name' THEN
    UPDATE public.areas SET name = public.areas__check_name(p_workspace_id, p_patch ->> 'name', a.id)
    WHERE id = a.id RETURNING * INTO a;
  END IF;
  IF p_patch ? 'color' THEN
    UPDATE public.areas SET color = public.areas__check_color(p_patch -> 'color')
    WHERE id = a.id RETURNING * INTO a;
  END IF;
  IF p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') <> 'null' AND a.deleted_at IS NULL THEN
    UPDATE public.areas SET deleted_at = now() WHERE id = a.id;
    -- Its projects become area-less: the delete's own consequence, so system
    -- work (a project the deleter can't edit follows too).
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    UPDATE public.buckets b SET area_id = NULL WHERE b.area_id = a.id;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  END IF;
  RETURN QUERY SELECT * FROM public.areas__list(p_workspace_id);
END;
$$;

-- The area of this name (made at the end of the sidebar when there's none),
-- for filing a project under a name (the rail's "Section" menu). Looked up on
-- the server, so a stale list in the app never makes a second one. Answers
-- with that area.
CREATE OR REPLACE FUNCTION public.areas_op_ensure(p_workspace_id uuid, p_name text)
RETURNS public.areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.areas;
  v_id uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('areas:' || p_workspace_id::text, 0));
  v_id := public.areas__find_or_create(p_workspace_id, public.tasks__clean_name(p_name, 'An area', 80));
  SELECT * INTO a FROM public.areas WHERE id = v_id;
  RETURN a;
END;
$$;

-- Move an area right after another (first when p_after is null). Answers with
-- every live area.
CREATE OR REPLACE FUNCTION public.areas_op_move(p_workspace_id uuid, p_area_id uuid, p_after uuid)
RETURNS SETOF public.areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order uuid[];
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('areas:' || p_workspace_id::text, 0));
  -- Renumber every area (hidden ones keep their order among the rest).
  v_order := public.areas__order(p_workspace_id);
  IF NOT (p_area_id = ANY (v_order)) OR NOT public.areas__visible(p_area_id) THEN
    RAISE EXCEPTION 'Area not found.' USING ERRCODE = '22023';
  END IF;
  IF p_after IS NOT NULL AND (p_after = p_area_id OR NOT (p_after = ANY (v_order))
                              OR NOT public.areas__visible(p_after)) THEN
    RAISE EXCEPTION 'An area moves only among this workspace''s areas.' USING ERRCODE = '22023';
  END IF;
  v_order := public.tasks__reorder(v_order, p_area_id, p_after);
  UPDATE public.areas x SET position = o.n
  FROM unnest(v_order) WITH ORDINALITY AS o(id, n)
  WHERE x.id = o.id AND x.position IS DISTINCT FROM o.n::integer;
  RETURN QUERY SELECT * FROM public.areas__list(p_workspace_id);
END;
$$;

-- ── 14. Project ops ─────────────────────────────────────────────────────────

-- After every live project of the workspace (the app's own end key, so a
-- server-made project and one the app placed sort the same way).
CREATE OR REPLACE FUNCTION public.projects__end_position(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max text;
  v_n bigint;
BEGIN
  SELECT max(b.position COLLATE "C") INTO v_max FROM public.buckets b
  WHERE b.workspace_id = p_workspace_id AND b.deleted_at IS NULL;
  IF v_max IS NULL OR v_max = '' THEN
    RETURN public.tasks_queue__key(1048576);
  END IF;
  v_n := public.tasks_queue__num(v_max);
  IF v_n IS NOT NULL AND v_n + 1048576 < 3656158440062976 THEN
    RETURN public.tasks_queue__key(v_n + 1048576);
  END IF;
  RETURN v_max || 'i';
END;
$$;

-- The project fields a patch may set, applied to a row (no write).
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
  RETURN b;
END;
$$;

-- Make a project. The creator owns it (sharing defaults and the default
-- statuses come from the insert triggers); a resent create answers with the
-- project it made. Keys: id, name, position, area_id, status, starts_on,
-- target_on, lead_id, client_contact_id.
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
    'client_contact_id']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A project needs an owner.' USING ERRCODE = '42501';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(p_project ->> 'id'), gen_random_uuid());
  SELECT * INTO b FROM public.buckets WHERE id = v_id;
  IF FOUND THEN
    IF b.workspace_id IS DISTINCT FROM p_workspace_id
       OR NOT public.can_access('bucket', b.id, 'view', v_actor) THEN
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
    lead_id, client_contact_id, area_id, created_at, updated_at)
  VALUES (
    b.id, b.workspace_id, b.owner_id, b.name, false, b.position, b.status, b.starts_on, b.target_on,
    b.lead_id, b.client_contact_id, b.area_id, now(), now())
  RETURNING * INTO b;
  RETURN b;
END;
$$;

-- Edit a project's fields: name, status, starts_on, target_on, lead_id,
-- client_contact_id, area_id, position (only the keys given).
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
    'name', 'status', 'starts_on', 'target_on', 'lead_id', 'client_contact_id', 'area_id', 'position']);
  b := public.projects__guard(p_workspace_id, p_project_id);
  SELECT * INTO b FROM public.buckets WHERE id = b.id FOR UPDATE;
  n := public.projects__apply_fields(b, p_patch);
  IF row(n.name, n.status, n.starts_on, n.target_on, n.lead_id, n.client_contact_id, n.area_id, n.position)
     IS NOT DISTINCT FROM
     row(b.name, b.status, b.starts_on, b.target_on, b.lead_id, b.client_contact_id, b.area_id, b.position) THEN
    RETURN b;
  END IF;
  UPDATE public.buckets SET
    name = n.name, status = n.status, starts_on = n.starts_on, target_on = n.target_on,
    lead_id = n.lead_id, client_contact_id = n.client_contact_id, area_id = n.area_id,
    position = n.position, updated_at = now()
  WHERE id = b.id
  RETURNING * INTO b;
  RETURN b;
END;
$$;

-- Move a project into an area (null: no area) and, with a position, to a new
-- place in the sidebar.
CREATE OR REPLACE FUNCTION public.projects_op_move(
  p_workspace_id uuid, p_project_id uuid, p_area_id uuid, p_position text DEFAULT NULL)
RETURNS public.buckets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.projects_op_update(p_workspace_id, p_project_id,
    jsonb_build_object('area_id', p_area_id)
    || CASE WHEN p_position IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('position', p_position) END);
END;
$$;

-- ── 15. Section ops ─────────────────────────────────────────────────────────

-- A project's live sections, in order.
CREATE OR REPLACE FUNCTION public.sections__list(p_project_id uuid)
RETURNS SETOF public.sections
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.sections s
  WHERE s.project_id = p_project_id AND s.deleted_at IS NULL
  ORDER BY s.position, s.created_at, s.id
$$;

-- A section's dates from a patch onto its current ones: a range, or an end
-- date only.
CREATE OR REPLACE FUNCTION public.sections__check_dates(p_starts date, p_ends date)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_starts IS NOT NULL AND p_ends IS NULL THEN
    RAISE EXCEPTION 'A section has an end date, or a start and an end.' USING ERRCODE = '22023';
  END IF;
  IF p_starts IS NOT NULL AND p_starts > p_ends THEN
    RAISE EXCEPTION 'A section can''t end before it starts.' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Add a section. Keys: id, name, starts_on, ends_on, after (the section to
-- follow; null for first; absent for last). A resent create answers as the
-- first did. Answers with the project's live sections.
CREATE OR REPLACE FUNCTION public.sections_op_create(p_workspace_id uuid, p_project_id uuid, p_section jsonb)
RETURNS SETOF public.sections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.buckets;
  s public.sections;
  v_id uuid;
  v_order uuid[];
  v_starts date;
  v_ends date;
BEGIN
  PERFORM public.tasks__check_keys(p_section, ARRAY['id', 'name', 'starts_on', 'ends_on', 'after']);
  b := public.projects__guard(p_workspace_id, p_project_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('sections:' || b.id::text, 0));
  v_id := coalesce(public.tasks__try_uuid(p_section ->> 'id'), gen_random_uuid());
  SELECT * INTO s FROM public.sections WHERE id = v_id;
  IF FOUND THEN
    IF s.project_id IS DISTINCT FROM b.id THEN
      RAISE EXCEPTION 'That section isn''t in this project.' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT * FROM public.sections__list(b.id);
    RETURN;
  END IF;
  v_starts := public.tasks__patch_date(p_section, 'starts_on');
  v_ends := public.tasks__patch_date(p_section, 'ends_on');
  PERFORM public.sections__check_dates(v_starts, v_ends);

  SELECT coalesce(array_agg(x.id ORDER BY x.position, x.created_at, x.id), '{}') INTO v_order
  FROM public.sections__list(b.id) x;
  INSERT INTO public.sections (id, workspace_id, project_id, name, position, starts_on, ends_on)
  VALUES (v_id, p_workspace_id, b.id, public.tasks__clean_name(p_section ->> 'name', 'A section', 120),
          cardinality(v_order) + 1, v_starts, v_ends);
  IF p_section ? 'after' THEN
    IF jsonb_typeof(p_section -> 'after') <> 'null'
       AND NOT (public.tasks__try_uuid(p_section ->> 'after') = ANY (v_order)) THEN
      RAISE EXCEPTION 'A section goes only among this project''s sections.' USING ERRCODE = '22023';
    END IF;
    v_order := public.tasks__reorder(v_order || v_id, v_id, public.tasks__try_uuid(p_section ->> 'after'));
    UPDATE public.sections x SET position = o.n
    FROM unnest(v_order) WITH ORDINALITY AS o(id, n)
    WHERE x.id = o.id AND x.position IS DISTINCT FROM o.n::integer;
  END IF;
  RETURN QUERY SELECT * FROM public.sections__list(b.id);
END;
$$;

-- Rename ("name"), date ("starts_on", "ends_on"), delete or restore
-- ("deleted_at"). Deleting a section moves its tasks to "No section" in the
-- same project; nothing is deleted. Answers with the project's live sections.
CREATE OR REPLACE FUNCTION public.sections_op_update(p_workspace_id uuid, p_section_id uuid, p_patch jsonb)
RETURNS SETOF public.sections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.sections;
  v_key text;
  v_starts date;
  v_ends date;
  v_bypass text;
  v_restore boolean;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Expected an object of section fields.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('name', 'starts_on', 'ends_on', 'deleted_at') THEN
      RAISE EXCEPTION 'Sections have no field "%".', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_restore := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null';
  SELECT * INTO s FROM public.sections x
  WHERE x.id = p_section_id AND x.workspace_id = p_workspace_id
  FOR UPDATE;
  -- A section of a project the caller can't see reads as missing.
  IF NOT FOUND OR (s.deleted_at IS NOT NULL AND NOT v_restore)
     OR NOT public.can_access('bucket', s.project_id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Section not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.projects__guard(p_workspace_id, s.project_id);

  IF v_restore AND s.deleted_at IS NOT NULL THEN
    BEGIN
      UPDATE public.sections SET deleted_at = NULL WHERE id = s.id RETURNING * INTO s;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'trash_expired' THEN
        RAISE EXCEPTION 'This section was deleted more than 30 days ago, so it can''t be restored.';
      END IF;
      RAISE;
    END;
  END IF;
  IF p_patch ? 'name' THEN
    UPDATE public.sections SET name = public.tasks__clean_name(p_patch ->> 'name', 'A section', 120)
    WHERE id = s.id RETURNING * INTO s;
  END IF;
  IF p_patch ? 'starts_on' OR p_patch ? 'ends_on' THEN
    v_starts := CASE WHEN p_patch ? 'starts_on' THEN public.tasks__patch_date(p_patch, 'starts_on') ELSE s.starts_on END;
    v_ends := CASE WHEN p_patch ? 'ends_on' THEN public.tasks__patch_date(p_patch, 'ends_on') ELSE s.ends_on END;
    PERFORM public.sections__check_dates(v_starts, v_ends);
    UPDATE public.sections SET starts_on = v_starts, ends_on = v_ends
    WHERE id = s.id AND row(starts_on, ends_on) IS DISTINCT FROM row(v_starts, v_ends)
    RETURNING * INTO s;
  END IF;
  IF p_patch ? 'deleted_at' AND NOT v_restore AND s.deleted_at IS NULL THEN
    UPDATE public.sections SET deleted_at = now() WHERE id = s.id;
    -- Its tasks (deleted ones too, so a restore lands right) go to "No
    -- section": the delete's own consequence, so system work.
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    UPDATE public.tasks t SET section_id = NULL, updated_at = now() WHERE t.section_id = s.id;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  END IF;
  RETURN QUERY SELECT * FROM public.sections__list(s.project_id);
END;
$$;

-- Move a section right after another of its project (first when p_after is
-- null). Answers with the project's live sections.
CREATE OR REPLACE FUNCTION public.sections_op_move(p_workspace_id uuid, p_section_id uuid, p_after uuid)
RETURNS SETOF public.sections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.sections;
  v_order uuid[];
BEGIN
  SELECT * INTO s FROM public.sections x
  WHERE x.id = p_section_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.can_access('bucket', s.project_id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'Section not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.projects__guard(p_workspace_id, s.project_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('sections:' || s.project_id::text, 0));
  SELECT coalesce(array_agg(x.id ORDER BY x.position, x.created_at, x.id), '{}') INTO v_order
  FROM public.sections__list(s.project_id) x;
  IF p_after IS NOT NULL AND (p_after = s.id OR NOT (p_after = ANY (v_order))) THEN
    RAISE EXCEPTION 'A section moves only among its project''s sections.' USING ERRCODE = '22023';
  END IF;
  v_order := public.tasks__reorder(v_order, s.id, p_after);
  UPDATE public.sections x SET position = o.n
  FROM unnest(v_order) WITH ORDINALITY AS o(id, n)
  WHERE x.id = o.id AND x.position IS DISTINCT FROM o.n::integer;
  RETURN QUERY SELECT * FROM public.sections__list(s.project_id);
END;
$$;

-- ── 16. Backfills (triggers off: none of this is an edit) ───────────────────

-- Today's rail sections become areas, in sidebar order: labels in the order
-- of their first project (bucketRanks in _shared/tasks-connector.ts), after
-- any area the workspace already has. Deleted projects whose label has no
-- area get one when they're restored (buckets__area_sync).
CREATE OR REPLACE FUNCTION public.tasks__backfill_areas(p_workspace_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
  v_label text;
  v_pos integer;
  v_made integer := 0;
BEGIN
  FOR v_ws IN
    SELECT DISTINCT b.workspace_id FROM public.buckets b
    WHERE nullif(btrim(coalesce(b.group_label, '')), '') IS NOT NULL AND NOT b.is_system
      AND (p_workspace_id IS NULL OR b.workspace_id = p_workspace_id)
  LOOP
    SELECT coalesce(max(a.position), 0) INTO v_pos FROM public.areas a
    WHERE a.workspace_id = v_ws AND a.deleted_at IS NULL;
    FOR v_label IN
      SELECT l.label FROM (
        SELECT btrim(left(btrim(b.group_label), 80)) AS label,
               min(b.rn) AS first_seen
        FROM (SELECT x.*, row_number() OVER (ORDER BY x.position COLLATE "C", x.id) AS rn
              FROM public.buckets x
              WHERE x.workspace_id = v_ws AND x.deleted_at IS NULL AND NOT x.is_system) b
        WHERE nullif(btrim(coalesce(b.group_label, '')), '') IS NOT NULL
        GROUP BY 1
      ) l
      ORDER BY l.first_seen
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.areas a
                     WHERE a.workspace_id = v_ws AND a.name = v_label AND a.deleted_at IS NULL) THEN
        v_pos := v_pos + 1;
        INSERT INTO public.areas (workspace_id, name, position) VALUES (v_ws, v_label, v_pos);
        v_made := v_made + 1;
      END IF;
    END LOOP;
    UPDATE public.buckets b SET area_id = a.id, group_label = a.name
    FROM public.areas a
    WHERE b.workspace_id = v_ws AND a.workspace_id = v_ws AND a.deleted_at IS NULL
      AND NOT b.is_system AND b.area_id IS NULL
      AND a.name = btrim(left(btrim(b.group_label), 80));
  END LOOP;
  RETURN v_made;
END;
$$;

ALTER TABLE public.buckets DISABLE TRIGGER USER;
SELECT public.tasks__backfill_areas(NULL);
ALTER TABLE public.buckets ENABLE TRIGGER USER;

-- The estimate starts as today's duration_minutes.
ALTER TABLE public.tasks DISABLE TRIGGER USER;
UPDATE public.tasks SET estimate_minutes = duration_minutes
WHERE duration_minutes IS NOT NULL AND estimate_minutes IS NULL;
ALTER TABLE public.tasks ENABLE TRIGGER USER;

-- Each workspace's time blocks become every member's own (owner included).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tb.workspace_id, u.user_id, public.tasks__clean_time_blocks(tb.workspace_id, tb.blocks, u.user_id) AS blocks
    FROM public.task_time_blocks tb
    JOIN LATERAL (
      SELECT w.owner_id AS user_id FROM public.workspaces w WHERE w.id = tb.workspace_id
      UNION
      SELECT m.user_id FROM public.workspace_members m WHERE m.workspace_id = tb.workspace_id
    ) u ON u.user_id IS NOT NULL
    WHERE tb.blocks <> '{}'::jsonb
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.user_id)
  LOOP
    IF r.blocks <> '{}'::jsonb THEN
      PERFORM public.tasks__put_time_blocks(r.user_id, r.workspace_id, r.blocks);
    END IF;
  END LOOP;
END;
$$;

-- ── 17. Grants ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal: only definer functions and triggers call these.
  FOREACH fn IN ARRAY ARRAY[
    'tasks__is_member(uuid, uuid)', 'tasks__guard_structure(uuid)', 'projects__guard(uuid, uuid)',
    'areas__find_or_create(uuid, text)', 'buckets__area_sync()', 'areas__mirror_labels()',
    'buckets__project_check()', 'tasks__section_check()',
    'tasks__clean_time_blocks(uuid, jsonb, uuid)', 'tasks__put_time_blocks(uuid, uuid, jsonb)',
    'areas__order(uuid)',
    'task_time_blocks__legacy()', 'areas__list(uuid)', 'areas__check_name(uuid, text, uuid)',
    'projects__end_position(uuid)', 'projects__apply_fields(public.buckets, jsonb)',
    'sections__list(uuid)', 'tasks__backfill_areas(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Pure helpers: they read only their arguments (tasks__estimate_sync is a
  -- trigger every writer of tasks fires).
  -- The areas policy calls this, so every reader needs it. It answers only
  -- for the caller (perm_actor_id), and says nothing but visible or not.
  REVOKE ALL ON FUNCTION public.areas__visible(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.areas__visible(uuid) TO authenticated, service_role;
  FOREACH fn IN ARRAY ARRAY[
    'tasks__reorder(uuid[], uuid, uuid)', 'tasks__clean_name(text, text, integer)',
    'tasks__patch_date(jsonb, text)', 'areas__check_color(jsonb)',
    'sections__check_dates(date, date)', 'tasks__estimate_sync()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  -- The ops.
  FOREACH fn IN ARRAY ARRAY[
    'areas_op_create(uuid, text, text)', 'areas_op_update(uuid, uuid, jsonb)',
    'areas_op_move(uuid, uuid, uuid)', 'areas_op_ensure(uuid, text)',
    'projects_op_create(uuid, jsonb)', 'projects_op_update(uuid, uuid, jsonb)',
    'projects_op_move(uuid, uuid, uuid, text)',
    'sections_op_create(uuid, uuid, jsonb)', 'sections_op_update(uuid, uuid, jsonb)',
    'sections_op_move(uuid, uuid, uuid)',
    'tasks_op_set_time_blocks(uuid, jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

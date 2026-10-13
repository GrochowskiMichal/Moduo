-- TV-U16 · A project's description, and archived projects as team defaults
-- (specs/tasks-v3.md §3 "Projects … description", REPLAN 16 and 78;
-- decisions in docs/decisions/tasks.md "TV-U16").
--
--   * buckets.description: the project's own text, plain, up to 20,000
--     characters ('' when there is none). The overview (the right panel's
--     Project view) shows and edits it. It is written through
--     projects_op_create / projects_op_update (keys `description`), which
--     need Edit on the project; a direct write to the row keeps the
--     description that was there (buckets__description_guard, the Time &
--     region pattern). A project template
--     and "Duplicate project…" now carry it (TV-D15's body already had the
--     key, always empty until now).
--   * A team's default project is never an archived one: naming one is
--     refused, and a default archived after it was named counts as none when
--     a task is routed to the team (it asks for a project instead of filing
--     into a read-only one). Unarchiving it makes it the default again.
--
-- Redefines, each re-cut from its live body: projects__apply_fields,
-- projects_op_update, projects_op_create (TV-D10, TV-U6),
-- project_templates__body_of and project_templates__apply_body (TV-D15),
-- teams__check_project and teams__route_project (TV-D13). CREATE OR REPLACE
-- keeps every grant. Adds one trigger (buckets_description_guard); no new
-- table or policy. The column needs no
-- erasure step (it is the project's, and goes wherever the project goes) and
-- the full export reads buckets whole. Verified on the local stack by
-- supabase/tests/project_overview.test.sql.

DO $$
BEGIN
  IF to_regprocedure('public.projects__apply_fields(public.buckets, jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'buckets' AND column_name = 'archived_at') THEN
    RAISE EXCEPTION 'Apply TV-D10 and TV-U6 (20261011100000_projects_archive_trash) before this migration.';
  END IF;
  IF to_regprocedure('public.project_templates__body_of(uuid, uuid)') IS NULL
     OR to_regprocedure('public.project_templates__apply_body(uuid, jsonb, jsonb, boolean)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D15 (20261013160000_templates) before this migration.';
  END IF;
  IF to_regprocedure('public.teams__route_project(uuid, uuid)') IS NULL
     OR to_regprocedure('public.teams__check_project(uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply TV-D13 (20261013150000_teams_routing) before this migration.';
  END IF;
END;
$$;

ALTER TABLE public.buckets ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.buckets DROP CONSTRAINT IF EXISTS buckets_description_length;
ALTER TABLE public.buckets ADD CONSTRAINT buckets_description_length
  CHECK (char_length(description) <= 20000);

-- Only the ops write it. The project policy lets an editor write the row
-- directly (an old build's rename does); a direct write from the app's roles
-- keeps the description that was there (a new row starts with none). The ops
-- run as their owner, so they pass, after their own checks (Edit on the
-- project, the length).
CREATE OR REPLACE FUNCTION public.buckets__description_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.description := '';
  ELSE
    NEW.description := OLD.description;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS buckets_description_guard ON public.buckets;
CREATE TRIGGER buckets_description_guard
  BEFORE INSERT OR UPDATE OF description ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.buckets__description_guard();

REVOKE ALL ON FUNCTION public.buckets__description_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buckets__description_guard() FROM anon;
REVOKE ALL ON FUNCTION public.buckets__description_guard() FROM authenticated;

-- ── projects__apply_fields (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.projects__apply_fields(b buckets, p_fields jsonb)
 RETURNS buckets
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- TV-U16: the project's description (plain text; null clears it).
  IF p_fields ? 'description' THEN
    IF jsonb_typeof(p_fields -> 'description') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'A project''s description is text.' USING ERRCODE = '22023';
    END IF;
    b.description := rtrim(coalesce(p_fields ->> 'description', ''));
    IF char_length(b.description) > 20000 THEN
      RAISE EXCEPTION 'A project''s description can be up to 20,000 characters.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN b;
END;
$function$;

-- ── projects_op_update (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.projects_op_update(p_workspace_id uuid, p_project_id uuid, p_patch jsonb)
 RETURNS buckets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b public.buckets;
  n public.buckets;
BEGIN
  PERFORM public.tasks__check_keys(p_patch, ARRAY[
    'name', 'status', 'starts_on', 'target_on', 'lead_id', 'client_contact_id', 'area_id', 'position',
    'color', 'archived_at', 'description']);
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
         n.color, n.archived_at, n.description)
     IS NOT DISTINCT FROM
     row(b.name, b.status, b.starts_on, b.target_on, b.lead_id, b.client_contact_id, b.area_id, b.position,
         b.color, b.archived_at, b.description) THEN
    RETURN b;
  END IF;
  UPDATE public.buckets SET
    name = n.name, status = n.status, starts_on = n.starts_on, target_on = n.target_on,
    lead_id = n.lead_id, client_contact_id = n.client_contact_id, area_id = n.area_id,
    position = n.position, color = n.color, archived_at = n.archived_at, description = n.description,
    updated_at = now()
  WHERE id = b.id
  RETURNING * INTO b;
  RETURN b;
END;
$function$;

-- ── projects_op_create (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.projects_op_create(p_workspace_id uuid, p_project jsonb)
 RETURNS buckets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
  b public.buckets;
  v_id uuid;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(p_project, ARRAY[
    'id', 'name', 'position', 'area_id', 'status', 'starts_on', 'target_on', 'lead_id',
    'client_contact_id', 'color', 'description']);
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
  b.description := '';
  b := public.projects__apply_fields(b, p_project || jsonb_build_object('name', coalesce(p_project ->> 'name', '')));
  IF nullif(b.position, '') IS NULL THEN
    b.position := public.projects__end_position(p_workspace_id);
  END IF;

  -- perm_enforce_write checks the role; the triggers check the lead, the
  -- client and the area, and set group_label.
  INSERT INTO public.buckets (
    id, workspace_id, owner_id, name, is_system, position, status, starts_on, target_on,
    lead_id, client_contact_id, area_id, color, description, created_at, updated_at)
  VALUES (
    b.id, b.workspace_id, b.owner_id, b.name, false, b.position, b.status, b.starts_on, b.target_on,
    b.lead_id, b.client_contact_id, b.area_id, b.color, b.description, now(), now())
  RETURNING * INTO b;
  RETURN b;
END;
$function$;

-- ── project_templates__body_of (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.project_templates__body_of(p_project_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        AND x.status_category IN ('backlog', 'todo', 'in_progress')
        AND public.tasks__visible_to(x.id, p_actor)) > 2000 THEN
    RAISE EXCEPTION 'A project with more than 2,000 open tasks can''t be copied.' USING ERRCODE = '22023';
  END IF;
  -- Only tasks the reader can see: a hidden one never reaches a body.
  WITH k AS (
    SELECT x.id, x.parent_id, x.position, x.created_at FROM public.tasks x
    WHERE x.bucket_id = b.id AND x.deleted_at IS NULL
      AND x.status_category IN ('backlog', 'todo', 'in_progress')
      AND public.tasks__visible_to(x.id, p_actor))
  SELECT coalesce(array_agg(k.id ORDER BY k.position COLLATE "C", k.created_at, k.id), '{}') INTO v_top
  FROM k
  WHERE k.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM k p WHERE p.id = k.parent_id);
  SELECT coalesce(array_agg(x.id ORDER BY array_position(v_top, x.parent_id), x.position COLLATE "C", x.created_at, x.id), '{}')
    INTO v_sub
  FROM public.tasks x
  WHERE x.parent_id = ANY (v_top) AND x.bucket_id = b.id AND x.deleted_at IS NULL
    AND x.status_category IN ('backlog', 'todo', 'in_progress')
    AND public.tasks__visible_to(x.id, p_actor);
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
    'description', b.description,
    'color', b.color,
    'starts', public.templates__offset(b.starts_on, v_anchor),
    'target', public.templates__offset(b.target_on, v_anchor),
    'statuses', v_statuses,
    'sections', v_sections,
    'tasks', v_tasks,
    'relations', v_relations);
END;
$function$;

-- ── project_templates__apply_body (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.project_templates__apply_body(p_workspace_id uuid, p_body jsonb, p_fields jsonb, p_private boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Whoever calls (an op, or the server for another workspace) writes as a
  -- person who can add projects there.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A project needs an owner.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id) THEN
    RAISE EXCEPTION 'You don''t have edit access to Tasks in this workspace.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.templates__check_body('project', p_body);
  PERFORM public.tasks__check_keys(p_fields, ARRAY['id', 'name', 'starts_on', 'area_id', 'keep_people']);
  -- Always a new project: never into one that's there.
  IF EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = public.tasks__try_uuid(p_fields ->> 'id')) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;

  v_project := jsonb_build_object(
    'name', coalesce(nullif(btrim(coalesce(p_fields ->> 'name', '')), ''), p_body ->> 'name'),
    'color', p_body -> 'color');
  -- TV-U16: the body's description becomes the new project's.
  IF nullif(btrim(coalesce(p_body ->> 'description', '')), '') IS NOT NULL THEN
    v_project := v_project || jsonb_build_object('description', p_body ->> 'description');
  END IF;
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
$function$;

-- ── teams__check_project (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.teams__check_project(p_workspace_id uuid, p_project jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     OR NOT public.projects__editable(v) THEN
    RAISE EXCEPTION 'That project isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  -- TV-U16: nor can an archived one (its tasks are read-only).
  IF EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = v AND b.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'That project is archived. Pick a live one, or unarchive it first.'
      USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$function$;

-- ── teams__route_project (re-cut from its live body) ──
CREATE OR REPLACE FUNCTION public.teams__route_project(p_workspace_id uuid, p_team_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_project uuid;
BEGIN
  SELECT b.id INTO v_project
  FROM public.teams x
  JOIN public.buckets b ON b.id = x.default_project_id
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL
    AND b.deleted_at IS NULL AND b.archived_at IS NULL AND NOT b.is_system;
  IF NOT EXISTS (SELECT 1 FROM public.teams x
                 WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'That team isn''t in this workspace.' USING ERRCODE = '22023';
  END IF;
  IF v_project IS NULL
     OR (public.perm_actor_id() IS NOT NULL AND NOT public.projects__editable(v_project)) THEN
    RAISE EXCEPTION 'A task for a team needs a project. Pick one, or give the team a default project.'
      USING ERRCODE = '22023';
  END IF;
  RETURN v_project;
END;
$function$;


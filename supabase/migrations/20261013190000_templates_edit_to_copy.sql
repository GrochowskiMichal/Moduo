-- TV-D15 follow-up · Copying needs Edit on the source (D15-11; an agent's
-- choice, deferred to by Maciej, 2026-10-13).
--
-- "Duplicate project…" and "Save as template" (a project's or a task's, even
-- one kept for yourself) now need Edit on what they copy, not just sight of
-- it: a copy is its maker's, and a copy made from view-only access could later
-- be shared to people the source never reached. A task template takes only
-- the subtasks its maker can edit. Using a template that's shared with you is
-- unchanged (it needs Tasks edit in the workspace, as any new task does).
--
-- Re-cut from the live bodies of 20261013160000_templates.sql (only the
-- checks below change), plus `templates_can_copy`, the app's question before
-- it offers a copy. Re-runnable.

-- ── 1. A task template takes only the subtasks its maker can edit ──────────

CREATE OR REPLACE FUNCTION public.task_templates__body_of(p_task_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    WHERE x.parent_id = r.id AND x.deleted_at IS NULL AND public.tasks__editable_to(x.id, p_actor)
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
$function$;

-- ── 2. Duplicate project… needs Edit on the project ───────────────────────

CREATE OR REPLACE FUNCTION public.projects_op_duplicate(p_workspace_id uuid, p_project_id uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Copying needs Edit on the source (D15-11).
  IF NOT public.projects__editable_to(b.id, v_actor) THEN
    RAISE EXCEPTION 'You need edit access to this project to copy it.' USING ERRCODE = '42501';
  END IF;
  v_id := public.tasks__try_uuid(v_fields ->> 'id');
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.buckets x WHERE x.id = v_id) THEN
    -- A resend of a duplicate that landed: only a project this person made.
    IF NOT EXISTS (SELECT 1 FROM public.buckets x
                   WHERE x.id = v_id AND x.workspace_id = p_workspace_id AND x.owner_id = v_actor
                     AND NOT x.is_system AND x.deleted_at IS NULL) THEN
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
$function$;

-- ── 3. Save as template needs Edit on the project or task ────────────────

CREATE OR REPLACE FUNCTION public.project_templates_op_save(p_workspace_id uuid, p_project_id uuid, p_fields jsonb)
 RETURNS project_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Copying needs Edit on the source (D15-11).
  IF NOT public.projects__editable_to(b.id, v_actor) THEN
    RAISE EXCEPTION 'You need edit access to this project to copy it.' USING ERRCODE = '42501';
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
                                       shareable, source_ids, body, summary)
  VALUES (v_id, p_workspace_id, v_actor,
          public.tasks__clean_name(coalesce(nullif(btrim(coalesce(p_fields ->> 'name', '')), ''), b.name), 'A template', 120),
          false, NOT public.templates__workspace_sees(b.id),
          public.templates__sources_full('project', ARRAY[b.id], v_actor), ARRAY[b.id],
          v_body, public.templates__summary(v_body))
  RETURNING * INTO x;
  RETURN x;
END;
$function$;

CREATE OR REPLACE FUNCTION public.task_templates_op_save(p_workspace_id uuid, p_task_id uuid, p_fields jsonb)
 RETURNS task_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
  r public.tasks;
  v_id uuid;
  v_body jsonb;
  v_sources uuid[];
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
  -- Copying needs Edit on the source (D15-11).
  IF NOT public.tasks__editable_to(r.id, v_actor) THEN
    RAISE EXCEPTION 'You need edit access to this task to save it as a template.' USING ERRCODE = '42501';
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
  -- What it copied: the task and the subtasks this person can see.
  v_sources := ARRAY[r.id] || coalesce((
    SELECT array_agg(y.id ORDER BY y.id) FROM public.tasks y
    WHERE y.parent_id = r.id AND y.deleted_at IS NULL AND public.tasks__editable_to(y.id, v_actor)), '{}');
  INSERT INTO public.task_templates (id, workspace_id, owner_id, name, shared, private_source,
                                    shareable, source_ids, body, summary)
  VALUES (v_id, p_workspace_id, v_actor,
          public.tasks__clean_name(coalesce(nullif(btrim(coalesce(p_fields ->> 'name', '')), ''),
                                            left(btrim(r.title), 120)), 'A template', 120),
          false, NOT public.templates__workspace_sees(r.bucket_id),
          public.templates__sources_full('task', v_sources, v_actor), v_sources,
          v_body, public.templates__summary(v_body))
  RETURNING * INTO x;
  RETURN x;
END;
$function$;

-- ── 4. The app's question ─────────────────────────────────────────────────

-- May the caller copy this project or task (Duplicate, Save as template)?
-- Answers only for the caller; hidden and missing read as no.
CREATE OR REPLACE FUNCTION public.templates_can_copy(p_kind text, p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_kind
    WHEN 'project' THEN EXISTS (SELECT 1 FROM public.buckets b
                                WHERE b.id = p_id AND b.deleted_at IS NULL AND NOT b.is_system)
                        AND public.projects__visible_to(p_id, public.perm_actor_id())
                        AND public.projects__editable_to(p_id, public.perm_actor_id())
    WHEN 'task' THEN EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = p_id AND t.deleted_at IS NULL)
                     AND public.tasks__editable_to(p_id, public.perm_actor_id())
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.templates_can_copy(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.templates_can_copy(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.templates_can_copy(text, uuid) TO authenticated, service_role;

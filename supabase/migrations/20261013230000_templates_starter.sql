-- TV-U17 · Starter templates for the role question (specs/tasks-v3.md §16,
-- REPLAN 34: the role "sets defaults only: preset, first view, seeded views,
-- three teaching tasks, a starter template").
--
-- A starter template is a project template Moduo ships: Project kickoff (a
-- PM), Monthly close (a founder or ops), Client onboarding (client work) and
-- Episode (a creator). D15's only way in was "Save as template" from a live
-- project, so this adds one op:
--
--   project_templates_op_starter(workspace, {id, starter})
--
-- The app names a starter by its key (STARTER_TEMPLATES in @contracts) and
-- the server builds the body itself (`templates__starter_body`), so no body
-- the client wrote is ever stored. The body names no people, teams, tags,
-- links or projects, only titles, sections, statuses and day offsets, and it
-- still goes through D15's `templates__check_body`. The template is the
-- caller's own and private; with no source it can't be shared
-- (`templates_op_update` re-checks Full on the sources and there are none;
-- `shareable` is false). Applying one is D15's op, unchanged. A resend with
-- the same id answers with the row it made. It needs Tasks edit in the
-- workspace, and API keys can't call it (the app makes these). Erasure and
-- the export already cover `project_templates` (D15).

-- One task of a starter: a title, its section, its parent (a position
-- earlier in the list) and its due day counted from the project's start.
CREATE OR REPLACE FUNCTION public.templates__starter_task(
  p_title text, p_section integer, p_parent integer, p_due integer, p_status integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'title', p_title, 'description', '', 'parent', p_parent, 'status', p_status,
    'section', p_section, 'position', NULL, 'priority', NULL, 'energy', NULL, 'estimate', NULL,
    'due', p_due, 'due_time', NULL, 'assignee', NULL, 'team', NULL,
    'tags', '[]'::jsonb, 'links', '[]'::jsonb)
$$;

-- The body of each starter, or null for a key Moduo doesn't ship.
CREATE OR REPLACE FUNCTION public.templates__starter_body(p_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_key = 'kickoff' THEN
    RETURN jsonb_build_object(
      'v', 1, 'kind', 'project', 'name', 'Project kickoff',
      'description', 'Get a new project going: agree the goal and the people, run the kickoff, then plan the first milestone.',
      'color', NULL, 'starts', 0, 'target', 14, 'statuses', '[]'::jsonb,
      'sections', jsonb_build_array(
        jsonb_build_object('name', 'Prepare', 'starts', 0, 'ends', 4),
        jsonb_build_object('name', 'Kick off', 'starts', 5, 'ends', 7),
        jsonb_build_object('name', 'First milestone', 'starts', 8, 'ends', 14)),
      'tasks', jsonb_build_array(
        public.templates__starter_task('Write a one-page brief', 0, NULL, 2),
        public.templates__starter_task('Agree the goal and what’s out of scope', 0, NULL, 3),
        public.templates__starter_task('List who’s involved and who decides', 0, NULL, 4),
        public.templates__starter_task('Run the kickoff meeting', 1, NULL, 5),
        public.templates__starter_task('Send the agenda', 1, 3, 4),
        public.templates__starter_task('Share the notes and next steps', 1, 3, 6),
        public.templates__starter_task('Plan the first milestone’s tasks', 2, NULL, 8),
        public.templates__starter_task('Check in on progress', 2, NULL, 14)),
      'relations', '[]'::jsonb);
  ELSIF p_key = 'monthly_close' THEN
    RETURN jsonb_build_object(
      'v', 1, 'kind', 'project', 'name', 'Monthly close',
      'description', 'The end-of-month routine: money in and out, the month’s numbers, and what comes next.',
      'color', NULL, 'starts', 0, 'target', 5, 'statuses', '[]'::jsonb, 'sections', '[]'::jsonb,
      'tasks', jsonb_build_array(
        public.templates__starter_task('Reconcile the bank accounts', NULL, NULL, 1),
        public.templates__starter_task('Send and chase invoices', NULL, NULL, 1),
        public.templates__starter_task('Pay bills and payroll', NULL, NULL, 2),
        public.templates__starter_task('Review spending against the budget', NULL, NULL, 3),
        public.templates__starter_task('Update the month’s numbers', NULL, NULL, 4),
        public.templates__starter_task('Plan next month’s priorities', NULL, NULL, 5)),
      'relations', '[]'::jsonb);
  ELSIF p_key = 'client_onboarding' THEN
    RETURN jsonb_build_object(
      'v', 1, 'kind', 'project', 'name', 'Client onboarding',
      'description', 'Bring a new client on: the paperwork, a kickoff call and the first delivery.',
      'color', NULL, 'starts', 0, 'target', 10, 'statuses', '[]'::jsonb,
      'sections', jsonb_build_array(
        jsonb_build_object('name', 'Paperwork', 'starts', 0, 'ends', 3),
        jsonb_build_object('name', 'Kickoff', 'starts', 4, 'ends', 6),
        jsonb_build_object('name', 'First delivery', 'starts', 7, 'ends', 10)),
      'tasks', jsonb_build_array(
        public.templates__starter_task('Send the contract and the first invoice', 0, NULL, 1),
        public.templates__starter_task('Collect access and assets', 0, NULL, 3),
        public.templates__starter_task('Kickoff call', 1, NULL, 4),
        public.templates__starter_task('Share the agenda', 1, 2, 3),
        public.templates__starter_task('Send a recap', 1, 2, 5),
        public.templates__starter_task('Agree the first delivery date', 1, NULL, 5),
        public.templates__starter_task('Deliver the first piece of work', 2, NULL, 10)),
      'relations', '[]'::jsonb);
  ELSIF p_key = 'episode' THEN
    -- A creator's pipeline (AC7.1): Ideas (backlog) · Drafting · Editing ·
    -- Published; the categories it leaves out come from the workspace's set.
    RETURN jsonb_build_object(
      'v', 1, 'kind', 'project', 'name', 'Episode',
      'description', 'One episode from idea to published.',
      'color', NULL, 'starts', 0, 'target', 7,
      'statuses', jsonb_build_array(
        jsonb_build_object('category', 'backlog', 'name', 'Ideas', 'hidden', false),
        jsonb_build_object('category', 'todo', 'name', 'Planned', 'hidden', false),
        jsonb_build_object('category', 'in_progress', 'name', 'Drafting', 'hidden', false),
        jsonb_build_object('category', 'in_progress', 'name', 'Editing', 'hidden', false),
        jsonb_build_object('category', 'done', 'name', 'Published', 'hidden', false)),
      'sections', '[]'::jsonb,
      'tasks', jsonb_build_array(
        public.templates__starter_task('Outline the episode', NULL, NULL, 1, 1),
        public.templates__starter_task('Record', NULL, NULL, 3, 1),
        public.templates__starter_task('Edit', NULL, NULL, 5, 1),
        public.templates__starter_task('Write the title and description', NULL, NULL, 6, 1),
        public.templates__starter_task('Publish and share', NULL, NULL, 7, 1)),
      'relations', '[]'::jsonb);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.project_templates_op_starter(p_workspace_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_fields jsonb := coalesce(p_fields, '{}'::jsonb);
  v_key text := v_fields ->> 'starter';
  v_body jsonb;
  v_id uuid;
  x public.project_templates;
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Templates are changed in the app.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(v_fields, ARRAY['id', 'starter']);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'A template needs an owner.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_key, '') NOT IN ('kickoff', 'monthly_close', 'client_onboarding', 'episode') THEN
    RAISE EXCEPTION 'Moduo has no starter template called that.' USING ERRCODE = '22023';
  END IF;
  v_id := coalesce(public.tasks__try_uuid(v_fields ->> 'id'), gen_random_uuid());
  SELECT * INTO x FROM public.project_templates y WHERE y.id = v_id;
  IF FOUND THEN
    IF x.workspace_id IS DISTINCT FROM p_workspace_id OR x.owner_id IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'That template isn''t here any more.' USING ERRCODE = '22023';
    END IF;
    RETURN (to_jsonb(x) - 'source_ids') || jsonb_build_object('kind', 'project');
  END IF;
  v_body := public.templates__starter_body(v_key);
  PERFORM public.templates__check_body('project', v_body);
  INSERT INTO public.project_templates (id, workspace_id, owner_id, name, shared, private_source,
                                       shareable, source_ids, body, summary)
  VALUES (v_id, p_workspace_id, v_actor, v_body ->> 'name', false, false, false, '{}'::uuid[],
          v_body, public.templates__summary(v_body))
  RETURNING * INTO x;
  RETURN (to_jsonb(x) - 'source_ids') || jsonb_build_object('kind', 'project');
END;
$$;

REVOKE ALL ON FUNCTION public.templates__starter_task(text, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.templates__starter_task(text, integer, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.templates__starter_task(text, integer, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.templates__starter_task(text, integer, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.templates__starter_body(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.templates__starter_body(text) FROM anon;
REVOKE ALL ON FUNCTION public.templates__starter_body(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.templates__starter_body(text) TO service_role;
REVOKE ALL ON FUNCTION public.project_templates_op_starter(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_templates_op_starter(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.project_templates_op_starter(uuid, jsonb) TO authenticated, service_role;

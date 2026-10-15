-- MOD-141 (dogfood call #20) · Saved views keep a Project filter.
-- Re-cut from the live body of task_views__check_filters (20261013250000).
--
-- Filter gained a Project dimension where more than one project shows (All,
-- My tasks, Upcoming, Won't do and the views over them), and a view keeps it
-- like the other filters. A Project value is "none", "inbox" (each reader's
-- own Inbox, never anyone's Inbox id) or the id of a project of this same
-- workspace that the saver can see: a view never carries the id of a project
-- its maker couldn't open. Every refusal reads the same, as before.
--
-- Same signature, so CREATE OR REPLACE keeps the function's grants (service
-- role only); they're re-stated below anyway. Re-runnable.

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
    IF v_dim NOT IN ('assignee', 'creator', 'team', 'tag', 'project')
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
      -- The reader's own Inbox, whoever reads the view.
      IF v_dim = 'project' AND v_text = 'inbox' THEN
        CONTINUE;
      END IF;
      IF v_dim NOT IN ('assignee', 'creator', 'team', 'tag', 'project') THEN
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
            SELECT 1 FROM public.tags x WHERE x.id = v_id AND x.workspace_id = p_workspace_id))
         -- A project of this workspace (never an Inbox: that's "inbox") the
         -- saver can see.
         OR (v_dim = 'project' AND NOT (
            EXISTS (SELECT 1 FROM public.buckets b
                    WHERE b.id = v_id AND b.workspace_id = p_workspace_id AND NOT b.is_system)
            AND public.projects__visible_to(v_id, p_actor))) THEN
        RAISE EXCEPTION 'That filter can''t be saved in a view.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  RETURN p_filters;
END;
$$;

REVOKE ALL ON FUNCTION public.task_views__check_filters(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_views__check_filters(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.task_views__check_filters(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.task_views__check_filters(uuid, uuid, jsonb) TO service_role;

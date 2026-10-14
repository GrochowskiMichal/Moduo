-- TV-U8 follow-up · Saved views: who may change a view, made narrower.
-- Re-cut from the live body of task_views_op_update (20261013250000).
--
-- - Someone else's view: the workspace's owner or an admin may only take a
--   shared, live view they can see off the workspace (`{"shared": false}`).
--   Nothing else, not on a deleted view, and never a restore: a view its
--   maker deleted stays deleted.
-- - The maker: a change that puts a view in front of the workspace (sharing
--   it, or restoring a shared one) needs Tasks edit access and that the maker
--   still sees its project; changing what a shared view shows (its name,
--   filter or Display) needs Tasks edit access too.
-- Everything else is unchanged. Re-runnable.

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
  v_was_public boolean;
  v_is_public boolean;
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
  v_owner := r.id IS NOT NULL AND r.owner_id = v_actor;
  -- Someone else's view is there for you only while it's live, shared, and
  -- you may see it.
  IF r.id IS NULL
     OR (NOT v_owner
         AND NOT (r.deleted_at IS NULL
                  AND public.task_views__sees(p_workspace_id, r.owner_id, r.shared, r.project_id, v_actor))) THEN
    RAISE EXCEPTION 'That view isn''t here any more.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_owner THEN
    v_admin := public.perm_is_owner(p_workspace_id, v_actor)
            OR EXISTS (SELECT 1 FROM public.workspace_members m
                       WHERE m.workspace_id = p_workspace_id AND m.user_id = v_actor AND m.role = 'admin');
    -- The one thing anyone else may do: the workspace's owner or an admin
    -- takes it off the workspace.
    IF NOT v_admin
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_patch) k WHERE k <> 'shared')
       OR v_patch -> 'shared' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'Only the person who made a view can change it.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.task_views x SET shared = false
    WHERE x.id = r.id
    RETURNING to_jsonb(x) INTO v;
    RETURN v;
  END IF;

  v_name := CASE WHEN v_patch ? 'name' THEN public.tasks__clean_name(v_patch ->> 'name', 'A view', 80)
                 ELSE r.name END;
  v_filters := CASE WHEN v_patch ? 'filters' THEN public.task_views__check_filters(p_workspace_id, v_actor, v_patch -> 'filters')
                    ELSE r.filters END;
  v_display := CASE WHEN v_patch ? 'display' THEN public.task_views__check_display(v_patch -> 'display')
                    ELSE r.display END;
  v_shared := CASE WHEN v_patch ? 'shared' THEN (v_patch ->> 'shared')::boolean ELSE r.shared END;
  v_deleted := CASE WHEN NOT v_patch ? 'deleted' THEN r.deleted_at
                    WHEN (v_patch ->> 'deleted')::boolean THEN coalesce(r.deleted_at, now())
                    ELSE NULL END;
  v_was_public := r.shared AND r.deleted_at IS NULL;
  v_is_public := v_shared AND v_deleted IS NULL;
  -- Putting a view in front of the workspace (sharing it, or restoring a
  -- shared one) asks for edit access and that the maker still sees its
  -- project; so does changing what a shared view shows.
  IF v_is_public AND NOT v_was_public THEN
    PERFORM public.tasks__guard_structure(p_workspace_id);
    IF r.project_id IS NOT NULL AND NOT public.projects__visible_to(r.project_id, v_actor) THEN
      RAISE EXCEPTION 'That project isn''t here any more.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_is_public AND (v_patch ? 'name' OR v_patch ? 'filters' OR v_patch ? 'display') THEN
    PERFORM public.tasks__guard_structure(p_workspace_id);
  END IF;

  UPDATE public.task_views x
  SET name = v_name, filters = v_filters, display = v_display, shared = v_shared, deleted_at = v_deleted
  WHERE x.id = r.id
  RETURNING to_jsonb(x) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.task_views_op_update(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.task_views_op_update(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.task_views_op_update(uuid, uuid, jsonb) TO authenticated, service_role;

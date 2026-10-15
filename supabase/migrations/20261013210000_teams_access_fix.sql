-- TV-D13 follow-up · Who changes a team (specs/tasks-v3.md "Members → Teams";
-- default t; decisions in docs/decisions/tasks.md "TV-D13 follow-up").
--
--   * A team's name, letters and colour, and taking someone else out of it:
--     the team's creator, the workspace owner or an admin. Anyone who works
--     on tasks still makes teams and adds people to them (default t), and
--     anyone in a team can leave it.
--   * A team's default project: the new one must be a project the person can
--     edit (as before). Replacing or clearing one that's already set also
--     needs the creator, the owner or an admin, or Edit on the project it
--     names now; a default whose project is gone counts as none.
--   * Deleting and restoring a team: unchanged (creator, owner or admin).
--
-- Redefines only teams_op_update(uuid, uuid, jsonb) and
-- teams_op_remove_member(uuid, uuid, uuid), each re-cut from its live body
-- (TV-D10's 20261010182000, unchanged since). No tables, columns or triggers.
-- Verified on the local stack by supabase/tests/teams_access.test.sql.

CREATE OR REPLACE FUNCTION public.teams_op_update(p_workspace_id uuid, p_team_id uuid, p_patch jsonb)
RETURNS public.teams
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t public.teams;
  v_actor uuid := public.perm_actor_id();
  v_restore boolean;
  v_bypass text;
  v_manager boolean;
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  PERFORM public.tasks__check_keys(p_patch, ARRAY['name', 'mark', 'color', 'default_project_id', 'deleted_at']);
  PERFORM pg_advisory_xact_lock(hashtextextended('teams:' || p_workspace_id::text, 0));
  v_restore := p_patch ? 'deleted_at' AND jsonb_typeof(p_patch -> 'deleted_at') = 'null';
  SELECT * INTO t FROM public.teams x
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR (t.deleted_at IS NOT NULL AND NOT v_restore) THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = '22023';
  END IF;
  -- The team's creator, the workspace owner or an admin.
  v_manager := t.created_by IS NOT DISTINCT FROM v_actor
               OR public.perm_is_owner(p_workspace_id, v_actor)
               OR public.perm_user_has(p_workspace_id, v_actor, 'ws.manage_roles');
  IF p_patch ? 'deleted_at'
     AND (v_restore = (t.deleted_at IS NOT NULL))
     AND NOT v_manager THEN
    RAISE EXCEPTION 'Only the team''s creator, the workspace owner or an admin can delete a team.'
      USING ERRCODE = '42501';
  END IF;
  -- TV-D13 follow-up: so is its name, its letters and its colour.
  IF (p_patch ? 'name' OR p_patch ? 'mark' OR p_patch ? 'color') AND NOT v_manager THEN
    RAISE EXCEPTION 'Only the team''s creator, the workspace owner or an admin can change a team.'
      USING ERRCODE = '42501';
  END IF;
  -- Replacing or clearing a default that's set: the same people, or Edit on
  -- the project it names now. The new one is checked below (Edit on it).
  IF p_patch ? 'default_project_id' AND NOT v_manager
     AND EXISTS (SELECT 1 FROM public.buckets b
                 WHERE b.id = t.default_project_id AND b.deleted_at IS NULL AND NOT b.is_system)
     AND NOT public.projects__editable(t.default_project_id) THEN
    RAISE EXCEPTION 'Only the team''s creator, the workspace owner or an admin can change its default project.'
      USING ERRCODE = '42501';
  END IF;

  IF v_restore AND t.deleted_at IS NOT NULL THEN
    PERFORM public.teams__check_name(p_workspace_id, t.name, t.id);
    UPDATE public.teams SET deleted_at = NULL WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'name' THEN
    UPDATE public.teams SET name = public.teams__check_name(p_workspace_id, p_patch ->> 'name', t.id)
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'mark' THEN
    UPDATE public.teams SET mark = CASE
        WHEN nullif(btrim(coalesce(p_patch ->> 'mark', '')), '') IS NULL THEN public.teams__auto_mark(t.name)
        ELSE public.teams__check_mark(p_patch ->> 'mark') END
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'color' THEN
    UPDATE public.teams SET color = public.areas__check_color(p_patch -> 'color')
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'default_project_id' THEN
    UPDATE public.teams SET default_project_id = public.teams__check_project(p_workspace_id, p_patch -> 'default_project_id')
    WHERE id = t.id RETURNING * INTO t;
  END IF;
  IF p_patch ? 'deleted_at' AND NOT v_restore AND t.deleted_at IS NULL THEN
    UPDATE public.teams SET deleted_at = now() WHERE id = t.id RETURNING * INTO t;
    -- The delete's own consequence: system work.
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    UPDATE public.tasks x SET team_id = NULL, updated_at = now() WHERE x.team_id = t.id;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  END IF;
  RETURN t;
END;
$function$;

CREATE OR REPLACE FUNCTION public.teams_op_remove_member(p_workspace_id uuid, p_team_id uuid, p_user_id uuid)
RETURNS SETOF public.team_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t public.teams;
  v_actor uuid := public.perm_actor_id();
BEGIN
  PERFORM public.tasks__guard_structure(p_workspace_id);
  SELECT * INTO t FROM public.teams x
  WHERE x.id = p_team_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = '22023';
  END IF;
  -- TV-D13 follow-up: anyone can leave; taking someone else out is for the
  -- team's creator, the workspace owner or an admin.
  IF p_user_id IS DISTINCT FROM v_actor
     AND NOT (t.created_by IS NOT DISTINCT FROM v_actor
              OR public.perm_is_owner(p_workspace_id, v_actor)
              OR public.perm_user_has(p_workspace_id, v_actor, 'ws.manage_roles')) THEN
    RAISE EXCEPTION 'Only the team''s creator, the workspace owner or an admin can take someone else out of a team.'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.team_members m SET deleted_at = now()
  WHERE m.team_id = t.id AND m.user_id = p_user_id AND m.deleted_at IS NULL;
  RETURN QUERY SELECT * FROM public.teams__members_of(t.id);
END;
$function$;

-- Grants as before (CREATE OR REPLACE keeps them; restated for a fresh replay).
REVOKE ALL ON FUNCTION public.teams_op_update(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teams_op_remove_member(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teams_op_update(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teams_op_remove_member(uuid, uuid, uuid) TO authenticated, service_role;

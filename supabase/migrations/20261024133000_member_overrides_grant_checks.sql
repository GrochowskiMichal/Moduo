-- MOD-573 · A member's stored exceptions are checked as stored, and again
-- whenever a role change would switch them on.
--
-- workspace_op_set_member_access checked the grant rules (perm_can_grant, and
-- "only the owner gives member or role management") against the member's
-- resolved permissions, but stored the raw exceptions. perm_resolve drops
-- every non-view key under a read-only role, so a non-owner manager could
-- park ws.manage_members, ws.manage_roles, ws.api_keys or module write keys
-- on someone behind a read-only role. Editing that role (perm_roles_propagate
-- re-resolves its members) or deleting it (its members move to another role)
-- then switched them on, and perm_members_resolve checked grants on INSERT
-- only.
--
-- Two checks now:
--   * workspace_op_set_member_access runs the grant rules on the exceptions
--     that allow something (value true) as well as on the resolved set, so
--     nothing can be parked that the manager couldn't give outright;
--   * perm_members_resolve, on an UPDATE by a signed-in person, runs the same
--     rules on the permissions the change adds to that member. A role edit,
--     a role deletion or a reassignment that would hand out something the
--     person doing it couldn't give is refused as a whole. The owner passes;
--     so does system work (no auth.uid()), a member becoming the owner, and
--     the outgoing owner's own demotion in a transfer.
--
-- Verified on the local stack by supabase/tests/member_overrides_grants.test.sql.

CREATE OR REPLACE FUNCTION public.workspace_op_set_member_access(p_member_id uuid, p_role_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS workspace_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  m public.workspace_members;
  r public.workspace_roles;
  v_overrides jsonb := public.perm_validate_overrides(p_overrides);
  v_next text[];
  v_allowed text[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO m FROM public.workspace_members WHERE id = p_member_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Member not found.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = m.workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Workspace not found.';
  END IF;
  IF m.user_id = v_actor THEN
    RAISE EXCEPTION 'You can''t change your own access.';
  END IF;
  IF public.perm_is_owner(m.workspace_id, m.user_id) THEN
    RAISE EXCEPTION 'The owner always has full access. Transfer ownership to change it.';
  END IF;
  IF NOT public.perm_can_manage_member(m.workspace_id, v_actor, m.user_id) THEN
    RAISE EXCEPTION 'You can''t manage this person''s access.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.workspace_roles WHERE id = coalesce(p_role_id, m.role_id);
  IF r.id IS NULL OR r.workspace_id <> m.workspace_id THEN
    RAISE EXCEPTION 'That role doesn''t belong to this workspace.';
  END IF;

  v_next := public.perm_resolve(r.permissions, r.read_only, v_overrides);
  -- MOD-573: the exceptions are stored as given, so the allowing ones are
  -- checked as given too, not only what this role lets through today.
  v_allowed := ARRAY(SELECT e.key FROM jsonb_each(v_overrides) e
                     WHERE jsonb_typeof(e.value) = 'boolean' AND e.value::text = 'true');
  IF NOT public.perm_can_grant(m.workspace_id, v_actor, v_next || v_allowed) THEN
    RAISE EXCEPTION 'You can''t give someone permissions you don''t have.' USING ERRCODE = '42501';
  END IF;
  -- Granting management powers stays with the owner.
  IF NOT public.perm_is_owner(m.workspace_id, v_actor)
     AND ((v_next || v_allowed) && ARRAY['ws.manage_members', 'ws.manage_roles']) THEN
    RAISE EXCEPTION 'Only the owner can give someone member or role management.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspace_members
     SET role_id = r.id, overrides = v_overrides
   WHERE id = m.id
   RETURNING * INTO m;
  RETURN m;
END;
$function$;


CREATE OR REPLACE FUNCTION public.perm_members_resolve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.workspace_roles;
  v_is_owner boolean;
  v_role_changed boolean;
  v_added text[];
BEGIN
  -- Ownership comes only from workspaces.owner_id — never from the role text
  -- (a written 'owner' must not mint an unremovable super-admin).
  v_is_owner := EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.owner_id = NEW.user_id);

  IF TG_OP = 'INSERT' THEN
    v_role_changed := NEW.role_id IS NOT NULL;
  ELSE
    v_role_changed := NEW.role_id IS DISTINCT FROM OLD.role_id;
  END IF;

  -- A tier text written without a role id (legacy clients, transfer ownership,
  -- invite acceptance from an old row) picks the matching system role.
  IF NEW.role_id IS NULL OR (NOT v_role_changed AND TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role) THEN
    NEW.role_id := public.perm_system_role_id(NEW.workspace_id, NEW.role);
  END IF;

  SELECT * INTO r FROM public.workspace_roles WHERE id = NEW.role_id;
  IF r.id IS NULL OR r.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'That role doesn''t belong to this workspace.';
  END IF;

  IF jsonb_typeof(coalesce(NEW.overrides, '{}'::jsonb)) <> 'object' THEN
    NEW.overrides := '{}'::jsonb;
  END IF;

  IF v_is_owner THEN
    NEW.role := 'owner';
  ELSE
    NEW.role := public.perm_role_tier(r);
  END IF;
  NEW.perms := public.perm_resolve(r.permissions, r.read_only, NEW.overrides);
  -- Keep the legacy lanes truthful for clients that still read them (desktop
  -- builds ≤ 1.0.9 gate their nav on these two columns).
  NEW.permissions_notes := CASE
    WHEN NEW.perms && ARRAY['notes.create','notes.edit','notes.delete'] THEN 'write'
    WHEN 'notes.view' = ANY (NEW.perms) THEN 'read' ELSE 'none' END;
  NEW.permissions_tasks := CASE
    WHEN NEW.perms && ARRAY['tasks.create','tasks.edit','tasks.delete'] THEN 'write'
    WHEN 'tasks.view' = ANY (NEW.perms) THEN 'read' ELSE 'none' END;
  IF v_is_owner THEN
    NEW.permissions_notes := 'write';
    NEW.permissions_tasks := 'write';
  END IF;

  -- A direct insert of SOMEONE ELSE's row (the legacy insert policy) can't hand
  -- out more than the inserter holds. Definer ops insert the caller's own row
  -- (accept invite, ownership hand-off) and pass through.
  IF TG_OP = 'INSERT' AND NOT v_is_owner AND auth.uid() IS NOT NULL AND auth.uid() <> NEW.user_id
     AND (NOT public.perm_can_grant(NEW.workspace_id, auth.uid(), NEW.perms)
          OR (NOT public.perm_is_owner(NEW.workspace_id, auth.uid())
              AND NEW.perms && ARRAY['ws.manage_members', 'ws.manage_roles'])) THEN
    RAISE EXCEPTION 'You can''t give someone permissions you don''t have.' USING ERRCODE = '42501';
  END IF;
  -- MOD-573: a change that adds permissions to a member (a role edit or
  -- deletion switching on stored exceptions, a reassignment) is held to the
  -- same rules for whoever makes it. The outgoing owner's own demotion in a
  -- transfer is the owner's act and passes.
  IF TG_OP = 'UPDATE' AND NOT v_is_owner AND auth.uid() IS NOT NULL
     AND OLD.role IS DISTINCT FROM 'owner'
     AND NOT public.perm_is_owner(NEW.workspace_id, auth.uid()) THEN
    v_added := ARRAY(SELECT k FROM unnest(NEW.perms) k
                     WHERE NOT k = ANY (coalesce(OLD.perms, '{}'::text[])));
    IF cardinality(v_added) > 0
       AND (NOT public.perm_can_grant(NEW.workspace_id, auth.uid(), v_added)
            OR v_added && ARRAY['ws.manage_members', 'ws.manage_roles']) THEN
      RAISE EXCEPTION 'Only the owner can do this: it would give someone permissions you can''t give.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.perm_members_resolve() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.workspace_op_set_member_access(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_set_member_access(uuid, uuid, jsonb) TO authenticated, service_role;



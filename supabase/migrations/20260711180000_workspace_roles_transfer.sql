-- Owner/admin role hierarchy + transfer ownership (follow-up to DF-24).
--
-- Hierarchy: owner > admin > editor(member) > viewer.
--   - The owner manages everyone below (incl. admins) and can hand off ownership.
--   - An admin manages ONLY members below admin (editor/viewer): can't remove,
--     demote, or promote another admin, and can't grant the admin role.
--   - The owner is never removed/role-changed through these ops (hands off via
--     transfer-ownership); no one manages themselves here.
--
-- All three are SECURITY DEFINER: the base workspace_members write-RLS is
-- own-row, so managing another member (and rewriting workspaces.owner_id) can't
-- be a client-direct write. `member` is the DB spelling of the app's `editor`.

-- ── remove-member: add the "admin can't remove an admin" rule ──────────────────
CREATE OR REPLACE FUNCTION public.workspace_op_remove_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_target_user  uuid;
  v_target_role  text;
  v_is_owner     boolean;
  v_is_admin     boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT m.workspace_id, m.user_id, m.role::text
    INTO v_workspace_id, v_target_user, v_target_role
    FROM public.workspace_members m
   WHERE m.id = p_member_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  -- Defense-in-depth: never act on a soft-deleted workspace (the owner checks
  -- already require deleted_at IS NULL; this covers the admin branch too).
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found';
  END IF;

  v_is_owner := EXISTS (
    SELECT 1 FROM public.workspaces w
     WHERE w.id = v_workspace_id AND w.owner_id = v_caller AND w.deleted_at IS NULL
  );
  v_is_admin := EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = v_workspace_id AND m.user_id = v_caller AND m.role::text = 'admin'
  );

  IF NOT (v_is_owner OR v_is_admin) THEN
    RAISE EXCEPTION 'only workspace owners and admins can remove members';
  END IF;

  IF v_target_role = 'owner'
     OR v_target_user = (SELECT owner_id FROM public.workspaces WHERE id = v_workspace_id) THEN
    RAISE EXCEPTION 'cannot remove the workspace owner';
  END IF;

  IF v_target_user = v_caller THEN
    RAISE EXCEPTION 'use leave to remove yourself';
  END IF;

  -- Only the owner may remove an admin.
  IF v_target_role = 'admin' AND NOT v_is_owner THEN
    RAISE EXCEPTION 'only the workspace owner can remove an admin';
  END IF;

  DELETE FROM public.workspace_members WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_op_remove_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_op_remove_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_remove_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_op_remove_member(uuid) TO service_role;

-- ── set-member-role: role + module permissions, hierarchy-enforced ─────────────
-- Accepts the DB vocabulary (role ∈ {admin,member,viewer}; perm ∈ {read,write,none}).
CREATE OR REPLACE FUNCTION public.workspace_op_set_member_role(
  p_member_id  uuid,
  p_role       text,
  p_perm_notes text DEFAULT 'write',
  p_perm_tasks text DEFAULT 'write'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_target_user  uuid;
  v_target_role  text;
  v_is_owner     boolean;
  v_is_admin     boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_role NOT IN ('admin', 'member', 'viewer') THEN
    RAISE EXCEPTION 'invalid role %', p_role;
  END IF;

  SELECT m.workspace_id, m.user_id, m.role::text
    INTO v_workspace_id, v_target_user, v_target_role
    FROM public.workspace_members m
   WHERE m.id = p_member_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  -- Defense-in-depth: never act on a soft-deleted workspace (the owner checks
  -- already require deleted_at IS NULL; this covers the admin branch too).
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found';
  END IF;

  v_is_owner := EXISTS (
    SELECT 1 FROM public.workspaces w
     WHERE w.id = v_workspace_id AND w.owner_id = v_caller AND w.deleted_at IS NULL
  );
  v_is_admin := EXISTS (
    SELECT 1 FROM public.workspace_members m
     WHERE m.workspace_id = v_workspace_id AND m.user_id = v_caller AND m.role::text = 'admin'
  );

  IF NOT (v_is_owner OR v_is_admin) THEN
    RAISE EXCEPTION 'only workspace owners and admins can change roles';
  END IF;

  IF v_target_role = 'owner'
     OR v_target_user = (SELECT owner_id FROM public.workspaces WHERE id = v_workspace_id) THEN
    RAISE EXCEPTION 'cannot change the owner''s role — transfer ownership instead';
  END IF;

  IF v_target_user = v_caller THEN
    RAISE EXCEPTION 'you cannot change your own role';
  END IF;

  -- Admins may only manage members below admin, and may not grant admin.
  IF NOT v_is_owner THEN
    IF v_target_role = 'admin' THEN
      RAISE EXCEPTION 'only the workspace owner can manage admins';
    END IF;
    IF p_role = 'admin' THEN
      RAISE EXCEPTION 'only the workspace owner can grant the admin role';
    END IF;
  END IF;

  UPDATE public.workspace_members
     SET role = p_role,
         permissions_notes = p_perm_notes,
         permissions_tasks = p_perm_tasks
   WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_op_set_member_role(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_op_set_member_role(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_set_member_role(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_op_set_member_role(uuid, text, text, text) TO service_role;

-- ── transfer-ownership: owner hands off to an existing member ───────────────────
-- Sets workspaces.owner_id, promotes the target to owner, demotes the old owner
-- to admin (so they keep management access and aren't stranded). Needed by the
-- account-deletion flow: an owner must hand off before deleting their account.
CREATE OR REPLACE FUNCTION public.workspace_op_transfer_ownership(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_workspace_id uuid;
  v_target_user  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT m.workspace_id, m.user_id
    INTO v_workspace_id, v_target_user
    FROM public.workspace_members m
   WHERE m.id = p_member_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  -- Defense-in-depth: never act on a soft-deleted workspace (the owner checks
  -- already require deleted_at IS NULL; this covers the admin branch too).
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = v_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w
     WHERE w.id = v_workspace_id AND w.owner_id = v_caller AND w.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'only the workspace owner can transfer ownership';
  END IF;

  IF v_target_user = v_caller THEN
    RAISE EXCEPTION 'you already own this workspace';
  END IF;

  UPDATE public.workspaces SET owner_id = v_target_user WHERE id = v_workspace_id;
  UPDATE public.workspace_members SET role = 'owner' WHERE id = p_member_id;
  -- Demote the old owner to admin. UPSERT, not UPDATE: a `trg_workspaces_add_owner_member`
  -- trigger backfills the owner's membership today, but if that ever changes an
  -- owner-creator could lack a member row and a bare UPDATE would silently strand
  -- them (0 rows) after handing off. The (workspace_id,user_id) unique key backs it.
  INSERT INTO public.workspace_members (workspace_id, user_id, role, permissions_notes, permissions_tasks)
  VALUES (v_workspace_id, v_caller, 'admin', 'write', 'write')
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_op_transfer_ownership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_op_transfer_ownership(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_transfer_ownership(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_op_transfer_ownership(uuid) TO service_role;

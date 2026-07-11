-- DF-24 — remove-member op for the workspace membership loop.
--
-- The base `workspace_members` write-RLS is own-row (that's why `leave` — a
-- self-DELETE — works client-direct, and the `paid_plan_required_to_add_member`
-- INSERT policy's first branch is `user_id = auth.uid()`). Ejecting *another*
-- member is therefore not expressible as a client DELETE; it needs a
-- SECURITY DEFINER op that encodes the authorization explicitly, matching the
-- workspace's other owner-scoped ops (workspace_api_keys_revoke, the *_op_*
-- guards).
--
-- Rules: the caller must be the workspace owner OR an active admin member; the
-- target may not be an owner (owners transfer/delete, they aren't ejected); and
-- self-removal is refused (that path is `leave`, so the last-workspace guard in
-- the UI stays the single source of truth for "never strand at zero").

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
  v_can_manage   boolean;
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

  -- Owner of the (live) workspace, or an admin member of it.
  SELECT
    EXISTS (
      SELECT 1 FROM public.workspaces w
       WHERE w.id = v_workspace_id
         AND w.owner_id = v_caller
         AND w.deleted_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = v_workspace_id
         AND m.user_id = v_caller
         AND m.role::text = 'admin'
    )
  INTO v_can_manage;

  IF NOT v_can_manage THEN
    RAISE EXCEPTION 'only workspace owners and admins can remove members';
  END IF;

  -- Never eject the owner. Check BOTH the membership role AND the authoritative
  -- `workspaces.owner_id` — an admin must not be able to hard-delete the real
  -- owner's row even if that row's role string ever drifts from "owner".
  IF v_target_role = 'owner'
     OR v_target_user = (SELECT owner_id FROM public.workspaces WHERE id = v_workspace_id) THEN
    RAISE EXCEPTION 'cannot remove the workspace owner';
  END IF;

  IF v_target_user = v_caller THEN
    RAISE EXCEPTION 'use leave to remove yourself';
  END IF;

  DELETE FROM public.workspace_members WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_op_remove_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_op_remove_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_op_remove_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_op_remove_member(uuid) TO service_role;

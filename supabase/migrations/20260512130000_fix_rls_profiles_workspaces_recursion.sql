-- Fix: infinite RLS recursion on workspaces INSERT
-- Chain: INSERT workspaces WITH CHECK -> SELECT plan_tier FROM profiles ->
--   profiles RLS includes profiles_select_workspace_members ->
--   EXISTS (SELECT FROM workspaces ...) -> workspaces RLS again -> recursion.
-- Solution: read plan_tier via SECURITY DEFINER (bypasses profiles RLS).

CREATE OR REPLACE FUNCTION public.profile_plan_tier_text(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(plan_tier::text, 'free')
  FROM public.profiles
  WHERE id = p_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.profile_plan_tier_text(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_plan_tier_text(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_plan_tier_text(uuid) TO service_role;

DROP POLICY IF EXISTS free_users_max_one_workspace ON public.workspaces;
CREATE POLICY free_users_max_one_workspace ON public.workspaces
FOR INSERT
WITH CHECK (
  public.profile_plan_tier_text(auth.uid()) <> 'free'
  OR public.workspaces_owned_count_for_user(auth.uid()) = 0
);

DROP POLICY IF EXISTS paid_plan_required_to_invite ON public.workspace_invites;
CREATE POLICY paid_plan_required_to_invite ON public.workspace_invites
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_invites.workspace_id
      AND w.owner_id = auth.uid()
      AND w.deleted_at IS NULL
  )
  AND public.profile_plan_tier_text(auth.uid()) = ANY (ARRAY['pro', 'team', 'founder'])
);

DROP POLICY IF EXISTS paid_plan_required_to_add_member ON public.workspace_members;
CREATE POLICY paid_plan_required_to_add_member ON public.workspace_members
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
        AND w.deleted_at IS NULL
    )
    AND public.profile_plan_tier_text(auth.uid()) = ANY (ARRAY['pro', 'team', 'founder'])
  )
);

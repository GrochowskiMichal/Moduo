-- Fix: "infinite recursion detected in policy for relation workspaces"
-- The free_users_max_one_workspace INSERT policy used
--   SELECT count(*) FROM workspaces ...
-- which is evaluated with RLS and can recurse into workspaces policies again.
-- Count via SECURITY DEFINER so RLS is not applied to that inner scan.

CREATE OR REPLACE FUNCTION public.workspaces_owned_count_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT count(*)::int
  FROM public.workspaces
  WHERE owner_id = p_user_id
    AND deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.workspaces_owned_count_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspaces_owned_count_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspaces_owned_count_for_user(uuid) TO service_role;

DROP POLICY IF EXISTS free_users_max_one_workspace ON public.workspaces;

CREATE POLICY free_users_max_one_workspace ON public.workspaces
FOR INSERT
WITH CHECK (
  COALESCE(
    (SELECT plan_tier::text FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    'free'
  ) <> 'free'
  OR public.workspaces_owned_count_for_user(auth.uid()) = 0
);

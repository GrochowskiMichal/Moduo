-- MOD-66 · The plan helpers answer only about people the caller may know about.
--
-- profile_plan_tier_text, workspace_seat_cap and workspaces_owned_count_for_user
-- are SECURITY DEFINER, executable by signed-in people (RLS policies and the
-- workspace-create trigger call them under the caller's own role), and took any
-- user id: a signed-in person holding someone's uuid could read their plan tier,
-- seat cap (Stripe quantity) and how many workspaces they own.
--
-- Rule, applied in the body: the answer is real for
--   * the caller themself,
--   * the owner of a workspace the caller belongs to (seat caps and plan limits
--     are the workspace's own limits; every legitimate caller asks about the
--     workspace owner), and
--   * server code (no signed-in person: the service role, definer jobs).
-- Anyone else gets NULL. auth.uid() is the JWT's person even inside a definer
-- function, so the definer callers (chat, attachments limits) keep working.
-- workspaces_owned_count_for_user is only ever asked about the caller (RLS
-- policy: auth.uid(); trigger: NEW.owner_id, which SEC2 pins to the caller), so
-- it answers for the caller and server code only.
-- The free-plan trigger (workspaces__plan_limit) asks about NEW.owner_id, who is
-- not the caller on an ownership transfer, so the unscoped answers live in two
-- server-only helpers (plan__tier_of, plan__owned_count_of) that the trigger
-- and the scoped functions call.
-- Grants are unchanged and re-stated: `authenticated` keeps EXECUTE because the
-- policies run as the caller; `anon` stays out.

CREATE OR REPLACE FUNCTION public.plan__caller_may_ask_about(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NULL
      OR p_user_id = auth.uid()
      OR EXISTS (SELECT 1
                   FROM public.workspaces w
                   JOIN public.workspace_members m ON m.workspace_id = w.id
                  WHERE w.owner_id = p_user_id
                    AND m.user_id = auth.uid())
$$;

-- Unscoped answers, for server functions only (definer callers run as their
-- owner, so these need no client grant).
CREATE OR REPLACE FUNCTION public.plan__tier_of(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(plan_tier::text, 'free') FROM public.profiles WHERE id = p_user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.plan__owned_count_of(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int FROM public.workspaces WHERE owner_id = p_user_id AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.profile_plan_tier_text(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.plan__tier_of(p_user_id) WHERE public.plan__caller_may_ask_about(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.workspace_seat_cap(p_owner uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'stripe'
AS $$
  SELECT CASE public.plan__tier_of(p_owner)
    WHEN 'founder' THEN 1000000
    WHEN 'team' THEN COALESCE(
      (SELECT GREATEST((s.items->'data'->0->>'quantity')::int, 3)
         FROM public.profiles p JOIN stripe.subscriptions s ON s.id = p.stripe_subscription_id
        WHERE p.id = p_owner), 3)
    WHEN 'duo' THEN 2
    ELSE 1
  END
  WHERE public.plan__caller_may_ask_about(p_owner)
$$;

CREATE OR REPLACE FUNCTION public.workspaces_owned_count_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.plan__owned_count_of(p_user_id)
  WHERE auth.uid() IS NULL OR p_user_id = auth.uid();
$$;

-- The free-plan trigger, unchanged except it reads the unscoped helpers.
CREATE OR REPLACE FUNCTION public.workspaces__plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_live integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  -- An update counts when a live workspace gains an owner: a restore or a
  -- new owner_id.
  IF TG_OP = 'UPDATE' AND NOT (
    NEW.deleted_at IS NULL
    AND (OLD.deleted_at IS NOT NULL OR NEW.owner_id IS DISTINCT FROM OLD.owner_id)
  ) THEN
    RETURN NULL;
  END IF;
  IF COALESCE(public.plan__tier_of(NEW.owner_id), 'free') <> 'free' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workspaces_plan_limit:owner:' || NEW.owner_id::text, 0));
  SELECT public.plan__owned_count_of(NEW.owner_id) INTO v_live;
  IF v_live > 1 THEN
    IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'The new owner is on the free plan, which includes one workspace, and already owns one.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'The free plan includes one workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.plan__caller_may_ask_about(uuid), public.plan__tier_of(uuid),
  public.plan__owned_count_of(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan__caller_may_ask_about(uuid), public.plan__tier_of(uuid),
  public.plan__owned_count_of(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.workspaces__plan_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspaces__plan_limit() TO service_role;

REVOKE ALL ON FUNCTION public.profile_plan_tier_text(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspace_seat_cap(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspaces_owned_count_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_plan_tier_text(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_seat_cap(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspaces_owned_count_for_user(uuid) TO authenticated, service_role;

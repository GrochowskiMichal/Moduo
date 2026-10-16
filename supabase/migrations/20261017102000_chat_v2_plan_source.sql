-- Chat v2 · CV-4 plan source (specs/chat-v2.md block 4, Assumption #25;
-- .design/chat-v2/research/round-3-database.md §2.25 e; CH4a, CH25, CH67). The stamp is
-- provisional: re-cut on the day it applies, keeping chat's order (after CV-2a's and
-- CV-2b's files).
--
-- Chat is on in a workspace when its owner's plan includes chat (Duo, Team or Founder:
-- rank ≥ duo, as before) OR the workspace holds an active dated grant (a handed-out
-- Team workspace). The grant is read through one function its owner defines (the
-- hackathon plan, TX-9b):
--
--   public.plan_grant_effective_tier(p_workspace_id uuid) → the plan tier an active
--   dated grant gives that workspace now, or null when none is active.
--
-- It is looked up by name on every call (`to_regprocedure`) and only called when it
-- exists (plpgsql prepares the call on its first run, so the body never needs it), so
-- this file applies before or after TX-9b in any order. While it doesn't exist the
-- owner's plan decides, exactly as v1 did. The owner's plan is checked first, so a
-- workspace whose owner has chat never calls the grant function. A grant function that
-- fails reads as no grant (a WARNING in the log): it can pause a granted workspace, but
-- never turns its error into one for every caller (the realtime topic policies and the
-- unread counts ask this function too).
--
-- Callers pick this up by name and are unchanged: chat_op__guard (posting and the other
-- plan-gated writes), chat_op_agent_post, chat_can_access_workspace (the workspace
-- presence topic, v1's chat_unread_counts). Reading never asks the plan
-- (chat_can_read_channel, CV-1).
--
-- Redefined from its live body (2026-10-14, 20261006150000_chat_module.sql): the same
-- name, parameter, return type, STABLE SECURITY DEFINER and search_path; the language
-- moves from sql to plpgsql because a SQL function's body must resolve every function
-- it names when it is created.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chat_workspace_enabled(p_workspace_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_grant text;
BEGIN
  SELECT w.owner_id INTO v_owner
    FROM public.workspaces w
   WHERE w.id = p_workspace_id
     AND w.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The owner's plan (v1's rule, unchanged).
  IF public.plan_tier_rank(public.profile_plan_tier_text(v_owner)) >= public.plan_tier_rank('duo') THEN
    RETURN true;
  END IF;

  -- A dated grant (TX-9b), when its function exists. `::text` takes a text or a
  -- plan_tier result alike; null or an unknown tier ranks 0.
  IF to_regprocedure('public.plan_grant_effective_tier(uuid)') IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    v_grant := public.plan_grant_effective_tier(p_workspace_id)::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat_workspace_enabled: plan_grant_effective_tier failed (%), read as no grant', SQLSTATE;
    RETURN false;
  END;
  RETURN public.plan_tier_rank(v_grant) >= public.plan_tier_rank('duo');
END;
$function$;

COMMENT ON FUNCTION public.chat_workspace_enabled(uuid) IS
  'Chat is on: the owner''s plan is Duo, Team or Founder, or public.plan_grant_effective_tier(workspace) '
  '(TX-9b''s dated grant, looked up when it exists) gives such a tier. Reading never needs it (CV-4).';

-- Grants re-stated (CREATE OR REPLACE keeps them; this states them on purpose).
REVOKE ALL ON FUNCTION public.chat_workspace_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_workspace_enabled(uuid) TO authenticated, service_role;

DO $$
DECLARE
  v_fn regprocedure := 'public.chat_workspace_enabled(uuid)'::regprocedure;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_fn
          AND p.prosecdef
          AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'CV-4: chat_workspace_enabled lost its definer settings or grants';
  END IF;
END;
$$;

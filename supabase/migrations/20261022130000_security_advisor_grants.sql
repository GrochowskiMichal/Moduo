-- DB-SEC-1 (MOD-247) · The 2026-10-22 Supabase security advisor, each finding checked
-- against what actually uses it (prod catalog, app, desktop, Edge Functions,
-- SQL bodies, policies, cron).
--
-- What the advisor flagged on prod: 319 SECURITY DEFINER functions signed-in
-- people can run over /rest/v1/rpc, 9 that anon can run, 1 function with a
-- mutable search_path, leaked-password protection off, and (INFO) 17 tables
-- with RLS on and no policy.
--
-- What stays, on purpose:
--   * 264 app RPCs (`*_op_*`, reads like `chat_search`): the app calls them,
--     and each checks the caller itself (auth.uid() / perm_actor_id(), directly
--     or through its module guard).
--   * 28 helpers that RLS policies call: a policy runs as the caller, so the
--     caller needs EXECUTE. Each answers only about the caller.
--   * calendar_public_feed for anon: the published-calendar ICS feed (PERM-5),
--     the 64-hex token is the credential (ANON_DEFINER_ALLOWED).
--   * The 17 RLS-without-policy tables are server-only on purpose (deny-all
--     for clients); only user_integrations still had client table grants.
--
-- What this changes:
--   1. Trigger functions lose every client grant (8 were still open to anon and
--      signed-in people, e.g. handle_new_user). Postgres never checks EXECUTE
--      when a trigger fires, so nothing that fires them changes.
--   2. Nine helpers only server code calls lose their client grants: the four
--      module-permission helpers whose siblings (notes, email) are already
--      server-only, projects__editable, tasks__editable, perm_can_view_entity,
--      chat_is_workspace_admin, and share_visible_ids (the connector's, which
--      runs as service_role). Every caller is a SECURITY DEFINER function, so it
--      runs them as its owner.
--   3. Two dead helpers go: perm_private_entity_visible (replaced by
--      perm_can_see_entity in 20261008130000, PERM-10 item 5) and
--      user_can_manage_workspace_members (pre-migration era, no caller since
--      PERM-1). No policy, view or function body calls either (a function
--      body isn't a tracked dependency, so the body search is the proof).
--   4. share_defaults_get becomes SECURITY INVOKER: it read any workspace's
--      share defaults for anyone signed in. The table's read policy (owner or
--      member) now decides.
--   5. workspace_seats_used answers only for a member or owner of the
--      workspace, or server code; anyone else gets NULL, which makes the
--      seat-cap policies that call it fail closed.
--   6. notes_live__fresh gets a pinned search_path.
--   7. user_integrations (encrypted Google / Zoom tokens) loses its anon and
--      authenticated table grants. Only Edge Functions (service_role) touch it;
--      RLS hid the rows but does not gate TRUNCATE.

-- 1 · Trigger functions are never RPCs.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

-- 2 · Server-only helpers.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.calendar_module_permission(uuid)',
    'public.contacts_module_permission(uuid)',
    'public.spine_module_permission(uuid)',
    'public.tasks_module_permission(uuid)',
    'public.projects__editable(uuid)',
    'public.tasks__editable(uuid)',
    'public.perm_can_view_entity(uuid, text)',
    'public.chat_is_workspace_admin(uuid)',
    'public.share_visible_ids(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

-- 3 · Dead helpers.
DROP FUNCTION IF EXISTS public.perm_private_entity_visible(text, uuid);
DROP FUNCTION IF EXISTS public.user_can_manage_workspace_members(uuid);

-- 4 · Share defaults are read through the table's own policy.
ALTER FUNCTION public.share_defaults_get(uuid) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.share_defaults_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_defaults_get(uuid) TO authenticated, service_role;

-- 5 · Seat counts only for the workspace's own people.
CREATE OR REPLACE FUNCTION public.workspace_seats_used(p_workspace uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN auth.uid() IS NULL
                OR public.tasks_module_can_access_workspace(p_workspace) THEN
    (SELECT count(*) FROM public.workspace_members WHERE workspace_id = p_workspace)::int
    + (SELECT count(*) FROM public.workspace_invites
        WHERE workspace_id = p_workspace AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > now()))::int
  END
$$;
REVOKE ALL ON FUNCTION public.workspace_seats_used(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_seats_used(uuid) TO authenticated, service_role;

-- 6 · Pinned search_path.
ALTER FUNCTION public.notes_live__fresh() SET search_path = '';

-- 7 · Server-only token table.
REVOKE ALL ON TABLE public.user_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_integrations TO service_role;

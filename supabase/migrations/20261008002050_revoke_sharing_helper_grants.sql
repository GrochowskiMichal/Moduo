-- Close client EXECUTE on the sharing helpers PERM sharing left open.
--
-- 20261006210000_perm_sharing.sql gives most of its functions an explicit
-- REVOKE + GRANT pair, but not these:
--   * share_grant_workspace(uuid, text, uuid, text): SECURITY DEFINER, no caller
--     check, and EXECUTE for PUBLIC. It upserts a workspace-wide
--     resource_grants row at any level, for any item in any workspace with 2+
--     members. Anyone holding the public anon key could have shared a
--     teammate's private note with the whole workspace at 'full', or downgraded
--     an existing workspace share (ON CONFLICT … SET level). Needed: the
--     workspace id and the item id. The API logs cover the whole window since
--     the sharing release (2026-10-06) and show no direct call.
--   * share_member_count(uuid): EXECUTE for PUBLIC. It returns any
--     workspace's member count.
--   * chat_has_cap(uuid, uuid, text): its REVOKE named only PUBLIC, so anon
--     kept the EXECUTE Supabase grants it directly (gotchas §Supabase; the
--     slip OPS-2 and 20261007223443 fixed elsewhere). It returns what a given
--     member may do in a workspace's chat.
--   * perm_can_see_entity(uuid, text, uuid): EXECUTE for PUBLIC. For anon it
--     only ever answers false, so this one is hygiene.
--
-- Checked on prod 2026-10-07 before writing this: no `.rpc()` in src/,
-- supabase/functions/ or scripts/ names any of them, and no view or invoker
-- function calls them. share_grant_workspace and share_member_count are called
-- only by SECURITY DEFINER functions owned by postgres (the share_*_after
-- triggers, calendar_op_create_custom, share_apply_invite,
-- share_default_calendar_grant, share_on_member_joined), which run as the owner,
-- so caller grants don't apply. No RLS policy uses either. perm_can_see_entity
-- backs three SELECT policies (comments, entities, module_activity) that are
-- all `TO authenticated`, so revoking anon can't turn an anonymous read into a
-- permission error (gotchas §Supabase: check the policy's role first).
-- chat_has_cap is in no policy; its explicit authenticated grant was
-- deliberate, so signed-in callers keep it.

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal: only definer triggers and ops call these.
  FOREACH fn IN ARRAY ARRAY[
    'share_grant_workspace(uuid, text, uuid, text)',
    'share_member_count(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;

  -- Signed-in callers keep these; anon never had a reason to.
  FOREACH fn IN ARRAY ARRAY[
    'chat_has_cap(uuid, uuid, text)',
    'perm_can_see_entity(uuid, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

-- Assert the end state rather than trust the statements (gotchas §Supabase).
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s %s=%s (want %s)', c.fn, c.rolname, c.has, c.want), '; ')
    INTO v_bad
  FROM (
    SELECT e.fn, e.rolname, e.want,
           has_function_privilege(e.rolname, ('public.' || e.fn)::regprocedure, 'EXECUTE') AS has
    FROM (VALUES
      ('share_grant_workspace(uuid, text, uuid, text)', 'anon', false),
      ('share_grant_workspace(uuid, text, uuid, text)', 'authenticated', false),
      ('share_grant_workspace(uuid, text, uuid, text)', 'service_role', true),
      ('share_member_count(uuid)', 'anon', false),
      ('share_member_count(uuid)', 'authenticated', false),
      ('share_member_count(uuid)', 'service_role', true),
      ('chat_has_cap(uuid, uuid, text)', 'anon', false),
      ('chat_has_cap(uuid, uuid, text)', 'authenticated', true),
      ('perm_can_see_entity(uuid, text, uuid)', 'anon', false),
      ('perm_can_see_entity(uuid, text, uuid)', 'authenticated', true)
    ) AS e(fn, rolname, want)
  ) c
  WHERE c.has IS DISTINCT FROM c.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Sharing helper grants are not as intended: %', v_bad;
  END IF;
END;
$$;

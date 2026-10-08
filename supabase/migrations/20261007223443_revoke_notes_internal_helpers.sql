-- Close client EXECUTE on the notes module's internal SECURITY DEFINER helpers.
--
-- `notes__purge_ids(uuid, uuid[])` hard-deletes whichever TRASHED notes it is
-- handed, in any workspace: it re-roots their live children, soft-deletes their
-- links, tombstones their registry rows and deletes them (note_updates cascade).
-- It has no caller guard because it was only meant to run inside
-- `notes_op_purge` / `notes_op_purge_expired`, which guard first. But
-- 20260703120000_notes_module.sql revoked it, and its siblings
-- `notes__subtree_ids(uuid, uuid)` and `notes_op__guard_note(uuid, uuid, boolean)`,
-- only FROM PUBLIC and FROM anon. Supabase grants `authenticated` EXECUTE on
-- public functions directly (gotchas §Supabase), so all three stayed callable by
-- any signed-in user over PostgREST (`POST /rest/v1/rpc/notes__purge_ids`).
-- Confirmed on prod 2026-10-07: each one's ACL was {postgres, authenticated,
-- service_role}, and they were the only `*__*` SECURITY DEFINER helpers in
-- `public` that a client role could call.
--
-- What each one exposed:
--   * notes__purge_ids: anyone signed in who knew a workspace id and trashed note
--     ids could delete those notes for good (no 30-day restore, no activity row).
--     Wide open from the notes module's prod apply (2026-07-04) until PERM-1
--     (2026-10-06), whose `perm_enforce_write` trigger on `notes` now rejects a
--     non-member's delete. The trigger was the only thing left in front of it.
--   * notes__subtree_ids: a note's descendant ids, in any workspace.
--   * notes_op__guard_note: checks edit access to the workspace, then returns the
--     whole note row past RLS, so a member could read a note they can't open
--     (a private note, since PERM sharing) by its id.
-- The API logs Supabase keeps (2026-09-30 → 2026-10-07) show no direct call to
-- any `*__*` helper.
--
-- Nothing outside SQL calls them: no `.rpc()` in src/, supabase/functions/ or
-- scripts/, and no policy, view or pg_depend entry references them. All 16
-- callers are `notes_op_*` functions, SECURITY DEFINER and owned by postgres, so
-- they run as the owner and caller grants don't apply. Every notes op already
-- calls `notes_op__guard(uuid)`, revoked from authenticated since day one.
-- service_role keeps EXECUTE.
--
-- This is the same slip OPS-2 (20260729140000) fixed for anon: hand-written
-- REVOKE pairs next to a correct grant loop. So: a loop, and an assertion over
-- the whole helper family rather than these three.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'notes__purge_ids(uuid, uuid[])',
    'notes__subtree_ids(uuid, uuid)',
    'notes_op__guard_note(uuid, uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
    -- Explicit, as in the notes op loop: the MCP connector runs as service_role.
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;

-- Assert rather than trust the REVOKEs (gotchas §Supabase): no `*__*` SECURITY
-- DEFINER helper in public is left executable by a client role, directly or via
-- PUBLIC. Fails, and rolls this migration back, if one is.
DO $$
DECLARE
  v_open text;
BEGIN
  SELECT string_agg(format('%s (%s)', p.oid::regprocedure, r.rolname), ', ')
    INTO v_open
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname LIKE '%\_\_%'
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'Internal SECURITY DEFINER helpers still callable by a client role: %', v_open;
  END IF;

  IF NOT (has_function_privilege('service_role', 'public.notes__purge_ids(uuid, uuid[])', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.notes__subtree_ids(uuid, uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.notes_op__guard_note(uuid, uuid, boolean)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on a notes helper.';
  END IF;
END;
$$;

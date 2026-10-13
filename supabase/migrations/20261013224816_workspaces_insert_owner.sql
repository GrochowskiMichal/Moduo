-- SEC2 · Workspaces are created only for the signed-in person; the free-plan
-- workspace limit is enforced in the database.
--
-- 1. public.workspaces has exactly one INSERT policy, for signed-in people only:
--    the new row's owner is the caller (owner_id = auth.uid()), and on the free
--    plan the caller owns no live workspace yet. Every other plan (pro, duo,
--    team, founder) creates as many as before. Signed-out requests (anon) hold
--    no INSERT on the table.
-- 2. The AFTER trigger workspaces_plan_limit checks the free plan of the
--    owner again for every row that passed the policies, under a per-person
--    lock, whenever a live workspace gains an owner: on every insert, when a
--    deleted workspace is restored (deleted_at back to NULL), and when
--    owner_id changes (workspace_op_transfer_ownership, or any other function).
--    It applies whenever a signed-in person is behind the request, directly or
--    through a function they call; server code with no person behind it
--    (service role, admin SQL) is not limited. The lock makes each owner's
--    creations, restores and incoming transfers take turns; the count then
--    sees every workspace committed before the lock was granted (READ
--    COMMITTED, the isolation every API role runs at) and every row this
--    statement wrote.
-- The plan and the count come from the existing SECURITY DEFINER helpers
-- profile_plan_tier_text and workspaces_owned_count_for_user (20260512120000,
-- 20260512130000), unchanged here, grants included.
-- owner_id changes only through server code (workspace_op_transfer_ownership):
-- the UPDATE policy keeps a client's row owned by that client. A transfer to
-- someone on the free plan who already owns a live workspace is refused.
-- trg_workspaces_add_owner_member (handle_new_workspace) still makes the
-- creator the workspace's owner member.
--
-- Re-runnable. Uses only objects that predate the Tasks v3 migrations.
-- Tested by supabase/tests/workspaces_insert.test.sql.

-- Fail fast instead of queueing the app behind this migration's table locks.
SET LOCAL lock_timeout = '5s';

-- ── 1. The INSERT policy ─────────────────────────────────────────────────────
-- Permissive policies OR together, so the table keeps one INSERT policy.
DROP POLICY IF EXISTS free_users_max_one_workspace ON public.workspaces;
DROP POLICY IF EXISTS workspaces_insert_own ON public.workspaces;
DROP POLICY IF EXISTS workspaces_insert_owner ON public.workspaces;

CREATE POLICY workspaces_insert_owner ON public.workspaces
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND owner_id = (SELECT auth.uid())
  AND (
    COALESCE(public.profile_plan_tier_text((SELECT auth.uid())), 'free') <> 'free'
    OR public.workspaces_owned_count_for_user((SELECT auth.uid())) = 0
  )
);

REVOKE INSERT ON public.workspaces FROM anon;

-- ── 2. The free plan, per row, under a per-person lock ───────────────────────
-- AFTER ROW, so it runs only for rows the policies let through, once the whole
-- statement has written its rows. VOLATILE (the default), so each query below
-- takes a fresh snapshot: under READ COMMITTED it sees what committed before
-- the lock was granted, and it sees every row this statement wrote, the
-- current one included.
CREATE OR REPLACE FUNCTION public.workspaces__plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF COALESCE(public.profile_plan_tier_text(NEW.owner_id), 'free') <> 'free' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workspaces_plan_limit:owner:' || NEW.owner_id::text, 0));
  SELECT public.workspaces_owned_count_for_user(NEW.owner_id) INTO v_live;
  IF v_live > 1 THEN
    IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'The new owner is on the free plan, which includes one workspace, and already owns one.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'The free plan includes one workspace.' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

-- Only the trigger runs it; no client role can call it.
REVOKE ALL ON FUNCTION public.workspaces__plan_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspaces__plan_limit() TO service_role;

DROP TRIGGER IF EXISTS workspaces_plan_limit ON public.workspaces;
CREATE TRIGGER workspaces_plan_limit
  AFTER INSERT OR UPDATE OF deleted_at, owner_id ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces__plan_limit();

-- ── The end state, checked ───────────────────────────────────────────────────
-- One permissive policy covers INSERT (none for ALL), for signed-in people
-- only; anon cannot insert; the trigger is in place and no client can call
-- its function.
DO $$
DECLARE
  v_names text[];
  v_roles oid[];
BEGIN
  SELECT array_agg(polname::text ORDER BY polname) INTO v_names
  FROM pg_policy
  WHERE polrelid = 'public.workspaces'::regclass
    AND polpermissive
    AND polcmd IN ('a', '*');
  IF v_names IS DISTINCT FROM ARRAY['workspaces_insert_owner'] THEN
    RAISE EXCEPTION 'public.workspaces: expected one permissive INSERT policy (workspaces_insert_owner), found %',
      v_names;
  END IF;

  SELECT polroles INTO v_roles
  FROM pg_policy
  WHERE polrelid = 'public.workspaces'::regclass AND polname = 'workspaces_insert_owner';
  IF v_roles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid] THEN
    RAISE EXCEPTION 'public.workspaces: workspaces_insert_owner must apply to authenticated only';
  END IF;

  IF has_table_privilege('anon', 'public.workspaces', 'INSERT')
     OR has_any_column_privilege('anon', 'public.workspaces', 'INSERT') THEN
    RAISE EXCEPTION 'public.workspaces: anon still holds INSERT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.workspaces'::regclass
      AND tgname = 'workspaces_plan_limit'
      AND tgenabled = 'O'
      AND tgfoid = 'public.workspaces__plan_limit()'::regprocedure
      AND tgtype::int & 3 = 1  -- FOR EACH ROW, AFTER
      AND tgtype::int & 28 = 20  -- INSERT and UPDATE, not DELETE
      AND (SELECT array_agg(a ORDER BY a) FROM unnest(tgattr::int2[]) a)  -- UPDATE OF deleted_at, owner_id
        = (SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
           WHERE attrelid = 'public.workspaces'::regclass AND attname IN ('deleted_at', 'owner_id'))
  ) THEN
    RAISE EXCEPTION 'public.workspaces: trigger workspaces_plan_limit (AFTER INSERT OR UPDATE OF deleted_at, owner_id, FOR EACH ROW) is missing or disabled';
  END IF;

  IF has_function_privilege('anon', 'public.workspaces__plan_limit()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.workspaces__plan_limit()', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.workspaces__plan_limit() must not be callable by client roles';
  END IF;
END;
$$;

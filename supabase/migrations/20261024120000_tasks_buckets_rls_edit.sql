-- Defence in depth after MOD-571: RLS on tasks and buckets asks for Edit
-- before a change, not only View.
--
-- Until now each table had one FOR ALL policy whose USING asked for View, so
-- RLS let anyone who could see a task or project update or delete it, and the
-- write gate lived only in the perm_enforce_write / perm_fixed_columns
-- triggers. Those triggers stand aside while share.bypass is '1'; when
-- share_member_removed left it on for the rest of its transaction (fixed by
-- 20261024110000), nothing stopped a viewer's next write. Split per command
-- so RLS holds the triggers' main lines on its own:
--
--   SELECT  unchanged (View on the task or its project; your own project).
--   INSERT  tasks: Edit on the parent project, as before, and that project
--           must be in the task's workspace (the trigger's rule). Projects:
--           your own project, only where your role can add (owner or
--           tasks.create, the trigger's rule), so a leak can't plant one in a
--           workspace you only view.
--   UPDATE  Edit on the row (USING). WITH CHECK pins what the triggers pin:
--           a project's owner, workspace and Inbox flag; a task's workspace,
--           and its project unless you have Edit on the new one and it is in
--           the task's workspace.
--   DELETE  tasks: Edit (a task is an item in its project, as in the
--           trigger). Projects: Full, as the trigger asks.
--
-- WITH CHECK runs before the new row is written, so a lookup by id (here and
-- in can_access) reads the row as it was; the pins compare against that.
-- The helpers are SECURITY DEFINER so the lookup doesn't recurse into RLS;
-- callable as RPCs too, they answer false for a row you can't see, so they
-- tell you nothing new.
--
-- System work is untouched: every function that sets share.bypass is
-- SECURITY DEFINER and owned by postgres (BYPASSRLS), and the service role
-- bypasses RLS too. The finer trigger rules (assignee must be able to edit,
-- status bookkeeping, trash columns) stay trigger-only.

SET LOCAL lock_timeout = '5s';

-- A project the caller can see, in the given workspace.
CREATE OR REPLACE FUNCTION public.tasks__rls_bucket_here(p_bucket_id uuid, p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access('bucket', p_bucket_id, 'view') AND EXISTS (
    SELECT 1 FROM public.buckets b WHERE b.id = p_bucket_id AND b.workspace_id = p_workspace_id)
$$;

-- The stored project columns an update may not change.
CREATE OR REPLACE FUNCTION public.buckets__rls_fixed_kept(
  p_id uuid, p_owner_id uuid, p_workspace_id uuid, p_is_system boolean)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access('bucket', p_id, 'view') AND coalesce((
    SELECT b.owner_id IS NOT DISTINCT FROM p_owner_id
       AND b.workspace_id IS NOT DISTINCT FROM p_workspace_id
       AND b.is_system IS NOT DISTINCT FROM p_is_system
    FROM public.buckets b WHERE b.id = p_id), false)
$$;

-- A task stays in its workspace, and moves only into a project of that
-- workspace the caller can edit.
CREATE OR REPLACE FUNCTION public.tasks__rls_move_ok(
  p_id uuid, p_workspace_id uuid, p_bucket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access('task', p_id, 'view') AND coalesce((
    SELECT t.workspace_id IS NOT DISTINCT FROM p_workspace_id
       AND (t.bucket_id IS NOT DISTINCT FROM p_bucket_id
            OR (public.can_access('bucket', p_bucket_id, 'edit')
                AND public.tasks__rls_bucket_here(p_bucket_id, t.workspace_id)))
    FROM public.tasks t WHERE t.id = p_id), false)
$$;

-- Called by the policies as the signed-in role (gotchas: REVOKE … FROM
-- PUBLIC doesn't revoke anon).
REVOKE ALL ON FUNCTION public.buckets__rls_fixed_kept(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasks__rls_move_ok(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasks__rls_bucket_here(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buckets__rls_fixed_kept(uuid, uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tasks__rls_move_ok(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tasks__rls_bucket_here(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS tasks_workspace_access ON public.tasks;
DROP POLICY IF EXISTS tasks_read ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
DROP POLICY IF EXISTS tasks_delete ON public.tasks;

CREATE POLICY tasks_read ON public.tasks
  FOR SELECT TO authenticated
  USING (public.can_access('task', id, 'view') OR public.can_access('bucket', bucket_id, 'view'));

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK ((public.can_access('task', id, 'view') OR public.can_access('bucket', bucket_id, 'edit'))
              AND public.tasks__rls_bucket_here(bucket_id, workspace_id));

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.can_access('task', id, 'edit'))
  WITH CHECK (public.can_access('task', id, 'edit')
              AND public.tasks__rls_move_ok(id, workspace_id, bucket_id));

CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (public.can_access('task', id, 'edit'));

DROP POLICY IF EXISTS buckets_workspace_access ON public.buckets;
DROP POLICY IF EXISTS buckets_read ON public.buckets;
DROP POLICY IF EXISTS buckets_insert ON public.buckets;
DROP POLICY IF EXISTS buckets_update ON public.buckets;
DROP POLICY IF EXISTS buckets_delete ON public.buckets;

CREATE POLICY buckets_read ON public.buckets
  FOR SELECT TO authenticated
  USING (public.can_access('bucket', id, 'view')
         OR (owner_id = (SELECT auth.uid()) AND public.perm_can_view(workspace_id, 'tasks')));

CREATE POLICY buckets_insert ON public.buckets
  FOR INSERT TO authenticated
  WITH CHECK ((owner_id = (SELECT auth.uid()) AND public.perm_i_have(workspace_id, 'tasks.create'))
              OR public.can_access('bucket', id, 'edit'));

CREATE POLICY buckets_update ON public.buckets
  FOR UPDATE TO authenticated
  USING (public.can_access('bucket', id, 'edit'))
  WITH CHECK (public.can_access('bucket', id, 'edit')
              AND public.buckets__rls_fixed_kept(id, owner_id, workspace_id, is_system));

CREATE POLICY buckets_delete ON public.buckets
  FOR DELETE TO authenticated
  USING (public.can_access('bucket', id, 'full'));

-- Stop if anything else permissive is left on either table: another policy
-- would be OR'd in and undo these.
DO $check$
DECLARE
  v_found text[];
BEGIN
  SELECT array_agg(c.relname || '.' || pol.polname ORDER BY c.relname, pol.polname)
    INTO v_found
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  WHERE pol.polrelid IN ('public.tasks'::regclass, 'public.buckets'::regclass)
    AND pol.polpermissive;
  IF v_found IS DISTINCT FROM ARRAY[
       'buckets.buckets_delete', 'buckets.buckets_insert', 'buckets.buckets_read', 'buckets.buckets_update',
       'tasks.tasks_delete', 'tasks.tasks_insert', 'tasks.tasks_read', 'tasks.tasks_update'] THEN
    RAISE EXCEPTION 'tasks/buckets carry unexpected permissive policies: %', v_found;
  END IF;
END
$check$;

-- Defence in depth after MOD-571: RLS on tasks and buckets asks for Edit
-- before a change, not only View.
--
-- Until now each table had one FOR ALL policy whose USING asked for View, so
-- RLS let anyone who could see a task or project update or delete it, and the
-- write gate lived only in the perm_enforce_write / perm_fixed_columns
-- triggers. Those triggers stand aside while share.bypass is '1'; when
-- share_member_removed left it on for the rest of its transaction (fixed by
-- 20261024110000), nothing stopped a viewer's next write. Split per command
-- so RLS holds the same floor the trigger does:
--
--   SELECT  unchanged (View on the task or its project; your own project).
--   INSERT  unchanged (Edit on the parent project; your own project).
--   UPDATE  Edit on the row, before (USING) and after (WITH CHECK).
--   DELETE  tasks: Edit (a task is an item in its project, as in the
--           trigger). Projects: Full, as the trigger asks.
--
-- System work is untouched: every function that sets share.bypass is
-- SECURITY DEFINER and owned by postgres (BYPASSRLS), and the service role
-- bypasses RLS too. Moving a task into another project still needs Edit
-- there; that check stays in the trigger, since a policy can't see OLD.

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
  WITH CHECK (public.can_access('task', id, 'view') OR public.can_access('bucket', bucket_id, 'edit'));

CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.can_access('task', id, 'edit'))
  WITH CHECK (public.can_access('task', id, 'edit'));

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
  WITH CHECK (owner_id = (SELECT auth.uid()) OR public.can_access('bucket', id, 'edit'));

CREATE POLICY buckets_update ON public.buckets
  FOR UPDATE TO authenticated
  USING (public.can_access('bucket', id, 'edit'))
  WITH CHECK (public.can_access('bucket', id, 'edit'));

CREATE POLICY buckets_delete ON public.buckets
  FOR DELETE TO authenticated
  USING (public.can_access('bucket', id, 'full'));

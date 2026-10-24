-- MOD-571 · Removing a workspace member turns share.bypass on only for the
-- removal's own clean-up (supabase/migrations/20261024110000_share_member_removed_bypass.sql).
-- Every function that sets it saves the caller's value and puts it back, so
-- the next statement in the same transaction is checked as usual.
--
-- Cast: OA owns workspace A, OB owns workspace B. V is a member of both. In
-- B, PV is OB's project shared with V at View, with task TV in it. G is a
-- member of A whose account goes away (the removal's early return).

SELECT test.person(n) FROM unnest(ARRAY['OA', 'OB', 'V', 'G']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('A'), test.id('OA'), 'Alpha'),
  (test.id('B'), test.id('OB'), 'Beta');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('A'), test.id('V'), 'member'),
  (test.id('B'), test.id('V'), 'member'),
  (test.id('A'), test.id('G'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('PV'), test.id('B'), test.id('OB'), 'Board notes', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PV');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('B'), 'bucket', test.id('PV'), 'member', test.id('V'), 'view', test.id('OB'));
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('TV'), test.id('B'), test.id('PV'), test.id('OB'), 'Board task', 'todo');

DO $$
DECLARE
  r text;
BEGIN
  PERFORM set_config('share.bypass', '', true);

  -- Control: before anything is removed, V can read TV but not change it.
  PERFORM test.ok(test.value_as('V', format('SELECT title FROM public.tasks WHERE id = %L', test.id('TV'))) = 'Board task',
    'V can see the task they were shared at View');
  r := test.try('V', format($q$UPDATE public.tasks SET title = 'Mine now' WHERE id = %L$q$, test.id('TV')));
  PERFORM test.ok(r LIKE '42501%' OR r = 'ok 0', 'a View share can''t rename the task', r);

  -- V leaves workspace A by deleting their own membership.
  r := test.as_user('V', format('DELETE FROM public.workspace_members WHERE workspace_id = %L AND user_id = %L',
                                test.id('A'), test.id('V')));
  PERFORM test.ok(r = 'ok 1', 'V can leave workspace A', r);
  PERFORM test.ok(coalesce(current_setting('share.bypass', true), '') <> '1',
    'leaving puts share.bypass back the way it was', current_setting('share.bypass', true));

  -- Same transaction: B's checks still hold. (as_user keeps a write that
  -- goes through, so the "unchanged" check below would see it.) A refusal is
  -- the trigger's 42501, or 'ok 0' where RLS asks for Edit first
  -- (20261024120000_tasks_buckets_rls_edit.sql).
  r := test.as_user('V', format($q$UPDATE public.tasks SET title = 'Mine now' WHERE id = %L$q$, test.id('TV')));
  PERFORM test.ok(r LIKE '42501%' OR r = 'ok 0', 'after leaving A, V still can''t rename a task they only view in B', r);
  r := test.as_user('V', format('UPDATE public.tasks SET owner_id = %L WHERE id = %L', test.id('V'), test.id('TV')));
  PERFORM test.ok(r LIKE '42501%' OR r = 'ok 0', 'nor take it over', r);
  r := test.try('V', format('DELETE FROM public.tasks WHERE id = %L', test.id('TV')));
  PERFORM test.ok(r LIKE '42501%' OR r = 'ok 0', 'nor delete it', r);
  r := test.as_user('V', format('UPDATE public.buckets SET owner_id = %L WHERE id = %L', test.id('V'), test.id('PV')));
  PERFORM test.ok(r LIKE '42501%' OR r = 'ok 0', 'nor take over the project', r);
  PERFORM test.ok((SELECT title FROM public.tasks WHERE id = test.id('TV')) = 'Board task'
              AND (SELECT owner_id FROM public.buckets WHERE id = test.id('PV')) = test.id('OB'),
    'the task and project are unchanged');

  -- An account deletion's cascade takes the removal's early return (no
  -- profile any more): that path puts the setting back too.
  DELETE FROM public.profiles WHERE id = test.id('G');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.workspace_members
                              WHERE workspace_id = test.id('A') AND user_id = test.id('G')),
    'a deleted profile takes its membership with it');
  PERFORM test.ok(coalesce(current_setting('share.bypass', true), '') <> '1',
    'and that removal puts share.bypass back too', current_setting('share.bypass', true));

  -- A caller that already had the bypass on keeps it.
  PERFORM set_config('share.bypass', '1', true);
  DELETE FROM public.workspace_members WHERE workspace_id = test.id('B') AND user_id = test.id('V');
  PERFORM test.ok(current_setting('share.bypass', true) = '1', 'a removal inside system work leaves the bypass on');
  PERFORM set_config('share.bypass', '', true);
END;
$$;

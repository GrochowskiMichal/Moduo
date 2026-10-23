-- RLS on tasks and buckets asks for Edit before a change
-- (supabase/migrations/20261024120000_tasks_buckets_rls_edit.sql). The write
-- triggers stand aside while share.bypass is '1'; these checks turn it on, the
-- way MOD-571's leak did, and expect RLS alone to hold: a viewer's UPDATE and
-- DELETE match no rows. With the bypass off, the triggers and RLS agree.
--
-- Cast: O owns workspace W. In W, P is O's project shared with V at View,
-- with E at Edit, and with R at Edit while R's role is viewer (the role caps
-- it at View). T is a task in P. TD is a task in O's project Q, shared
-- directly with D at Edit (D has nothing on Q). Z is O's empty project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'V', 'E', 'R', 'D']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Workspace');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('V'), 'member'),
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('R'), 'viewer'),
  (test.id('W'), test.id('D'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Launch', false),
  (test.id('Q'), test.id('W'), test.id('O'), 'Hiring', false),
  (test.id('Z'), test.id('W'), test.id('O'), 'Spare', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('P'), test.id('Q'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'bucket', test.id('P'), 'member', test.id('V'), 'view', test.id('O')),
  (test.id('W'), 'bucket', test.id('P'), 'member', test.id('E'), 'edit', test.id('O')),
  (test.id('W'), 'bucket', test.id('P'), 'member', test.id('R'), 'edit', test.id('O'));
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('T'), test.id('W'), test.id('P'), test.id('O'), 'Write the brief', 'todo'),
  (test.id('TD'), test.id('W'), test.id('Q'), test.id('O'), 'Call the recruiter', 'todo');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'task', test.id('TD'), 'member', test.id('D'), 'edit', test.id('O'));

DO $$
DECLARE
  r text;
BEGIN
  -- The policies, one per command (no FOR ALL policy left to widen a write).
  PERFORM test.ok((SELECT array_agg(policyname || ':' || cmd ORDER BY policyname) FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'tasks' AND permissive = 'PERMISSIVE')
                  = ARRAY['tasks_delete:DELETE', 'tasks_insert:INSERT', 'tasks_read:SELECT', 'tasks_update:UPDATE'],
    'tasks has one permissive policy per command');
  PERFORM test.ok((SELECT array_agg(policyname || ':' || cmd ORDER BY policyname) FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'buckets' AND permissive = 'PERMISSIVE')
                  = ARRAY['buckets_delete:DELETE', 'buckets_insert:INSERT', 'buckets_read:SELECT', 'buckets_update:UPDATE'],
    'buckets has one permissive policy per command');

  -- Reads are unchanged.
  PERFORM test.ok(test.value_as('V', format('SELECT title FROM public.tasks WHERE id = %L', test.id('T'))) = 'Write the brief',
    'V can see a task in a project shared at View');
  PERFORM test.ok(test.value_as('R', format('SELECT name FROM public.buckets WHERE id = %L', test.id('P'))) = 'Launch',
    'R can see the project');
  PERFORM test.ok(test.value_as('D', format('SELECT title FROM public.tasks WHERE id = %L', test.id('TD'))) = 'Call the recruiter',
    'D can see the task shared with them directly');

  -- Without the bypass, the trigger and RLS both refuse a viewer.
  PERFORM set_config('share.bypass', '', true);
  r := test.try('V', format($q$UPDATE public.tasks SET title = 'Mine now' WHERE id = %L$q$, test.id('T')));
  PERFORM test.ok(r = 'ok 0', 'a View share can''t rename the task', r);

  -- The leak: share.bypass left on. RLS alone must hold.
  PERFORM set_config('share.bypass', '1', true);

  r := test.as_user('V', format($q$UPDATE public.tasks SET title = 'Mine now' WHERE id = %L$q$, test.id('T')));
  PERFORM test.ok(r = 'ok 0', 'under the bypass, a viewer''s task rename matches nothing', r);
  r := test.as_user('V', format('UPDATE public.tasks SET owner_id = %L WHERE id = %L', test.id('V'), test.id('T')));
  PERFORM test.ok(r = 'ok 0', 'nor can they take the task over', r);
  r := test.as_user('V', format('DELETE FROM public.tasks WHERE id = %L', test.id('T')));
  PERFORM test.ok(r = 'ok 0', 'nor delete it', r);
  r := test.as_user('V', format($q$UPDATE public.buckets SET name = 'Mine now', owner_id = %L WHERE id = %L$q$,
                                test.id('V'), test.id('P')));
  PERFORM test.ok(r = 'ok 0', 'nor rename or take over the project', r);
  r := test.as_user('V', format('DELETE FROM public.buckets WHERE id = %L', test.id('P')));
  PERFORM test.ok(r = 'ok 0', 'nor delete the project', r);
  r := test.as_user('V', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
                                   VALUES (%L, %L, %L, %L, 'Sneaked in', 'todo')$q$,
                                test.id('TV-new'), test.id('W'), test.id('P'), test.id('V')));
  PERFORM test.ok(r LIKE '42501%', 'nor add a task to it', r);

  r := test.as_user('R', format($q$INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
                                   VALUES (%L, %L, %L, 'Planted', false)$q$,
                                test.id('PR-new'), test.id('W'), test.id('R')));
  PERFORM test.ok(r LIKE '42501%', 'a viewer-role member can''t add a project of their own', r);
  r := test.as_user('R', format($q$UPDATE public.tasks SET title = 'Mine now' WHERE id = %L$q$, test.id('T')));
  PERFORM test.ok(r = 'ok 0', 'an Edit share capped by the viewer role can''t rename the task either', r);

  PERFORM test.ok((SELECT title FROM public.tasks WHERE id = test.id('T')) = 'Write the brief'
              AND (SELECT owner_id FROM public.tasks WHERE id = test.id('T')) = test.id('O')
              AND (SELECT name FROM public.buckets WHERE id = test.id('P')) = 'Launch'
              AND (SELECT owner_id FROM public.buckets WHERE id = test.id('P')) = test.id('O'),
    'the task and project are unchanged');

  -- Edit keeps working, under the bypass too.
  r := test.try('E', format($q$UPDATE public.tasks SET title = 'Write the brief, v2' WHERE id = %L$q$, test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'an Edit share can rename the task', r);
  r := test.try('E', format($q$UPDATE public.buckets SET name = 'Launch v2' WHERE id = %L$q$, test.id('P')));
  PERFORM test.ok(r = 'ok 1', 'and the project', r);
  r := test.try('E', format('DELETE FROM public.tasks WHERE id = %L', test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'and delete a task in it (an item in the project)', r);
  r := test.try('E', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
                               VALUES (%L, %L, %L, %L, 'New one', 'todo')$q$,
                            test.id('TE-new'), test.id('W'), test.id('P'), test.id('E')));
  PERFORM test.ok(r = 'ok 1', 'and add a task to it', r);
  r := test.try('E', format('DELETE FROM public.buckets WHERE id = %L', test.id('P')));
  PERFORM test.ok(r = 'ok 0', 'but deleting the project needs Full', r);
  r := test.try('E', format($q$INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
                               VALUES (%L, %L, %L, 'My own', false)$q$,
                            test.id('PE-new'), test.id('W'), test.id('E')));
  PERFORM test.ok(r = 'ok 1', 'a member can add a project of their own', r);

  r := test.try('D', format($q$UPDATE public.tasks SET title = 'Call the recruiter today' WHERE id = %L$q$, test.id('TD')));
  PERFORM test.ok(r = 'ok 1', 'a task shared directly at Edit can be renamed', r);
  r := test.try('D', format($q$UPDATE public.buckets SET name = 'Mine' WHERE id = %L$q$, test.id('Q')));
  PERFORM test.ok(r = 'ok 0', 'but not its project', r);

  r := test.try('O', format($q$UPDATE public.buckets SET name = 'Launch 2027' WHERE id = %L$q$, test.id('P')));
  PERFORM test.ok(r = 'ok 1', 'the owner can rename the project', r);
  r := test.try('O', format('DELETE FROM public.buckets WHERE id = %L', test.id('Z')));
  PERFORM test.ok(r = 'ok 1', 'and delete an empty one', r);

  -- System work runs in SECURITY DEFINER ops owned by postgres, outside RLS.
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_update(%L, %L, '{"title": "Through the op"}'::jsonb)$q$,
                            test.id('W'), test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'an op still writes', r);

  PERFORM set_config('share.bypass', '', true);
  r := test.try('E', format($q$UPDATE public.tasks SET title = 'Write the brief, v3' WHERE id = %L$q$, test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'without the bypass, an Edit share can still rename the task', r);
END;
$$;

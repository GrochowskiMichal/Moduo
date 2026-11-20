-- MOD-549 · Deleting or retyping a task-to-task "blocks" link needs Edit on
-- the waiting task (supabase/migrations/20261024132500_links_unblock_needs_task_edit.sql).
--
-- Cast: O owns workspace W; M is a member. PB is O's private project with
-- tasks TA (waits) and TB (blocks it). PM is M's project with task TM, which
-- blocks TA too. L1 and L2 are the links TB→TA and TM→TA.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('M'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('PB'), test.id('W'), test.id('O'), 'Fundraise', false),
  (test.id('PM'), test.id('W'), test.id('M'), 'Website', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PM'));
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('TA'), test.id('W'), test.id('PB'), test.id('O'), 'Sign term sheet', 'todo'),
  (test.id('TB'), test.id('W'), test.id('PB'), test.id('O'), 'Legal review', 'todo'),
  (test.id('TM'), test.id('W'), test.id('PM'), test.id('M'), 'Publish deck', 'todo');
INSERT INTO public.entity_links (id, workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by)
VALUES (test.id('L1'), test.id('W'), 'task', test.id('TB'), 'task', test.id('TA'), 'blocks', test.id('O')),
       (test.id('L2'), test.id('W'), 'task', test.id('TM'), 'task', test.id('TA'), 'blocks', test.id('O'));

CREATE FUNCTION test.waits(p_blocker text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.task_relations
                 WHERE blocker_task_id = test.id(p_blocker) AND blocked_task_id = test.id('TA'))
$$;

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.ok(test.waits('TB') AND test.waits('TM'), 'control: the links made both dependencies');
  PERFORM test.ok(NOT public.can_access('task', test.id('TA'), 'view', test.id('M')),
    'control: M can''t see the waiting task');

  r := test.as_user('M', format('SELECT public.links_op_delete(%L, %L)', test.id('W'), test.id('L1')));
  PERFORM test.ok(r LIKE '42501%' AND test.waits('TB')
              AND (SELECT deleted_at IS NULL FROM public.entity_links WHERE id = test.id('L1')),
    'deleting the link doesn''t remove a dependency of a task you can''t edit', r);
  r := test.as_user('M', format($q$SELECT public.links_op_set_kind(%L, %L, 'references')$q$,
    test.id('W'), test.id('L1')));
  PERFORM test.ok(r LIKE '42501%' AND test.waits('TB')
              AND (SELECT relation_kind FROM public.entity_links WHERE id = test.id('L1')) = 'blocks',
    'nor does retyping it', r);
  -- Even when the blocker is M's own task: the dependency belongs to TA.
  r := test.as_user('M', format('SELECT public.links_op_delete(%L, %L)', test.id('W'), test.id('L2')));
  PERFORM test.ok(r LIKE '42501%' AND test.waits('TM'),
    'owning the blocking task isn''t enough', r);

  -- Someone who can edit the waiting task still can.
  r := test.as_user('O', format($q$SELECT public.links_op_set_kind(%L, %L, 'references')$q$,
    test.id('W'), test.id('L1')));
  PERFORM test.ok(r = 'ok 1' AND NOT test.waits('TB'), 'O retypes the link and the dependency goes', r);
  r := test.as_user('O', format($q$SELECT public.links_op_set_kind(%L, %L, 'blocks')$q$,
    test.id('W'), test.id('L1')));
  PERFORM test.ok(r = 'ok 1' AND test.waits('TB'), 'and back, which brings it back', r);
  r := test.as_user('O', format('SELECT public.links_op_delete(%L, %L)', test.id('W'), test.id('L1')));
  PERFORM test.ok(r = 'ok 1' AND NOT test.waits('TB'), 'O deletes the link and the dependency goes', r);

  -- Deleting your own blocking task still clears its dependency, though you
  -- can't edit the task that waited (the trigger path is not gated).
  r := test.as_user('M', format('DELETE FROM public.tasks WHERE id = %L', test.id('TM')));
  PERFORM test.ok(r = 'ok 1' AND NOT test.waits('TM'),
    'M deletes their own task, and its dependency goes with it', r);

  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.links__assert_can_unblock(public.entity_links)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.links_op_delete(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.links_op_delete(uuid, uuid)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.links_op_set_kind(uuid, uuid, text)', 'EXECUTE'),
    'grants: the ops for signed-in people, the check internal');
END;
$$;

-- TV-D16 follow-up · every bell notice names its item by id
-- (supabase/migrations/20261013269000_notice_ids_only.sql, after
-- 20261013268000_agents_privacy_fix.sql). E gets one of each notice about
-- things O's project and note hold, then O takes them away: E's bell keeps
-- the notices, but none of them carries a title or a comment's text, and the
-- reads the app names them through (the entity registry, the comments) no
-- longer answer E.
--
-- Cast: O owns workspace W; E and F are members. PO is O's project E and F
-- edit (until O takes it from E); PX is O's private project (E never sees
-- it); N is O's note E may view (until O takes it). DS is a team of E and F.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('PO'), test.id('W'), test.id('O'), 'Board', false, '0001'),
  (test.id('PX'), test.id('W'), test.id('O'), 'O alone', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id IN (test.id('PO'), test.id('PX'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'bucket', test.id('PO'), 'member', test.id('E'), 'edit', test.id('O')),
  (test.id('W'), 'bucket', test.id('PO'), 'member', test.id('F'), 'edit', test.id('O'));

CREATE FUNCTION test.make(p_who text, p_task jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'), p_task))
$$;
-- The notices E's bell holds (through the bell's own read).
CREATE FUNCTION test.bell(p_where text DEFAULT 'true') RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as('E', format($q$SELECT count(*)::text FROM public.notifications_list(%L, 500) WHERE %s$q$,
    test.id('W'), p_where))::integer
$$;
-- A notice kind that names its item by id only: nothing it holds is a title
-- or a comment's text.
CREATE FUNCTION test.ids_only() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.module_activity a
    WHERE a.workspace_id = test.id('W')
      AND a.op IN ('tasks.assigned', 'tasks.completed', 'tasks.unblocked', 'tasks.team_check_back',
                   'tasks.waiting_resolved', 'tasks.mentioned', 'notes.mention', 'comments.add',
                   'comments.edit', 'comments.team_mention', 'tasks.routed', 'tasks.reminder',
                   'tasks.agent_status', 'tasks.handed_back')
      AND (a.payload ?| ARRAY['title', 'excerpt', 'blocker_title', 'note'] OR a.payload::text LIKE '%Secret%'))
$$;

DO $$
DECLARE
  r text;
  v_comment uuid;
  v_quiet uuid;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('DS'), 'name', 'Design', 'members', jsonb_build_array(test.id('E'), test.id('F')))));

  -- assigned: O gives E a task in PO.
  r := test.make('O', jsonb_build_object('id', test.id('TA'), 'title', 'Secret assigned', 'bucket_id', test.id('PO'),
    'assignee_id', test.id('E')));
  -- completed: F finishes a task E made.
  r := test.make('E', jsonb_build_object('id', test.id('TC'), 'title', 'Secret made by E', 'bucket_id', test.id('PO')));
  r := test.as_user('F', format($q$SELECT * FROM public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$q$,
    test.id('W'), test.id('TC')));
  -- unblocked: E's task was waiting on one in O's private project.
  r := test.make('O', jsonb_build_object('id', test.id('TB'), 'title', 'Secret blocked', 'bucket_id', test.id('PO'),
    'assignee_id', test.id('E')));
  r := test.make('O', jsonb_build_object('id', test.id('TX'), 'title', 'Secret private blocker', 'bucket_id', test.id('PX')));
  INSERT INTO public.task_relations (id, workspace_id, blocker_task_id, blocked_task_id)
  VALUES (test.id('REL'), test.id('W'), test.id('TX'), test.id('TB'));
  r := test.as_user('O', format($q$SELECT * FROM public.tasks_op_set_status(%L, %L, 'done', NULL, NULL)$q$,
    test.id('W'), test.id('TX')));
  -- team check-back: E routed a task to Design three days ago; nobody took it.
  r := test.make('E', jsonb_build_object('id', test.id('TT'), 'title', 'Secret for the team', 'bucket_id', test.id('PO'),
    'team_id', test.id('DS'), 'assignee_id', NULL));
  SET LOCAL session_replication_role = replica;
  UPDATE public.tasks SET team_routed_at = now() - interval '4 days' WHERE id = test.id('TT');
  SET LOCAL session_replication_role = origin;
  PERFORM public.tasks__team_check_backs(now(), 100);
  -- mentioned: O names E in a task's description.
  r := test.make('O', jsonb_build_object('id', test.id('TM'), 'title', 'Secret mention', 'bucket_id', test.id('PO')));
  r := test.as_user('O', format($q$SELECT public.tasks_op_mention(%L, %L, %L::uuid[])$q$,
    test.id('W'), test.id('TM'), ARRAY[test.id('E')]));
  -- waiting resolved: E waits on F, and F comments.
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$, test.id('W'), test.id('TA'),
    jsonb_build_object('kind', 'person', 'ref', test.id('F'))));
  -- comments: F names E in a comment, names Design in it, and edits one to name E.
  r := test.as_user('F', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Secret comment text', %L::uuid[])$q$,
    test.id('W'), test.id('TA'), ARRAY[test.id('E')]));
  v_comment := (SELECT id FROM public.comments WHERE body = 'Secret comment text');
  r := test.as_user('F', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Secret quiet text', '{}'::uuid[])$q$,
    test.id('W'), test.id('TB')));
  v_quiet := (SELECT id FROM public.comments WHERE body = 'Secret quiet text');
  -- Design is named on a comment on a task E doesn't follow (so the team
  -- notice is E's only word of it).
  r := test.as_user('F', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Secret team text', '{}'::uuid[])$q$,
    test.id('W'), test.id('TM')));
  r := test.as_user('F', format($q$SELECT public.comments_op_mention_teams(%L, %L::uuid[])$q$,
    (SELECT id FROM public.comments WHERE body = 'Secret team text'), ARRAY[test.id('DS')]));
  r := test.as_user('F', format($q$SELECT public.comments_op_edit(%L, 'Secret edited text', %L::uuid[])$q$,
    v_quiet, ARRAY[test.id('E')]));
  -- a note mention: O names E in a note E may view.
  r := test.as_user('O', format($q$SELECT public.notes_op_create(%L, %L, NULL, 'Secret note title', NULL, NULL)$q$,
    test.id('W'), test.id('N')));
  -- O's alone, then shared with E.
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('N');
  UPDATE public.notes SET workspace_shared = false WHERE id = test.id('N');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'note', test.id('N'), 'member', test.id('E'), 'view', test.id('O'));
  r := test.as_user('O', format($q$SELECT public.notes_op_mention(%L, %L, %L::uuid[])$q$, test.id('W'), test.id('N'), ARRAY[test.id('E')]));

  PERFORM test.ok(test.bell($q$op = 'tasks.assigned'$q$) >= 1 AND test.bell($q$op = 'tasks.completed'$q$) = 1
              AND test.bell($q$op = 'tasks.unblocked'$q$) = 1 AND test.bell($q$op = 'tasks.team_check_back'$q$) = 1
              AND test.bell($q$op = 'tasks.mentioned'$q$) = 1 AND test.bell($q$op = 'tasks.waiting_resolved'$q$) = 1
              AND test.bell($q$op = 'comments.add'$q$) >= 1 AND test.bell($q$op = 'comments.team_mention'$q$) = 1
              AND test.bell($q$op = 'comments.edit'$q$) = 1 AND test.bell($q$op = 'notes.mention'$q$) = 1,
    'E''s bell has one of each notice', test.bell()::text);
  PERFORM test.ok(test.ids_only(), 'no notice carries a title, a note''s title or a comment''s text');
  PERFORM test.ok((SELECT payload ->> 'blocker_id' FROM public.module_activity WHERE op = 'tasks.unblocked') = test.id('TX')::text
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.entities WHERE entity_id = %L$q$, test.id('TX'))) = '0'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.entities WHERE entity_id = %L$q$, test.id('TB'))) = '1',
    'the blocker is named by id, and the registry names it only for whoever sees it (E never did; E sees the freed task)');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.comments WHERE id IN (%L, %L)$q$, v_comment, v_quiet)) = '2'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.entities WHERE entity_id IN (%L, %L)$q$, test.id('TA'), test.id('N'))) = '2',
    'while E sees them, the app can name the tasks and the note and read the comments');

  -- O takes the project and the note away from E.
  DELETE FROM public.resource_grants WHERE subject_id = test.id('E') AND resource_id IN (test.id('PO'), test.id('N'));
  UPDATE public.tasks SET assignee_id = NULL WHERE id IN (test.id('TA'), test.id('TB'));
  DELETE FROM public.resource_grants WHERE subject_id = test.id('E') AND resource_type = 'task';
  PERFORM test.ok(test.value_as('E', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TA'))) = 'false'
              AND test.value_as('E', format($q$SELECT public.tasks__visible(%L)::text$q$, test.id('TC'))) = 'false',
    'E no longer sees the project''s tasks');
  PERFORM test.ok(test.bell() >= 10
              AND test.bell($q$payload ?| ARRAY['title', 'excerpt', 'blocker_title'] OR payload::text LIKE '%%Secret%%'$q$) = 0,
    'E''s bell still lists the notices, with no title or comment text in any');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.entities WHERE entity_id IN (%L, %L, %L, %L, %L, %L)$q$,
                    test.id('TA'), test.id('TB'), test.id('TC'), test.id('TT'), test.id('TM'), test.id('N'))) = '0'
              AND test.value_as('E', format($q$SELECT count(*)::text FROM public.comments WHERE id IN (%L, %L)$q$, v_comment, v_quiet)) = '0',
    'and the reads the app names them through no longer answer E');
END;
$$;

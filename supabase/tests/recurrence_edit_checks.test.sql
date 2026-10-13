-- TV-D12 · Changing a repeat's occurrence needs edit access on the task
-- (supabase/migrations/20261013145000_recurrence_edit_checks.sql).
-- decisions "TV-D12".
--
-- Cast: O owns workspace W and the projects; E is a member who can edit SB
-- but only view PV; V is a workspace viewer. K1 is an API key of E's with
-- Tasks "view", K2 one with Tasks "edit".

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PV'), test.id('W'), test.id('O'), 'View only for E', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PV');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('E'), 'view', test.id('O')),
       (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('V'), 'view', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K1'), test.id('W'), 'Reader', 'mdo_k1', md5('db-test-k1'), '{"tasks": "view"}'::jsonb, test.id('E')),
  (test.id('K2'), test.id('W'), 'Agent', 'mdo_k2', md5('db-test-k2'), '{"tasks": "edit"}'::jsonb, test.id('E'));

CREATE FUNCTION test.repeat(p_name text, p_project text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project),
      'due_on', (now() AT TIME ZONE 'UTC')::date,
      'recurrence', jsonb_build_object('rrule', 'FREQ=WEEKLY',
        'dtstart', public.tasks__iso(((now() AT TIME ZONE 'UTC')::date + time '09:00') AT TIME ZONE 'UTC')))))
$$;
CREATE FUNCTION test.due(p_name text) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT due_on FROM public.tasks WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.skip(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT (public.tasks_op_skip_occurrence(%L, %L, NULL, NULL)).due_on$q$, test.id('W'), test.id(p_name))
$$;
CREATE FUNCTION test.move(p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT (public.tasks_op_move_occurrence(%L, %L, %L::date)).due_on$q$,
    test.id('W'), test.id(p_name), (now() AT TIME ZONE 'UTC')::date + 2)
$$;

DO $$
DECLARE
  d date := (now() AT TIME ZONE 'UTC')::date;
  r text;
BEGIN
  PERFORM test.repeat('Viewed', 'PV');
  PERFORM test.repeat('Shared', 'SB');

  -- Someone who can only view the task.
  r := test.as_user('E', test.skip('Viewed'));
  PERFORM test.ok(r LIKE '42501%' AND test.due('Viewed') = d,
    'skipping an occurrence needs edit access: a member who only views the task is refused', r);
  r := test.as_user('E', test.move('Viewed'));
  PERFORM test.ok(r LIKE '42501%' AND test.due('Viewed') = d,
    'moving just this one needs edit access too', r);
  r := test.as_user('E', format($q$UPDATE public.tasks SET recurrence = '{"rrule": "FREQ=DAILY"}'::jsonb WHERE id = %L$q$,
    test.id('Viewed')));
  PERFORM test.ok(r NOT LIKE 'ok 1' AND (SELECT recurrence ->> 'rrule' FROM public.tasks WHERE id = test.id('Viewed')) = 'FREQ=WEEKLY',
    'changing the rule directly needs edit access (the rule-change trigger never runs for a refused write)', r);

  -- A workspace viewer.
  r := test.as_user('V', test.skip('Viewed'));
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.due('Viewed') = d, 'a workspace viewer can''t skip', r);
  r := test.as_user('V', test.move('Viewed'));
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.due('Viewed') = d, 'or move one', r);

  -- API keys: a reading key, and an editing key whose person only views the task.
  r := test.as_key('K1', test.skip('Shared'));
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.due('Shared') = d, 'a key with Tasks "view" can''t skip', r);
  r := test.as_key('K1', test.move('Shared'));
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.due('Shared') = d, 'or move one', r);
  r := test.as_key('K2', test.skip('Viewed'));
  PERFORM test.ok(r LIKE '42501%' AND test.due('Viewed') = d,
    'an editing key can''t skip on a task its person only views', r);
  r := test.as_key('K2', test.move('Viewed'));
  PERFORM test.ok(r LIKE '42501%' AND test.due('Viewed') = d, 'or move one there', r);

  -- Someone who can edit it still can.
  r := test.as_key('K2', test.skip('Shared'));
  PERFORM test.ok(r LIKE 'ok%' AND test.due('Shared') = d + 7, 'an editing key skips where its person can edit', r);
  r := test.as_user('E', test.move('Shared'));
  PERFORM test.ok(r LIKE 'ok%' AND test.due('Shared') = d + 2, 'and a member who can edit moves one', r);
  r := test.as_user('O', test.skip('Viewed'));
  PERFORM test.ok(r LIKE 'ok%' AND test.due('Viewed') = d + 7, 'the owner skips on the view-only project', r);

  -- Grants on the ops.
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.tasks_op_move_occurrence(uuid, uuid, date, timestamptz)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.tasks_op_skip_occurrence(uuid, uuid, timestamptz, jsonb, boolean)', 'EXECUTE'),
    'grants: the two ops are for signed-in people and keys, never anon');
END;
$$;

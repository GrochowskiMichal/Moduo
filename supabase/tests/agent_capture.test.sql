-- TV-U13b · The Inbox's agent chip ("via Claude Desktop"): the app reads a
-- task's `tasks.create` trail row when a key made it (no new column; decision
-- U13b-3). This pins the rule the chip relies on: a key's name reaches only
-- people who can see the task, the same as the trail.
--
-- Cast: O owns workspace W. E and F are members, V is a viewer, X owns
-- another workspace W2. SB is shared with the workspace. K is E's key with
-- Tasks edit ("Claude Desktop").

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_k', md5('db-test-k'), '{"tasks": "edit"}'::jsonb, test.id('E'));

-- The app's read (runtime.web listAgentCaptures), as a person, through RLS:
-- the labels of key-made creates among these tasks.
CREATE FUNCTION test.chips(p_who text, p_tasks text[]) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(test.value_as(p_who, format($q$
    SELECT string_agg(actor_label, ' | ' ORDER BY actor_label) FROM public.module_activity
    WHERE workspace_id = %L AND module = 'tasks' AND entity_type = 'task'
      AND op = 'tasks.create' AND actor_type = 'api_key' AND entity_id = ANY(%L::uuid[])$q$,
    test.id('W'), (SELECT array_agg(test.id(t)) FROM unnest(p_tasks) AS t))), '')
$$;

DO $$
DECLARE
  r text;
BEGIN
  -- The agent captures one task into E's Inbox and files one in Shared.
  r := test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TI'), 'title', 'Captured by the agent')));
  PERFORM test.ok(r LIKE 'ok%', 'the key captures into its person''s Inbox', r);
  r := test.as_key('K', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TS'), 'title', 'Filed by the agent', 'bucket_id', test.id('SB'))));
  PERFORM test.ok(r LIKE 'ok%', 'the key files one in a shared project', r);
  -- A task E makes by hand has no chip.
  r := test.as_user('E', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TH'), 'title', 'Made by hand')));
  PERFORM test.ok(r LIKE 'ok%', 'E makes one by hand', r);

  PERFORM test.ok(test.chips('E', ARRAY['TI', 'TH']) = 'E · via Claude Desktop',
    'E reads the chip on the agent''s capture, and none on a task made by hand',
    test.chips('E', ARRAY['TI', 'TH']));
  PERFORM test.ok(test.chips('F', ARRAY['TI']) = '',
    'a teammate who can''t see E''s Inbox task never reads the key''s name', test.chips('F', ARRAY['TI']));
  PERFORM test.ok(test.chips('O', ARRAY['TI']) = '',
    'neither does the workspace''s owner', test.chips('O', ARRAY['TI']));
  PERFORM test.ok(test.chips('X', ARRAY['TI', 'TS']) = '',
    'nor someone from another workspace', test.chips('X', ARRAY['TI', 'TS']));
  PERFORM test.ok(test.chips('F', ARRAY['TS']) = 'E · via Claude Desktop'
              AND test.chips('V', ARRAY['TS']) = 'E · via Claude Desktop',
    'people who can see a task read how it was made, as its trail already says');

  -- Handed to F's Inbox, F can see it, and with it how it was made.
  r := test.as_user('E', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$,
    test.id('W'), test.id('TI'), test.id('F')));
  PERFORM test.ok(r LIKE 'ok%', 'E assigns the capture to F', r);
  PERFORM test.ok(test.chips('F', ARRAY['TI']) = 'E · via Claude Desktop',
    'once F can see the task, F reads its chip', test.chips('F', ARRAY['TI']));
  PERFORM test.ok(test.chips('V', ARRAY['TI']) = '',
    'a viewer who still can''t see it reads nothing', test.chips('V', ARRAY['TI']));
END $$;

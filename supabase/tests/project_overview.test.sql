-- TV-U16 · A project's description, and archived projects as team defaults
-- (supabase/migrations/20261013240000_project_description_team_defaults.sql).
-- specs/tasks-v3.md §3 ("Projects: description …"), REPLAN 16 and 78; the
-- hackathon's prepared projects open on their description.
--
-- Cast: O owns workspace W. E is a member who works on tasks, V a viewer, N a
-- member who can't see O's private project PB, X belongs to another workspace.
-- P is shared with the workspace (E edits it, V reads it).

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'N', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');

CREATE FUNCTION test.description(p_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT description FROM public.buckets WHERE id = test.id(p_name)
$$;
CREATE FUNCTION test.update(p_who text, p_project text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format('SELECT * FROM public.projects_op_update(%L, %L, %L::jsonb)',
                                    test.id('W'), test.id(p_project), p_patch))
$$;

DO $$
DECLARE
  r text;
  v_copy uuid := test.id('P copy');
BEGIN
  -- ── Made with one, through the op ────────────────────────────────────────────
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P'), 'name', 'Hackathon kit',
                       'description', E'Build something with the API.\nJudging on Sunday.  ')));
  PERFORM test.ok(r = 'ok 1', 'a project is made with a description', r);
  PERFORM test.ok(test.description('P') = E'Build something with the API.\nJudging on Sunday.',
    'the description is kept as typed, trailing space trimmed', test.description('P'));
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('P0'), 'name', 'No words')));
  PERFORM test.ok(test.description('P0') = '', 'a project made without one has none ('''')');
  r := test.as_user('O', format($q$SELECT public.projects_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('PB'), 'name', 'Private plans', 'description', 'Only mine')));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
  PERFORM test.ok(public.can_access('bucket', test.id('P'), 'edit', test.id('E'))
              AND public.can_access('bucket', test.id('P'), 'view', test.id('V'))
              AND NOT public.can_access('bucket', test.id('P'), 'edit', test.id('V'))
              AND NOT public.can_access('bucket', test.id('PB'), 'view', test.id('N')),
    'setup: E edits P, V only reads it, N can''t see PB');

  -- ── Edited through projects_op_update, with Edit ────────────────────────────
  r := test.update('E', 'P', '{"description": "Ship by Sunday 18:00."}');
  PERFORM test.ok(r = 'ok 1' AND test.description('P') = 'Ship by Sunday 18:00.',
    'someone who can edit the project changes its description', r);
  r := test.update('E', 'P', '{"description": null}');
  PERFORM test.ok(r = 'ok 1' AND test.description('P') = '', 'null clears it', r);
  PERFORM test.update('E', 'P', '{"description": "Ship by Sunday 18:00."}');
  r := test.update('E', 'P', jsonb_build_object('description', repeat('x', 20001)));
  PERFORM test.ok(r LIKE '22023%up to 20,000%' AND test.description('P') = 'Ship by Sunday 18:00.',
    'more than 20,000 characters is refused', r);
  r := test.update('E', 'P', '{"description": 42}');
  PERFORM test.ok(r LIKE '22023%is text%', 'a description that isn''t text is refused', r);
  r := test.update('E', 'P', jsonb_build_object('description', repeat('y', 20000)));
  PERFORM test.ok(r = 'ok 1' AND char_length(test.description('P')) = 20000, 'exactly 20,000 is fine', r);
  PERFORM test.update('E', 'P', '{"description": "Ship by Sunday 18:00."}');

  -- ── A viewer can't write it ──────────────────────────────────────────────────
  r := test.update('V', 'P', '{"description": "Viewer was here"}');
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.description('P') = 'Ship by Sunday 18:00.',
    'a viewer can''t change the description through the op', r);
  r := test.as_user('V', format($q$UPDATE public.buckets SET description = 'Viewer was here' WHERE id = %L$q$,
    test.id('P')));
  PERFORM test.ok(test.description('P') = 'Ship by Sunday 18:00.',
    'nor by writing the row', r);

  -- ── Only the op writes it, even for an editor ────────────────────────────────
  r := test.as_user('E', format($q$UPDATE public.buckets SET description = 'Raw write', name = 'Hackathon kit 2' WHERE id = %L$q$,
    test.id('P')));
  PERFORM test.ok(r = 'ok 1' AND test.description('P') = 'Ship by Sunday 18:00.'
              AND (SELECT name FROM public.buckets WHERE id = test.id('P')) = 'Hackathon kit 2',
    'an editor''s direct write keeps the description (the rest of the row saves)', r);
  r := test.as_user('E', format($q$INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, description)
                                  VALUES (%L, %L, %L, 'Raw', false, 'Raw words')$q$,
    test.id('PR'), test.id('W'), test.id('E')));
  PERFORM test.ok(r = 'ok 1' AND test.description('PR') = '',
    'a project inserted directly starts with no description', r);
  r := test.update('E', 'P', '{"name": "Hackathon kit"}');
  PERFORM test.ok(test.description('P') = 'Ship by Sunday 18:00.', 'another field''s edit leaves it alone', r);

  -- ── Who reads it ─────────────────────────────────────────────────────────────
  PERFORM test.ok(test.value_as('V', format('SELECT description FROM public.buckets WHERE id = %L', test.id('P')))
                  = 'Ship by Sunday 18:00.',
    'a viewer of the project reads it');
  PERFORM test.ok(test.value_as('N', format('SELECT count(*)::text FROM public.buckets WHERE id = %L', test.id('PB'))) = '0',
    'a member who can''t see a private project doesn''t read its row (nor its description)');
  r := test.update('N', 'PB', '{"description": "Mine now"}');
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.description('PB') = 'Only mine',
    'nor can they write it', r);
  PERFORM test.ok(test.value_as('X', format('SELECT count(*)::text FROM public.buckets WHERE id = %L', test.id('P'))) = '0',
    'someone from another workspace doesn''t read it');
  r := test.as_user('X', format('SELECT * FROM public.projects_op_update(%L, %L, %L::jsonb)',
    test.id('W'), test.id('P'), '{"description": "Outsider"}'));
  PERFORM test.ok(r NOT LIKE 'ok%' AND test.description('P') = 'Ship by Sunday 18:00.',
    'nor write it', r);

  -- ── Templates and Duplicate carry it (TV-D15) ────────────────────────────────
  PERFORM test.ok(public.project_templates__body_of(test.id('P'), test.id('E')) ->> 'description'
                  = 'Ship by Sunday 18:00.',
    'a project''s template body carries its description');
  r := test.as_user('E', format($q$SELECT public.projects_op_duplicate(%L, %L, %L::jsonb)$q$, test.id('W'),
    test.id('P'), jsonb_build_object('id', v_copy, 'name', 'Hackathon kit (team 2)')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT description FROM public.buckets WHERE id = v_copy) = 'Ship by Sunday 18:00.',
    'Duplicate project… copies the description', r);
  PERFORM test.ok((public.project_templates__body_of(test.id('P0'), test.id('O')) ->> 'description') = '',
    'a project without one gives an empty one');
END;
$$;

-- ── A team's default project is never an archived one ──────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('E', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T'), 'name', 'Judges', 'default_project_id', test.id('P'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT default_project_id FROM public.teams WHERE id = test.id('T')) = test.id('P'),
    'setup: Judges file into P', r);
  r := test.as_user('E', format('SELECT public.tasks_op_create(%L, %L::jsonb)', test.id('W'),
    jsonb_build_object('id', test.id('t1'), 'title', 'Score team 1', 'team_id', test.id('T'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT bucket_id FROM public.tasks WHERE id = test.id('t1')) = test.id('P'),
    'a task for the team lands in its default', r);

  r := test.as_user('O', format('SELECT * FROM public.projects_op_update(%L, %L, %L::jsonb)',
    test.id('W'), test.id('P'), '{"archived_at": "now"}'));
  PERFORM test.ok(r = 'ok 1' AND (SELECT archived_at FROM public.buckets WHERE id = test.id('P')) IS NOT NULL,
    'setup: O archives P', r);
  r := test.as_user('E', format('SELECT public.tasks_op_create(%L, %L::jsonb)', test.id('W'),
    jsonb_build_object('id', test.id('t2'), 'title', 'Score team 2', 'team_id', test.id('T'))));
  PERFORM test.ok(r LIKE '22023%needs a project%' AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = test.id('t2')),
    'an archived default counts as none: a task for the team asks for a project', r);
  r := test.as_user('E', format('SELECT public.tasks_op_create(%L, %L::jsonb)', test.id('W'),
    jsonb_build_object('id', test.id('t3'), 'title', 'Score team 3', 'team_id', test.id('T'),
                       'bucket_id', test.id('P0'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT bucket_id FROM public.tasks WHERE id = test.id('t3')) = test.id('P0'),
    'with a project picked it files there', r);

  r := test.as_user('E', format($q$SELECT public.teams_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'name', 'Mentors', 'default_project_id', test.id('P'))));
  PERFORM test.ok(r LIKE '22023%archived%' AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id = test.id('T2')),
    'a new team can''t name an archived default', r);
  r := test.as_user('E', format('SELECT public.teams_op_update(%L, %L, %L::jsonb)', test.id('W'), test.id('T'),
    jsonb_build_object('default_project_id', test.id('P0'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT default_project_id FROM public.teams WHERE id = test.id('T')) = test.id('P0'),
    'its default can be replaced with a live one', r);
  r := test.as_user('E', format('SELECT public.teams_op_update(%L, %L, %L::jsonb)', test.id('W'), test.id('T'),
    jsonb_build_object('default_project_id', test.id('P'))));
  PERFORM test.ok(r LIKE '22023%archived%' AND (SELECT default_project_id FROM public.teams WHERE id = test.id('T')) = test.id('P0'),
    'and not with an archived one', r);

  -- Unarchived, it works as a default again.
  PERFORM test.as_user('O', format('SELECT * FROM public.projects_op_update(%L, %L, %L::jsonb)',
    test.id('W'), test.id('P'), '{"archived_at": null}'));
  r := test.as_user('E', format('SELECT public.teams_op_update(%L, %L, %L::jsonb)', test.id('W'), test.id('T'),
    jsonb_build_object('default_project_id', test.id('P'))));
  r := test.as_user('E', format('SELECT public.tasks_op_create(%L, %L::jsonb)', test.id('W'),
    jsonb_build_object('id', test.id('t4'), 'title', 'Score team 4', 'team_id', test.id('T'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT bucket_id FROM public.tasks WHERE id = test.id('t4')) = test.id('P'),
    'unarchived, the project is the team''s default again', r);
END;
$$;

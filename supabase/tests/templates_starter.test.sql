-- TV-U17 · Starter templates (supabase/migrations/20261013230000_templates_starter.sql).
-- The role question's starter template is a project template Moduo ships.
-- The app names it by key and the server builds the body, so: only a member
-- with Tasks edit makes one; the body passes D15's validator and names no
-- people, teams, tags, links or projects; the template is the caller's,
-- private and never shareable; API keys are refused; a resend makes nothing
-- twice; and it applies like any other template.
--
-- Cast: O owns workspace W, M is a member who works on tasks, A an admin, V a
-- viewer, X owns another workspace W2 and isn't in W.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'A', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('A'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit"}'::jsonb, test.id('O'));

CREATE FUNCTION test.starter(p_who text, p_ws text, p_fields jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.try(p_who, format($q$SELECT public.project_templates_op_starter(%L, %L::jsonb)$q$,
                                test.id(p_ws), p_fields))
$$;

DO $$
DECLARE
  r text;
  v_tid uuid := test.id('T1');
  x public.project_templates;
  k text;
BEGIN
  -- ── Every starter Moduo ships is a readable body naming nobody ────────────
  FOREACH k IN ARRAY ARRAY['kickoff', 'monthly_close', 'client_onboarding', 'episode'] LOOP
    PERFORM public.templates__check_body('project', public.templates__starter_body(k));
    PERFORM test.ok(
      NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.templates__starter_body(k) -> 'tasks') e
                  WHERE jsonb_typeof(e -> 'assignee') <> 'null' OR jsonb_typeof(e -> 'team') <> 'null'
                     OR jsonb_array_length(e -> 'tags') > 0 OR jsonb_array_length(e -> 'links') > 0),
      format('the %s starter passes the validator and names no people, teams, tags or links', k));
  END LOOP;
  PERFORM test.ok(public.templates__starter_body('nope') IS NULL, 'an unknown key has no body');

  -- ── Made by a member: theirs, private, unshareable ────────────────────────
  r := test.as_user('M', format($q$SELECT public.project_templates_op_starter(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', v_tid, 'starter', 'kickoff')));
  SELECT * INTO x FROM public.project_templates WHERE id = v_tid;
  PERFORM test.ok(r LIKE 'ok%' AND x.owner_id = test.id('M') AND x.workspace_id = test.id('W')
              AND NOT x.shared AND NOT x.shareable AND NOT x.private_source
              AND x.source_ids = '{}'::uuid[] AND x.name = 'Project kickoff'
              AND x.body = public.templates__starter_body('kickoff')
              AND (x.summary ->> 'tasks')::int = 8,
    'a member makes the Project kickoff starter: theirs, private, unshareable, the shipped body', r);
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.project_templates WHERE id = %L$q$, v_tid)) = '0',
    'nobody else reads it, the workspace owner included');

  -- ── A resend makes nothing twice; nobody else can claim the id ────────────
  r := test.as_user('M', format($q$SELECT public.project_templates_op_starter(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', v_tid, 'starter', 'episode')));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT count(*) FROM public.project_templates WHERE owner_id = test.id('M')) = 1
              AND (SELECT name FROM public.project_templates WHERE id = v_tid) = 'Project kickoff',
    'the same id again answers with the template it made', r);
  r := test.starter('O', 'W', jsonb_build_object('id', v_tid, 'starter', 'kickoff'));
  PERFORM test.ok(r LIKE '22023%isn''t here any more%', 'someone else can''t claim that id', r);

  -- ── Never shared, by its owner or by an admin ─────────────────────────────
  r := test.try('M', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), v_tid));
  PERFORM test.ok(r LIKE '42501%', 'its owner can''t share it (it has no source to have Full on)', r);
  r := test.try('A', format($q$SELECT public.templates_op_update(%L, 'project', %L, '{"shared": true}'::jsonb)$q$,
    test.id('W'), v_tid));
  PERFORM test.ok(r NOT LIKE 'ok%' AND NOT (SELECT shared FROM public.project_templates WHERE id = v_tid),
    'nor can an admin', r);

  -- ── Who can't ─────────────────────────────────────────────────────────────
  r := test.starter('V', 'W', '{"starter": "kickoff"}'::jsonb);
  PERFORM test.ok(r LIKE '42501%edit access to Tasks%', 'a viewer can''t make one', r);
  r := test.starter('X', 'W', '{"starter": "kickoff"}'::jsonb);
  PERFORM test.ok(r LIKE '42501%' AND NOT EXISTS (SELECT 1 FROM public.project_templates WHERE owner_id = test.id('X')),
    'nor can someone outside the workspace', r);
  r := test.as_key('K', format($q$SELECT public.project_templates_op_starter(%L, '{"starter": "kickoff"}'::jsonb)$q$,
    test.id('W')));
  PERFORM test.ok(r LIKE '42501%changed in the app%'
              AND NOT EXISTS (SELECT 1 FROM public.project_templates WHERE owner_id = test.id('O')),
    'nor can an API key', r);

  -- ── Only a key Moduo ships; the client never sends a body ─────────────────
  r := test.starter('M', 'W', '{"starter": "sprint"}'::jsonb);
  PERFORM test.ok(r LIKE '22023%no starter template%', 'an unknown starter is refused', r);
  r := test.starter('M', 'W', '{}'::jsonb);
  PERFORM test.ok(r LIKE '22023%no starter template%', 'no key, no template', r);
  r := test.starter('M', 'W', jsonb_build_object('starter', 'kickoff',
    'body', public.templates__starter_body('kickoff') || jsonb_build_object('name', 'Mine')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'a body sent by the client is refused', r);
  r := test.starter('M', 'W', '{"starter": "kickoff", "shared": true}'::jsonb);
  PERFORM test.ok(r NOT LIKE 'ok%', 'so is asking for it shared', r);

  -- ── It applies like any other template ────────────────────────────────────
  r := test.as_user('M', format($q$SELECT public.project_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'), v_tid,
    jsonb_build_object('id', test.id('P1'), 'name', 'Acme kickoff', 'starts_on', '2026-11-02')));
  PERFORM test.ok(r LIKE 'ok%'
              AND EXISTS (SELECT 1 FROM public.buckets WHERE id = test.id('P1') AND name = 'Acme kickoff')
              AND (SELECT count(*) FROM public.tasks WHERE bucket_id = test.id('P1') AND deleted_at IS NULL) = 8
              AND (SELECT count(*) FROM public.sections WHERE project_id = test.id('P1') AND deleted_at IS NULL) = 3
              AND EXISTS (SELECT 1 FROM public.tasks WHERE bucket_id = test.id('P1') AND title = 'Write a one-page brief'
                            AND due_on = '2026-11-04'),
    'applying it makes the project with its sections, tasks and dates', r);
  r := test.as_user('M', format($q$SELECT public.project_templates_op_starter(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'starter', 'episode')));
  r := test.as_user('M', format($q$SELECT public.project_templates_op_apply(%L, %L, %L::jsonb)$q$, test.id('W'),
    test.id('T2'), jsonb_build_object('id', test.id('P2'), 'starts_on', '2026-11-02')));
  PERFORM test.ok(r LIKE 'ok%'
              -- Positions count inside a category.
              AND (SELECT string_agg(name, ' · ' ORDER BY array_position(
                            ARRAY['backlog', 'todo', 'in_progress', 'done', 'wont_do'], category), position)
                   FROM public.project_statuses
                   WHERE project_id = test.id('P2') AND category IN ('backlog', 'in_progress', 'done')
                     AND deleted_at IS NULL) = 'Ideas · Drafting · Editing · Published',
    'the Episode starter opens as the creator''s pipeline', r);
END;
$$;

-- TV-D11b · What the shared store reads at 10,000 tasks
-- (supabase/migrations/20261011120000_tasks_sync_feed_search.sql): tombstones for
-- the hard-delete tables, the grant feed, tasks_search, the Realtime
-- publication. specs/tasks-v3.md AC12.3 (search on the server) and the
-- TV-D11a deferrals (BUILD_ORDER "From TV-D11a").
--
-- Cast: O owns workspace W; M is a member, V a viewer; X owns W2 and is an
-- outsider here. SB is shared with the workspace, PB is O's private project.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'V', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('V'), 'viewer');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false);
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title, description, position) VALUES
  (test.id('T1'), test.id('W'), test.id('O'), test.id('SB'), 'Feed the quokka', '', 'a'),
  (test.id('T2'), test.id('W'), test.id('O'), test.id('SB'), 'Plan the launch',
    '<p dir="ltr"><span style="white-space: pre-wrap;">Bring the QUOKKA &amp; friends</span></p>', 'b'),
  (test.id('T3'), test.id('W'), test.id('O'), test.id('PB'), 'Private quokka plans', '', 'c'),
  (test.id('T4'), test.id('W'), test.id('O'), test.id('SB'), 'Linked note',
    '<p><span data-lexical-entity-ref="x" class="ref">Secret quokka</span> and more</p>', 'd'),
  (test.id('T5'), test.id('W'), test.id('O'), test.id('SB'), '50% off_sale', '', 'e');
INSERT INTO public.tags (id, workspace_id, owner_id, name) VALUES
  (test.id('TG'), test.id('W'), test.id('O'), 'bug');

CREATE FUNCTION test.search(p_who text, p_query text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(x::text, ',' ORDER BY x::text), '') FROM public.tasks_search(%L, %L) AS x$q$,
    test.id('W'), p_query));
  RETURN v;
END;
$$;
CREATE FUNCTION test.ids(VARIADIC p_names text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(x::text, ',' ORDER BY x::text) FROM (SELECT test.id(n) AS x FROM unnest(p_names) AS n) s
$$;
CREATE FUNCTION test.feed(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(resource_type || ':' || resource_id || ':' || coalesce(user_id::text, '*'), ' ' ORDER BY id), '')
       FROM public.access_changes WHERE workspace_id = %L$q$, test.id('W')))
$$;

DO $$
DECLARE
  r text;
  v_link uuid := test.id('L1');
  v_before text;
BEGIN
  -- ── Tombstones: a hard delete leaves a mark the store reads ───────────────
  r := test.as_op('M', format($q$INSERT INTO public.tag_links (id, workspace_id, tag_id, entity_type, entity_id)
    VALUES (%L, %L, %L, 'task', %L)$q$, v_link, test.id('W'), test.id('TG'), test.id('T1')));
  PERFORM test.ok(r = 'ok 1'
      AND (SELECT updated_at IS NOT NULL FROM public.tag_links WHERE id = v_link),
    'a tag link is stamped by the server when it is made', r);
  PERFORM test.as_op('M', format($q$DELETE FROM public.tag_links WHERE id = %L$q$, v_link));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.sync_tombstones
      WHERE table_name = 'tag_links' AND row_id = v_link AND workspace_id = test.id('W')),
    'deleting it leaves a tombstone: table, id, workspace, when');
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.sync_tombstones WHERE row_id = %L$q$, v_link)) = '1'
      AND test.value_as('X', format($q$SELECT count(*)::text FROM public.sync_tombstones WHERE row_id = %L$q$, v_link)) = '0',
    'members read the workspace''s tombstones; an outsider reads none');
  r := test.try('M', format($q$INSERT INTO public.sync_tombstones (table_name, row_id, workspace_id) VALUES ('tag_links', %L, %L)$q$,
    test.id('fake'), test.id('W')));
  PERFORM test.ok(r LIKE '42501%', 'nobody writes a tombstone by hand', r);
  PERFORM test.as_op('O', format($q$INSERT INTO public.task_queue (id, workspace_id, user_id, task_id, position)
    VALUES (%L, %L, %L, %L, 'a0')$q$, test.id('Q1'), test.id('W'), test.id('O'), test.id('T1')));
  PERFORM test.as_op('O', format($q$DELETE FROM public.task_queue WHERE id = %L$q$, test.id('Q1')));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.sync_tombstones WHERE table_name = 'task_queue' AND row_id = test.id('Q1')),
    'a queue row taken out leaves one too');

  -- ── The grant feed ────────────────────────────────────────────────────────
  DELETE FROM public.access_changes WHERE workspace_id = test.id('W');
  PERFORM test.as_op('O', format($q$INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level)
    VALUES (%L, 'bucket', %L, 'member', %L, 'view')$q$, test.id('W'), test.id('PB'), test.id('M')));
  PERFORM test.ok(test.feed('M') = 'bucket:' || test.id('PB') || ':' || test.id('M'),
    'sharing a project with M tells M', test.feed('M'));
  PERFORM test.ok(test.feed('V') = '' AND test.feed('X') = '',
    'and nobody else: not another member, not an outsider', test.feed('V'));
  PERFORM test.as_op('O', format($q$UPDATE public.resource_grants SET level = 'edit'
    WHERE resource_type = 'bucket' AND resource_id = %L AND subject_id = %L$q$, test.id('PB'), test.id('M')));
  PERFORM test.as_op('O', format($q$DELETE FROM public.resource_grants
    WHERE resource_type = 'bucket' AND resource_id = %L AND subject_id = %L$q$, test.id('PB'), test.id('M')));
  PERFORM test.ok((SELECT count(*) FROM public.access_changes WHERE workspace_id = test.id('W') AND user_id = test.id('M')) = 3,
    'changing the share and taking it away say so too (one row each)');
  PERFORM test.as_op('O', format($q$INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level)
    VALUES (%L, 'task', %L, 'workspace', NULL, 'view')$q$, test.id('W'), test.id('T3')));
  PERFORM test.ok(test.feed('V') = 'task:' || test.id('T3') || ':*',
    'a task shared with the workspace tells everyone in it', test.feed('V'));
  DELETE FROM public.resource_grants WHERE resource_type = 'task' AND resource_id = test.id('T3');
  DELETE FROM public.access_changes WHERE workspace_id = test.id('W');
  PERFORM test.as_op('O', format($q$UPDATE public.tasks SET bucket_id = %L WHERE id = %L$q$, test.id('PB'), test.id('T1')));
  PERFORM test.ok(test.feed('M') = 'task:' || test.id('T1') || ':*',
    'a task moved to another project tells the workspace (who sees it may change)', test.feed('M'));
  PERFORM test.as_op('O', format($q$UPDATE public.tasks SET title = 'Feed the quokka now' WHERE id = %L$q$, test.id('T1')));
  PERFORM test.ok((SELECT count(*) FROM public.access_changes WHERE workspace_id = test.id('W')) = 1,
    'any other edit says nothing');
  PERFORM test.as_op('O', format($q$UPDATE public.tasks SET bucket_id = %L WHERE id = %L$q$, test.id('SB'), test.id('T1')));
  DELETE FROM public.access_changes WHERE workspace_id = test.id('W');
  UPDATE public.workspace_members SET role = 'viewer' WHERE workspace_id = test.id('W') AND user_id = test.id('M');
  PERFORM test.ok(test.feed('M') = 'workspace:' || test.id('W') || ':' || test.id('M') AND test.feed('V') = '',
    'a member''s role changing tells that member', test.feed('M'));
  UPDATE public.workspace_members SET role = 'member' WHERE workspace_id = test.id('W') AND user_id = test.id('M');
  r := test.try('M', format($q$INSERT INTO public.access_changes (workspace_id, resource_type, resource_id) VALUES (%L, 'task', %L)$q$,
    test.id('W'), test.id('T1')));
  PERFORM test.ok(r LIKE '42501%', 'nobody writes the feed by hand', r);

  -- ── tasks_search ──────────────────────────────────────────────────────────
  PERFORM test.ok(test.search('M', 'quokka') = test.ids('T1', 'T2'),
    'every word, in a title or the description''s text; never a private project''s task', test.search('M', 'quokka'));
  PERFORM test.ok(test.search('O', 'quokka') = test.ids('T1', 'T2', 'T3'),
    'its owner finds the private one', test.search('O', 'quokka'));
  PERFORM test.ok(test.search('M', 'quokka friends') = test.ids('T2') AND test.search('M', 'QUOKKA &') = test.ids('T2'),
    'all the words count, case aside; entities read as their characters', test.search('M', 'quokka friends'));
  PERFORM test.ok(test.search('M', 'span') = '' AND test.search('M', 'secret') = '',
    'the HTML itself and a reference''s stored text are never searched', test.search('M', 'span'));
  PERFORM test.ok(test.search('M', '50%') = test.ids('T5') AND test.search('M', 'off_') = test.ids('T5')
      AND test.search('M', '%') = test.ids('T5'),
    '% and _ are just characters', test.search('M', '%'));
  PERFORM test.ok(test.search('M', '   ') = '', 'an empty query finds nothing');
  PERFORM test.ok(test.search('X', 'quokka') = '', 'an outsider finds nothing', test.search('X', 'quokka'));
  r := test.value_as('M', format($q$SELECT count(*)::text FROM public.tasks_search(%L, 'quokka', 1)$q$, test.id('W')));
  PERFORM test.ok(r = '1', 'the limit holds', r);

  -- ── Deletes that cascade still go through (an account's erasure) ─────────
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W3'), test.id('X'), 'Gone soon');
  INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
    (test.id('GB'), test.id('W3'), test.id('X'), 'Shared there', false);
  INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title, position) VALUES
    (test.id('GT'), test.id('W3'), test.id('X'), test.id('GB'), 'Queued there', 'a');
  INSERT INTO public.task_queue (workspace_id, user_id, task_id, position)
    VALUES (test.id('W3'), test.id('X'), test.id('GT'), 'a0');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level)
    VALUES (test.id('W3'), 'bucket', test.id('GB'), 'workspace', NULL, 'view');
  r := test.as_op(NULL, format($q$DELETE FROM public.workspaces WHERE id = %L$q$, test.id('W3')));
  PERFORM test.ok(r = 'ok 1'
      AND NOT EXISTS (SELECT 1 FROM public.sync_tombstones WHERE workspace_id = test.id('W3'))
      AND NOT EXISTS (SELECT 1 FROM public.access_changes WHERE workspace_id = test.id('W3')),
    'deleting a workspace cascades through its queue and shares, leaving no marks behind', r);
  PERFORM test.as_op('O', format($q$INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level)
    VALUES (%L, 'bucket', %L, 'member', %L, 'view')$q$, test.id('W'), test.id('PB'), test.id('V')));
  r := test.as_op(NULL, format($q$DELETE FROM auth.users WHERE id = %L$q$, test.id('V')));
  PERFORM test.ok(r = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.access_changes WHERE user_id = test.id('V')),
    'deleting a member''s account cascades through their shares; their feed rows go with them', r);

  -- ── Realtime ──────────────────────────────────────────────────────────────
  PERFORM test.ok(
    (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
       AND tablename IN ('task_completions', 'attachments', 'access_changes')) = 3,
    'completions, attachments and the grant feed are published');
END;
$$;

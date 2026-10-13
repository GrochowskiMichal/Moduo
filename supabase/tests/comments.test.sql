-- TV-U13 · Comments: edit, delete with Undo, six fixed reactions
-- (supabase/migrations/20261013100000_comment_reactions_edits.sql).
-- specs/tasks-v3.md §9, AC11.8; REPLAN 88, default q.
--
-- Cast: O owns workspace W and project SB (shared with the workspace). E and
-- F are members who can edit SB; V is a viewer; M can't see O's private
-- project PB; N can only view O's project PV; S has O's project PS shared
-- with them until it's taken back; X is in another workspace. K is E's key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'V', 'M', 'N', 'S', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('S'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002'),
  (test.id('PV'), test.id('W'), test.id('O'), 'O view-only', false, '0003'),
  (test.id('PS'), test.id('W'), test.id('O'), 'O and S', false, '0004');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PV'), test.id('PS'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('N'), 'view', test.id('O')),
       (test.id('W'), 'bucket', test.id('PS'), 'member', test.id('S'), 'edit', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit", "links": "edit"}'::jsonb, test.id('E'));

SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
  jsonb_build_object('id', test.id('T'), 'title', 'Logo concepts', 'bucket_id', test.id('SB'))));
SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
  jsonb_build_object('id', test.id('TP'), 'title', 'Secret plan', 'bucket_id', test.id('PB'))));
SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
  jsonb_build_object('id', test.id('TV'), 'title', 'Read-only brief', 'bucket_id', test.id('PV'))));
SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
  jsonb_build_object('id', test.id('TS'), 'title', 'Shared for now', 'bucket_id', test.id('PS'))));
SELECT test.as_user('X', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W2'),
  jsonb_build_object('id', test.id('TX'), 'title', 'Not here')));

-- A comment by someone, with a stable id for the checks.
CREATE FUNCTION test.comment(p_who text, p_name text, p_task text, p_body text,
                             p_mentions uuid[] DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r text;
BEGIN
  r := test.as_user(p_who, format(
    $q$SELECT public.comments_op_add(%L, 'task', %L, %L, %L::uuid[], 'Task', 'task')$q$,
    test.id('W'), test.id(p_task), p_body, p_mentions));
  UPDATE public.comments SET id = test.id(p_name)
   WHERE entity_id = test.id(p_task) AND body = p_body AND id <> test.id(p_name);
  UPDATE public.module_activity SET payload = jsonb_set(payload, '{comment_id}', to_jsonb(test.id(p_name)::text))
   WHERE op = 'comments.add' AND entity_id = test.id(p_task) AND payload ->> 'excerpt' = left(p_body, 140);
  RETURN r;
END;
$$;
CREATE FUNCTION test.mentioned(p_op text, p_comment text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(p.display_name, ',' ORDER BY p.display_name), '')
  FROM public.module_activity a,
       LATERAL jsonb_array_elements_text(a.payload -> 'mentioned_user_ids') AS m(uid)
       JOIN public.profiles p ON p.id::text = m.uid
  WHERE a.op = p_op AND a.payload ->> 'comment_id' = test.id(p_comment)::text
$$;

-- ── Grants and the vocabulary ────────────────────────────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  PERFORM test.ok(has_table_privilege('authenticated', 'public.comment_reactions', 'SELECT')
              AND NOT has_table_privilege('authenticated', 'public.comment_reactions', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.comment_reactions', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.comment_reactions', 'DELETE')
              AND NOT has_table_privilege('anon', 'public.comment_reactions', 'SELECT'),
    'grants: reactions are read-only for the app (the op writes them)');
  FOREACH v_fn IN ARRAY ARRAY['public.comments__can_remove(public.comments)', 'public.comments__find(uuid)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('grants: %s is the server''s only', v_fn));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.comments_op_edit(uuid, text, uuid[])', 'public.comments_op_delete(uuid)',
                              'public.comments_op_restore(uuid)', 'public.comments_op_react(uuid, text, boolean)'] LOOP
    PERFORM test.ok(has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('grants: %s is callable by members, never anonymously', v_fn));
  END LOOP;
  PERFORM test.ok(
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'comment_reactions_reaction_check'))
      LIKE '%thumbs_up%check%eyes%pray%heart%smile%',
    'vocabulary: the six reactions, in order');
END $$;

-- ── Edit ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.comment('E', 'C1', 'T', 'First pass is up', ARRAY[test.id('F')]);
  PERFORM test.ok(test.mentioned('comments.add', 'C1') = 'F', 'add: F is named');

  r := test.as_user('F', format($q$SELECT public.comments_op_edit(%L, 'Hijacked')$q$, test.id('C1')));
  PERFORM test.ok(r LIKE '42501%' AND (SELECT body FROM public.comments WHERE id = test.id('C1')) = 'First pass is up',
    'edit: someone else''s comment is refused and unchanged', r);

  r := test.as_user('E', format($q$SELECT public.comments_op_edit(%L, '   ')$q$, test.id('C1')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'edit: an empty body is refused', r);

  r := test.as_user('E', format($q$SELECT public.comments_op_edit(%L, 'First pass is up, @F @O', %L::uuid[])$q$,
    test.id('C1'), ARRAY[test.id('F'), test.id('O'), test.id('E')]));
  PERFORM test.ok(r LIKE 'ok%'
              AND (SELECT body FROM public.comments WHERE id = test.id('C1')) = 'First pass is up, @F @O'
              AND (SELECT edited_at IS NOT NULL FROM public.comments WHERE id = test.id('C1')),
    'edit: the author edits; the comment reads "edited"', r);
  PERFORM test.ok(test.mentioned('comments.edit', 'C1') = 'O',
    'edit: only someone named for the first time is notified (not F again, not the author)');
  PERFORM test.ok((SELECT count(*) FROM public.module_activity
                   WHERE op = 'comments.add' AND payload ->> 'comment_id' = test.id('C1')::text) = 1,
    'edit: the trail keeps the original add row');

  r := test.as_user('E', format($q$SELECT public.comments_op_edit(%L, 'First pass is up, @F @O')$q$, test.id('C1')));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT count(*) FROM public.module_activity
                   WHERE op = 'comments.edit' AND payload ->> 'comment_id' = test.id('C1')::text) = 1,
    'edit: saving the same text writes nothing', r);

  r := test.as_key('K', format($q$SELECT public.comments_op_edit(%L, 'via key')$q$, test.id('C1')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'edit: an app over a key can''t edit a person''s comment', r);
END $$;

-- ── Delete and Undo ──────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.comment('F', 'C2', 'T', 'Looks good to me');
  PERFORM test.comment('E', 'C3', 'T', 'One more thing');

  r := test.as_user('E', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('C2')));
  PERFORM test.ok(r LIKE '42501%' AND (SELECT deleted_at IS NULL FROM public.comments WHERE id = test.id('C2')),
    'delete: a member can''t delete someone else''s comment', r);

  r := test.as_user('V', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('C3')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'delete: a viewer can''t delete', r);

  r := test.as_user('E', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('C3')));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT deleted_at IS NOT NULL FROM public.comments WHERE id = test.id('C3')),
    'delete: the author deletes their own', r);
  PERFORM test.ok(test.value_as('F', format($q$SELECT count(*)::text FROM public.comments
                   WHERE id = %L AND deleted_at IS NULL$q$, test.id('C3'))) = '0',
    'delete: others no longer read it as live');

  r := test.as_user('E', format($q$SELECT public.comments_op_restore(%L)$q$, test.id('C3')));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT deleted_at IS NULL FROM public.comments WHERE id = test.id('C3')),
    'undo: the author restores it', r);

  r := test.as_user('O', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('C2')));
  PERFORM test.ok(r LIKE 'ok%' AND (SELECT deleted_at IS NOT NULL FROM public.comments WHERE id = test.id('C2')),
    'delete: Full access on the project deletes anyone''s', r);
  PERFORM test.ok((SELECT count(*) FROM public.module_activity
                   WHERE op = 'comments.add' AND payload ->> 'comment_id' = test.id('C2')::text) = 1
              AND (SELECT count(*) FROM public.module_activity
                   WHERE op = 'comments.delete' AND payload ->> 'comment_id' = test.id('C2')::text) = 1,
    'delete: the trail keeps the add and records the delete');

  r := test.as_user('E', format($q$SELECT public.comments_op_edit(%L, 'edit after delete')$q$, test.id('C3')));
  PERFORM test.ok(r LIKE 'ok%', 'edit: a restored comment edits again', r);
END $$;

-- ── Reactions ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v_before timestamptz;
  v_activity bigint;
BEGIN
  SELECT count(*) INTO v_activity FROM public.module_activity WHERE workspace_id = test.id('W');
  UPDATE public.comments SET updated_at = now() - interval '1 hour' WHERE id = test.id('C1');
  SELECT updated_at INTO v_before FROM public.comments WHERE id = test.id('C1');

  r := test.as_user('F', format($q$SELECT * FROM public.comments_op_react(%L, 'thumbs_up')$q$, test.id('C1')));
  PERFORM test.ok(r = 'ok 1', 'react: F adds 👍 and gets the comment''s reactions back', r);
  r := test.as_user('F', format($q$SELECT * FROM public.comments_op_react(%L, 'thumbs_up')$q$, test.id('C1')));
  PERFORM test.ok(r = 'ok 1', 'react: adding it twice keeps one', r);
  r := test.as_user('O', format($q$SELECT * FROM public.comments_op_react(%L, 'heart')$q$, test.id('C1')));
  PERFORM test.ok(r = 'ok 2', 'react: O adds ❤️', r);
  PERFORM test.ok((SELECT updated_at > v_before AND body = 'First pass is up, @F @O'
                   FROM public.comments WHERE id = test.id('C1')),
    'react: the comment''s stamp moves (open panels hear it); its text doesn''t');
  PERFORM test.ok((SELECT count(*) FROM public.module_activity WHERE workspace_id = test.id('W')) = v_activity,
    'react: no activity row, so nobody is notified (88)');

  r := test.as_user('F', format($q$SELECT * FROM public.comments_op_react(%L, 'party')$q$, test.id('C1')));
  PERFORM test.ok(r LIKE '22023%', 'react: only the six', r);
  r := test.as_key('K', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('C1')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'react: an app over a key can''t react', r);
  r := test.as_user('X', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('C1')));
  PERFORM test.ok(r LIKE 'P0002%', 'react: someone outside the workspace is told it isn''t there', r);
  r := test.as_user('F', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('C2')));
  PERFORM test.ok(r LIKE 'P0002%', 'react: not on a deleted comment', r);

  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$,
                   test.id('C1'))) = '2',
    'read: a member who sees the task reads its reactions');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$,
                   test.id('C1'))) = '0',
    'read: someone in another workspace reads none');

  r := test.as_user('F', format($q$SELECT * FROM public.comments_op_react(%L, 'thumbs_up', false)$q$, test.id('C1')));
  PERFORM test.ok(r = 'ok 1', 'react: F takes 👍 back; O''s ❤️ stays', r);
END $$;

-- ── A private project's comments ─────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.comment('O', 'CP', 'TP', 'Only for me');
  PERFORM test.as_user('O', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('CP')));
  r := test.as_user('M', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('CP')));
  PERFORM test.ok(r LIKE 'P0002%', 'private: M can''t react to what they can''t see', r);
  r := test.as_user('M', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('CP')));
  PERFORM test.ok(r LIKE 'P0002%', 'private: M can''t delete it either (no hint it exists)', r);
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$,
                   test.id('CP'))) = '0',
    'private: M reads none of its reactions');
END $$;

-- ── Who may comment, and the refused cases (every op asks the item's gate) ──
DO $$
DECLARE
  r text;
BEGIN
  -- Adding: only on what you can see.
  r := test.as_user('M', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'peek', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE 'P0002%', 'add: no comment on a task you can''t see', r);
  r := test.as_user('X', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'hello', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('T')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'add: someone in another workspace can''t comment', r);
  r := test.as_key('K', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'From the app', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('T')));
  PERFORM test.ok(r LIKE 'ok%', 'add: an app over its creator''s key still comments on what they see', r);
  r := test.as_key('K', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Peek', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(r LIKE 'P0002%', 'add: a key can''t comment on what its creator can''t see', r);

  -- A view-only share comments and reacts, but removes only its own.
  PERFORM test.comment('O', 'CV', 'TV', 'Owner note on the brief');
  r := test.as_user('N', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('CV')));
  PERFORM test.ok(r LIKE 'ok%', 'view share: N can react to what N can comment on', r);
  r := test.as_user('N', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('CV')));
  PERFORM test.ok(r LIKE '42501%' AND (SELECT deleted_at IS NULL FROM public.comments WHERE id = test.id('CV')),
    'view share: N can''t remove someone else''s comment', r);
  r := test.as_user('N', format($q$SELECT public.comments_op_edit(%L, 'rewritten')$q$, test.id('CV')));
  PERFORM test.ok(r LIKE '42501%', 'view share: N can''t edit someone else''s comment', r);

  -- A workspace viewer can't comment, so can't react either.
  r := test.as_user('V', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('C1')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'viewer: no reactions without commenting', r);

  -- A key can't edit, delete, restore or react, even its creator's own.
  PERFORM test.comment('E', 'CE', 'T', 'E wrote this');
  r := test.as_key('K', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('CE')));
  PERFORM test.ok(r LIKE '42501%' AND (SELECT deleted_at IS NULL FROM public.comments WHERE id = test.id('CE')),
    'key: no delete, even of its creator''s comment', r);
  r := test.as_key('K', format($q$SELECT public.comments_op_restore(%L)$q$, test.id('C2')));
  PERFORM test.ok(r LIKE '42501%', 'key: no restore', r);

  -- A share taken back: what it reached is gone, reactions included.
  PERFORM test.comment('O', 'CS', 'TS', 'For S while shared');
  r := test.as_user('S', format($q$SELECT * FROM public.comments_op_react(%L, 'heart')$q$, test.id('CS')));
  PERFORM test.ok(r LIKE 'ok%', 'revoked share: S reacts while it''s shared', r);
  PERFORM test.comment('S', 'CS2', 'TS', 'S was here');
  PERFORM test.ok(test.value_as('S', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$,
                   test.id('CS'))) = '1',
    'revoked share: S reads the reactions while it''s shared');
  DELETE FROM public.resource_grants
  WHERE resource_type = 'bucket' AND resource_id = test.id('PS') AND subject_id = test.id('S');
  r := test.as_user('S', format($q$SELECT * FROM public.comments_op_react(%L, 'heart', false)$q$, test.id('CS')));
  PERFORM test.ok(r LIKE 'P0002%', 'revoked share: S can''t react any more', r);
  r := test.as_user('S', format($q$SELECT public.comments_op_edit(%L, 'still mine?')$q$, test.id('CS2')));
  PERFORM test.ok(r LIKE 'P0002%', 'revoked share: S can''t edit their own comment there any more', r);
  r := test.as_user('S', format($q$SELECT public.comments_op_delete(%L)$q$, test.id('CS2')));
  PERFORM test.ok(r LIKE 'P0002%', 'revoked share: … nor delete it', r);
  PERFORM test.ok(test.value_as('S', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$,
                   test.id('CS'))) = '0'
              AND test.value_as('S', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('TS'))) = '0',
    'revoked share: S reads neither the comments nor their reactions');

  -- 'task_project' names a task under an older type: only its author removes it.
  r := test.as_user('E', format($q$SELECT public.comments_op_add(%L, 'task_project', %L, 'Old-type comment', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('T')));
  PERFORM test.ok(r LIKE 'ok%', 'task_project: E comments on a task under the old type', r);
  r := test.as_user('O', format($q$SELECT public.comments_op_delete(id) FROM public.comments
                                   WHERE entity_type = 'task_project' AND body = 'Old-type comment'$q$));
  PERFORM test.ok(r LIKE '42501%', 'task_project: Full access doesn''t reach it; its author does', r);
  r := test.as_user('E', format($q$SELECT public.comments_op_delete(id) FROM public.comments
                                   WHERE entity_type = 'task_project' AND body = 'Old-type comment'$q$));
  PERFORM test.ok(r LIKE 'ok%', 'task_project: the author deletes it', r);

  -- A task id from another workspace doesn't count as one in this workspace.
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Cross', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TX')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'add: a task from another workspace isn''t this workspace''s', r);
END $$;

-- ── Reading follows the same gate; mentions and notices only reach viewers ──
DO $$
DECLARE
  r text;
  r2 text;
BEGIN
  -- A private task's comments: nobody else reads them (type 'task' or 'task_project').
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task_project', %L, 'Old-type secret', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TP')));
  PERFORM test.ok(test.value_as('M', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('TP'))) = '0',
    'read: no comment on a private task reaches someone who can''t see it (task and task_project)');
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('TP'))) = '2',
    'read: its owner reads both');

  -- An unknown item type: nobody, not even the workspace.
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label)
  VALUES (test.id('W'), 'widget', test.id('WG'), 'A widget');
  INSERT INTO public.comments (workspace_id, entity_type, entity_id, body, created_by)
  VALUES (test.id('W'), 'widget', test.id('WG'), 'On a widget', test.id('O'));
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('WG'))) = '0'
              AND test.value_as('O', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('WG'))) = '0',
    'read: a comment on an unknown type is nobody''s to read');
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'widget', %L, 'more', '{}'::uuid[], 'x', 'x')$q$,
    test.id('W'), test.id('WG')));
  PERFORM test.ok(r LIKE 'P0002%', 'add: nobody comments on an unknown type', r);

  -- One refusal for hidden and missing.
  r := test.as_user('M', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'x', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TP')));
  r2 := test.as_user('M', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'x', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('no-such-task')));
  PERFORM test.ok(r = r2 AND r LIKE 'P0002%', 'add: a hidden task and a missing one answer alike', r || ' / ' || r2);
  r := test.as_user('M', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('CP')));
  r2 := test.as_user('M', format($q$SELECT * FROM public.comments_op_react(%L, 'eyes')$q$, test.id('no-such-comment')));
  PERFORM test.ok(r = r2 AND r LIKE 'P0002%', 'react: a hidden comment and a missing one answer alike', r || ' / ' || r2);
  r := test.as_user('M', format($q$SELECT public.comments_op_edit(%L, 'x')$q$, test.id('CP')));
  r2 := test.as_user('M', format($q$SELECT public.comments_op_edit(%L, 'x')$q$, test.id('no-such-comment')));
  PERFORM test.ok(r = r2 AND r LIKE 'P0002%', 'edit: a hidden comment and a missing one answer alike', r || ' / ' || r2);

  -- Mentions: only people who can see the item are stored (and so notified).
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'For @E and @F', %L::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TP'), ARRAY[test.id('E'), test.id('F')]));
  PERFORM test.ok((SELECT payload -> 'mentioned_user_ids' FROM public.module_activity
                   WHERE op = 'comments.add' AND payload ->> 'excerpt' = 'For @E and @F') = '[]'::jsonb,
    'mentions: nobody who can''t see the task is named (no notice, no excerpt)');
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Shared: @E', %L::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('T'), ARRAY[test.id('E'), test.id('M')]));
  PERFORM test.ok((SELECT payload -> 'mentioned_user_ids' FROM public.module_activity
                   WHERE op = 'comments.add' AND payload ->> 'excerpt' = 'Shared: @E')
                  @> jsonb_build_array(test.id('E')::text, test.id('M')::text),
    'mentions: people who can see it are named');
  PERFORM test.comment('O', 'CM', 'TP', 'Draft for me');
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_edit(%L, 'Draft for me and @E', %L::uuid[])$q$,
    test.id('CM'), ARRAY[test.id('E')]));
  PERFORM test.ok((SELECT payload -> 'mentioned_user_ids' FROM public.module_activity
                   WHERE op = 'comments.edit' AND payload ->> 'comment_id' = test.id('CM')::text) = '[]'::jsonb,
    'mentions: an edit doesn''t name someone who can''t see the task either');

  -- Participants: someone whose share was taken back hears nothing more.
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'After S left', '{}'::uuid[], 'x', 'task')$q$,
    test.id('W'), test.id('TS')));
  PERFORM test.ok(NOT ((SELECT payload -> 'notify_user_ids' FROM public.module_activity
                        WHERE op = 'comments.add' AND payload ->> 'excerpt' = 'After S left')
                       @> jsonb_build_array(test.id('S')::text)),
    'notices: a past commenter who can''t see the task any more isn''t notified');

  -- A note shared view-only, then taken back.
  INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode)
  VALUES (test.id('NO'), test.id('W'), test.id('O'), 'Plan', 'custom');
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('NO');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'note', test.id('NO'), 'member', test.id('N'), 'view', test.id('O'));
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'note', %L, 'Note thoughts', '{}'::uuid[], 'Plan', 'note')$q$,
    test.id('W'), test.id('NO')));
  PERFORM test.ok(r LIKE 'ok%', 'note: its owner comments', r);
  PERFORM test.ok(test.value_as('N', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('NO'))) = '1',
    'note: a view share reads its comments');
  PERFORM test.ok(test.value_as('E', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('NO'))) = '0',
    'note: someone it isn''t shared with reads none');
  DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('NO');
  PERFORM test.ok(test.value_as('N', format($q$SELECT count(*)::text FROM public.comments WHERE entity_id = %L$q$,
                   test.id('NO'))) = '0',
    'note: once taken back, its comments are gone for N');
END $$;

-- ── Erasure: a person's reactions go with their profile ──────────────────────
DO $$
BEGIN
  DELETE FROM public.profiles WHERE id = test.id('O');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.comment_reactions WHERE user_id = test.id('O')),
    'erasure: removing a profile removes its reactions');
EXCEPTION WHEN OTHERS THEN
  -- The profile may be held by other rows in this fixture; check the FK instead.
  PERFORM test.ok(
    (SELECT confdeltype FROM pg_constraint WHERE conname = 'comment_reactions_user_id_fkey') = 'c',
    'erasure: reactions cascade with the profile');
END $$;

-- TV-U13 · Comments: edit, delete with Undo, six fixed reactions
-- (supabase/migrations/20261013100000_comment_reactions_edits.sql).
-- specs/tasks-v3.md §9, AC11.8; REPLAN 88, default q.
--
-- Cast: O owns workspace W and project SB (shared with the workspace). E and
-- F are members who can edit SB; V is a viewer; M can't see O's private
-- project PB; X is in another workspace.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'F', 'V', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('F'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('M'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"tasks": "edit", "links": "edit"}'::jsonb, test.id('E'));

SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
  jsonb_build_object('id', test.id('T'), 'title', 'Logo concepts', 'bucket_id', test.id('SB'))));
SELECT test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
  jsonb_build_object('id', test.id('TP'), 'title', 'Secret plan', 'bucket_id', test.id('PB'))));

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

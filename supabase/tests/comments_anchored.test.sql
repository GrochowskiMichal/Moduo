-- NR-8 · Comments anchored to text (supabase/migrations/20261016180000_comments_anchored.sql).
--
-- Cast: O owns workspace W and the private note N, shared with V (view). M is
-- a member who can't see N. A is a thread (anchor) on N; B another.

SELECT test.person(n) FROM unnest(ARRAY['O', 'V', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key'),
        '{"notes": "edit", "links": "edit"}'::jsonb, test.id('O'));
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['V', 'M']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode)
VALUES (test.id('N'), test.id('W'), test.id('O'), 'Board plan', 'custom'),
       (test.id('N2'), test.id('W'), test.id('O'), 'Other', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('N');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('N'), 'member', test.id('V'), 'view', test.id('O'));

CREATE FUNCTION test.anchored(p_who text, p_note text, p_anchor text, p_body text,
                              p_mentions uuid[] DEFAULT '{}') RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT (public.comments_op_add_anchored(%L, %L, %L, %L, %L::uuid[], 'Board plan', 'note')).id::text$q$,
    test.id('W'), test.id(p_note), test.id(p_anchor), p_body, p_mentions))
$$;

DO $$
DECLARE
  v text;
  c public.comments;
BEGIN
  -- O starts thread A mentioning V; V (view-only) replies.
  v := test.anchored('O', 'N', 'A', 'Is this number right?', ARRAY[test.id('V')]);
  SELECT * INTO c FROM public.comments WHERE id::text = v;
  PERFORM test.ok(c.anchor_id = test.id('A') AND c.entity_type = 'note' AND c.resolved_at IS NULL,
    'an anchored comment carries its thread id', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
      WHERE a.op = 'comments.add' AND a.payload ->> 'comment_id' = v
        AND a.payload -> 'mentioned_user_ids' ? test.id('V')::text),
    'an anchored comment notifies its mentions through comments_op_add');
  v := test.anchored('V', 'N', 'A', 'Yes, checked.');
  PERFORM test.ok((SELECT count(*) FROM public.comments WHERE anchor_id = test.id('A')) = 2,
    'a view-only member can reply in the thread', v);

  -- Someone who can't see the note can neither comment nor resolve.
  v := test.anchored('M', 'N', 'B', 'peek');
  PERFORM test.ok(v LIKE 'ERROR%', 'a member without access cannot start a thread', v);
  v := test.value_as('M', format($q$SELECT public.comments_op_resolve(%L, %L, %L)::text$q$,
    test.id('W'), test.id('N'), test.id('A')));
  PERFORM test.ok(v LIKE 'ERROR%', 'a member without access cannot resolve', v);

  -- An outsider naming their own workspace with this note gets nothing.
  v := test.value_as('X', format(
    $q$SELECT (public.comments_op_add_anchored(%L, %L, %L, 'x')).id::text$q$,
    test.id('W2'), test.id('N'), test.id('XA')));
  PERFORM test.ok(v LIKE 'ERROR%', 'another workspace cannot anchor on this note', v);
  v := test.value_as('X', format($q$SELECT public.comments_op_resolve(%L, %L, %L)::text$q$,
    test.id('W2'), test.id('N'), test.id('A')));
  PERFORM test.ok(v LIKE 'ERROR%', 'another workspace cannot resolve this note''s thread', v);

  -- An app's key can't resolve (a person does, in their editor).
  v := test.as_key('K', format($q$SELECT public.comments_op_resolve(%L, %L, %L)$q$,
    test.id('W'), test.id('N'), test.id('A')));
  PERFORM test.ok(v NOT LIKE 'ok%', 'an API key cannot resolve a thread', v);

  -- A thread id can't be reused on another note.
  v := test.anchored('O', 'N2', 'A', 'hijack');
  PERFORM test.ok(v LIKE 'ERROR%another note%', 'a thread belongs to one note', v);

  -- Resolve closes every comment in the thread; a reply is then refused.
  v := test.value_as('V', format($q$SELECT public.comments_op_resolve(%L, %L, %L)::text$q$,
    test.id('W'), test.id('N'), test.id('A')));
  PERFORM test.ok(v = '2', 'resolve closes the whole thread', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.comments WHERE anchor_id = test.id('A') AND resolved_at IS NULL),
    'every comment in a resolved thread has resolved_at');
  v := test.anchored('O', 'N', 'A', 'late reply');
  PERFORM test.ok(v LIKE 'ERROR%resolved%', 'a resolved thread takes no replies', v);

  -- Reopen.
  v := test.value_as('O', format($q$SELECT public.comments_op_resolve(%L, %L, %L, false)::text$q$,
    test.id('W'), test.id('N'), test.id('A')));
  PERFORM test.ok(v = '2' AND NOT EXISTS (SELECT 1 FROM public.comments
      WHERE anchor_id = test.id('A') AND resolved_at IS NOT NULL), 'a thread can be reopened', v);

  -- Resolving an unknown thread says so.
  v := test.value_as('O', format($q$SELECT public.comments_op_resolve(%L, %L, %L)::text$q$,
    test.id('W'), test.id('N'), test.id('Z')));
  PERFORM test.ok(v LIKE 'ERROR%', 'resolving a missing thread is refused', v);

  -- Plain comments are untouched: note-level and on tasks alike.
  v := test.value_as('O', format(
    $q$SELECT (public.comments_op_add(%L, 'note', %L, 'general', '{}'::uuid[], 'Board plan', 'note')).anchor_id::text$q$,
    test.id('W'), test.id('N')));
  PERFORM test.ok(v IS NULL, 'a note-level comment keeps a null anchor', v);

  -- Constraints.
  BEGIN
    INSERT INTO public.comments (workspace_id, entity_type, entity_id, body, created_by, anchor_id)
    VALUES (test.id('W'), 'task', test.id('N'), 'x', test.id('O'), test.id('Q'));
    PERFORM test.ok(false, 'an anchor on a non-note comment is refused');
  EXCEPTION WHEN check_violation THEN
    PERFORM test.ok(true, 'an anchor on a non-note comment is refused');
  END;

  PERFORM test.ok(has_function_privilege('authenticated',
      'public.comments_op_resolve(uuid, uuid, uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.comments_op_resolve(uuid, uuid, uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.comments_op_add_anchored(uuid, uuid, uuid, text, uuid[], text, text)', 'EXECUTE'),
    'grants: authenticated only');
END;
$$;

-- A published note's public page shows only the sub-notes that inherit its
-- sharing (supabase/migrations/20261020120000_notes_public_subtree.sql).
--
-- Cast: O owns workspace W. Root R is published. Under it:
--   A  inherits            → public, and so is A1 (inherits from A)
--   P  has its own sharing → private, and so is P1 (inherits from P)
--   X  inherits, archived  → hidden, and so is X1
--   D  inherits, trashed   → hidden
-- Note Q in another workspace is never reached.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('O'), 'Side project');

INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_md) VALUES
  (test.id('R'), test.id('W'), test.id('O'), 'Handbook', 'Welcome <!-- moduo:task:abc -->');
INSERT INTO public.notes (id, workspace_id, created_by, parent_id, title) VALUES
  (test.id('A'), test.id('W'), test.id('O'), test.id('R'), 'Onboarding'),
  (test.id('P'), test.id('W'), test.id('O'), test.id('R'), 'Salaries'),
  (test.id('X'), test.id('W'), test.id('O'), test.id('R'), 'Old process'),
  (test.id('D'), test.id('W'), test.id('O'), test.id('R'), 'Trashed draft');
INSERT INTO public.notes (id, workspace_id, created_by, parent_id, title) VALUES
  (test.id('A1'), test.id('W'), test.id('O'), test.id('A'), 'First week'),
  (test.id('P1'), test.id('W'), test.id('O'), test.id('P'), 'Salary bands'),
  (test.id('X1'), test.id('W'), test.id('O'), test.id('X'), 'Old checklist');
INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES
  (test.id('Q'), test.id('W2'), test.id('O'), 'Elsewhere');

UPDATE public.notes SET share_mode = 'inherit'
WHERE id IN (test.id('A'), test.id('A1'), test.id('P1'), test.id('X'), test.id('X1'), test.id('D'));
UPDATE public.notes SET share_mode = 'custom' WHERE id = test.id('P');
UPDATE public.notes SET is_archived = true WHERE id = test.id('X');
UPDATE public.notes SET deleted_at = now() WHERE id = test.id('D');
UPDATE public.notes SET published_at = now(), publish_token = 'db-test-root-token' WHERE id = test.id('R');
UPDATE public.notes SET published_at = now(), publish_token = 'db-test-private-token' WHERE id = test.id('P');

CREATE FUNCTION test.subtree(p_token text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.notes_public_subtree(p_token);
  RESET ROLE;
  RETURN v;
END;
$$;

CREATE FUNCTION test.subtree_ids(p_token text) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg((e ->> 'id')::uuid ORDER BY e ->> 'id'), '{}')
  FROM jsonb_array_elements(test.subtree(p_token) -> 'notes') e
$$;

DO $$
DECLARE
  v jsonb := test.subtree('db-test-root-token');
  v_ids uuid[] := test.subtree_ids('db-test-root-token');
  v_a1 jsonb;
BEGIN
  PERFORM test.ok((v ->> 'rootId')::uuid = test.id('R'), 'the token resolves the published root', v::text);
  PERFORM test.ok(v_ids @> ARRAY[test.id('R'), test.id('A'), test.id('A1')],
    'the root and the sub-notes that inherit its sharing are public', v_ids::text);
  PERFORM test.ok(NOT v_ids && ARRAY[test.id('P'), test.id('P1')],
    'a sub-note with its own sharing, and what inherits from it, stay private', v_ids::text);
  PERFORM test.ok(NOT v_ids && ARRAY[test.id('X'), test.id('X1'), test.id('D')],
    'archived and trashed sub-notes, and what is below them, stay hidden', v_ids::text);
  PERFORM test.ok(NOT v_ids && ARRAY[test.id('Q')], 'notes in another workspace are never reached');
  PERFORM test.ok(cardinality(v_ids) = 3, 'exactly the root, A and A1', v_ids::text);

  SELECT e INTO v_a1 FROM jsonb_array_elements(v -> 'notes') e WHERE (e ->> 'id')::uuid = test.id('A1');
  PERFORM test.ok((v_a1 ->> 'parentId')::uuid = test.id('A') AND v_a1 ->> 'title' = 'First week',
    'a sub-note carries its parent and title', v_a1::text);
  PERFORM test.ok((SELECT e -> 'parentId' FROM jsonb_array_elements(v -> 'notes') e
                   WHERE (e ->> 'id')::uuid = test.id('R')) = 'null'::jsonb,
    'the root has no parent on the page');

  -- The private sub-note's own link still shows it (its own publish).
  PERFORM test.ok(test.subtree_ids('db-test-private-token') = (SELECT array_agg(x ORDER BY x::text)
      FROM unnest(ARRAY[test.id('P'), test.id('P1')]) x),
    'a sub-note published on its own shows itself and what inherits from it');

  PERFORM test.ok(test.subtree('no-such-token') IS NULL, 'an unknown token answers nothing');
  PERFORM test.ok(test.subtree('') IS NULL AND test.subtree(NULL) IS NULL, 'an empty token answers nothing');

  UPDATE public.notes SET is_archived = true WHERE id = test.id('R');
  PERFORM test.ok(test.subtree('db-test-root-token') IS NULL, 'an archived root answers nothing');
  UPDATE public.notes SET is_archived = false, published_at = NULL WHERE id = test.id('R');
  PERFORM test.ok(test.subtree('db-test-root-token') IS NULL, 'an unpublished root answers nothing');
  UPDATE public.notes SET published_at = now() WHERE id = test.id('R');
END;
$$;

-- A root note filed under the published page keeps its own sharing ('custom':
-- notes_op_move moves it without changing share_mode), so it stays off the
-- link until it is set to follow its parent.
INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES
  (test.id('M'), test.id('W'), test.id('O'), 'Filed capture');

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('O', format($q$SELECT public.notes_op_move(%L, %L, %L, 'z')$q$,
    test.id('W'), test.id('M'), test.id('R')));
  PERFORM test.ok(v LIKE 'ok%' AND (SELECT parent_id FROM public.notes WHERE id = test.id('M')) = test.id('R'),
    'a root note can be filed under the published page', v);
  PERFORM test.ok(NOT test.subtree_ids('db-test-root-token') && ARRAY[test.id('M')],
    'a filed note with its own sharing stays off the parent''s link');
  UPDATE public.notes SET share_mode = 'inherit' WHERE id = test.id('M');
  PERFORM test.ok(test.subtree_ids('db-test-root-token') && ARRAY[test.id('M')],
    'once it follows its parent, it is on the link');
  DELETE FROM public.notes WHERE id = test.id('M');
END;
$$;

-- More sub-notes than PostgREST's row cap all come back (one JSON value).
INSERT INTO public.notes (workspace_id, created_by, parent_id, title)
SELECT test.id('W'), test.id('O'), test.id('A'), 'Page ' || i FROM generate_series(1, 1100) AS i;
UPDATE public.notes SET share_mode = 'inherit' WHERE parent_id = test.id('A');

DO $$
BEGIN
  PERFORM test.ok(jsonb_array_length(test.subtree('db-test-root-token') -> 'notes') = 1103,
    'a large published tree comes back whole');

  PERFORM test.ok(
    has_function_privilege('service_role', 'public.notes_public_subtree(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.notes_public_subtree(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.notes_public_subtree(text)', 'EXECUTE'),
    'grants: only the service role reads a published tree');
END;
$$;

-- Notes compaction refuses a stale fold (supabase/migrations/20261016150000_notes_snapshot_cas.sql).
--
-- Cast: O owns workspace W and note N. Client A pulled at doc_version 0;
-- client B then folds rows A never saw. A's later fold must be refused, so
-- B's snapshot survives.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.notes (id, workspace_id, created_by, title)
VALUES (test.id('N'), test.id('W'), test.id('O'), 'Board plan');
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
SELECT test.id('W'), test.id('N'), 'B', i, 'row' || i FROM generate_series(1, 3) AS i;

DO $$
DECLARE
  v text;
  n record;
  v_max bigint := (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('N'));
BEGIN
  -- B folds (it saw version 0).
  v := test.value_as('O', format(
    $q$SELECT public.notes_op_save_snapshot(%L, %L, 'SNAP-B', %s, NULL, NULL, 0)::text$q$,
    test.id('W'), test.id('N'), v_max));
  PERFORM test.ok((v::jsonb ->> 'refused') = 'false' AND (v::jsonb ->> 'doc_version') = '1',
    'a fold at the current version is accepted', v);

  -- A folds with the version it pulled before B's fold.
  v := test.value_as('O', format(
    $q$SELECT public.notes_op_save_snapshot(%L, %L, 'SNAP-A', %s, NULL, NULL, 0)::text$q$,
    test.id('W'), test.id('N'), v_max));
  PERFORM test.ok((v::jsonb ->> 'refused') = 'true' AND (v::jsonb ->> 'doc_version') = '1',
    'a stale fold is refused and reports the current version', v);

  SELECT * INTO n FROM test.notes_in WHERE id = test.id('N');
  PERFORM test.ok(n.doc_state = 'SNAP-B' AND n.doc_version = 1,
    'the newer snapshot survives a stale fold', n.doc_state || ' v' || n.doc_version);

  -- A refused fold deletes nothing from the log.
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
  VALUES (test.id('W'), test.id('N'), 'A', 1, 'row4');
  v := test.value_as('O', format(
    $q$SELECT public.notes_op_save_snapshot(%L, %L, 'SNAP-A', %s, NULL, NULL, 0)::text$q$,
    test.id('W'), test.id('N'), v_max + 1));
  PERFORM test.ok((SELECT count(*) FROM public.note_updates WHERE note_id = test.id('N')) = 1,
    'a refused fold leaves the log alone');

  -- Without an expected version, the old unconditional behaviour holds.
  v := test.value_as('O', format(
    $q$SELECT public.notes_op_save_snapshot(%L, %L, 'SNAP-C', %s)::text$q$,
    test.id('W'), test.id('N'), v_max + 1));
  PERFORM test.ok((v::jsonb ->> 'refused') = 'false' AND (v::jsonb ->> 'doc_version') = '2',
    'a fold without an expected version still applies', v);

  PERFORM test.ok(has_function_privilege('authenticated',
      'public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint)', 'EXECUTE'),
    'grants: authenticated may fold, anon may not');
END;
$$;

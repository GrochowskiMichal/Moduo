-- NS-7 · 10k list, 1k log (specs/notes-schema-hardening.md, AC8).
-- notes_list_meta at 10,000 notes answers within p95 ≤ 80 ms, its visibility
-- computed once per call, and it stops at 5,000 rows. A 1,000-row log comes
-- back from notes_pull in one call.
--
-- The seed is notes_search_perf.test.sql's: one workspace, O owns it, A is a
-- member; 10,000 notes in a tree (a third of the roots shared with the
-- workspace, the rest private to O or A, children inheriting). The list runs
-- once to warm up, then 20 times timed, as A through the role the app uses.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'List perf');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('A'), 'member');

SELECT setseed(0.6);

-- Roots first, then four levels of children under random earlier notes.
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, position, updated_at)
SELECT test.id('n' || i), test.id('W'), CASE WHEN i % 2 = 0 THEN test.id('O') ELSE test.id('A') END,
       'Note ' || i, 'body ' || i, md5(i::text), now() - (i || ' minutes')::interval
  FROM generate_series(1, 2000) i;
DO $$
BEGIN
  FOR lvl IN 1..4 LOOP
    INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, position, parent_id, updated_at)
    SELECT test.id('n' || i), test.id('W'), CASE WHEN i % 2 = 0 THEN test.id('O') ELSE test.id('A') END,
           'Note ' || i, 'body ' || i, md5(i::text), test.id('n' || (1 + floor(random() * (2000 * lvl))::int)),
           now() - (i || ' minutes')::interval
      FROM generate_series(2000 * lvl + 1, 2000 * (lvl + 1)) i;
  END LOOP;
END;
$$;

-- A third of the roots are shared with the workspace, the rest private.
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'note', test.id('n' || i), 'workspace', NULL, 'view', test.id('O')
  FROM generate_series(1, 2000) i WHERE i % 3 = 0;

-- One note with a 1,000-row log.
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
SELECT test.id('W'), test.id('n1'), 'db-test-ns7-perf', i, 'AAA='
  FROM generate_series(1, 1000) i;
ANALYZE public.notes;
ANALYZE public.resource_grants;
ANALYZE public.note_updates;

SELECT test.ok((SELECT count(*) FROM public.notes WHERE workspace_id = test.id('W')) = 10000,
  'the workspace holds 10,000 notes');

DO $$
DECLARE
  v_ws uuid := test.id('W');
  v_claims text := json_build_object('sub', test.id('A'), 'role', 'authenticated')::text;
  v_ms double precision[] := '{}';
  v_n int;
  v_t timestamptz;
  v_p95 double precision;
  v_p50 double precision;
  v_since timestamptz := now() - interval '30 days';
BEGIN
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;
  PERFORM count(*) FROM public.notes_list_meta(v_ws, v_since);
  FOR i IN 1..20 LOOP
    v_t := clock_timestamp();
    SELECT count(*) INTO v_n FROM public.notes_list_meta(v_ws, v_since);
    v_ms := v_ms || (extract(epoch FROM clock_timestamp() - v_t) * 1000);
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY m), percentile_cont(0.5) WITHIN GROUP (ORDER BY m)
    INTO v_p95, v_p50 FROM unnest(v_ms) m;
  RAISE NOTICE 'notes_list_meta at 10k notes: p50 % ms, p95 % ms, % rows',
    round(v_p50::numeric, 1), round(v_p95::numeric, 1), v_n;
  PERFORM test.ok(v_n > 1000, 'A''s list holds real work (more than one PostgREST page)', v_n::text);
  PERFORM test.ok(v_p95 <= 80, '10k notes: list p95 ≤ 80 ms', format('p50 %s ms, p95 %s ms',
    round(v_p50::numeric, 1), round(v_p95::numeric, 1)));
END;
$$;

SELECT test.ok(
  test.value_as('O', format('SELECT count(*)::text FROM public.notes_list_meta(%L, NULL)', test.id('W'))) = '5000',
  'the list stops at 5,000 rows (O sees all 10,000)');

SELECT test.ok(
  test.value_as('A', format($q$SELECT (jsonb_array_length(r -> 'updates') = 1000
       AND r -> 'has_more' = 'false'::jsonb AND r ? 'snapshot')::text
       FROM public.notes_pull(%L, %L, 0, NULL) r$q$, test.id('W'), test.id('n1'))) = 'true',
  'a 1,000-row log comes back whole from one notes_pull call, with its snapshot');

DO $$
DECLARE
  v_ws uuid := test.id('W');
  v_note uuid := test.id('n1');
  v_t timestamptz;
  v_ms double precision;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test.id('A'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.notes_pull(v_ws, v_note, 0, NULL);
  v_t := clock_timestamp();
  PERFORM public.notes_pull(v_ws, v_note, 0, NULL);
  v_ms := extract(epoch FROM clock_timestamp() - v_t) * 1000;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'notes_pull of a 1,000-row log: % ms', round(v_ms::numeric, 1);
  PERFORM test.ok(v_ms <= 80, 'the 1,000-row pull answers within 80 ms', round(v_ms::numeric, 1)::text);
END;
$$;

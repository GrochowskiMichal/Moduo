-- GS-2: notes__search at 10,000 notes answers within p95 ≤ 60 ms
-- (specs/global-search.md AC8, notes' share of the budget).
--
-- One workspace: O owns it, A is a member who searches. 10,000 notes in a
-- tree (a third shared with the workspace, the rest private to O or A, children
-- inheriting), titles of 3 words and bodies of 80 from a 3,375-word vocabulary,
-- some with Polish letters. 50 mixed queries (one word, a word-start, two
-- words, a phrase, a negation, a title typo that takes the fuzzy path) run
-- once to warm up, then once timed, as A through the same role the app uses.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Search perf');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('A'), 'member');

CREATE TABLE test.vocab AS
SELECT row_number() OVER () AS n, a || b || c AS w
  FROM unnest(ARRAY['ka','lo','mi','ne','ru','sa','ti','vo','pe','da','go','fu','zi','ba','łe']) a,
       unnest(ARRAY['ra','mo','li','nu','ke','so','ta','vi','po','de','gu','fa','zo','bi','że']) b,
       unnest(ARRAY['n','s','t','l','r','k','m','x','p','d','g','f','z','b','ść']) c;

SELECT setseed(0.6);

CREATE TABLE test.vocab_all AS SELECT array_agg(w ORDER BY n) AS ws FROM test.vocab;

CREATE FUNCTION test.words(p_count int) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(a.ws[1 + floor(random() * 3375)::int], ' ')
    FROM generate_series(1, p_count) g, test.vocab_all a
$$;

-- Roots first, then four levels of children under random earlier notes.
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, updated_at)
SELECT test.id('n' || i), test.id('W'), CASE WHEN i % 2 = 0 THEN test.id('O') ELSE test.id('A') END,
       test.words(3), test.words(80), now() - (i || ' minutes')::interval
  FROM generate_series(1, 2000) i;
DO $$
BEGIN
  FOR lvl IN 1..4 LOOP
    INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, parent_id, updated_at)
    SELECT test.id('n' || i), test.id('W'), CASE WHEN i % 2 = 0 THEN test.id('O') ELSE test.id('A') END,
           test.words(3), test.words(80), test.id('n' || (1 + floor(random() * (2000 * lvl))::int)),
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
ANALYZE public.notes;
ANALYZE public.resource_grants;

SELECT test.ok((SELECT count(*) FROM public.notes WHERE workspace_id = test.id('W')) = 10000,
  'the workspace holds 10,000 notes');

-- 50 queries built from the vocabulary.
CREATE TABLE test.queries AS
SELECT q FROM (
  SELECT (SELECT w FROM test.vocab WHERE n = 1 + (i * 67) % 3375) AS q FROM generate_series(1, 12) i
  UNION ALL
  SELECT left((SELECT w FROM test.vocab WHERE n = 1 + (i * 131) % 3375), 3) FROM generate_series(1, 10) i
  UNION ALL
  SELECT (SELECT w FROM test.vocab WHERE n = 1 + (i * 17) % 3375) || ' '
         || left((SELECT w FROM test.vocab WHERE n = 1 + (i * 241) % 3375), 4) FROM generate_series(1, 10) i
  UNION ALL
  SELECT '"' || (SELECT w FROM test.vocab WHERE n = 1 + (i * 29) % 3375) || ' '
         || (SELECT w FROM test.vocab WHERE n = 1 + (i * 311) % 3375) || '"' FROM generate_series(1, 5) i
  UNION ALL
  SELECT left((SELECT w FROM test.vocab WHERE n = 1 + (i * 53) % 3375), 4) || ' -'
         || (SELECT w FROM test.vocab WHERE n = 1 + (i * 97) % 3375) FROM generate_series(1, 5) i
  UNION ALL
  -- A title word with one letter dropped: no exact hit, the fuzzy path runs.
  SELECT overlay(split_part(n.title, ' ', 1) PLACING '' FROM 3 FOR 1)
    FROM public.notes n WHERE n.id IN (SELECT test.id('n' || (i * 300)) FROM generate_series(1, 8) i)
) s;

SELECT test.ok((SELECT count(*) FROM test.queries) = 50, 'fifty queries');

DO $$
DECLARE
  v_ws uuid := test.id('W');
  v_claims text := json_build_object('sub', test.id('A'), 'role', 'authenticated')::text;
  v_qs text[] := ARRAY(SELECT q FROM test.queries);
  v_ms double precision[] := '{}';
  v_hits int := 0;
  v_n int;
  v_t timestamptz;
  v_p95 double precision;
  v_p50 double precision;
  q text;
BEGIN
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;
  FOREACH q IN ARRAY v_qs LOOP
    PERFORM count(*) FROM public.notes__search(v_ws, q, 20);
  END LOOP;
  FOREACH q IN ARRAY v_qs LOOP
    v_t := clock_timestamp();
    SELECT count(*) INTO v_n FROM public.notes__search(v_ws, q, 20);
    v_ms := v_ms || (extract(epoch FROM clock_timestamp() - v_t) * 1000);
    v_hits := v_hits + v_n;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY m), percentile_cont(0.5) WITHIN GROUP (ORDER BY m)
    INTO v_p95, v_p50 FROM unnest(v_ms) m;
  RAISE NOTICE 'notes__search at 10k notes: p50 % ms, p95 % ms, % hits over 50 queries',
    round(v_p50::numeric, 1), round(v_p95::numeric, 1), v_hits;
  PERFORM test.ok(v_hits > 50, 'the queries find things (the timing measures real work)', v_hits::text);
  PERFORM test.ok(v_p95 <= 60, '10k notes: p95 ≤ 60 ms', format('p50 %s ms, p95 %s ms',
    round(v_p50::numeric, 1), round(v_p95::numeric, 1)));
END;
$$;

-- GS-4: tasks__search at 10,000 tasks answers within p95 ≤ 60 ms
-- (specs/global-search.md AC8, tasks' share of the budget).
--
-- One workspace: O owns it, A is a member who searches. 20 projects, a third
-- shared with the workspace and the rest private to O, so A can open about a
-- third of the 10,000 tasks. Titles of 3 words and descriptions of 40 (as
-- HTML) from a 3,375-word vocabulary, some with Polish letters. 50 mixed
-- queries (one word, a word-start, two words, a phrase, a negation, a title
-- typo that takes the fuzzy path, a handle) run once to warm up, then once
-- timed, as A through the same role the app uses.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Tasks search perf');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('A'), 'member');

CREATE TABLE test.vocab AS
SELECT row_number() OVER () AS n, a || b || c AS w
  FROM unnest(ARRAY['ka','lo','mi','ne','ru','sa','ti','vo','pe','da','go','fu','zi','ba','łe']) a,
       unnest(ARRAY['ra','mo','li','nu','ke','so','ta','vi','po','de','gu','fa','zo','bi','że']) b,
       unnest(ARRAY['n','s','t','l','r','k','m','x','p','d','g','f','z','b','ść']) c;

SELECT setseed(0.4);

CREATE TABLE test.vocab_all AS SELECT array_agg(w ORDER BY n) AS ws FROM test.vocab;

CREATE FUNCTION test.words(p_count int) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(a.ws[1 + floor(random() * 3375)::int], ' ')
    FROM generate_series(1, p_count) g, test.vocab_all a
$$;

INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
SELECT test.id('p' || i), test.id('W'), test.id('O'), test.words(2), false FROM generate_series(1, 20) i;
DELETE FROM public.resource_grants WHERE resource_type = 'bucket'
  AND resource_id IN (SELECT id FROM public.buckets WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'bucket', test.id('p' || i), 'workspace', NULL, 'edit', test.id('O')
  FROM generate_series(1, 20) i WHERE i % 3 = 0;

INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, description, status)
SELECT test.id('t' || i), test.id('W'), test.id('p' || (1 + i % 20)), test.id('O'),
       test.words(3), '<p>' || test.words(20) || '</p><p>' || test.words(20) || '</p>', 'todo'
  FROM generate_series(1, 10000) i;
ANALYZE public.tasks;
ANALYZE public.resource_grants;

SELECT test.ok((SELECT count(*) FROM public.tasks WHERE workspace_id = test.id('W')) = 10000,
  'the workspace holds 10,000 tasks');

CREATE TABLE test.queries AS
SELECT q FROM (
  SELECT (SELECT w FROM test.vocab WHERE n = 1 + (i * 67) % 3375) AS q FROM generate_series(1, 12) i
  UNION ALL
  SELECT left((SELECT w FROM test.vocab WHERE n = 1 + (i * 131) % 3375), 3) FROM generate_series(1, 10) i
  UNION ALL
  SELECT (SELECT w FROM test.vocab WHERE n = 1 + (i * 17) % 3375) || ' '
         || left((SELECT w FROM test.vocab WHERE n = 1 + (i * 241) % 3375), 4) FROM generate_series(1, 8) i
  UNION ALL
  SELECT '"' || (SELECT w FROM test.vocab WHERE n = 1 + (i * 29) % 3375) || ' '
         || (SELECT w FROM test.vocab WHERE n = 1 + (i * 311) % 3375) || '"' FROM generate_series(1, 5) i
  UNION ALL
  SELECT left((SELECT w FROM test.vocab WHERE n = 1 + (i * 53) % 3375), 4) || ' -'
         || (SELECT w FROM test.vocab WHERE n = 1 + (i * 97) % 3375) FROM generate_series(1, 5) i
  UNION ALL
  -- A title word with one letter dropped: no exact hit, the fuzzy path runs.
  SELECT overlay(split_part(t.title, ' ', 1) PLACING '' FROM 3 FOR 1)
    FROM public.tasks t WHERE t.id IN (SELECT test.id('t' || (i * 900)) FROM generate_series(1, 6) i)
  UNION ALL
  SELECT w.task_key || '-' || t.number
    FROM public.tasks t JOIN public.workspaces w ON w.id = t.workspace_id
   WHERE t.id IN (SELECT test.id('t' || (i * 1200 + 3)) FROM generate_series(1, 4) i)
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
    PERFORM count(*) FROM public.tasks__search(v_ws, q, 20);
  END LOOP;
  FOREACH q IN ARRAY v_qs LOOP
    v_t := clock_timestamp();
    SELECT count(*) INTO v_n FROM public.tasks__search(v_ws, q, 20);
    v_ms := v_ms || (extract(epoch FROM clock_timestamp() - v_t) * 1000);
    v_hits := v_hits + v_n;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY m), percentile_cont(0.5) WITHIN GROUP (ORDER BY m)
    INTO v_p95, v_p50 FROM unnest(v_ms) m;
  RAISE NOTICE 'tasks__search at 10k tasks: p50 % ms, p95 % ms, % hits over 50 queries',
    round(v_p50::numeric, 1), round(v_p95::numeric, 1), v_hits;
  PERFORM test.ok(v_hits > 50, 'the queries find things (the timing measures real work)', v_hits::text);
  PERFORM test.ok(v_p95 <= 60, '10k tasks: p95 ≤ 60 ms', format('p50 %s ms, p95 %s ms',
    round(v_p50::numeric, 1), round(v_p95::numeric, 1)));
END;
$$;

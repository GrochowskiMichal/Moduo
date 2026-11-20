-- GS-3: search_all(ws, query, types, limit_per_type, context_type, context_id)
-- merges notes__search with the registry__search adapter, dedupes, applies
-- per-type limits and ranks (specs/global-search.md AC4, AC5, AC6;
-- Assumptions 2, 5, 7, 8, 12, 18).
--
-- Cast: O owns workspace W (task key SRC, once OLD); A is a member. Projects:
-- P1 is shared with the workspace, PA is archived, PP is O's own. Everything
-- else is shared with the workspace unless a case says otherwise.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Search all W');
UPDATE public.workspaces SET task_key = 'SRC', task_key_aliases = '{OLD}' WHERE id = test.id('W');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('A'), 'member');

-- Rows as a signed-in person, in the order search_all returns them, as jsonb.
CREATE FUNCTION test.all_as(p_who text, p_query text, p_types text[] DEFAULT NULL, p_limit int DEFAULT NULL,
                            p_ctx_type text DEFAULT NULL, p_ctx text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY o), '[]')::text
         FROM public.search_all(%L, %L, %L::text[], %s, %L, %L::uuid) WITH ORDINALITY AS h(entity_type, entity_id, title,
              context, snippet, icon, match, rank, updated_at, archived, score, type_total, top, o)$q$,
    test.id('W'), p_query, p_types, coalesce(p_limit::text, 'NULL'), p_ctx_type,
    CASE WHEN p_ctx IS NULL THEN NULL ELSE test.id(p_ctx)::text END));
BEGIN
  IF r LIKE 'ERROR%' THEN
    RETURN jsonb_build_array(jsonb_build_object('error', r));
  END IF;
  RETURN r::jsonb;
END;
$$;

CREATE FUNCTION test.ids(p_rows jsonb) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg((h ->> 'entity_id')::uuid ORDER BY o), '{}')
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(h, o)
$$;

CREATE FUNCTION test.row_of(p_rows jsonb, p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT h FROM jsonb_array_elements(p_rows) h WHERE h ->> 'entity_id' = test.id(p_name)::text
$$;

CREATE FUNCTION test.pos(p_rows jsonb, p_name text) RETURNS bigint LANGUAGE sql AS $$
  SELECT o FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(h, o) WHERE h ->> 'entity_id' = test.id(p_name)::text
$$;

CREATE FUNCTION test.of_type(p_rows jsonb, p_type text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::int FROM jsonb_array_elements(p_rows) h WHERE h ->> 'entity_type' = p_type
$$;

-- Every row keeps the contract: a known match, an archived flag, rank and
-- score in 0..1, a type total at least its rows, exactly one Top result and it
-- comes first, nothing twice.
CREATE FUNCTION test.well_formed(p_rows jsonb) RETURNS boolean LANGUAGE sql AS $$
  SELECT jsonb_array_length(p_rows) = 0 OR (
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) h
                 WHERE h ->> 'match' NOT IN ('handle', 'title', 'title_fuzzy', 'body')
                    OR h -> 'archived' IS NULL OR jsonb_typeof(h -> 'archived') <> 'boolean'
                    OR (h ->> 'rank')::real NOT BETWEEN 0 AND 1
                    OR (h ->> 'score')::real NOT BETWEEN 0 AND 1
                    OR (h ->> 'updated_at') IS NULL
                    OR (h ->> 'type_total')::int < (SELECT count(*) FROM jsonb_array_elements(p_rows) g
                                                     WHERE g ->> 'entity_type' = h ->> 'entity_type'))
    AND (SELECT count(*) FROM jsonb_array_elements(p_rows) h WHERE (h ->> 'top')::boolean) = 1
    AND (p_rows -> 0 ->> 'top')::boolean
    AND (SELECT count(*) = count(DISTINCT (h ->> 'entity_type') || ':' || (h ->> 'entity_id'))
           FROM jsonb_array_elements(p_rows) h)
  )
$$;

-- ── Fixture ──────────────────────────────────────────────────────────────────

INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('P1'), test.id('W'), test.id('O'), 'Garden', false),
  (test.id('PA'), test.id('W'), test.id('O'), 'Old orchard', false),
  (test.id('PP'), test.id('W'), test.id('O'), 'Private board', false);
UPDATE public.buckets SET archived_at = now() WHERE id = test.id('PA');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PP');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'bucket', test.id(b), 'workspace', NULL, 'edit', test.id('O') FROM unnest(ARRAY['P1', 'PA']) b
ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;

INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('TH'), test.id('W'), test.id('P1'), test.id('O'), 'Kumquat harvest', 'todo'),
  (test.id('QL'), test.id('W'), test.id('P1'), test.id('O'), 'Quince pie', 'todo'),
  (test.id('QA'), test.id('W'), test.id('PA'), test.id('O'), 'Quince jelly', 'todo'),
  (test.id('CT'), test.id('W'), test.id('P1'), test.id('O'), 'Context anchor', 'todo'),
  (test.id('CP'), test.id('W'), test.id('PP'), test.id('O'), 'Private anchor', 'todo');
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
SELECT test.id('PEAR' || i), test.id('W'), test.id('P1'), test.id('O'), 'Pear crate ' || i, 'todo' FROM generate_series(1, 12) i;
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
SELECT test.id('FIG' || i), test.id('W'), test.id('P1'), test.id('O'), 'Fig box ' || i, 'todo' FROM generate_series(1, 60) i;

INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, updated_at, is_archived) VALUES
  (test.id('NK'), test.id('W'), test.id('O'), 'Picking day', 'We picked a kumquat by the gate', now(), false),
  (test.id('L1'), test.id('W'), test.id('O'), 'Lemon plan', '', now() - interval '1 day', false),
  (test.id('L2'), test.id('W'), test.id('O'), 'Lemon plan', '', now(), false),
  (test.id('R1'), test.id('W'), test.id('O'), 'Rhubarb crumble', '', now(), false),
  (test.id('R2'), test.id('W'), test.id('O'), 'Rhubarb crumble', '', now() - interval '30 days', false),
  (test.id('NX'), test.id('W'), test.id('O'), 'Old log', 'the harvst was late', now() - interval '300 days', true),
  (test.id('QN'), test.id('W'), test.id('O'), 'Quince notes', '', now(), true);
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'note', n.id, 'workspace', NULL, 'view', test.id('O') FROM public.notes n WHERE n.workspace_id = test.id('W');

INSERT INTO public.companies (id, workspace_id, owner_id, name) VALUES
  (test.id('CO'), test.id('W'), test.id('O'), 'Kumquat Ltd');
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES
  (test.id('ZL'), test.id('W'), test.id('O'), 'Żaneta Łukasiewicz'),
  (test.id('AL'), test.id('W'), test.id('O'), 'Al Green');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'contact', test.id(c), 'workspace', NULL, 'view', test.id('O') FROM unnest(ARRAY['ZL', 'AL']) c
ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;
INSERT INTO public.calendar_events (id, workspace_id, owner_id, title, start_time, end_time) VALUES
  (test.id('EV'), test.id('W'), test.id('O'), 'Kumquat tasting', now() + interval '1 day', now() + interval '1 day 1 hour');

-- The registry rows the adapter reads (tasks register themselves on insert).
INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, updated_at) VALUES
  (test.id('W'), 'company', test.id('CO'), 'Kumquat Ltd', now()),
  (test.id('W'), 'contact', test.id('ZL'), 'Żaneta Łukasiewicz', now()),
  (test.id('W'), 'contact', test.id('AL'), 'Al Green', now()),
  (test.id('W'), 'event', test.id('EV'), 'Kumquat tasting', now()),
  (test.id('W'), 'bucket', test.id('P1'), 'Garden', now()),
  (test.id('W'), 'bucket', test.id('PA'), 'Old orchard', now()),
  (test.id('W'), 'note', test.id('L1'), 'Lemon plan', now())
ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;

-- L1 is linked to both anchors: CT, which A can see, and CP, which A can't.
INSERT INTO public.entity_links (workspace_id, source_type, source_id, target_type, target_id, created_by) VALUES
  (test.id('W'), 'note', test.id('L1'), 'task', test.id('CT'), test.id('O')),
  (test.id('W'), 'task', test.id('CP'), 'note', test.id('L1'), test.id('O'));

CREATE TABLE test.handle AS
  SELECT handle, split_part(handle, '-', 2) AS num FROM public.entities
   WHERE workspace_id = test.id('W') AND entity_type = 'task' AND entity_id = test.id('TH');

SELECT test.ok((SELECT handle FROM test.handle) LIKE 'SRC-%', 'the fixture task has a handle',
  (SELECT handle FROM test.handle));

-- ── Merge: every adopted type in one ranked list ────────────────────────────

DO $$
DECLARE
  v jsonb := test.all_as('O', 'kumquat');
BEGIN
  PERFORM test.ok(test.well_formed(v), 'search_all keeps the row contract (match vocabulary, flags, one Top result first, nothing twice)', v::text);
  PERFORM test.ok(test.row_of(v, 'NK') ->> 'match' = 'body' AND test.row_of(v, 'NK') ->> 'snippet' IS NOT NULL,
    'a note found by a body word comes from notes__search, with its snippet', v::text);
  PERFORM test.ok(test.row_of(v, 'TH') ->> 'entity_type' = 'task'
              AND test.row_of(v, 'CO') ->> 'entity_type' = 'company'
              AND test.row_of(v, 'EV') ->> 'entity_type' = 'event',
    'tasks, companies and events come from the registry adapter, in the same list', v::text);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) h WHERE h ->> 'entity_type' = 'note'
                                AND h ->> 'entity_id' <> test.id('NK')::text),
    'no other note says kumquat', v::text);
END;
$$;

SELECT test.ok(jsonb_array_length(test.all_as('O', '')) = 0
           AND jsonb_array_length(test.all_as('O', 'k')) = 0
           AND jsonb_array_length(test.all_as('O', '-kumquat')) = 0,
  'an empty, one-letter or only-negative query searches nothing');

-- Types filter.
SELECT test.ok(test.ids(test.all_as('O', 'kumquat', ARRAY['note'])) = ARRAY[test.id('NK')],
  'a types filter keeps only those types');
SELECT test.ok(test.of_type(test.all_as('O', 'kumquat', ARRAY['task', 'event']), 'note') = 0
           AND test.of_type(test.all_as('O', 'kumquat', ARRAY['task', 'event']), 'event') = 1,
  'and asks notes__search nothing when notes aren''t wanted');

-- ── AC6: a task ID finds that task first ─────────────────────────────────────

DO $$
DECLARE
  h text := (SELECT handle FROM test.handle);
  n text := (SELECT num FROM test.handle);
  v jsonb;
BEGIN
  FOREACH h IN ARRAY ARRAY[h, lower(h), 'src ' || n, 'OLD-' || n] LOOP
    v := test.all_as('A', h);
    PERFORM test.ok(v -> 0 ->> 'entity_id' = test.id('TH')::text AND v -> 0 ->> 'match' = 'handle'
                AND (v -> 0 ->> 'rank')::real = 1 AND (v -> 0 ->> 'top')::boolean,
      format('"%s" finds the task first, as a handle hit with rank 1', h), v::text);
  END LOOP;
END;
$$;

-- ── Typo forgiveness: word_similarity ≥ 0.5, never above an exact hit ───────

DO $$
DECLARE
  v jsonb := test.all_as('A', 'harvst');
BEGIN
  PERFORM test.ok(test.row_of(v, 'TH') ->> 'match' = 'title_fuzzy',
    'a typo finds a registry title by its best-matching stretch (word_similarity, not whole-title similarity)', v::text);
  PERFORM test.ok(test.pos(v, 'NX') = 1 AND test.pos(v, 'TH') > test.pos(v, 'NX'),
    'an old, archived exact body hit still ranks above a fresh typo-forgiven title', v::text);
  PERFORM test.ok(jsonb_array_length(test.all_as('A', 'kmqt')) = 0,
    'a stretch that shares too few letters finds nothing', test.all_as('A', 'kmqt')::text);
  PERFORM test.ok(test.of_type(test.all_as('A', 'harvst -kumquat'), 'task') = 0,
    'an excluded word excludes typo-forgiven registry titles too');
END;
$$;

-- ── Accents, word-starts and short words in the registry adapter ─────────────

SELECT test.ok(test.row_of(test.all_as('A', 'zaneta luka'), 'ZL') ->> 'match' = 'title',
  '"zaneta luka" finds "Żaneta Łukasiewicz": unaccented word-starts, every word, any order');
SELECT test.ok(test.row_of(test.all_as('A', 'LUKASIEWICZ żaneta'), 'ZL') IS NOT NULL,
  'and the other way round');
SELECT test.ok(test.row_of(test.all_as('A', 'al green'), 'AL') IS NOT NULL
           AND test.row_of(test.all_as('A', 'gr al'), 'AL') ->> 'match' IS DISTINCT FROM 'title',
  'words of 1–2 letters match whole words only (a word-start of 2 letters is at most a typo match)');

-- ── Archived: flagged, and ranked below a live twin ─────────────────────────

DO $$
DECLARE
  v jsonb := test.all_as('A', 'quince');
BEGIN
  PERFORM test.ok((test.row_of(v, 'QA') ->> 'archived')::boolean AND NOT (test.row_of(v, 'QL') ->> 'archived')::boolean,
    'a task in an archived project is flagged archived; a live one isn''t', v::text);
  PERFORM test.ok(test.pos(v, 'QL') < test.pos(v, 'QA'), 'the archived task ranks below the live one', v::text);
  PERFORM test.ok((test.row_of(v, 'QN') ->> 'archived')::boolean,
    'an archived note is flagged archived (notes__search''s new column)', v::text);
  PERFORM test.ok((test.row_of(test.all_as('A', 'orchard'), 'PA') ->> 'archived')::boolean,
    'an archived project is flagged archived');
END;
$$;

-- ── Per-type limits and the "Show all N" count ──────────────────────────────

DO $$
DECLARE
  v jsonb := test.all_as('A', 'pear');
BEGIN
  PERFORM test.ok(test.of_type(v, 'task') = 8 AND (v -> 0 ->> 'type_total')::int = 12,
    'by default 8 rows per type, with the type''s total for "Show all 12"', v::text);
  PERFORM test.ok(test.of_type(test.all_as('A', 'pear', NULL, 50), 'task') = 12, 'a limit of 50 returns all 12');
  PERFORM test.ok(test.of_type(test.all_as('A', 'pear', NULL, 2), 'task') = 2, 'a limit of 2 returns 2');
  v := test.all_as('A', 'fig', NULL, 1000);
  PERFORM test.ok(test.of_type(v, 'task') = 50 AND (v -> 0 ->> 'type_total')::int = 50,
    'the limit is capped at 50, and so is the count', v::text);
END;
$$;

-- ── Ranking: recency and the context boost ──────────────────────────────────

DO $$
DECLARE
  v jsonb := test.all_as('A', 'rhubarb');
  d real := (test.row_of(v, 'R1') ->> 'score')::real - (test.row_of(v, 'R2') ->> 'score')::real;
BEGIN
  PERFORM test.ok(test.pos(v, 'R1') < test.pos(v, 'R2') AND d BETWEEN 0.065 AND 0.085,
    'with equal text, the newer ranks higher, 30 days halving the 0.15 recency term', format('%s %s', d, v));
END;
$$;

DO $$
DECLARE
  v jsonb;
BEGIN
  v := test.all_as('A', 'lemon');
  PERFORM test.ok(test.ids(v) = ARRAY[test.id('L2'), test.id('L1')], 'without context the newer note leads', v::text);
  v := test.all_as('A', 'lemon', NULL, NULL, 'task', 'CT');
  PERFORM test.ok(test.ids(v) = ARRAY[test.id('L1'), test.id('L2')],
    'a note linked to the item open now ranks up (context 0.10)', v::text);
  v := test.all_as('A', 'lemon', NULL, NULL, 'task', 'CP');
  PERFORM test.ok(test.ids(v) = ARRAY[test.id('L2'), test.id('L1')],
    'a context item you can''t see boosts nothing', v::text);
  v := test.all_as('O', 'lemon', NULL, NULL, 'task', 'CP');
  PERFORM test.ok(test.ids(v) = ARRAY[test.id('L1'), test.id('L2')],
    'the same link boosts for someone who can see that item (either direction of the link)', v::text);
END;
$$;

-- ── The adapter on its own, and notes__search's archived column ──────────────

SELECT test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.registry__search(%L, 'kumquat', 20)$q$, test.id('W')))::int = 3,
  'registry__search answers by itself, as the person asking');
SELECT test.ok(test.value_as('A', format($q$SELECT count(*) FROM public.registry__search(%L, 'lemon', 20) WHERE entity_type = 'note'$q$, test.id('W'))) = '0',
  'it never answers for notes, which are on the contract');
SELECT test.ok(test.value_as('A', format($q$SELECT count(*) FROM public.registry__search(%L, 'pear', 3, ARRAY['task']) $q$, test.id('W'))) = '3',
  'its limit is per type');
SELECT test.ok(test.value_as('A', format($q$SELECT bool_and(archived) FROM public.notes__search(%L, 'quince', 20)$q$, test.id('W'))) = 'true',
  'notes__search returns an archived column');

-- ── Shape and grants (Assumption 7) ──────────────────────────────────────────

SELECT test.ok((SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=""', 'statement_timeout=5s'] FROM pg_proc
                 WHERE oid = 'public.search_all(uuid, text, text[], integer, text, uuid)'::regprocedure),
  'search_all is SECURITY INVOKER, with an empty search_path and a 5 s statement timeout');
SELECT test.ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc
                 WHERE oid = 'public.registry__search(uuid, text, integer, text[])'::regprocedure),
  'registry__search is SECURITY DEFINER with an empty search_path (the actor comes from the request)');
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.search_all(uuid, text, text[], integer, text, uuid)',
                             'public.registry__search(uuid, text, integer, text[])',
                             'public.notes__search(uuid, text, integer)']) f
   WHERE has_function_privilege('anon', f, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
      OR NOT has_function_privilege('service_role', f, 'EXECUTE')),
  'search_all, registry__search and notes__search are callable by signed-in people and the server, never anon');
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.search_all(uuid, text, text[], integer, text, uuid)'::regprocedure,
                                          'public.registry__search(uuid, text, integer, text[])'::regprocedure)
     AND EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a IN ('p_actor', 'p_user', 'p_user_id'))),
  'the actor is never a parameter');

-- ── Validator follow-ups ─────────────────────────────────────────────────────

-- Typo forgiveness holds across modules: 3 exact hits anywhere switch it off.
DO $$
DECLARE
  v jsonb;
BEGIN
  INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text) VALUES
    (test.id('HV1'), test.id('W'), test.id('O'), 'Field log 1', 'harvst notes'),
    (test.id('HV2'), test.id('W'), test.id('O'), 'Field log 2', 'harvst again'),
    (test.id('HV3'), test.id('W'), test.id('O'), 'Field log 3', 'one more harvst');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  SELECT test.id('W'), 'note', test.id(n), 'workspace', NULL, 'view', test.id('O') FROM unnest(ARRAY['HV1', 'HV2', 'HV3']) n
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;
  v := test.all_as('A', 'harvst');
  PERFORM test.ok(test.row_of(v, 'TH') IS NULL
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) h WHERE h ->> 'match' = 'title_fuzzy'),
    'with 3+ exact hits in one module, no other module''s typo-forgiven title shows', v::text);
END;
$$;

-- A key's context is ignored (it has no item open; its creator's visibility
-- isn't its scope): the score never tells it about a linked item.
CREATE TEMP TABLE key_ctx (entity_id uuid, score real) ON COMMIT DROP;
GRANT ALL ON key_ctx TO service_role;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KC'), test.id('W'), 'O notes', 'mdo_kc', md5('db-test-kc'), '{"notes": "view"}'::jsonb, test.id('O'));
SELECT test.as_key('KC', format($q$INSERT INTO pg_temp.key_ctx SELECT h.entity_id, h.score
                                    FROM public.search_all(%L, 'lemon', NULL, NULL, 'task', %L) h$q$,
                              test.id('W'), test.id('CP')));
SELECT test.ok((SELECT array_agg(entity_id ORDER BY score DESC, entity_id) FROM key_ctx) = ARRAY[test.id('L2'), test.id('L1')],
  'a key''s context boosts nothing');

-- GS-2: notes__search(ws, query, limit), Notes on the global search contract
-- (specs/global-search.md AC1, AC2, AC3, AC4, AC10; Assumptions 6, 7, 9, 10, 11).
--
-- Cast: O owns workspace W; A is a member; X is signed in but not a member.
-- Keys: KV (notes: view, A's), KT (tasks only, A's), KO (notes: view, O's),
-- KR (revoked, A's).
--
-- Every root note gets the workspace's default grant on insert; the fixture
-- clears them and shares exactly what each case needs.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Search W');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('A'), 'member');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by, revoked_at) VALUES
  (test.id('KV'), test.id('W'), 'A notes reader', 'mdo_kv', md5('db-test-kv'), '{"notes": "view"}'::jsonb, test.id('A'), NULL),
  (test.id('KT'), test.id('W'), 'A tasks agent', 'mdo_kt', md5('db-test-kt'), '{"tasks": "edit"}'::jsonb, test.id('A'), NULL),
  (test.id('KO'), test.id('W'), 'O notes reader', 'mdo_ko', md5('db-test-ko'), '{"notes": "view"}'::jsonb, test.id('O'), NULL),
  (test.id('KR'), test.id('W'), 'Revoked', 'mdo_kr', md5('db-test-kr'), '{"notes": "view"}'::jsonb, test.id('A'), now());

-- Hits as a signed-in person, best first, as jsonb (the test schema can't be
-- read under authenticated, so ids are compared after).
CREATE FUNCTION test.search_as(p_who text, p_query text, p_limit int DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.rank DESC, h.updated_at DESC, h.entity_id), '[]')::text
         FROM public.notes__search(%L, %L, %s) h$q$, test.id('W'), p_query, p_limit));
BEGIN
  IF r LIKE 'ERROR%' THEN
    RETURN jsonb_build_array(jsonb_build_object('error', r));
  END IF;
  RETURN r::jsonb;
END;
$$;

-- The ids in a hit list, in order.
CREATE FUNCTION test.hit_ids(p_hits jsonb) RETURNS uuid[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg((h ->> 'entity_id')::uuid ORDER BY o), '{}')
    FROM jsonb_array_elements(p_hits) WITH ORDINALITY AS t(h, o)
$$;

CREATE FUNCTION test.hit(p_hits jsonb, p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT h FROM jsonb_array_elements(p_hits) h WHERE h ->> 'entity_id' = test.id(p_name)::text
$$;

-- ── Fixture ──────────────────────────────────────────────────────────────────

-- A four-level tree, shared at the top: Company > Planning > Quarterly review > Retro.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('TOP'), test.id('W'), test.id('O'), 'Company', 'About us');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, parent_id) VALUES
  (test.id('PL'), test.id('W'), test.id('O'), 'Planning', 'Ideas for the kumquat jam stand', test.id('TOP'));
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, parent_id) VALUES
  (test.id('QR'), test.id('W'), test.id('O'), 'Quarterly review', 'Numbers', test.id('PL'));
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, parent_id) VALUES
  (test.id('DEEP'), test.id('W'), test.id('O'), 'Retro',
   'What went well. ' || repeat('Filler words about the quarter. ', 20)
   || 'We tasted a kumquat at lunch and liked it. ' || repeat('More filler. ', 10), test.id('QR'));

-- Title above body.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('T1'), test.id('W'), test.id('O'), 'Budget plan', ''),
  (test.id('T2'), test.id('W'), test.id('O'), 'Expenses', 'The budget for the third quarter'),
  (test.id('T3'), test.id('W'), test.id('O'), 'Budget review', 'The budget, again');

-- Accents, both ways.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('Z1'), test.id('W'), test.id('O'), 'Garden', 'Mój żółw śpi pod krzakiem'),
  (test.id('Z2'), test.id('W'), test.id('O'), 'Zolw notes', '');

-- A shared note under a private parent.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('SEC'), test.id('W'), test.id('O'), 'Secret plans', 'Nothing here');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, parent_id) VALUES
  (test.id('SH'), test.id('W'), test.id('O'), 'Shared bit', 'A persimmon on the desk', test.id('SEC'));
UPDATE public.notes SET share_mode = 'custom' WHERE id = test.id('SH');

-- Trashed and archived.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, deleted_at, is_archived) VALUES
  (test.id('TR'), test.id('W'), test.id('O'), 'Quince old', '', now(), false),
  (test.id('AR'), test.id('W'), test.id('O'), 'Quince jam', '', NULL, true),
  (test.id('LV'), test.id('W'), test.id('O'), 'Quince tart', '', NULL, false);

-- Typo forgiveness.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('MT'), test.id('W'), test.id('O'), 'Weekly meeting notes', 'Agenda');

-- A's own private note.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('AP'), test.id('W'), test.id('A'), 'Diary', 'An aubergine for dinner');

-- One shared match, then 300 newer private ones with the same words.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, updated_at) VALUES
  (test.id('ZV'), test.id('W'), test.id('O'), 'Crossing', 'The zebra crossing by the office', now() - interval '30 days');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, updated_at)
SELECT test.id('ZP' || i), test.id('W'), test.id('O'), 'Private ' || i, 'The zebra crossing by the office', now()
  FROM generate_series(1, 300) i;

-- An edit-shared note A renames below.
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
  (test.id('ED'), test.id('W'), test.id('O'), 'Draft', '');

DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'note', test.id(n), 'workspace', NULL, 'view', test.id('O')
  FROM unnest(ARRAY['TOP', 'T1', 'T2', 'T3', 'Z1', 'Z2', 'TR', 'AR', 'LV', 'MT', 'ZV']) n;
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'note', test.id('SH'), 'member', test.id('A'), 'view', test.id('O')),
  (test.id('W'), 'note', test.id('ED'), 'workspace', NULL, 'edit', test.id('O'));

-- ── AC1: a body word finds the note, with a snippet and its parent path ─────

DO $$
DECLARE
  v jsonb := test.search_as('A', 'kumquat');
  d jsonb := test.hit(v, 'DEEP');
  p jsonb := test.hit(v, 'PL');
BEGIN
  PERFORM test.ok(jsonb_array_length(v) = 2 AND d IS NOT NULL AND p IS NOT NULL,
    'a word only in two notes'' bodies finds exactly those notes', v::text);
  PERFORM test.ok(d ->> 'match' = 'body' AND d ->> 'entity_type' = 'note' AND d ->> 'title' = 'Retro',
    'a body hit says so, with the note''s type and title', d::text);
  PERFORM test.ok(strpos(d ->> 'snippet', chr(57344) || 'kumquat' || chr(57345)) > 0
              AND length(d ->> 'snippet') < 400,
    'the snippet is a short fragment with the word marked', d ->> 'snippet');
  PERFORM test.ok(d ->> 'context' = '… / Planning / Quarterly review',
    'the context is the parent path: two ancestors, more above shown as …', d ->> 'context');
  PERFORM test.ok(p ->> 'context' = 'Company', 'a note one level down shows its one parent', p ->> 'context');
  PERFORM test.ok((test.search_as('A', 'Company') -> 0 ->> 'context') IS NULL,
    'a root note has no context');
  PERFORM test.ok(test.hit(test.search_as('A', 'kumq'), 'DEEP') IS NOT NULL,
    'a word of 3+ letters matches word-starts');
END;
$$;

-- ── Title above body; snippet only for body hits ─────────────────────────────

DO $$
DECLARE
  v jsonb := test.search_as('A', 'budget');
BEGIN
  PERFORM test.ok(jsonb_array_length(v) = 3, 'three notes say budget', v::text);
  PERFORM test.ok(test.hit(v, 'T1') ->> 'match' = 'title' AND test.hit(v, 'T1') -> 'snippet' = 'null'::jsonb,
    'a title hit has no snippet', test.hit(v, 'T1')::text);
  PERFORM test.ok(test.hit(v, 'T3') ->> 'match' = 'title' AND test.hit(v, 'T3') -> 'snippet' = 'null'::jsonb,
    'a note matching in its title and its body is a title hit, without a snippet');
  PERFORM test.ok(test.hit(v, 'T2') ->> 'match' = 'body' AND test.hit(v, 'T2') ->> 'snippet' IS NOT NULL,
    'a body hit has one');
  PERFORM test.ok((test.hit(v, 'T1') ->> 'rank')::real > (test.hit(v, 'T2') ->> 'rank')::real
              AND (test.hit(v, 'T3') ->> 'rank')::real > (test.hit(v, 'T2') ->> 'rank')::real,
    'title hits rank above body hits');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) h
                               WHERE (h ->> 'rank')::real NOT BETWEEN 0 AND 1
                                  OR h ->> 'match' NOT IN ('handle', 'title', 'title_fuzzy', 'body')
                                  OR (h ->> 'updated_at') IS NULL),
    'every row keeps the contract: rank in 0..1, a known match, a timestamp');
  PERFORM test.ok(test.hit_ids(test.search_as('A', 'quarter budget')) = ARRAY[test.id('T2')],
    'all words must match, in any order');
END;
$$;

-- ── AC2 for notes: accents both ways ─────────────────────────────────────────

DO $$
BEGIN
  PERFORM test.ok(test.hit(test.search_as('A', 'zolw'), 'Z1') IS NOT NULL
              AND strpos(test.hit(test.search_as('A', 'zolw'), 'Z1') ->> 'snippet',
                         chr(57344) || 'żółw' || chr(57345)) > 0,
    '"zolw" finds "żółw" in a body and marks the accented word',
    test.hit(test.search_as('A', 'zolw'), 'Z1')::text);
  PERFORM test.ok(test.hit(test.search_as('A', 'ŻÓŁW'), 'Z2') ->> 'match' = 'title',
    '"ŻÓŁW" finds "Zolw" in a title');
  PERFORM test.ok(jsonb_array_length(test.search_as('A', '-zebra')) = 0
              AND jsonb_array_length(test.search_as('A', '   ')) = 0,
    'an only-negative or empty query finds nothing');
END;
$$;

-- ── AC3: what you can't open never appears ───────────────────────────────────

DO $$
DECLARE
  v jsonb;
BEGIN
  v := test.search_as('A', 'persimmon');
  PERFORM test.ok(test.hit_ids(v) = ARRAY[test.id('SH')] AND (v -> 0 -> 'context') = 'null'::jsonb,
    'a note shared with you under a private parent is found, and the parent''s title stays hidden', v::text);
  PERFORM test.ok(test.search_as('O', 'persimmon') -> 0 ->> 'context' = 'Secret plans',
    'its owner sees the parent path');
  PERFORM test.ok(jsonb_array_length(test.search_as('A', 'secret')) = 0,
    'a private note is never found by someone else');
  PERFORM test.ok(jsonb_array_length(test.search_as('O', 'aubergine')) = 0
              AND test.hit_ids(test.search_as('A', 'aubergine')) = ARRAY[test.id('AP')],
    'the workspace owner doesn''t see a member''s private note; the member does');
  PERFORM test.ok(jsonb_array_length(test.search_as('X', 'budget')) = 0,
    'someone outside the workspace finds nothing');

  v := test.search_as('A', 'quince');
  PERFORM test.ok(NOT (test.id('TR') = ANY (test.hit_ids(v))), 'a trashed note is hidden', v::text);
  PERFORM test.ok(test.hit_ids(v) = ARRAY[test.id('LV'), test.id('AR')],
    'an archived note is found, ranked below a live one', v::text);
END;
$$;

-- API keys: the key's scope and its person's access, both.
SELECT test.ok(test.as_key('KV', format($q$SELECT 1 FROM public.notes__search(%L, 'kumquat', 20)$q$, test.id('W'))) = 'ok 2',
  'a key with notes view finds what its person sees');
SELECT test.ok(test.as_key('KV', format($q$SELECT 1 FROM public.notes__search(%L, 'secret', 20)$q$, test.id('W'))) = 'ok 0',
  'and not what its person can''t see');
SELECT test.ok(test.as_key('KO', format($q$SELECT 1 FROM public.notes__search(%L, 'aubergine', 20)$q$, test.id('W'))) = 'ok 0'
           AND test.as_key('KO', format($q$SELECT 1 FROM public.notes__search(%L, 'secret', 20)$q$, test.id('W'))) = 'ok 1',
  'the owner''s key sees the owner''s notes, not a member''s private one');
SELECT test.ok(test.as_key('KT', format($q$SELECT 1 FROM public.notes__search(%L, 'kumquat', 20)$q$, test.id('W'))) = 'ok 0',
  'a key without notes scope finds no notes');
SELECT test.ok(test.as_key('KR', format($q$SELECT 1 FROM public.notes__search(%L, 'kumquat', 20)$q$, test.id('W'))) = 'ok 0',
  'a revoked key finds nothing');
SELECT test.ok(test.as_key('KV', format($q$SELECT 1 FROM public.notes__search(%L, 'kumquat', 20)$q$, test.id('W2-none'))) = 'ok 0',
  'a key asking about another workspace finds nothing');

-- ── AC4: visibility before the limit ─────────────────────────────────────────

SELECT test.ok(test.hit_ids(test.search_as('A', 'zebra', 1)) = ARRAY[test.id('ZV')],
  '300 newer matches you can''t see don''t push out the one you can (limit 1)');
SELECT test.ok(jsonb_array_length(test.search_as('A', 'zebra crossing', 50)) = 1,
  'and they aren''t counted either');
SELECT test.ok(jsonb_array_length(test.search_as('O', 'zebra', 1000)) = 50,
  'the limit is capped at 50');

-- ── Typo forgiveness on titles ───────────────────────────────────────────────

DO $$
DECLARE
  v jsonb := test.search_as('A', 'meetng');
  v_min_exact real;
BEGIN
  PERFORM test.ok(test.hit_ids(v) = ARRAY[test.id('MT')] AND v -> 0 ->> 'match' = 'title_fuzzy'
              AND v -> 0 -> 'snippet' = 'null'::jsonb,
    'a typo finds the title when nothing matches exactly', v::text);

  INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
    (test.id('MB1'), test.id('W'), test.id('O'), 'Typo one', 'Notes from the meetng');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'note', test.id('MB1'), 'workspace', NULL, 'view', test.id('O'))
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;
  v := test.search_as('A', 'meetng');
  SELECT min((h ->> 'rank')::real) INTO v_min_exact FROM jsonb_array_elements(v) h WHERE h ->> 'match' <> 'title_fuzzy';
  PERFORM test.ok(test.hit_ids(v) = ARRAY[test.id('MB1'), test.id('MT')]
              AND (test.hit(v, 'MT') ->> 'rank')::real < v_min_exact,
    'with fewer than 3 exact hits the fuzzy title still shows, ranked below them', v::text);

  INSERT INTO public.notes (id, workspace_id, created_by, title, body_text) VALUES
    (test.id('MB2'), test.id('W'), test.id('O'), 'Typo two', 'Another meetng'),
    (test.id('MB3'), test.id('W'), test.id('O'), 'Typo three', 'A third meetng');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  SELECT test.id('W'), 'note', test.id(n), 'workspace', NULL, 'view', test.id('O') FROM unnest(ARRAY['MB2', 'MB3']) n
  ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;
  v := test.search_as('A', 'meetng');
  PERFORM test.ok(jsonb_array_length(v) = 3
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) h WHERE h ->> 'match' = 'title_fuzzy'),
    'with 3 exact hits, typo forgiveness stays off', v::text);
  PERFORM test.ok(jsonb_array_length(test.search_as('A', 'qwzx')) = 0,
    'a word like nothing finds nothing, fuzzily or not');
END;
$$;

-- ── The index is rebuilt unaccented, and people can still write notes ────────

SELECT test.ok(test.as_user('A', format($q$UPDATE public.notes SET title = 'Café plans' WHERE id = %L$q$, test.id('ED'))) = 'ok 1',
  'a member can still rename a note they may edit (the generated column runs as them)');
SELECT test.ok(test.search_as('A', 'cafe') -> 0 ->> 'entity_id' = test.id('ED')::text
           AND test.search_as('A', 'cafe') -> 0 ->> 'match' = 'title',
  'and the new title is searchable at once, accents ignored');
SELECT test.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notes'
                         AND indexdef LIKE '%USING gin (search_tsv)%')
           AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notes'
                         AND indexdef LIKE '%gin_trgm_ops%'),
  'notes keep a GIN index on search_tsv and gain a trigram index on the title');

-- ── Grants and shape ─────────────────────────────────────────────────────────

SELECT test.ok(has_function_privilege('authenticated', 'public.notes__search(uuid, text, integer)', 'EXECUTE')
           AND has_function_privilege('service_role', 'public.notes__search(uuid, text, integer)', 'EXECUTE')
           AND NOT has_function_privilege('anon', 'public.notes__search(uuid, text, integer)', 'EXECUTE'),
  'notes__search is callable by signed-in people and the server, never anon');
SELECT test.ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc
                 WHERE oid = 'public.notes__search(uuid, text, integer)'::regprocedure),
  'it is SECURITY DEFINER with an empty search_path (the actor comes from the request, never an argument)');

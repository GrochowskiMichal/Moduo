-- GS-8: recents are private, capped, erased (specs/global-search.md AC7;
-- Assumption 14; Q11–Q13b, Q19).
--
--   search_recents (user_id, workspace_id, entity_type, entity_id,
--                   last_opened_at, open_count): owner-only, read-only to clients.
--   search_op_record_open(ws, type, id)   the app's open of an item it can see
--   search_op_forget_open(ws, type, id)   remove one from Recent
--   search_op_clear_recents(ws)           clear Recent in a workspace
--   search_recents_list(ws, limit)        ⌘K's Recent: newest first, visible only
--   search_all's personal term            frecency, weight 0.20
--
-- Cast: O owns workspaces W and W2; A and B are members of W; X is outside.
-- Notes are shared with W unless a case says otherwise; NP is O's own.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Recents W'),
  (test.id('W2'), test.id('O'), 'Recents W2');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W2'), test.id('A'), 'member');

INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, updated_at)
SELECT test.id('N' || i), test.id('W'), test.id('O'), 'Recent note ' || i, '', now() FROM generate_series(1, 60) i;
INSERT INTO public.notes (id, workspace_id, created_by, title, body_text, updated_at) VALUES
  (test.id('NP'), test.id('W'), test.id('O'), 'Private recent', '', now()),
  (test.id('M1'), test.id('W2'), test.id('O'), 'Other workspace note', '', now()),
  -- Twins for the personal term: T1 is newer, so it leads until A opens T2.
  (test.id('T1'), test.id('W'), test.id('O'), 'Quokka plan', '', now()),
  (test.id('T2'), test.id('W'), test.id('O'), 'Quokka plan', '', now() - interval '1 minute');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id IN (test.id('W'), test.id('W2')));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT n.workspace_id, 'note', n.id, 'workspace', NULL, 'view', test.id('O')
  FROM public.notes n
 WHERE n.workspace_id IN (test.id('W'), test.id('W2')) AND n.id <> test.id('NP');

INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('P1'), test.id('W'), test.id('O'), 'Recents project', false);
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('P1'), 'workspace', NULL, 'edit', test.id('O'))
ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;

INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KA'), test.id('W'), 'A notes', 'mdo_ka', md5('db-test-ka'), '{"notes": "view"}'::jsonb, test.id('A'));

-- Record an open as a person; the op's answer as text.
CREATE FUNCTION test.open_as(p_who text, p_ws text, p_type text, p_item text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT public.search_op_record_open(%L, %L, %L)::text$q$,
                                     test.id(p_ws), p_type, test.id(p_item)))
$$;

-- What the table holds for someone (read as the test's superuser).
CREATE FUNCTION test.held(p_who text, p_ws text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.search_recents r WHERE r.user_id = test.id(p_who) AND r.workspace_id = test.id(p_ws)
$$;

-- Recent as a person, in order, as jsonb.
CREATE FUNCTION test.recent_as(p_who text, p_ws text, p_limit int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY o), '[]')::text
         FROM public.search_recents_list(%L, %s) WITH ORDINALITY AS h(entity_type, entity_id, title, context,
              snippet, icon, match, rank, updated_at, archived, last_opened_at, o)$q$,
    test.id(p_ws), coalesce(p_limit::text, 'NULL')));
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

-- ── Shape and access ─────────────────────────────────────────────────────────

SELECT test.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.search_recents'::regclass),
  'search_recents has RLS on');
SELECT test.ok(has_table_privilege('authenticated', 'public.search_recents', 'SELECT')
           AND NOT has_table_privilege('authenticated', 'public.search_recents', 'INSERT')
           AND NOT has_table_privilege('authenticated', 'public.search_recents', 'UPDATE')
           AND NOT has_table_privilege('authenticated', 'public.search_recents', 'DELETE')
           AND NOT has_table_privilege('anon', 'public.search_recents', 'SELECT'),
  'people may only read the table; every write goes through the ops; anon gets nothing');

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.search_op_record_open(uuid, text, uuid)',
                           'public.search_op_forget_open(uuid, text, uuid)',
                           'public.search_op_clear_recents(uuid)',
                           'public.search_recents_list(uuid, integer)'] LOOP
    PERFORM test.ok(has_function_privilege('authenticated', f, 'EXECUTE')
                AND has_function_privilege('service_role', f, 'EXECUTE')
                AND NOT has_function_privilege('anon', f, 'EXECUTE'),
      format('%s: authenticated and service_role, never anon', f));
  END LOOP;
END;
$$;

SELECT test.ok(EXISTS (SELECT 1 FROM pg_constraint c
                        WHERE c.conrelid = 'public.search_recents'::regclass AND c.contype = 'f'
                          AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
                          AND c.confdeltype = 'c')
           AND EXISTS (SELECT 1 FROM pg_constraint c
                        WHERE c.conrelid = 'public.search_recents'::regclass AND c.contype = 'f'
                          AND c.confrelid = 'public.workspaces'::regclass AND c.confdeltype = 'c'),
  'a row goes with its person and with its workspace (ON DELETE CASCADE)');

-- ── Recording an open ────────────────────────────────────────────────────────

SELECT test.ok(test.open_as('A', 'W', 'note', 'N1') = 'true' AND test.held('A', 'W') = 1,
  'opening a note records it');
SELECT test.ok((SELECT open_count FROM public.search_recents
                 WHERE user_id = test.id('A') AND entity_id = test.id('N1')) = 1,
  'a first open counts once');
SELECT test.open_as('A', 'W', 'note', 'N1');
SELECT test.ok((SELECT open_count FROM public.search_recents
                 WHERE user_id = test.id('A') AND entity_id = test.id('N1')) = 2 AND test.held('A', 'W') = 1,
  'opening it again counts again on the same row');

-- (Each op runs in its own statement first: a check in the same statement
-- reads the snapshot from before it ran.)
CREATE TABLE test.said (k text PRIMARY KEY, v text);
INSERT INTO test.said VALUES ('P1', test.open_as('A', 'W', 'project', 'P1'));
SELECT test.ok((SELECT v FROM test.said WHERE k = 'P1') = 'true'
           AND EXISTS (SELECT 1 FROM public.search_recents
                        WHERE user_id = test.id('A') AND entity_type = 'bucket' AND entity_id = test.id('P1')),
  'a project open is kept under search_all''s type, bucket');

INSERT INTO test.said VALUES ('NP', test.open_as('A', 'W', 'note', 'NP'));
SELECT test.ok((SELECT v FROM test.said WHERE k = 'NP') = 'false'
           AND NOT EXISTS (SELECT 1 FROM public.search_recents WHERE entity_id = test.id('NP')),
  'an item you can''t see is never recorded');
INSERT INTO test.said VALUES ('M1', test.open_as('A', 'W', 'note', 'M1'));
SELECT test.ok((SELECT v FROM test.said WHERE k = 'M1') = 'false'
           AND NOT EXISTS (SELECT 1 FROM public.search_recents
                            WHERE workspace_id = test.id('W') AND entity_id = test.id('M1')),
  'an item from another workspace isn''t recorded under this one');
SELECT test.ok(test.open_as('X', 'W', 'note', 'N2') = 'false' AND test.held('X', 'W') = 0,
  'an outsider records nothing');
SELECT test.ok(test.open_as('A', 'W', 'nonsense', 'N2') = 'false',
  'an unknown type records nothing');

-- Q19: an agent's opens never count.
SELECT test.as_key('KA', format($q$SELECT public.search_op_record_open(%L, 'note', %L)$q$,
                                test.id('W'), test.id('N3')));
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.search_recents WHERE entity_id = test.id('N3')),
  'an API key''s open is never recorded, not even for its person (Q19)');

SELECT test.ok(test.try('A', format($q$INSERT INTO public.search_recents (user_id, workspace_id, entity_type, entity_id)
                                       VALUES (%L, %L, 'note', %L)$q$, test.id('A'), test.id('W'), test.id('N4')))
               LIKE '42501%',
  'a direct insert is refused');

-- ── Private to their person ──────────────────────────────────────────────────

SELECT test.ok(test.value_as('A', format($q$SELECT count(*) FROM public.search_recents WHERE user_id = %L$q$,
                                         test.id('A')))::int = test.held('A', 'W'),
  'A reads their own rows');
SELECT test.ok(test.value_as('B', format($q$SELECT count(*) FROM public.search_recents WHERE user_id = %L$q$,
                                         test.id('A'))) = '0',
  'a teammate can''t read them');
SELECT test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.search_recents WHERE user_id = %L$q$,
                                         test.id('A'))) = '0',
  'nor can the workspace''s owner');
SELECT test.ok(jsonb_array_length(test.recent_as('B', 'W')) = 0,
  'B''s Recent is empty: A''s opens are A''s');

-- ── Recent: 8, newest first, visible only ────────────────────────────────────

DO $$
BEGIN
  -- Ten opens, one after another (stamped apart: one now() per transaction).
  FOR i IN 1..10 LOOP
    PERFORM test.open_as('A', 'W', 'note', 'N' || i);
    UPDATE public.search_recents SET last_opened_at = now() - make_interval(mins => 100 - i)
     WHERE user_id = test.id('A') AND entity_id = test.id('N' || i);
  END LOOP;
  UPDATE public.search_recents SET last_opened_at = now() - interval '1 day'
   WHERE user_id = test.id('A') AND entity_type = 'bucket';
END;
$$;

DO $$
DECLARE
  v jsonb := test.recent_as('A', 'W');
BEGIN
  PERFORM test.ok(test.ids(v) = ARRAY(SELECT test.id('N' || i) FROM generate_series(10, 3, -1) i),
    'Recent lists the last 8 opened, newest first', v::text);
  PERFORM test.ok(v -> 0 ->> 'title' = 'Recent note 10' AND v -> 0 ->> 'entity_type' = 'note'
              AND (v -> 0 ->> 'last_opened_at') IS NOT NULL AND (v -> 0 ->> 'archived') = 'false',
    'each row carries its title, type, archived flag and when it was opened', v::text);
  PERFORM test.ok(jsonb_array_length(test.recent_as('A', 'W', 50)) = 11,
    'a larger limit reads further back', test.recent_as('A', 'W', 50)::text);
END;
$$;

-- Visibility is checked when Recent is read: a note A can no longer see, or one
-- in the trash, drops out and the next one moves up.
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('N10');
UPDATE public.notes SET deleted_at = now() WHERE id = test.id('N9');
DO $$
DECLARE
  v jsonb := test.recent_as('A', 'W');
BEGIN
  PERFORM test.ok(test.ids(v) = ARRAY(SELECT test.id('N' || i) FROM generate_series(8, 1, -1) i),
    'an item you lost access to, or trashed, leaves Recent and 8 still show', v::text);
END;
$$;

SELECT test.ok(jsonb_array_length(test.recent_as('X', 'W')) = 0, 'an outsider''s Recent is empty');

DO $$
DECLARE
  r text := test.as_key('KA', format($q$SELECT * FROM public.search_recents_list(%L, 8)$q$, test.id('W')));
BEGIN
  PERFORM test.ok(r = 'ok 0', 'an API key has no Recent', r);
END;
$$;

-- ── Pruned to 50 per person per workspace ────────────────────────────────────

SELECT test.open_as('A', 'W2', 'note', 'M1');
DO $$
BEGIN
  FOR i IN 11..60 LOOP
    PERFORM test.open_as('A', 'W', 'note', 'N' || i);
  END LOOP;
END;
$$;
SELECT test.ok(test.held('A', 'W') = 50, 'A keeps at most 50 opens in W', test.held('A', 'W')::text);
SELECT test.ok(test.held('A', 'W2') = 1, 'the cap is per workspace: W2''s open stays');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.search_recents
                            WHERE user_id = test.id('A') AND entity_type = 'bucket'),
  'the oldest opens are the ones pruned');

-- ── Remove one, clear all ────────────────────────────────────────────────────

INSERT INTO test.said VALUES ('N60', test.value_as('A', format($q$SELECT public.search_op_forget_open(%L, 'note', %L)::text$q$,
                                                              test.id('W'), test.id('N60'))));
SELECT test.ok((SELECT v FROM test.said WHERE k = 'N60') = 'true'
           AND NOT EXISTS (SELECT 1 FROM public.search_recents
                            WHERE user_id = test.id('A') AND entity_id = test.id('N60')),
  'removing one item takes it out of Recent');
SELECT test.value_as('B', format($q$SELECT public.search_op_forget_open(%L, 'note', %L)$q$,
                                 test.id('W'), test.id('N59')));
SELECT test.ok(EXISTS (SELECT 1 FROM public.search_recents
                        WHERE user_id = test.id('A') AND entity_id = test.id('N59')),
  'someone else can''t remove your items');
SELECT test.value_as('B', format($q$SELECT public.search_op_clear_recents(%L)$q$, test.id('W')));
SELECT test.ok(test.held('A', 'W') = 49, 'nor clear your Recent');
INSERT INTO test.said VALUES ('clear', test.value_as('A', format($q$SELECT public.search_op_clear_recents(%L)::text$q$,
                                                                test.id('W'))));
SELECT test.ok((SELECT v FROM test.said WHERE k = 'clear') = '49'
           AND test.held('A', 'W') = 0 AND test.held('A', 'W2') = 1,
  'Clear empties Recent in this workspace only');

-- ── The personal term in search_all ──────────────────────────────────────────

CREATE FUNCTION test.quokka_as(p_who text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT jsonb_agg(jsonb_build_object('id', h.entity_id, 'score', h.score) ORDER BY o)::text
         FROM public.search_all(%L, 'quokka', ARRAY['note']) WITH ORDINALITY AS h(entity_type, entity_id, title,
              context, snippet, icon, match, rank, updated_at, archived, score, type_total, top, o)$q$,
    test.id('W')))::jsonb
$$;

SELECT test.ok(test.quokka_as('A') -> 0 ->> 'id' = test.id('T1')::text,
  'before any open, the newer twin leads');
DO $$
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM test.open_as('A', 'W', 'note', 'T2');
  END LOOP;
END;
$$;
DO $$
DECLARE
  a jsonb := test.quokka_as('A');
  b jsonb := test.quokka_as('B');
BEGIN
  PERFORM test.ok(a -> 0 ->> 'id' = test.id('T2')::text
              AND (a -> 0 ->> 'score')::real > (a -> 1 ->> 'score')::real,
    'what you open often ranks up for you (Q13b)', a::text);
  PERFORM test.ok((a -> 0 ->> 'score')::real - (b -> 1 ->> 'score')::real <= 0.2001,
    'by at most the personal weight, 0.20', format('%s / %s', a, b));
  PERFORM test.ok(b -> 0 ->> 'id' = test.id('T1')::text,
    'and only for you: a teammate''s order is unchanged', b::text);
END;
$$;

CREATE TEMP TABLE key_quokka (id uuid, score real);
GRANT ALL ON key_quokka TO service_role;
SELECT test.as_key('KA', format($q$INSERT INTO pg_temp.key_quokka SELECT h.entity_id, h.score
                                    FROM public.search_all(%L, 'quokka', ARRAY['note']) h$q$, test.id('W')));
SELECT test.ok((SELECT id FROM key_quokka ORDER BY score DESC, id LIMIT 1) = test.id('T1'),
  'an API key''s search has no personal term, even for its person''s opens');

-- ── Account erasure ──────────────────────────────────────────────────────────

SELECT test.ok((public.account_erase_workspace_data(test.id('A'), true) ->> 'search_recents_deleted')::int
               = (SELECT count(*) FROM public.search_recents WHERE user_id = test.id('A')),
  'the erasure preview counts the person''s recents');
SELECT public.account_erase_workspace_data(test.id('A'), false);
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.search_recents WHERE user_id = test.id('A')),
  'account erasure removes every recent of theirs, in every workspace');

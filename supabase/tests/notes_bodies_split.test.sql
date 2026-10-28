-- NS-11 · Split content from the row (specs/notes-schema-hardening.md AC12,
-- Assumption 11; supabase/migrations/20261030200000_notes_bodies_split.sql).
--
-- A note's content (doc_state, doc_version, body_text, body_md and the search
-- vector) lives in note_bodies, one row per note, and notes keeps only meta.
-- Search, the public subtree, pull, snapshot, seed, duplicate, import and
-- compaction answer exactly as before, an edit push changes nothing on the
-- notes row but updated_at and edited_*, and clients read content only
-- through access-checked functions (no table grant on note_bodies). v1.4.0
-- selected these columns from notes, so each has a computed field of the same
-- name (PostgREST `select=body_md`), access-checked.
--
-- Cast: O owns W. E edits N, V views N and P's tree, M is a member with no
-- grant. U owns W2. KV is O's key with Notes: View.
-- O's notes in W:
--   N   'Quarterly plan', body about a zebra, snapshot 'SNAP-N' at version 2.
--   H   hidden from everyone but O, its body names the zebra too.
--   P   published, with PC under it (inherit).
--   I   imported: a body, no snapshot, no log.
-- Q in W2 (U's).

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'M', 'U']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('U'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'member'),
  (test.id('W'), test.id('M'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_ns11', md5('db-test-ns11-kv'), '{"notes": "view"}', test.id('O'));

INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, body_md, doc_state, doc_version, position) VALUES
  (test.id('N'), test.id('W'), test.id('O'), 'Quarterly plan', 'the zebra migrates south',
   E'# Quarterly plan\n\nthe zebra migrates south', 'SNAP-N', 2, 'a'),
  (test.id('H'), test.id('W'), test.id('O'), 'Salaries', 'the zebra is paid well', '# Salaries', NULL, 0, 'b'),
  (test.id('P'), test.id('W'), test.id('O'), 'Handbook', 'Welcome aboard', E'# Handbook\n\nWelcome aboard', NULL, 0, 'c'),
  (test.id('I'), test.id('W'), test.id('O'), 'Imported', 'imported text', E'# Imported\n\nimported text', NULL, 0, 'd');
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, body_md, parent_id, position) VALUES
  (test.id('PC'), test.id('W'), test.id('O'), 'First week', 'Meet the team', '# First week', test.id('P'), 'a');
INSERT INTO test.notes_in (id, workspace_id, created_by, title, body_text, body_md) VALUES
  (test.id('Q'), test.id('W2'), test.id('U'), 'Theirs', 'the zebra elsewhere', '# Theirs');
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('N'), test.id('H'), test.id('P'), test.id('I'));
UPDATE public.notes SET share_mode = 'inherit' WHERE id = test.id('PC');
UPDATE public.notes SET published_at = now(), publish_token = 'db-test-ns11-token' WHERE id = test.id('P');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by) VALUES
  (test.id('W'), 'note', test.id('N'), 'member', test.id('E'), 'edit', test.id('O')),
  (test.id('W'), 'note', test.id('N'), 'member', test.id('V'), 'view', test.id('O')),
  (test.id('W'), 'note', test.id('P'), 'member', test.id('V'), 'view', test.id('O'));
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
VALUES (test.id('W'), test.id('N'), 'db-test-ns11', 1, 'AAE='),
       (test.id('W'), test.id('N'), 'db-test-ns11', 2, 'AAI=');

-- The note's body row, as jsonb (or NULL).
CREATE FUNCTION test.body(p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(b) - 'search_tsv' FROM public.note_bodies b WHERE b.note_id = test.id(p_name)
$$;
-- The notes row, as jsonb.
CREATE FUNCTION test.row(p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(n) FROM public.notes n WHERE n.id = test.id(p_name)
$$;
-- The keys whose values differ between two rows.
CREATE FUNCTION test.changed(p_before jsonb, p_after jsonb) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(k ORDER BY k), '{}')
    FROM (SELECT jsonb_object_keys(p_before) UNION SELECT jsonb_object_keys(p_after)) AS s(k)
   WHERE p_before -> k IS DISTINCT FROM p_after -> k
$$;
-- notes__search's hits as the person, as jsonb.
CREATE FUNCTION test.search_as(p_who text, p_query text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.rank DESC, h.updated_at DESC, h.entity_id), '[]')::text
         FROM public.notes__search(%L, %L, 20) h$q$, test.id('W'), p_query));
BEGIN
  IF r LIKE 'ERROR%' THEN
    RETURN jsonb_build_array(jsonb_build_object('error', r));
  END IF;
  RETURN r::jsonb;
END;
$$;
CREATE FUNCTION test.hit(p_hits jsonb, p_name text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT h FROM jsonb_array_elements(p_hits) h WHERE h ->> 'entity_id' = test.id(p_name)::text
$$;
-- A call as the service role with no actor (the nightly compaction).
CREATE FUNCTION test.service(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  SET LOCAL ROLE service_role;
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := 'error ' || SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v;
END;
$$;

-- ── The table ───────────────────────────────────────────────────────────────

SELECT test.ok(
  (SELECT array_agg(attname::text || ':' || format_type(atttypid, atttypmod) ORDER BY attname)
     FROM pg_attribute WHERE attrelid = 'public.note_bodies'::regclass AND attnum > 0 AND NOT attisdropped)
  @> ARRAY['body_md:text', 'body_text:text', 'doc_state:text', 'doc_version:integer',
           'note_id:uuid', 'search_tsv:tsvector', 'workspace_id:uuid'],
  'note_bodies holds the content columns');
SELECT test.ok(
  (SELECT attgenerated = 's' FROM pg_attribute
    WHERE attrelid = 'public.note_bodies'::regclass AND attname = 'search_tsv'),
  'note_bodies.search_tsv is a stored generated column');
SELECT test.ok(
  (SELECT array_agg(a.attname::text) FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.note_bodies'::regclass AND c.contype = 'p') = ARRAY['note_id'],
  'note_bodies is keyed on note_id');
SELECT test.ok(
  EXISTS (SELECT 1 FROM pg_constraint c
           WHERE c.conrelid = 'public.note_bodies'::regclass AND c.contype = 'f'
             AND c.confrelid = 'public.notes'::regclass AND c.confdeltype = 'c'
             AND (SELECT array_agg(attname::text ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                    JOIN pg_attribute ON attrelid = c.conrelid AND attnum = k.n) = ARRAY['workspace_id', 'note_id']
             AND (SELECT array_agg(attname::text ORDER BY k.o) FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
                    JOIN pg_attribute ON attrelid = c.confrelid AND attnum = k.n) = ARRAY['workspace_id', 'id']),
  'note_bodies (workspace_id, note_id) references notes (workspace_id, id) ON DELETE CASCADE');
SELECT test.ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'note_bodies'
            AND indexdef LIKE '%USING gin (search_tsv)%')
  AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'notes'
                    AND indexdef LIKE '%search_tsv%'),
  'the GIN index on search_tsv moved to note_bodies');
SELECT test.ok(
  NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notes'::regclass AND attnum > 0
                AND NOT attisdropped
                AND attname IN ('doc_state', 'doc_version', 'body_text', 'body_md', 'search_tsv')),
  'notes no longer holds the content columns');

-- ── Access ──────────────────────────────────────────────────────────────────

SELECT test.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.note_bodies'::regclass)
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'note_bodies'
                AND cmd = 'SELECT' AND qual LIKE '%can_access%'),
  'note_bodies has RLS, with a SELECT policy through can_access');
SELECT test.ok(
  NOT has_table_privilege('authenticated', 'public.note_bodies', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.note_bodies', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.note_bodies', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.note_bodies', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.note_bodies', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.note_bodies', 'INSERT')
  AND has_table_privilege('service_role', 'public.note_bodies', 'SELECT'),
  'note_bodies: no client grants, the service role reads it');
SELECT test.ok(test.value_as('O', 'SELECT count(*)::text FROM public.note_bodies') LIKE 'ERROR%permission denied%',
  'a signed-in person can''t read note_bodies directly, not even the owner');
SELECT test.ok(
  has_table_privilege('authenticated', 'public.notes', 'SELECT')
  AND has_table_privilege('authenticated', 'public.note_updates', 'SELECT'),
  'notes and note_updates keep their SELECT grant one release (v1.4.0 reads both directly)');

-- ── Every note has a body row, kept in step ─────────────────────────────────

SELECT test.ok(
  (SELECT count(*) FROM public.notes WHERE workspace_id = test.id('W'))
  = (SELECT count(*) FROM public.note_bodies WHERE workspace_id = test.id('W'))
  AND (SELECT count(*) FROM public.notes n
        WHERE NOT EXISTS (SELECT 1 FROM public.note_bodies b WHERE b.note_id = n.id)) = 0,
  'every note has its body row, in its own workspace (the backfill and the insert trigger)');
SELECT test.ok(
  NOT EXISTS (SELECT 1 FROM public.notes n JOIN public.note_bodies b ON b.note_id = n.id
               WHERE b.workspace_id <> n.workspace_id),
  'every body row is in its note''s workspace');

DO $$
DECLARE
  r text;
  v_id uuid;
BEGIN
  r := test.as_user('O', format($q$SELECT public.notes_op_create(%L, %L, NULL, 'Fresh', 'z')$q$,
                                test.id('W'), test.id('NEW')));
  PERFORM test.ok(r = 'ok 1', 'create: a note is created', r);
  PERFORM test.ok((test.body('NEW') ->> 'doc_version')::int = 0 AND test.body('NEW') ->> 'body_md' = ''
              AND test.body('NEW') ->> 'body_text' = '' AND test.body('NEW') ->> 'doc_state' IS NULL,
    'create: a new note gets an empty body row', test.body('NEW')::text);
END;
$$;

SELECT test.ok(
  (SELECT b.search_tsv = setweight(to_tsvector('simple', public.search__unaccent(n.title)), 'A')
                         || setweight(to_tsvector('simple', public.search__unaccent(left(b.body_text, 150000))), 'B')
     FROM public.notes n JOIN public.note_bodies b ON b.note_id = n.id WHERE n.id = test.id('N')),
  'search_tsv is the title (A) and the body (B), as notes.search_tsv was');
SELECT test.ok(
  (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.note_bodies'::regclass AND a.attname = 'search_tsv')
  LIKE '%left(COALESCE(body_text, ''''::text), 150000)%',
  'search_tsv still reads at most 150,000 characters of the body');

DO $$
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.notes_op_rename(%L, %L, 'Okapi plan')$q$,
                                   test.id('W'), test.id('NEW')));
  PERFORM test.ok(test.hit(test.search_as('O', 'okapi'), 'NEW') ->> 'match' = 'title',
    'rename: the new title is searchable at once');
END;
$$;

-- ── Search ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v jsonb := test.search_as('V', 'zebra');
  n jsonb := test.hit(v, 'N');
BEGIN
  PERFORM test.ok(jsonb_array_length(v) = 1 AND n IS NOT NULL,
    'search: a body word finds the note V can see, not H, not another workspace''s', v::text);
  PERFORM test.ok(n ->> 'match' = 'body' AND n ->> 'title' = 'Quarterly plan'
              AND strpos(n ->> 'snippet', chr(57344) || 'zebra' || chr(57345)) > 0,
    'search: a body hit, titled, with the word marked in its snippet', n::text);
  PERFORM test.ok(test.hit(test.search_as('V', 'quarterly'), 'N') ->> 'match' = 'title'
              AND test.hit(test.search_as('V', 'quarterly'), 'N') ->> 'snippet' IS NULL,
    'search: a title word is a title hit, without a snippet');
  PERFORM test.ok(test.hit(test.search_as('V', 'quartrly'), 'N') ->> 'match' = 'title_fuzzy',
    'search: a typo in the title still finds it');
  PERFORM test.ok(test.hit(test.search_as('V', 'quartrly -zebra'), 'N') IS NULL,
    'search: an excluded body word still excludes a fuzzy title hit');
  PERFORM test.ok(jsonb_array_length(test.search_as('M', 'zebra')) = 0,
    'search: a member without a grant finds nothing');
  PERFORM test.ok(jsonb_array_length(test.search_as('O', 'zebra')) = 2,
    'search: the owner finds both of their zebra notes');
END;
$$;

-- ── Publish subtree ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v jsonb := test.service($q$SELECT public.notes_public_subtree('db-test-ns11-token')::text$q$)::jsonb;
BEGIN
  PERFORM test.ok((v ->> 'rootId')::uuid = test.id('P') AND jsonb_array_length(v -> 'notes') = 2,
    'publish: the token resolves the root and its inheriting child', v::text);
  PERFORM test.ok(
    (SELECT e ->> 'bodyMd' FROM jsonb_array_elements(v -> 'notes') e WHERE (e ->> 'id')::uuid = test.id('P'))
      = E'# Handbook\n\nWelcome aboard'
    AND (SELECT e ->> 'bodyMd' FROM jsonb_array_elements(v -> 'notes') e WHERE (e ->> 'id')::uuid = test.id('PC'))
      = '# First week',
    'publish: each page''s markdown is its stored body');
END;
$$;

-- ── Pull and the meta list ──────────────────────────────────────────────────

DO $$
DECLARE
  v jsonb := test.value_as('V', format('SELECT public.notes_pull(%L, %L, 0, NULL)::text',
                                       test.id('W'), test.id('N')))::jsonb;
  m text := test.value_as('V', format(
    $q$SELECT doc_version::text FROM public.notes_list_meta(%L, now() - interval '30 days') WHERE id = %L$q$,
    test.id('W'), test.id('N')));
BEGIN
  PERFORM test.ok(v ->> 'snapshot' = 'SNAP-N' AND (v ->> 'doc_version')::int = 2
              AND jsonb_array_length(v -> 'updates') = 2,
    'pull: the snapshot and version from note_bodies, the log from note_updates', v::text);
  PERFORM test.ok(NOT (test.value_as('V', format('SELECT public.notes_pull(%L, %L, 0, 2)::text',
                                                 test.id('W'), test.id('N')))::jsonb ? 'snapshot'),
    'pull: no snapshot when the caller holds the current version');
  PERFORM test.ok(m = '2', 'notes_list_meta: doc_version comes from note_bodies', m);
  PERFORM test.ok(test.as_key('KV', format('SELECT public.notes_pull(%L, %L, 0, NULL)',
                                           test.id('W'), test.id('N'))) = 'ok 1',
    'pull: an API key with Notes: View pulls (the MCP)');
END;
$$;

-- ── An edit push touches only updated_at and edited_* on notes ──────────────

DO $$
DECLARE
  v_before jsonb;
  v_changed text[];
  r text;
BEGIN
  UPDATE public.notes SET updated_at = '2020-01-01T00:00:00Z', edited_at = NULL, edited_by = NULL
   WHERE id = test.id('N');
  v_before := test.row('N');
  r := test.as_user('E', format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-e', '[{"clientSeq": 1, "updateB64": "AAM="}]'::jsonb,
                                            'the zebra stays home', 'the zebra stays home')$q$,
    test.id('W'), test.id('N')));
  PERFORM test.ok(r = 'ok 1', 'push: E pushes an edit', r);
  v_changed := test.changed(v_before, test.row('N'));
  PERFORM test.ok(v_changed <@ ARRAY['edited_at', 'edited_by', 'updated_at']
              AND 'updated_at' = ANY (v_changed) AND 'edited_by' = ANY (v_changed),
    'push: the notes row changes only in updated_at and edited_*', v_changed::text);
  PERFORM test.ok(test.body('N') ->> 'body_text' = 'the zebra stays home'
              AND test.body('N') ->> 'body_md' = 'the zebra stays home'
              AND test.body('N') ->> 'doc_state' = 'SNAP-N' AND (test.body('N') ->> 'doc_version')::int = 2,
    'push: the body lands in note_bodies, the snapshot untouched', test.body('N')::text);
  PERFORM test.ok(test.hit(test.search_as('V', 'home'), 'N') ->> 'match' = 'body',
    'push: the new body is searchable at once');

  -- A body-only change: same rule.
  v_before := test.row('N');
  r := test.as_user('E', format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-e', '[]'::jsonb, 'a quieter zebra', NULL)$q$,
    test.id('W'), test.id('N')));
  PERFORM test.ok(test.changed(v_before, test.row('N')) <@ ARRAY['updated_at']
              AND test.body('N') ->> 'body_text' = 'a quieter zebra'
              AND test.body('N') ->> 'body_md' = 'the zebra stays home',
    'push: a body-only change writes the body (NULL keeps the other) and touches only updated_at');

  -- A replay with the same body writes nothing anywhere.
  v_before := test.row('N') || jsonb_build_object('body', test.body('N'));
  r := test.as_user('E', format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-e', '[{"clientSeq": 1, "updateB64": "AAM="}]'::jsonb,
                                            'a quieter zebra', NULL)$q$,
    test.id('W'), test.id('N')));
  PERFORM test.ok(v_before = test.row('N') || jsonb_build_object('body', test.body('N')),
    'push: a replay with the stored body changes neither row');
  PERFORM test.ok(test.try('V', format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-v', '[]'::jsonb, 'vandal', 'vandal')$q$,
    test.id('W'), test.id('N'))) LIKE '42501%',
    'push: a viewer can''t write the body');
END;
$$;

-- ── Snapshot ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_before jsonb := test.row('N');
  v_upto bigint := (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('N'));
  r text;
BEGIN
  r := test.value_as('E', format(
    $q$SELECT public.notes_op_save_snapshot(%L, %L, 'SNAP-E', %s, 'folded zebra', '# folded', 2)::text$q$,
    test.id('W'), test.id('N'), v_upto));
  PERFORM test.ok((r::jsonb ->> 'refused') = 'false' AND (r::jsonb ->> 'doc_version') = '3',
    'snapshot: a fold at the current version is stored', r);
  PERFORM test.ok(test.body('N') ->> 'doc_state' = 'SNAP-E' AND (test.body('N') ->> 'doc_version')::int = 3
              AND test.body('N') ->> 'body_text' = 'folded zebra' AND test.body('N') ->> 'body_md' = '# folded',
    'snapshot: snapshot, version and bodies land in note_bodies', test.body('N')::text);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_updates WHERE note_id = test.id('N') AND id <= v_upto),
    'snapshot: the folded log rows are gone');
  PERFORM test.ok(test.changed(v_before, test.row('N')) <@ ARRAY['updated_at'],
    'snapshot: the notes row changes only in updated_at');
  r := test.value_as('E', format(
    $q$SELECT public.notes_op_save_snapshot(%L, %L, 'SNAP-OLD', 0, NULL, NULL, 2)::text$q$,
    test.id('W'), test.id('N')));
  PERFORM test.ok((r::jsonb ->> 'refused') = 'true' AND (r::jsonb ->> 'doc_version') = '3'
              AND test.body('N') ->> 'doc_state' = 'SNAP-E',
    'snapshot: a stale fold is refused and changes nothing', r);
END;
$$;

-- ── Seed ────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_before jsonb := test.row('I');
  r text;
BEGIN
  r := test.value_as('O', format(
    $q$SELECT coalesce(array_agg(o_id ORDER BY o_id), '{}')::text FROM public.notes_list_unmaterialized(%L, 1000)
        WHERE o_body_md = E'# Imported\n\nimported text'$q$, test.id('W')));
  PERFORM test.ok(r::uuid[] = ARRAY[test.id('I')],
    'seed: the imported note is listed with its markdown', r);
  r := test.value_as('O', format($q$SELECT public.notes_op_seed_doc(%L, %L, 'SEED-I', NULL, NULL)::text$q$,
                                 test.id('W'), test.id('I')));
  PERFORM test.ok((r::jsonb ->> 'seeded') = 'true' AND (r::jsonb ->> 'doc_version') = '1',
    'seed: the doc is seeded', r);
  PERFORM test.ok(test.body('I') ->> 'doc_state' = 'SEED-I' AND (test.body('I') ->> 'doc_version')::int = 1
              AND test.body('I') ->> 'body_md' = E'# Imported\n\nimported text'
              AND test.body('I') ->> 'body_text' = 'imported text',
    'seed: the snapshot lands in note_bodies and the bodies stay', test.body('I')::text);
  PERFORM test.ok(test.changed(v_before, test.row('I')) = '{}',
    'seed: the notes row is untouched (a repair, not an edit)');
  r := test.value_as('O', format($q$SELECT public.notes_op_seed_doc(%L, %L, 'SEED-2', NULL, NULL)::text$q$,
                                 test.id('W'), test.id('I')));
  PERFORM test.ok(r::jsonb ->> 'reason' = 'already_materialized', 'seed: a second seed is refused', r);
  r := test.value_as('O', format($q$SELECT public.notes_op_seed_doc(%L, %L, 'SEED-N', NULL, NULL)::text$q$,
                                 test.id('W'), test.id('NEW')));
  PERFORM test.ok((r::jsonb ->> 'seeded') = 'true', 'seed: an empty new note can be seeded', r);
END;
$$;

-- ── Duplicate ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  r text := test.value_as('O', format($q$SELECT (public.notes_op_duplicate(%L, %L, 'zz')).id::text$q$,
                                      test.id('W'), test.id('N')));
  v_copy jsonb := (SELECT to_jsonb(b) - 'search_tsv' FROM public.note_bodies b WHERE b.note_id = r::uuid);
BEGIN
  PERFORM test.ok(v_copy IS NOT NULL AND v_copy - 'note_id' = test.body('N') - 'note_id' - 'title'
                    || jsonb_build_object('title', 'Quarterly plan (copy)'),
    'duplicate: the copy holds the source''s snapshot, version and bodies', coalesce(v_copy::text, r));
  PERFORM test.ok(test.hit(test.search_as('O', 'folded'), 'N') IS NOT NULL
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(test.search_as('O', 'folded')) h
                           WHERE h ->> 'entity_id' = r AND h ->> 'title' = 'Quarterly plan (copy)'),
    'duplicate: the copy is searchable by its body');
END;
$$;

-- ── Import ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r text := test.value_as('O', format($q$SELECT public.notes_op_import(%L, %L::jsonb)::text$q$,
    test.id('W'), jsonb_build_array(
      jsonb_build_object('id', test.id('X'), 'title', 'From Notion', 'position', 'y',
                         'docStateB64', 'IMP-X', 'bodyText', 'an imported quokka', 'bodyMd', '# From Notion'),
      jsonb_build_object('id', test.id('X2'), 'title', 'Body only', 'position', 'yy',
                         'bodyText', 'only a body', 'bodyMd', '# Body only'))));
BEGIN
  PERFORM test.ok((r::jsonb ->> 'imported') = '2', 'import: two notes', r);
  PERFORM test.ok(test.body('X') ->> 'doc_state' = 'IMP-X' AND (test.body('X') ->> 'doc_version')::int = 0
              AND test.body('X') ->> 'body_text' = 'an imported quokka'
              AND test.body('X') ->> 'body_md' = '# From Notion',
    'import: the snapshot and bodies land in note_bodies', test.body('X')::text);
  PERFORM test.ok(test.body('X2') ->> 'doc_state' IS NULL AND test.body('X2') ->> 'body_md' = '# Body only',
    'import: a note with no doc keeps an empty snapshot', test.body('X2')::text);
  PERFORM test.ok(test.hit(test.search_as('O', 'quokka'), 'X') ->> 'match' = 'body',
    'import: the imported body is searchable');
END;
$$;

-- ── Compaction ──────────────────────────────────────────────────────────────

INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
VALUES (test.id('W'), test.id('N'), 'db-test-ns11', 10, 'AAQ='),
       (test.id('W'), test.id('N'), 'db-test-ns11', 11, 'AAU=');

DO $$
DECLARE
  v_before jsonb := test.row('N');
  v_body jsonb := test.body('N');
  v_src jsonb := test.service(format('SELECT public.notes__compact_source(%L)::text', test.id('N')))::jsonb;
  v_upto bigint := (SELECT max(id) FROM public.note_updates WHERE note_id = test.id('N'));
  r jsonb;
BEGIN
  PERFORM test.ok(v_src ->> 'doc_state' = 'SNAP-E' AND (v_src ->> 'doc_version')::int = 3
              AND jsonb_array_length(v_src -> 'updates') = 2,
    'compact: the source is note_bodies'' snapshot and version with the log', v_src::text);
  r := test.service(format($q$SELECT public.notes__compact(%L, 'SNAP-C', %s, 3)::text$q$,
                           test.id('N'), v_upto))::jsonb;
  PERFORM test.ok((r ->> 'refused') = 'false' AND (r ->> 'doc_version') = '4' AND (r ->> 'folded') = '2',
    'compact: the fold is stored', r::text);
  PERFORM test.ok(test.body('N') ->> 'doc_state' = 'SNAP-C' AND (test.body('N') ->> 'doc_version')::int = 4
              AND test.body('N') ->> 'body_text' = v_body ->> 'body_text'
              AND test.body('N') ->> 'body_md' = v_body ->> 'body_md',
    'compact: the snapshot moves, the bodies don''t', test.body('N')::text);
  PERFORM test.ok(test.changed(v_before, test.row('N')) = '{}', 'compact: the notes row is untouched');
  r := test.service(format($q$SELECT public.notes__compact(%L, 'SNAP-STALE', %s, 3)::text$q$,
                           test.id('N'), v_upto))::jsonb;
  PERFORM test.ok((r ->> 'refused') = 'true' AND test.body('N') ->> 'doc_state' = 'SNAP-C',
    'compact: a stale version is refused', r::text);
END;
$$;

-- ── v1.4.0's reads: the computed fields ─────────────────────────────────────

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['doc_state', 'doc_version', 'body_text', 'body_md', 'search_tsv'] LOOP
    PERFORM test.ok(
      has_function_privilege('authenticated', format('public.%I(public.notes)', f), 'EXECUTE')
      AND has_function_privilege('service_role', format('public.%I(public.notes)', f), 'EXECUTE')
      AND NOT has_function_privilege('anon', format('public.%I(public.notes)', f), 'EXECUTE'),
      format('compat: %s(notes) is a computed field for signed-in readers, not anon', f));
  END LOOP;
END;
$$;

SELECT test.ok(
  test.value_as('V', format($q$SELECT jsonb_build_object('doc_state', n.doc_state, 'doc_version', n.doc_version,
      'body_text', n.body_text, 'body_md', n.body_md)::text FROM public.notes n WHERE n.id = %L$q$, test.id('N')))::jsonb
  = (SELECT jsonb_build_object('doc_state', b.doc_state, 'doc_version', b.doc_version,
      'body_text', b.body_text, 'body_md', b.body_md) FROM public.note_bodies b WHERE b.note_id = test.id('N')),
  'compat: a reader selecting n.doc_state, n.body_md, … from notes gets the stored content');
SELECT test.ok(
  test.value_as('V', format($q$SELECT count(*)::text FROM public.notes n
      WHERE n.workspace_id = %L AND n.search_tsv @@ websearch_to_tsquery('simple', 'zebra')$q$, test.id('W'))) = '1',
  'compat: v1.4.0''s search filter on search_tsv still finds what V can see');
SELECT test.ok(
  test.value_as('V', format($q$SELECT coalesce(public.body_md(jsonb_populate_record(NULL::public.notes,
      jsonb_build_object('id', %L, 'workspace_id', %L))), 'NONE')$q$, test.id('H'), test.id('W'))) = 'NONE'
  AND test.value_as('V', format($q$SELECT coalesce(public.doc_state(jsonb_populate_record(NULL::public.notes,
      jsonb_build_object('id', %L, 'workspace_id', %L))), 'NONE')$q$, test.id('N'), test.id('W'))) <> 'NONE'
  AND test.value_as('M', format($q$SELECT coalesce(public.body_text(jsonb_populate_record(NULL::public.notes,
      jsonb_build_object('id', %L, 'workspace_id', %L))), 'NONE')$q$, test.id('N'), test.id('W'))) = 'NONE',
  'compat: a forged row reveals nothing the caller can''t open');
SELECT test.ok(
  test.as_key('KV', format($q$SELECT public.body_md(n) FROM public.notes n WHERE n.id = %L
                               AND public.body_md(n) = 'the zebra stays home'$q$, test.id('N'))) = 'ok 0'
  AND test.as_key('KV', format($q$SELECT 1 FROM public.notes n WHERE n.id = %L
                                 AND public.body_md(n) = '# folded'$q$, test.id('N'))) = 'ok 1',
  'compat: an API key (the deployed MCP) reads the stored markdown through the computed field');

-- ── Deletes cascade ─────────────────────────────────────────────────────────

DO $$
BEGIN
  DELETE FROM public.notes WHERE id = test.id('X2');
  PERFORM test.ok(test.body('X2') IS NULL, 'delete: a note''s body row goes with it');
  DELETE FROM public.workspaces WHERE id = test.id('W2');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_bodies WHERE workspace_id = test.id('W2')),
    'delete: a workspace''s body rows go with it (account erasure)');
END;
$$;

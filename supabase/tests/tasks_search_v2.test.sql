-- GS-4: tasks and projects on the search contract (specs/global-search.md
-- AC1–AC4, AC6; Assumptions 2, 5, 6, 7, 11, 13).
--
--   tasks__search(ws, query, limit)     SearchHit rows: the handle first, the
--                                       project as context, tasks__visible_to
--                                       before the limit, archived flagged
--   projects__search(ws, query, limit)  the same for projects (entity_type bucket)
--   tasks_search(ws, query, limit)      the app's and the MCP's RPC, backed by
--                                       tasks__search
--   the project registry                upserted on create and rename
--   search_all                          tasks and projects from their own module
--
-- Cast: O owns workspace W (task key TSV, once OLDK); A is a member; X is an
-- outsider. Projects: PW is shared with the workspace, PS is O's own, PA is
-- shared and archived. Keys: KT (O's, tasks view), KN (O's, notes view).

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Tasks search W');
UPDATE public.workspaces SET task_key = 'TSV', task_key_aliases = '{OLDK}' WHERE id = test.id('W');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('A'), 'member');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KT'), test.id('W'), 'O tasks', 'mdo_kt4', md5('db-test-gs4-kt'), '{"tasks": "view"}'::jsonb, test.id('O')),
  (test.id('KN'), test.id('W'), 'O notes', 'mdo_kn4', md5('db-test-gs4-kn'), '{"notes": "view"}'::jsonb, test.id('O'));

-- A module function's rows as a person, in order, as jsonb.
CREATE FUNCTION test.hits_as(p_who text, p_fn text, p_query text, p_limit int DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY o), '[]')::text
         FROM public.%s(%L, %L, %s) WITH ORDINALITY AS h(entity_type, entity_id, title, context, snippet,
              icon, match, rank, updated_at, archived, o)$q$,
    p_fn, test.id('W'), p_query, p_limit));
BEGIN
  IF r LIKE 'ERROR%' THEN
    RETURN jsonb_build_array(jsonb_build_object('error', r));
  END IF;
  RETURN r::jsonb;
END;
$$;

-- search_all's rows as a person.
CREATE FUNCTION test.all_as(p_who text, p_query text, p_types text[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  r text := test.value_as(p_who, format(
    $q$SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY o), '[]')::text
         FROM public.search_all(%L, %L, %L::text[], 50) WITH ORDINALITY AS h(entity_type, entity_id, title,
              context, snippet, icon, match, rank, updated_at, archived, score, type_total, top, o)$q$,
    test.id('W'), p_query, p_types));
BEGIN
  IF r LIKE 'ERROR%' THEN
    RETURN jsonb_build_array(jsonb_build_object('error', r));
  END IF;
  RETURN r::jsonb;
END;
$$;

-- tasks_search's ids as a person.
CREATE FUNCTION test.rpc_as(p_who text, p_query text, p_limit int DEFAULT 200) RETURNS uuid[]
LANGUAGE sql AS $$
  SELECT coalesce(nullif(test.value_as(p_who, format(
    $q$SELECT coalesce(array_agg(s ORDER BY o), '{}')::text FROM public.tasks_search(%L, %L, %s) WITH ORDINALITY AS t(s, o)$q$,
    test.id('W'), p_query, p_limit)), ''), '{}')::uuid[]
$$;

-- Rows through a key, the way the MCP calls (service_role + the key header).
CREATE TEMP TABLE key_rows (fn text, entity_type text, entity_id uuid) ON COMMIT DROP;
GRANT ALL ON key_rows TO service_role;
CREATE FUNCTION test.key_found(p_key text, p_fn text, p_query text) RETURNS uuid[] LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM pg_temp.key_rows;
  PERFORM test.as_key(p_key, format(
    $q$INSERT INTO pg_temp.key_rows SELECT %L, h.entity_type, h.entity_id FROM public.%s(%L, %L, 20) h$q$,
    p_fn, p_fn, test.id('W'), p_query));
  RETURN coalesce((SELECT array_agg(entity_id ORDER BY entity_id) FROM pg_temp.key_rows), '{}');
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

-- Every row keeps the SearchHit contract.
CREATE FUNCTION test.well_formed(p_rows jsonb, p_type text) RETURNS boolean LANGUAGE sql AS $$
  SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) h
                      WHERE h ? 'error'
                         OR h ->> 'entity_type' <> p_type
                         OR h ->> 'match' NOT IN ('handle', 'title', 'title_fuzzy', 'body')
                         OR jsonb_typeof(h -> 'archived') <> 'boolean'
                         OR (h ->> 'rank')::real NOT BETWEEN 0 AND 1
                         OR (h ->> 'updated_at') IS NULL
                         OR coalesce(h ->> 'title', '') = '')
     AND (SELECT count(*) = count(DISTINCT h ->> 'entity_id') FROM jsonb_array_elements(p_rows) h)
$$;

-- ── Fixture ──────────────────────────────────────────────────────────────────

INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, description) VALUES
  (test.id('PW'), test.id('W'), test.id('O'), 'Garden works', false, '<p>Every <b>marrow</b> bed</p>'),
  (test.id('PS'), test.id('W'), test.id('O'), 'Secret orchard', false, ''),
  (test.id('PA'), test.id('W'), test.id('O'), 'Old greenhouse', false, '');
UPDATE public.buckets SET archived_at = now() WHERE id = test.id('PA');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PS');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'bucket', test.id(b), 'workspace', NULL, 'edit', test.id('O') FROM unnest(ARRAY['PW', 'PA']) b
ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;

INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, description, status) VALUES
  -- A description word, accents and HTML.
  (test.id('TD'), test.id('W'), test.id('PW'), test.id('O'), 'Weekly sync',
   '<p>Bring the <b>żółwie</b> brochure &amp; the <span data-lexical-entity-ref="x">Hidden ref</span> map</p><p class="marmalade">done</p>', 'todo'),
  (test.id('TH'), test.id('W'), test.id('PW'), test.id('O'), 'Kumquat harvest', '', 'todo'),
  (test.id('TS'), test.id('W'), test.id('PS'), test.id('O'), 'Brochure secret', '', 'todo'),
  (test.id('TG'), test.id('W'), test.id('PS'), test.id('O'), 'Granted quokka', '', 'todo'),
  (test.id('QL'), test.id('W'), test.id('PW'), test.id('O'), 'Quince pie', '', 'todo'),
  (test.id('QA'), test.id('W'), test.id('PA'), test.id('O'), 'Quince jelly', '', 'todo'),
  (test.id('TT'), test.id('W'), test.id('PW'), test.id('O'), 'Pear pruning', '', 'todo'),
  (test.id('TB'), test.id('W'), test.id('PW'), test.id('O'), 'Plain notes', 'pear pruning reminder', 'todo');
UPDATE public.tasks SET imported_from = '{"source": "linear", "key": "ENG-4217"}'::jsonb WHERE id = test.id('TT');
-- A is given TG directly; its project stays private to O.
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'task', test.id('TG'), 'member', test.id('A'), 'view', test.id('O'))
ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO NOTHING;

-- AC4: one visible, older match, then 300 newer ones A can't see.
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('VIS'), test.id('W'), test.id('PW'), test.id('O'), 'Wombat census', 'todo');
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
SELECT test.id('INV' || i), test.id('W'), test.id('PS'), test.id('O'), 'Wombat count ' || i, 'todo'
  FROM generate_series(1, 300) i;

CREATE TABLE test.handle AS
  SELECT w.task_key || '-' || t.number AS handle, t.number::text AS num
    FROM public.tasks t JOIN public.workspaces w ON w.id = t.workspace_id
   WHERE t.id = test.id('TH');

-- ── AC1: a description word finds the task, with its project as context ─────

DO $$
DECLARE
  v jsonb := test.hits_as('A', 'tasks__search', 'brochure');
BEGIN
  PERFORM test.ok(test.well_formed(v, 'task'), 'tasks__search keeps the SearchHit contract', v::text);
  PERFORM test.ok(test.row_of(v, 'TD') ->> 'match' = 'body'
              AND test.row_of(v, 'TD') ->> 'snippet' LIKE '%' || chr(57344) || 'brochure' || chr(57345) || '%',
    'a word only in the description finds the task as a body hit, with a highlighted snippet', v::text);
  PERFORM test.ok(test.row_of(v, 'TD') ->> 'context' = 'Garden works',
    'the context line is the task''s project', v::text);
  PERFORM test.ok(test.row_of(v, 'TD') ->> 'title' = 'Weekly sync', 'the title is the task''s title', v::text);
END;
$$;

SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'zolwie'), 'TD') IS NOT NULL
           AND test.row_of(test.hits_as('A', 'tasks__search', 'ŻÓŁW'), 'TD') IS NOT NULL,
  'accents are ignored both ways, and a word-start matches ("żółw" finds "żółwie")');
SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'map brochure bring'), 'TD') IS NOT NULL,
  'every word must match, in any order');
SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'marmalade'), 'TD') IS NULL
           AND test.row_of(test.hits_as('A', 'tasks__search', 'hidden ref'), 'TD') IS NULL
           AND test.row_of(test.hits_as('A', 'tasks__search', 'amp'), 'TD') IS NULL,
  'markup is stripped: tag attributes, a reference''s stored text and entities aren''t searchable');
SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'weekly'), 'TD') ->> 'match' = 'title'
           AND test.row_of(test.hits_as('A', 'tasks__search', 'weekly'), 'TD') ->> 'snippet' IS NULL,
  'a title hit is a title match, without a snippet');
SELECT test.ok(test.pos(test.hits_as('A', 'tasks__search', 'pear pruning'), 'TT')
               < test.pos(test.hits_as('A', 'tasks__search', 'pear pruning'), 'TB'),
  'a title hit ranks above a body hit');
SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'ENG-4217'), 'TT') IS NOT NULL,
  'an import''s key ("ENG-4217") still finds its task');

-- ── AC6: a task's ID finds that task first ───────────────────────────────────

DO $$
DECLARE
  h text := (SELECT handle FROM test.handle);
  n text := (SELECT num FROM test.handle);
  v jsonb;
BEGIN
  FOREACH h IN ARRAY ARRAY[h, lower(h), 'tsv ' || n, 'OLDK-' || n] LOOP
    v := test.hits_as('A', 'tasks__search', h);
    PERFORM test.ok(v -> 0 ->> 'entity_id' = test.id('TH')::text AND v -> 0 ->> 'match' = 'handle'
                AND (v -> 0 ->> 'rank')::real = 1,
      format('"%s" finds the task first, as a handle hit with rank 1', h), v::text);
    v := test.all_as('A', h);
    PERFORM test.ok(v -> 0 ->> 'entity_id' = test.id('TH')::text AND (v -> 0 ->> 'top')::boolean,
      format('and search_all puts it on top for "%s"', h), v::text);
  END LOOP;
END;
$$;

-- ── Typo forgiveness: titles only, below every exact hit ─────────────────────

SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'harvst'), 'TH') ->> 'match' = 'title_fuzzy'
           AND (test.row_of(test.hits_as('A', 'tasks__search', 'harvst'), 'TH') ->> 'rank')::real <= 0.2,
  'a typo in a title finds the task as title_fuzzy, ranked at most 0.2');
SELECT test.ok(test.row_of(test.hits_as('A', 'tasks__search', 'brochre'), 'TD') IS NULL,
  'a typo never matches a description');
SELECT test.ok(jsonb_array_length(test.hits_as('A', 'tasks__search', 'harvst -kumquat')) = 0,
  'an excluded word excludes typo-forgiven titles too');

-- ── Archived: flagged, and ranked below a live twin ─────────────────────────

DO $$
DECLARE
  v jsonb := test.hits_as('A', 'tasks__search', 'quince');
BEGIN
  PERFORM test.ok((test.row_of(v, 'QA') ->> 'archived')::boolean AND NOT (test.row_of(v, 'QL') ->> 'archived')::boolean,
    'a task in an archived project is flagged archived; a live one isn''t', v::text);
  PERFORM test.ok(test.pos(v, 'QL') < test.pos(v, 'QA'), 'the archived task ranks below the live one', v::text);
END;
$$;

-- ── AC3: you never see a task you couldn't open ─────────────────────────────

SELECT test.ok(test.row_of(test.hits_as('O', 'tasks__search', 'brochure'), 'TS') IS NOT NULL
           AND test.row_of(test.hits_as('A', 'tasks__search', 'brochure'), 'TS') IS NULL,
  'a task in someone''s private project is found by them, never by a member without access');
SELECT test.ok(jsonb_array_length(test.hits_as('X', 'tasks__search', 'brochure')) = 0
           AND jsonb_array_length(test.hits_as('X', 'projects__search', 'garden')) = 0,
  'an outsider finds nothing');
DO $$
DECLARE
  v jsonb := test.hits_as('A', 'tasks__search', 'quokka');
BEGIN
  PERFORM test.ok(test.row_of(v, 'TG') IS NOT NULL AND test.row_of(v, 'TG') ->> 'context' IS NULL,
    'a task shared directly is found, without the name of a project you can''t see', v::text);
  v := test.hits_as('O', 'tasks__search', 'quokka');
  PERFORM test.ok(test.row_of(v, 'TG') ->> 'context' = 'Secret orchard', 'its owner sees the project as context', v::text);
END;
$$;
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(test.hits_as('A', 'tasks__search', 'wombat', 50)) h
   WHERE NOT public.can_access('task', (h ->> 'entity_id')::uuid, 'view', test.id('A'))),
  'every task A is shown, A can open (can_access)');

-- ── AC4: invisible matches never crowd out a visible one ─────────────────────

SELECT test.ok(test.ids(test.hits_as('A', 'tasks__search', 'wombat', 5)) = ARRAY[test.id('VIS')],
  '300 newer matches A can''t see don''t push out the 1 A can (visibility before the limit)');
SELECT test.ok(jsonb_array_length(test.hits_as('O', 'tasks__search', 'wombat', 5)) = 5
           AND jsonb_array_length(test.hits_as('O', 'tasks__search', 'wombat', 1000)) = 50,
  'the limit holds, and is capped at 50');

-- ── Keys ─────────────────────────────────────────────────────────────────────

SELECT test.ok(test.key_found('KT', 'tasks__search', 'brochure') = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[test.id('TD'), test.id('TS')]) x),
  'a tasks key finds what its person can see');
SELECT test.ok(test.key_found('KN', 'tasks__search', 'brochure') = '{}'
           AND test.key_found('KN', 'projects__search', 'garden') = '{}',
  'a notes-only key finds no tasks and no projects');
SELECT test.ok(test.key_found('KT', 'projects__search', 'orchard') = ARRAY[test.id('PS')],
  'a tasks key finds its person''s projects');

-- ── projects__search ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v jsonb := test.hits_as('A', 'projects__search', 'garden');
BEGIN
  PERFORM test.ok(test.well_formed(v, 'bucket') AND test.row_of(v, 'PW') ->> 'match' = 'title',
    'projects__search keeps the contract, as entity_type bucket', v::text);
  v := test.hits_as('A', 'projects__search', 'marrow');
  PERFORM test.ok(test.row_of(v, 'PW') ->> 'match' = 'body' AND test.row_of(v, 'PW') ->> 'snippet' IS NOT NULL,
    'a word in the project''s description finds it as a body hit with a snippet', v::text);
  PERFORM test.ok(test.row_of(test.hits_as('A', 'projects__search', 'orchard'), 'PS') IS NULL
              AND test.row_of(test.hits_as('O', 'projects__search', 'orchard'), 'PS') IS NOT NULL,
    'a private project is found by its owner only');
  PERFORM test.ok((test.row_of(test.hits_as('A', 'projects__search', 'greenhouse'), 'PA') ->> 'archived')::boolean,
    'an archived project is flagged archived');
  PERFORM test.ok(test.row_of(test.hits_as('A', 'projects__search', 'gardn works'), 'PW') ->> 'match' = 'title_fuzzy',
    'a typo in a project name is forgiven');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(test.hits_as('O', 'projects__search', 'inbox')) h
                               JOIN public.buckets b ON b.id = (h ->> 'entity_id')::uuid WHERE b.is_system),
    'the system Inbox is never a project result');
END;
$$;

-- ── Assumption 13: projects are registered on create and rename ──────────────

SELECT test.ok(test.as_user('O', format($q$SELECT public.projects_op_create(%L, '{"id": "%s", "name": "Apricot plan"}'::jsonb)$q$,
                                         test.id('W'), test.id('PN'))) LIKE 'ok%',
  'O creates a project through the op');
SELECT test.ok((SELECT label FROM public.entities WHERE workspace_id = test.id('W') AND entity_type = 'bucket'
                   AND entity_id = test.id('PN') AND deleted_at IS NULL) = 'Apricot plan',
  'a new project is in the registry at once, under its name');
SELECT test.ok(test.as_user('O', format($q$SELECT public.projects_op_update(%L, %L, '{"name": "Nectarine plan"}'::jsonb)$q$,
                                         test.id('W'), test.id('PN'))) LIKE 'ok%',
  'O renames it');
SELECT test.ok((SELECT label FROM public.entities WHERE workspace_id = test.id('W') AND entity_type = 'bucket'
                   AND entity_id = test.id('PN')) = 'Nectarine plan',
  'the registry follows the rename');
SELECT test.ok(test.row_of(test.all_as('O', 'nectarine'), 'PN') IS NOT NULL
           AND test.row_of(test.all_as('O', 'apricot'), 'PN') IS NULL,
  'a renamed project is found by its new name at once, and not by the old one');
SELECT test.ok(test.as_user('O', format($q$INSERT INTO public.buckets (id, workspace_id, owner_id, name) VALUES (%L, %L, %L, 'Damson board')$q$,
                                         test.id('PD'), test.id('W'), test.id('O'))) LIKE 'ok%'
           AND (SELECT label FROM public.entities WHERE entity_type = 'bucket' AND entity_id = test.id('PD')) = 'Damson board',
  'a project the app writes directly is registered too');
SELECT test.ok(test.as_user('O', format($q$UPDATE public.buckets SET deleted_at = now() WHERE id = %L$q$, test.id('PD'))) LIKE 'ok%'
           AND (SELECT deleted_at IS NOT NULL FROM public.entities WHERE entity_type = 'bucket' AND entity_id = test.id('PD'))
           AND test.row_of(test.all_as('O', 'damson'), 'PD') IS NULL,
  'a trashed project leaves the registry and the results');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.entities e JOIN public.buckets b ON b.id = e.entity_id
                            WHERE e.entity_type = 'bucket' AND b.is_system AND e.deleted_at IS NULL
                              AND e.workspace_id = test.id('W')),
  'a system Inbox is never registered');
SELECT test.ok((SELECT count(*) FROM public.buckets b
                 WHERE b.workspace_id = test.id('W') AND NOT b.is_system AND b.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.entity_type = 'bucket'
                                     AND e.entity_id = b.id AND e.label = b.name AND e.deleted_at IS NULL)) = 0,
  'every live project is registered under its current name');

-- ── The app writes tasks directly: the index expressions must let it ─────────

SELECT test.ok(test.as_user('A', format($q$INSERT INTO public.tasks (id, workspace_id, bucket_id, title, description) VALUES (%L, %L, %L, 'Żurek recipe', '<p>sour rye</p>')$q$,
                                         test.id('TA'), test.id('W'), test.id('PW'))) LIKE 'ok%',
  'a member inserts a task directly (the search indexes'' functions are executable by writers)');
SELECT test.ok(test.as_user('A', format($q$UPDATE public.tasks SET description = '<p>sour rye soup</p>' WHERE id = %L$q$, test.id('TA'))) LIKE 'ok%'
           AND test.row_of(test.hits_as('A', 'tasks__search', 'zurek soup'), 'TA') IS NOT NULL,
  'and edits it, and it is found by its new words at once');

-- ── The callers: tasks_search and search_all ────────────────────────────────

SELECT test.ok(test.rpc_as('A', 'brochure') = ARRAY[test.id('TD')]
           AND test.rpc_as('O', 'brochure') @> ARRAY[test.id('TD'), test.id('TS')],
  'tasks_search answers through tasks__search: a description word, each person''s own visibility');
SELECT test.ok(test.rpc_as('A', 'wombat', 5) = ARRAY[test.id('VIS')],
  'tasks_search no longer limits before visibility');
SELECT test.ok(test.rpc_as('A', 'ENG-4217') = ARRAY[test.id('TT')],
  'tasks_search still finds an import''s key');
SELECT test.ok((test.rpc_as('A', (SELECT handle FROM test.handle)))[1] = test.id('TH'),
  'tasks_search puts the handle first');
SELECT test.ok(test.rpc_as('A', 'harvst') = '{}',
  'tasks_search returns only exact matches (every word), never a typo match');
SELECT test.ok(test.rpc_as('X', 'brochure') = '{}', 'tasks_search answers an outsider with nothing');

DO $$
DECLARE
  v jsonb := test.all_as('A', 'brochure');
BEGIN
  PERFORM test.ok(test.row_of(v, 'TD') ->> 'match' = 'body' AND test.row_of(v, 'TD') ->> 'context' = 'Garden works',
    'search_all takes tasks from tasks__search (a body hit with its project; the registry has only titles)', v::text);
  v := test.all_as('A', 'marrow');
  PERFORM test.ok(test.row_of(v, 'PW') ->> 'match' = 'body',
    'and projects from projects__search', v::text);
  PERFORM test.ok(test.row_of(test.all_as('A', 'brochure', ARRAY['project']), 'TD') IS NULL
              AND test.row_of(test.all_as('A', 'marrow', ARRAY['project']), 'PW') IS NOT NULL,
    'a types filter of project asks projects only');
END;
$$;

-- ── Shape and grants (Assumption 7) ──────────────────────────────────────────

SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.tasks__search(uuid, text, integer)', 'public.projects__search(uuid, text, integer)']) f
   WHERE NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = f::regprocedure)
      OR has_function_privilege('anon', f, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
      OR NOT has_function_privilege('service_role', f, 'EXECUTE')),
  'tasks__search and projects__search are SECURITY DEFINER with an empty search_path, callable by signed-in people and the server, never anon');
SELECT test.ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p WHERE p.oid IN ('public.tasks__search(uuid, text, integer)'::regprocedure,
                                          'public.projects__search(uuid, text, integer)'::regprocedure)
     AND EXISTS (SELECT 1 FROM unnest(p.proargnames) a WHERE a IN ('p_actor', 'p_user', 'p_user_id'))),
  'the actor is never a parameter');
SELECT test.ok(NOT has_function_privilege('anon', 'public.tasks_search(uuid, text, integer)', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.tasks_search(uuid, text, integer)', 'EXECUTE')
           AND has_function_privilege('service_role', 'public.tasks_search(uuid, text, integer)', 'EXECUTE'),
  'tasks_search keeps its grants');
SELECT test.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tasks'
                         AND indexdef ILIKE '%USING gin%search__unaccent%' AND indexdef NOT ILIKE '%gin_trgm_ops%')
           AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'tasks'
                         AND indexdef ILIKE '%gin_trgm_ops%' AND indexdef ILIKE '%title%'),
  'tasks have a text index and a title trigram index');

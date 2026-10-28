-- NS-7 · Pull and list check once (specs/notes-schema-hardening.md, AC8,
-- Assumption 7; supabase/migrations/20261030160000_notes_read_rpcs.sql).
--
-- notes_pull(ws, note, after_id, known_version) answers a note's log page and,
-- when the caller's version is stale, its snapshot, in one call that checks
-- access once. It equals what the app's old two-step read (note_updates, then
-- notes, both through RLS) returned, and a note the caller can't see answers
-- exactly like a note that doesn't exist. notes_list_meta(ws, trash_since)
-- equals the RLS list (live notes plus those trashed after trash_since), in
-- byte order of position, for every person.
--
-- Cast: O owns W. E and V are members with edit and view on N; M is a member
-- with no grant; R a member whose role can't open notes; U is outside W and
-- owns W2. KV is O's key with Notes: View, KT O's key with Tasks only.
-- O's notes:
--   N   the target: snapshot 'U05BUA==' at version 2, three log rows.
--   C   follows N (inherit), position 'B' (sorts before 'a' in byte order).
--   S   shared with the whole workspace.
--   H   hidden from everyone but O.
--   T   trashed 3 days ago, V can view it.
--   TO  trashed 40 days ago, V can view it.
--   L   1,005 log rows (paging).

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'M', 'R', 'U']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('U'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'member'),
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('R'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
UPDATE public.workspace_members SET overrides = '{"notes.view": false}'::jsonb
  WHERE workspace_id = test.id('W') AND user_id = test.id('R');

INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_ns7v', md5('db-test-ns7-kv'), '{"notes": "view"}', test.id('O')),
  (test.id('KT'), test.id('W'), 'Tasks', 'mdo_ns7t', md5('db-test-ns7-kt'), '{"tasks": "edit"}', test.id('O'));

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, position) VALUES
  (test.id('N'), test.id('W'), test.id('O'), 'Q4 plan', 'body', 'a'),
  (test.id('S'), test.id('W'), test.id('O'), 'Handbook', 'body', 'c'),
  (test.id('H'), test.id('W'), test.id('O'), 'Salaries', 'secret', 'd'),
  (test.id('T'), test.id('W'), test.id('O'), 'Old plan', 'body', 'e'),
  (test.id('TO'), test.id('W'), test.id('O'), 'Ancient plan', 'body', 'f'),
  (test.id('L'), test.id('W'), test.id('O'), 'Long log', 'body', 'g');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, position, parent_id) VALUES
  (test.id('C'), test.id('W'), test.id('O'), 'Q4 details', 'body', 'B', test.id('N'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('N'), test.id('S'), test.id('H'), test.id('T'), test.id('TO'), test.id('L'));
UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false WHERE id = test.id('C');
UPDATE public.notes SET doc_state = 'U05BUA==', doc_version = 2 WHERE id = test.id('N');
-- Stamped with the triggers off, as rows trashed days ago would be.
SET LOCAL session_replication_role = replica;
UPDATE public.notes SET deleted_at = now() - interval '3 days' WHERE id = test.id('T');
UPDATE public.notes SET deleted_at = now() - interval '40 days' WHERE id = test.id('TO');
SET LOCAL session_replication_role = origin;
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (SELECT id FROM public.notes WHERE workspace_id = test.id('W'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'note', test.id(r), 'member', test.id(s), l, test.id('O')
  FROM (VALUES ('N'), ('L')) AS rr(r), (VALUES ('E', 'edit'), ('V', 'view')) AS ss(s, l)
UNION ALL
SELECT test.id('W'), 'note', test.id(r), 'member', test.id('V'), 'view', test.id('O')
  FROM (VALUES ('T'), ('TO')) AS rr(r)
UNION ALL
SELECT test.id('W'), 'note', test.id('S'), 'workspace', NULL, 'view', test.id('O');

INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64, origin, actor_key_id)
VALUES (test.id('W'), test.id('N'), 'db-test-ns7', 1, 'AAE=', 'user', NULL),
       (test.id('W'), test.id('N'), 'db-test-ns7', 2, 'AAI=', 'user', NULL),
       (test.id('W'), test.id('N'), 'agent:db-test-ns7', 1, 'AAM=', 'api_key', test.id('KV'));
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
SELECT test.id('W'), test.id('L'), 'db-test-ns7-l', i, 'AAA='
  FROM generate_series(1, 1005) i;

-- ── Shape, volatility and grants ────────────────────────────────────────────

SELECT test.ok(
  (SELECT provolatile = 's' AND prosecdef FROM pg_proc
    WHERE oid = 'public.notes_pull(uuid, uuid, bigint, integer)'::regprocedure),
  'notes_pull is STABLE and SECURITY DEFINER: the page and the snapshot come from one snapshot');
SELECT test.ok(
  (SELECT provolatile = 's' AND prosecdef AND proretset
          AND prorettype = 'public.notes_meta'::regtype FROM pg_proc
    WHERE oid = 'public.notes_list_meta(uuid, timestamp with time zone)'::regprocedure),
  'notes_list_meta is STABLE, SECURITY DEFINER and returns SETOF notes_meta');
SELECT test.ok(
  has_function_privilege('authenticated', 'public.notes_pull(uuid, uuid, bigint, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.notes_pull(uuid, uuid, bigint, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.notes_pull(uuid, uuid, bigint, integer)', 'EXECUTE'),
  'notes_pull: authenticated and service_role execute, anon does not');
SELECT test.ok(
  has_function_privilege('authenticated', 'public.notes_list_meta(uuid, timestamp with time zone)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.notes_list_meta(uuid, timestamp with time zone)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.notes_list_meta(uuid, timestamp with time zone)', 'EXECUTE'),
  'notes_list_meta: authenticated and service_role execute, anon does not');
SELECT test.ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a
               WHERE p.oid IN ('public.notes_pull(uuid, uuid, bigint, integer)'::regprocedure,
                               'public.notes_list_meta(uuid, timestamp with time zone)'::regprocedure)
                 AND (a ILIKE '%actor%' OR a ILIKE '%user%')),
  'the actor is never a parameter');

-- ── notes_pull ──────────────────────────────────────────────────────────────

-- The old two-step read as V (RLS), and the new call, as text.
CREATE FUNCTION test.pull_as(p_who text, p_note text, p_after bigint, p_known int, p_ws text DEFAULT 'W')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.value_as(p_who, format('SELECT public.notes_pull(%L, %L, %s, %s)::text',
    test.id(p_ws), test.id(p_note), p_after, coalesce(p_known::text, 'NULL')));
  IF v LIKE 'ERROR %' THEN
    RETURN jsonb_build_object('error', substr(v, 7));
  END IF;
  RETURN v::jsonb;
END;
$$;

CREATE TABLE test.old_pull AS SELECT
  test.value_as('V', format($q$
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id,
      'client_seq', client_seq, 'update_b64', update_b64, 'origin', origin,
      'actor_key_id', actor_key_id) ORDER BY id), '[]')::text
      FROM public.note_updates WHERE note_id = %L AND id > 0$q$, test.id('N')))::jsonb AS updates,
  test.value_as('V', format($q$SELECT jsonb_build_object('doc_state', doc_state, 'doc_version', doc_version)::text
      FROM public.notes WHERE id = %L AND workspace_id = %L$q$, test.id('N'), test.id('W')))::jsonb AS note;

CREATE TABLE test.new_pull AS SELECT test.pull_as('V', 'N', 0, NULL) AS r;

SELECT test.ok(jsonb_array_length((SELECT updates FROM test.old_pull)) = 3,
  'the old read sees the three log rows (the comparison is not empty)');
SELECT test.ok(
  (SELECT r -> 'updates' FROM test.new_pull) = (SELECT updates FROM test.old_pull),
  'pull: the log page equals the old note_updates read (rows, columns, id order)',
  (SELECT r::text FROM test.new_pull));
SELECT test.ok(
  (SELECT r -> 'snapshot' FROM test.new_pull) = (SELECT note -> 'doc_state' FROM test.old_pull)
  AND (SELECT r -> 'doc_version' FROM test.new_pull) = (SELECT note -> 'doc_version' FROM test.old_pull),
  'pull: the snapshot and doc_version equal the old notes read');
SELECT test.ok((SELECT r -> 'has_more' FROM test.new_pull) = 'false'::jsonb,
  'pull: a short log has no more');

SELECT test.ok(
  (SELECT jsonb_array_length(r -> 'updates') FROM (SELECT test.pull_as('V', 'N',
    ((SELECT updates FROM test.old_pull) -> 0 ->> 'id')::bigint, NULL) AS r) s) = 2,
  'pull: p_after_id is a cursor (rows after it only)');
SELECT test.ok(
  (SELECT NOT (r ? 'snapshot') AND r -> 'doc_version' = '2'::jsonb
     FROM (SELECT test.pull_as('V', 'N', 0, 2) AS r) s),
  'pull: no snapshot when the caller already holds this version');
SELECT test.ok(
  (SELECT r -> 'snapshot' = '"U05BUA=="'::jsonb FROM (SELECT test.pull_as('V', 'N', 0, 1) AS r) s),
  'pull: the snapshot when the caller''s version is stale');
SELECT test.ok(
  (SELECT r ? 'snapshot' AND jsonb_typeof(r -> 'snapshot') = 'null'
     FROM (SELECT test.pull_as('V', 'L', 0, NULL) AS r) s),
  'pull: a note with no snapshot yet answers snapshot null on a first pull');

-- Paging: 1,005 rows are a page of 1,000 then 5.
CREATE TABLE test.page1 AS SELECT test.pull_as('E', 'L', 0, NULL) AS r;
SELECT test.ok(
  (SELECT jsonb_array_length(r -> 'updates') = 1000 AND r -> 'has_more' = 'true'::jsonb FROM test.page1),
  'pull: at most 1,000 rows a call, and has_more says there is a tail');
SELECT test.ok(
  (SELECT jsonb_array_length(r -> 'updates') = 5 AND r -> 'has_more' = 'false'::jsonb
     FROM (SELECT test.pull_as('E', 'L', ((SELECT r FROM test.page1) -> 'updates' -> 999 ->> 'id')::bigint, NULL) AS r) s),
  'pull: the next page from the last id is the 5-row tail, with no more');

-- Access: viewers and editors read; hidden equals missing; the trash still reads.
SELECT test.ok((SELECT NOT (test.pull_as('O', 'N', 0, NULL) ? 'error')), 'pull: the owner reads');
SELECT test.ok((SELECT NOT (test.pull_as('E', 'N', 0, NULL) ? 'error')), 'pull: an editor reads');
SELECT test.ok((SELECT NOT (test.pull_as('V', 'T', 0, NULL) ? 'error')),
  'pull: a viewer reads a trashed note they can see (the trash preview, as RLS allowed)');
SELECT test.ok((SELECT test.pull_as('M', 'H', 0, NULL) ->> 'error') LIKE '%Note not found%',
  'pull: a hidden note is refused as not found', (SELECT test.pull_as('M', 'H', 0, NULL)::text));
SELECT test.ok(
  (SELECT test.pull_as('M', 'H', 0, NULL)) = (SELECT test.pull_as('M', 'missing-note', 0, NULL)),
  'pull: hidden and missing answer the same');
SELECT test.ok(
  (SELECT test.pull_as('M', 'N', 0, NULL) ->> 'error') LIKE '%Note not found%',
  'pull: a member with no grant on a private note is refused');
SELECT test.ok(
  (SELECT test.pull_as('U', 'N', 0, NULL, 'W2') ->> 'error') LIKE '%Note not found%',
  'pull: a note asked for under another workspace is not found');
SELECT test.ok((SELECT test.pull_as('U', 'N', 0, NULL) ? 'error'), 'pull: an outsider is refused');
SELECT test.ok((SELECT test.pull_as('R', 'N', 0, NULL) ? 'error'),
  'pull: a role that can''t open notes is refused');
SELECT test.ok(
  test.as_key('KV', format('SELECT public.notes_pull(%L, %L, 0, NULL)', test.id('W'), test.id('N'))) = 'ok 1',
  'pull: a Notes view key reads (the MCP)');
SELECT test.ok(
  test.as_key('KT', format('SELECT public.notes_pull(%L, %L, 0, NULL)', test.id('W'), test.id('N'))) <> 'ok 1',
  'pull: a key without Notes scope is refused');

-- ── notes_list_meta ─────────────────────────────────────────────────────────

-- The RLS list as the app read it, and the new call, as ordered id arrays.
CREATE FUNCTION test.rls_list(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$
    SELECT coalesce(array_agg(id ORDER BY position COLLATE "C", id), '{}')::text
      FROM public.notes WHERE workspace_id = %L
       AND (deleted_at IS NULL OR deleted_at > now() - interval '30 days')$q$, test.id('W')))
$$;
CREATE FUNCTION test.rpc_list(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$
    SELECT coalesce(array_agg(id), '{}')::text
      FROM public.notes_list_meta(%L, now() - interval '30 days')$q$, test.id('W')))
$$;

SELECT test.ok(test.rls_list(p) = test.rpc_list(p),
  format('list: %s sees exactly the RLS list, in the same order', p),
  test.rls_list(p) || ' vs ' || test.rpc_list(p))
  FROM unnest(ARRAY['O', 'E', 'V', 'M']) AS p;
SELECT test.ok(test.rpc_list('O') LIKE '{' || test.id('C') || ',' || test.id('N') || ',%',
  'list: position sorts in byte order (B before a)', test.rpc_list('O'));
SELECT test.ok(cardinality(test.rpc_list('O')::uuid[]) = 6,
  'list: O sees every note but the one trashed before trash_since (non-trivial list)');
SELECT test.ok(test.rpc_list('V') LIKE '%' || test.id('T') || '%'
  AND test.rpc_list('V') NOT LIKE '%' || test.id('TO') || '%',
  'list: trashed after trash_since is in, trashed before it is out');
SELECT test.ok(test.rpc_list('M') = '{' || test.id('S') || '}',
  'list: a member with no grant sees only the workspace-shared note');
SELECT test.ok(
  test.value_as('V', format('SELECT count(*)::text FROM public.notes_list_meta(%L, NULL)', test.id('W'))) = '4',
  'list: a NULL trash_since lists live notes only (N, C, L, S)');
SELECT test.ok(test.rpc_list('R') = '{}', 'list: a role that can''t open notes gets nothing');
SELECT test.ok(test.rpc_list('U') = '{}', 'list: an outsider gets nothing');
-- The expected row is built outside E's role: notes__meta is service-only.
SELECT test.ok(
  test.value_as('E', format('SELECT to_jsonb(m)::text FROM public.notes_list_meta(%L, NULL) m WHERE m.id = %L',
    test.id('W'), test.id('N')))::jsonb
  = (SELECT to_jsonb(public.notes__meta(n)) FROM public.notes n WHERE n.id = test.id('N')),
  'list: each row is the note''s notes_meta');
SELECT test.ok(
  test.as_key('KV', format('SELECT * FROM public.notes_list_meta(%L, NULL)', test.id('W'))) = 'ok 5',
  'list: a Notes view key lists as its creator (live notes)',
  test.as_key('KV', format('SELECT * FROM public.notes_list_meta(%L, NULL)', test.id('W'))));
SELECT test.ok(
  test.as_key('KT', format('SELECT * FROM public.notes_list_meta(%L, NULL)', test.id('W'))) = 'ok 0',
  'list: a key without Notes scope lists nothing');

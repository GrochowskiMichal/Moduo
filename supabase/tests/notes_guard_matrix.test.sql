-- NS-6 · One guard, every op (specs/notes-schema-hardening.md, AC7,
-- Assumption 6, PQ4, PQ7; supabase/migrations/20261030150000_notes_one_guard.sql).
-- Every notes_op_* states its level once, through notes__require (a note) or
-- notes__require_module (create, import): the module key notes.<action> for the
-- caller (a key: its creator, capped by the key's Notes scope), then
-- can_access(view|edit|full) on the note. A note the caller can't see and a
-- note that doesn't exist get the same answer, P0002 "Note not found".
--
-- Cast: O owns W. E is a member, V a viewer, C a member whose role can add
-- notes but not edit or delete them (create-only), X a member whose role can't
-- publish, U is outside W. KV and KE are O's keys with Notes: View and Notes:
-- Edit. O's notes:
--   N  the target, top-level; E, C and X can edit it, V can view it. It has
--      one un-compacted update, so a duplicate copies a tail.
--   P  a page to move N under (the same grants).
--   T  N's twin in the trash, trashed yesterday (for restore and purge).
--   H, HT  hidden from everyone but O; HT is in the trash.
--   PR a private page E and X can edit; IC follows it (inherit).
--   PUB a published page E and X can edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'C', 'X', 'U']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('C'), 'member'),
  (test.id('W'), test.id('X'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
UPDATE public.workspace_members SET overrides = '{"notes.edit": false, "notes.delete": false}'::jsonb
  WHERE workspace_id = test.id('W') AND user_id = test.id('C');
UPDATE public.workspace_members SET overrides = '{"ws.publish": false}'::jsonb
  WHERE workspace_id = test.id('W') AND user_id = test.id('X');

INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_ns6v', md5('db-test-ns6-kv'), '{"notes": "view"}', test.id('O')),
  (test.id('KE'), test.id('W'), 'Writer', 'mdo_ns6e', md5('db-test-ns6-ke'), '{"notes": "edit"}', test.id('O'));

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, position) VALUES
  (test.id('N'), test.id('W'), test.id('O'), 'Q4 plan', 'body', 'a'),
  (test.id('P'), test.id('W'), test.id('O'), 'Roadmap', 'body', 'b'),
  (test.id('T'), test.id('W'), test.id('O'), 'Old plan', 'body', 'c'),
  (test.id('H'), test.id('W'), test.id('O'), 'Salaries', 'secret', 'd'),
  (test.id('HT'), test.id('W'), test.id('O'), 'Old salaries', 'secret', 'e'),
  (test.id('PR'), test.id('W'), test.id('O'), 'Drafts', 'private', 'f'),
  (test.id('PUB'), test.id('W'), test.id('O'), 'Changelog', 'public', 'g');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, position, parent_id) VALUES
  (test.id('IC'), test.id('W'), test.id('O'), 'v2 notes', 'draft', 'a', test.id('PR'));
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false
  WHERE id IN (test.id('N'), test.id('P'), test.id('T'), test.id('H'), test.id('HT'),
               test.id('PR'), test.id('PUB'));
UPDATE public.notes SET share_mode = 'inherit', workspace_shared = false WHERE id = test.id('IC');
UPDATE public.notes SET deleted_at = now() - interval '1 day' WHERE id IN (test.id('T'), test.id('HT'));
UPDATE public.notes SET publish_token = 'db-test-ns6-pub', published_at = now() WHERE id = test.id('PUB');
DELETE FROM public.resource_grants WHERE resource_type = 'note'
  AND resource_id IN (test.id('N'), test.id('P'), test.id('T'), test.id('H'), test.id('HT'),
                      test.id('PR'), test.id('PUB'), test.id('IC'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), 'note', test.id(r), 'member', test.id(s), l, test.id('O')
  FROM (VALUES ('N'), ('P'), ('T')) AS rr(r),
       (VALUES ('E', 'edit'), ('V', 'view'), ('C', 'edit'), ('X', 'edit')) AS ss(s, l)
UNION ALL
SELECT test.id('W'), 'note', test.id(r), 'member', test.id(s), 'edit', test.id('O')
  FROM (VALUES ('PR'), ('PUB')) AS rr(r), (VALUES ('E'), ('X')) AS ss(s);
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
VALUES (test.id('W'), test.id('N'), 'db-test-ns6', 1, 'AAA=');

-- One op's call, on a target note (and a parent for create, import and move).
CREATE FUNCTION test.op_sql(p_op text, p_note uuid, p_parent uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format(CASE p_op
    WHEN 'create'        THEN 'SELECT public.notes_op_create(%1$L, NULL, NULL, ''New'', ''z'')'
    WHEN 'create_under'  THEN 'SELECT public.notes_op_create(%1$L, NULL, %3$L, ''New'', ''z'')'
    WHEN 'import'        THEN 'SELECT public.notes_op_import(%1$L, jsonb_build_array(jsonb_build_object(''title'', ''Imp'')))'
    WHEN 'import_under'  THEN 'SELECT public.notes_op_import(%1$L, jsonb_build_array(jsonb_build_object(''title'', ''Imp'', ''parentId'', %3$L)))'
    WHEN 'duplicate'     THEN 'SELECT public.notes_op_duplicate(%1$L, %2$L, ''z'')'
    WHEN 'rename'        THEN 'SELECT public.notes_op_rename(%1$L, %2$L, ''Renamed'')'
    WHEN 'set_meta'      THEN 'SELECT public.notes_op_set_meta(%1$L, %2$L, ''{"fullWidth": true}''::jsonb)'
    WHEN 'unarchive'     THEN 'SELECT public.notes_op_unarchive(%1$L, %2$L)'
    WHEN 'unpublish'     THEN 'SELECT public.notes_op_unpublish(%1$L, %2$L)'
    WHEN 'seed_doc'      THEN 'SELECT public.notes_op_seed_doc(%1$L, %2$L, ''AAAA'')'
    WHEN 'file'          THEN 'SELECT public.notes_op_file(%1$L, %2$L, false, ''z'')'
    WHEN 'archive'       THEN 'SELECT public.notes_op_archive(%1$L, %2$L)'
    WHEN 'apply_updates' THEN 'SELECT public.notes_op_apply_updates(%1$L, %2$L, ''db-test-ns6-b'', ''[{"clientSeq": 1, "updateB64": "AAA="}]''::jsonb)'
    WHEN 'save_snapshot' THEN 'SELECT public.notes_op_save_snapshot(%1$L, %2$L, ''AAAA'', 0)'
    WHEN 'publish'       THEN 'SELECT public.notes_op_publish(%1$L, %2$L)'
    WHEN 'move'          THEN 'SELECT public.notes_op_move(%1$L, %2$L, %3$L, ''z'')'
    WHEN 'trash'         THEN 'SELECT public.notes_op_trash(%1$L, %2$L)'
    WHEN 'restore'       THEN 'SELECT public.notes_op_restore(%1$L, %2$L)'
    WHEN 'purge'         THEN 'SELECT public.notes_op_purge(%1$L, %2$L)'
    WHEN 'mention'       THEN 'SELECT public.notes_op_mention(%1$L, %2$L, ARRAY[%4$L]::uuid[])'
    WHEN 'set_favorite'  THEN 'SELECT public.notes_op_set_favorite(%1$L, %2$L, true)'
  END, test.id('W'), p_note, p_parent, test.id('O'))
$$;

-- A key's call, undone afterwards (test.try is the user's).
CREATE FUNCTION test.try_key(p_key text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  BEGIN
    v := test.as_key(p_key, p_sql);
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = v;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    v := SQLERRM;
  END;
  RETURN v;
END;
$$;

-- One caller's call, undone afterwards: 'ok', 'deny' (42501) or the raw answer.
CREATE FUNCTION test.call(p_who text, p_op text, p_note text DEFAULT NULL, p_parent text DEFAULT 'P')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_note uuid := test.id(coalesce(p_note, CASE WHEN p_op IN ('restore', 'purge') THEN 'T' ELSE 'N' END));
  v_parent uuid := test.id(CASE WHEN p_op IN ('create_under', 'import_under') AND p_note IS NULL
                               THEN 'N' ELSE p_parent END);
  v_sql text := test.op_sql(p_op, v_note, v_parent);
  v text;
BEGIN
  v := CASE WHEN p_who LIKE 'K%' THEN test.try_key(p_who, v_sql) ELSE test.try(p_who, v_sql) END;
  RETURN CASE WHEN v LIKE 'ok %' THEN 'ok' WHEN v LIKE '42501 %' THEN 'deny' ELSE v END;
END;
$$;

-- ── 1. The matrix ────────────────────────────────────────────────────────────
-- Callers in order: O, E, V, C, U, KV, KE.
DO $$
DECLARE
  v_who text[] := ARRAY['O', 'E', 'V', 'C', 'U', 'KV', 'KE'];
  r record;
  i int;
  v_want text;
  v_got text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- create on the module (+ edit on the parent)
    ('create',        'ok ok deny ok deny deny ok'),
    ('create_under',  'ok ok deny deny deny deny ok'),
    ('import',        'ok ok deny ok deny deny ok'),
    ('import_under',  'ok ok deny deny deny deny ok'),
    -- view on the source + create (+ edit on its parent)
    ('duplicate',     'ok ok deny ok deny deny ok'),
    -- edit
    ('rename',        'ok ok deny deny deny deny ok'),
    ('set_meta',      'ok ok deny deny deny deny ok'),
    ('unarchive',     'ok ok deny deny deny deny ok'),
    ('unpublish',     'ok ok deny deny deny deny ok'),
    ('seed_doc',      'ok ok deny deny deny deny ok'),
    ('file',          'ok ok deny deny deny deny ok'),
    ('archive',       'ok ok deny deny deny deny ok'),
    ('apply_updates', 'ok ok deny deny deny deny ok'),
    ('save_snapshot', 'ok ok deny deny deny deny ok'),
    -- edit + ws.publish
    ('publish',       'ok ok deny deny deny deny ok'),
    -- edit + edit on the new parent
    ('move',          'ok ok deny deny deny deny ok'),
    -- delete (full)
    ('trash',         'ok deny deny deny deny deny ok'),
    ('restore',       'ok deny deny deny deny deny ok'),
    ('purge',         'ok deny deny deny deny deny ok'),
    -- view
    ('mention',       'ok ok ok ok deny ok ok'),
    ('set_favorite',  'ok ok ok ok deny ok ok')
  ) AS m(op, want) LOOP
    FOR i IN 1 .. array_length(v_who, 1) LOOP
      v_want := split_part(r.want, ' ', i);
      v_got := test.call(v_who[i], r.op);
      PERFORM test.ok(v_got = v_want,
        format('%s as %s: %s', r.op, v_who[i], v_want), v_got);
    END LOOP;
  END LOOP;
END;
$$;

-- ── 2. Hidden equals missing (PQ7) ──────────────────────────────────────────
-- E has every Notes permission, so only the note decides the answer.
DO $$
DECLARE
  v_op text;
  v_hidden text;
  v_missing text;
BEGIN
  FOREACH v_op IN ARRAY ARRAY['rename', 'set_meta', 'unarchive', 'unpublish', 'seed_doc', 'file',
    'archive', 'apply_updates', 'save_snapshot', 'publish', 'move', 'trash', 'mention',
    'set_favorite', 'duplicate'] LOOP
    v_hidden := test.call('E', v_op, 'H');
    v_missing := test.call('E', v_op, 'MISSING');
    PERFORM test.ok(v_hidden = v_missing AND v_missing LIKE 'P0002 Note not found%',
      format('%s: a hidden note answers exactly like a missing one, P0002 Note not found', v_op),
      v_hidden || ' | ' || v_missing);
  END LOOP;

  FOREACH v_op IN ARRAY ARRAY['restore', 'purge'] LOOP
    v_hidden := test.call('E', v_op, 'HT');
    v_missing := test.call('E', v_op, 'MISSING');
    PERFORM test.ok(v_hidden = v_missing AND v_missing LIKE 'P0002 Note not found%',
      format('%s: a hidden trashed note answers exactly like a missing one', v_op),
      v_hidden || ' | ' || v_missing);
  END LOOP;

  -- A parent: create under it, move under it, import under it.
  FOREACH v_op IN ARRAY ARRAY['create_under', 'move'] LOOP
    v_hidden := test.call('E', v_op, CASE WHEN v_op = 'move' THEN 'N' ELSE 'H' END, 'H');
    v_missing := test.call('E', v_op, CASE WHEN v_op = 'move' THEN 'N' ELSE 'MISSING' END, 'MISSING');
    PERFORM test.ok(v_hidden = v_missing AND v_missing LIKE 'P0002 %',
      format('%s: a hidden parent answers exactly like a missing one, P0002', v_op),
      v_hidden || ' | ' || v_missing);
  END LOOP;
  v_hidden := test.call('E', 'import_under', 'H', 'H');
  v_missing := test.call('E', 'import_under', 'MISSING', 'MISSING');
  PERFORM test.ok(
    replace(v_hidden, test.id('H')::text, '<id>') = replace(v_missing, test.id('MISSING')::text, '<id>')
      AND v_missing LIKE '22023 A note''s parent isn''t in this workspace%',
    'import_under: a hidden parent answers like a missing one (PQ6''s 22023)', v_hidden || ' | ' || v_missing);
END;
$$;

-- A note you can see but not at the op's level is a refusal, not "not found".
SELECT test.ok(test.call('E', 'trash') = 'deny', 'E sees N but can''t delete it: 42501, not P0002');
SELECT test.ok(test.call('C', 'rename') = 'deny', 'create-only fails at the guard, before the trigger');
SELECT test.ok(test.try('C', test.op_sql('rename', test.id('N'), NULL)) LIKE '42501 Your role can''t edit notes%',
  'create-only gets the role''s refusal', test.try('C', test.op_sql('rename', test.id('N'), NULL)));
SELECT test.ok(test.try_key('KV', test.op_sql('rename', test.id('N'), NULL)) LIKE '42501 %API key%',
  'a view key gets the key''s refusal', test.try_key('KV', test.op_sql('rename', test.id('N'), NULL)));
SELECT test.ok(test.call('E', 'rename', 'T') LIKE '% in the trash%',
  'a trashed note you can see still says it is in the trash', test.call('E', 'rename', 'T'));

-- ── 3. One rule for going public (PQ4) ──────────────────────────────────────
SELECT test.ok(test.call('X', 'publish') = 'deny', 'publish: edit without ws.publish is refused');
SELECT test.ok(test.try('X', test.op_sql('publish', test.id('N'), NULL)) LIKE '42501 %publish%',
  'publish: the refusal names publishing', test.try('X', test.op_sql('publish', test.id('N'), NULL)));
SELECT test.ok(test.call('X', 'rename') = 'ok', 'control: X can edit N');
SELECT test.ok(test.call('E', 'move', 'IC', 'PUB') = 'ok',
  'move: an inherit note into a published tree needs edit + publish, not Full', test.call('E', 'move', 'IC', 'PUB'));
SELECT test.ok(test.call('X', 'move', 'IC', 'PUB') = 'deny',
  'move: edit without ws.publish can''t carry an inherit note onto the web', test.call('X', 'move', 'IC', 'PUB'));
SELECT test.ok(NOT public.can_access('note', test.id('IC'), 'full', test.id('E'))
               AND public.can_access('note', test.id('IC'), 'edit', test.id('E')),
  'control: E has edit, not Full, on IC');

-- ── 4. One guard: the shape ─────────────────────────────────────────────────
SELECT test.ok(to_regprocedure('public.notes__require(uuid, uuid, text, boolean)') IS NOT NULL
               AND pg_get_function_result('public.notes__require(uuid, uuid, text, boolean)'::regprocedure) = 'notes',
  'notes__require(ws, note, action, trashed) returns the notes row');
SELECT test.ok(to_regprocedure('public.notes__require_module(uuid, text)') IS NOT NULL,
  'notes__require_module(ws, action) exists');
SELECT test.ok(to_regprocedure('public.notes_op__guard(uuid)') IS NULL
               AND to_regprocedure('public.notes_op__guard_note(uuid, uuid, boolean)') IS NULL,
  'the old guards are gone');
SELECT test.ok(NOT has_function_privilege(r, f, 'EXECUTE'),
  format('%s can''t call %s', r, f))
  FROM unnest(ARRAY['anon', 'authenticated']) r,
       unnest(ARRAY['public.notes__require(uuid, uuid, text, boolean)',
                    'public.notes__require_module(uuid, text)']) f;
SELECT test.ok(has_function_privilege('service_role', f, 'EXECUTE'), format('service_role calls %s', f))
  FROM unnest(ARRAY['public.notes__require(uuid, uuid, text, boolean)',
                    'public.notes__require_module(uuid, text)']) f;

-- Every op goes through the one guard, and none asks the lossy mirror.
SELECT test.ok(
  p.prosrc ~ 'notes__require(_module)?\(' AND p.prosrc !~ 'notes_op__guard|notes_module_permission|module_member_permission',
  format('%s checks through the one guard', p.proname))
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.proname LIKE 'notes\_op\_%';

-- Return types and grants stay as they were.
SELECT test.ok(pg_get_function_result(p.oid) = 'notes_meta', format('%s still returns notes_meta', p.proname))
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.proname IN ('notes_op_create', 'notes_op_rename', 'notes_op_move',
   'notes_op_set_meta', 'notes_op_duplicate', 'notes_op_file', 'notes_op_archive',
   'notes_op_unarchive', 'notes_op_publish', 'notes_op_unpublish');
SELECT test.ok(has_function_privilege('authenticated', p.oid, 'EXECUTE')
               AND has_function_privilege('service_role', p.oid, 'EXECUTE')
               AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'),
  format('%s: authenticated and service_role, never anon', p.proname))
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.proname LIKE 'notes\_op\_%';

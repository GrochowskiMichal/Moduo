-- Client grants on Notes are read-only (NS-1, specs/notes-schema-hardening.md
-- AC1 and AC2; supabase/migrations/20261030100000_notes_close_open_surface.sql).
-- Every Notes write goes through a SECURITY DEFINER notes_op_*, so a client
-- write grant is only attack surface. anon holds nothing on Notes; a signed-in
-- person can SELECT notes, note_updates and note_favorites and nothing else.
-- The prod-only leftovers (two private helpers, three indexes, the public read
-- on exposed_notes) are gone.
--
-- The world is the RLS matrix's (rls_matrix.md): owner's note N in workspace
-- W, editor at Edit, member with nothing shared.

\ir _rls_matrix.sql

-- Catalog: the privileges themselves.
DO $t$
DECLARE
  r record;
  v_priv text;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      AND (c.relname LIKE 'note\_%' OR c.relname IN ('notes', 'exposed_notes'))
    ORDER BY c.relname
  LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      PERFORM test.ok(NOT has_table_privilege('anon', r.oid, v_priv),
        format('anon holds no %s on %s', v_priv, r.relname));
      PERFORM test.ok(
        has_table_privilege('authenticated', r.oid, v_priv)
          = (v_priv = 'SELECT' AND r.relname IN ('notes', 'note_updates', 'note_favorites')),
        format('authenticated %s %s on %s',
          CASE WHEN v_priv = 'SELECT' AND r.relname IN ('notes', 'note_updates', 'note_favorites')
               THEN 'keeps' ELSE 'holds no' END, v_priv, r.relname));
    END LOOP;
  END LOOP;
END;
$t$;

-- Sequences too: a client setval on the log's id would make every insert collide.
SELECT test.ok(count(*) = 0, 'no client role holds a privilege on a Notes sequence',
  string_agg(format('%s:%s:%s', r.role, c.relname, v.priv), ', '))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS v(priv)
WHERE n.nspname = 'public' AND c.relkind = 'S'
  AND (c.relname LIKE 'note\_%' OR c.relname LIKE 'notes\_%' OR c.relname LIKE 'exposed\_notes%')
  AND has_sequence_privilege(r.role, c.oid, v.priv);
SELECT test.ok(to_regclass('public.note_updates_id_seq') IS NOT NULL, 'the log''s id sequence is the one checked');

SELECT test.ok(count(*) = 0, 'anon executes no Notes function', string_agg(p.oid::regprocedure::text, ', '))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.proname ILIKE '%note%'
  AND p.proname <> 'notes_public_subtree'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

SELECT test.ok(NOT has_function_privilege('authenticated', 'public.notes_module_permission(uuid)', 'EXECUTE'),
  'authenticated can''t call notes_module_permission');
SELECT test.ok(NOT has_function_privilege('anon', 'public.notes_module_permission(uuid)', 'EXECUTE'),
  'anon can''t call notes_module_permission');

-- AC2: the prod-only leftovers.
SELECT test.ok(count(*) = 0, 'private.user_can_read_note and user_can_edit_note are gone',
  string_agg(p.oid::regprocedure::text, ', '))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname IN ('user_can_read_note', 'user_can_edit_note');

SELECT test.ok(count(*) = 0, 'the three prod-only notes indexes are gone', string_agg(indexname, ', '))
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('notes_workspace_pinned_idx', 'notes_workspace_share_scope_idx', 'idx_notes_workspace_id');

SELECT test.ok(count(*) = 0, 'exposed_notes has no policy left', string_agg(policyname, ', '))
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'exposed_notes';

-- Behaviour as anon: every Notes table refuses every statement.
DO $t$
DECLARE
  r record;
  v_sql text;
  v_out text;
BEGIN
  FOR r IN
    SELECT c.relname, a.attname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    -- The first plain column: an identity column refuses SET before privileges are asked.
    CROSS JOIN LATERAL (
      SELECT attname FROM pg_attribute
      WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped AND attidentity = '' AND attgenerated = ''
      ORDER BY attnum LIMIT 1
    ) a
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relname LIKE 'note\_%' OR c.relname IN ('notes', 'exposed_notes'))
    ORDER BY c.relname
  LOOP
    FOREACH v_sql IN ARRAY ARRAY[
      format('SELECT 1 FROM public.%I', r.relname),
      format('INSERT INTO public.%I DEFAULT VALUES', r.relname),
      format('UPDATE public.%I SET %I = %I', r.relname, r.attname, r.attname),
      format('DELETE FROM public.%I', r.relname),
      format('TRUNCATE public.%I', r.relname)
    ] LOOP
      v_out := test.mx('anon', v_sql);
      PERFORM test.ok(v_out LIKE '42501 %', format('anon is refused: %s', v_sql), v_out);
    END LOOP;
  END LOOP;
END;
$t$;

-- Behaviour as a member: direct writes fail, reads stay.
SELECT test.ok(test.mx('owner', format($q$SELECT 1 FROM public.notes WHERE id = %L$q$, test.id('N'))) = 'ok 1',
  'owner still reads their note directly');
SELECT test.ok(test.mx('owner', format($q$SELECT 1 FROM public.note_updates WHERE note_id = %L LIMIT 1$q$, test.id('N'))) LIKE 'ok %',
  'owner still reads note_updates directly');

DO $t$
DECLARE
  v_sql text;
  v_out text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format($q$INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES (%L, %L, %L, 'Direct')$q$,
      test.id('N-direct'), test.id('W'), test.id('owner')),
    format($q$UPDATE public.notes SET title = 'Renamed' WHERE id = %L$q$, test.id('N')),
    format($q$DELETE FROM public.notes WHERE id = %L$q$, test.id('N')),
    format($q$INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64) VALUES (%L, %L, 'tab', 1, 'Ag==')$q$,
      test.id('W'), test.id('N')),
    format($q$UPDATE public.note_updates SET client_id = 'x' WHERE note_id = %L$q$, test.id('N')),
    format($q$DELETE FROM public.note_updates WHERE note_id = %L$q$, test.id('N')),
    format($q$INSERT INTO public.note_favorites (workspace_id, user_id, note_id, position) VALUES (%L, %L, %L, 'a')$q$,
      test.id('W'), test.id('owner'), test.id('N')),
    'TRUNCATE public.notes',
    'TRUNCATE public.note_updates'
  ] LOOP
    v_out := test.mx('owner', v_sql);
    PERFORM test.ok(v_out LIKE '42501 %', format('owner''s direct write is refused: %s', left(v_sql, 60)), v_out);
  END LOOP;
END;
$t$;

-- Every op still works: the definer ops write as the table owner.
SELECT test.ok(test.mx('owner', format($q$SELECT public.notes_op_create(%L, %L, NULL, 'Through the op')$q$,
  test.id('W'), test.id('N-op'))) = 'ok 1', 'notes_op_create still works');
SELECT test.ok(test.mx('editor', format($q$SELECT public.notes_op_rename(%L, %L, 'Renamed by op')$q$,
  test.id('W'), test.id('N'))) = 'ok 1', 'notes_op_rename still works for an editor');
SELECT test.ok(test.mx('editor', format($q$SELECT public.notes_op_set_meta(%L, %L, '{"icon": "📘"}'::jsonb)$q$,
  test.id('W'), test.id('N'))) = 'ok 1', 'notes_op_set_meta still works');
SELECT test.ok(test.mx('editor', format($q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-g', '[{"clientSeq": 1, "updateB64": "Ag=="}]'::jsonb)$q$,
  test.id('W'), test.id('N'))) LIKE 'ok %', 'notes_op_apply_updates still writes the log');
SELECT test.ok(test.mx('owner', format($q$SELECT public.notes_op_set_favorite(%L, %L, true)$q$,
  test.id('W'), test.id('N'))) LIKE 'ok %', 'notes_op_set_favorite still works (it asks notes_module_permission)');
SELECT test.ok(test.mx('owner', format($q$SELECT public.notes_op_trash(%L, %L)$q$,
  test.id('W'), test.id('N'))) LIKE 'ok %', 'notes_op_trash still works');
SELECT test.ok(test.mx('owner', format($q$SELECT public.notes_op_publish(%L, %L)$q$,
  test.id('W'), test.id('N'))) LIKE 'ok %', 'notes_op_publish still works');
SELECT test.ok(test.mx('editor', format($q$SELECT * FROM public.notes__search(%L, 'HV16', 10)$q$,
  test.id('W'))) LIKE 'ok %', 'notes__search still runs for a member (it asks notes_module_permission)');
SELECT test.ok(test.mx('member', format($q$SELECT public.notes_op_rename(%L, %L, 'Not mine')$q$,
  test.id('W'), test.id('N'))) NOT LIKE 'ok %', 'an op still refuses a member with nothing shared');

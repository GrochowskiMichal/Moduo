-- NS-9 · Legacy out, integrity in (specs/notes-schema-hardening.md, AC10,
-- Assumption 9, PQ5; supabase/migrations/20261030180000_notes_legacy_out.sql).
-- The legacy sharing objects and columns are gone, and the pin with them
-- (Favorites replace it). Every note op still writes without them, and
-- erasure still completes. The actor columns null out when their person or
-- key goes, and position sorts in byte order, whatever the database collation.
--
-- Cast: O owns W and holds key K. X (the account erased) and Y (an editor who
-- leaves) are members. P is O's page; YN is Y's note, which O can see.

SELECT test.person(n) FROM unnest(ARRAY['O', 'X', 'Y']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['X', 'Y']) AS n;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_ns9', md5('db-test-ns9'), '{"notes": "edit"}'::jsonb, test.id('O'));
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, position) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Roadmap', 'body', 'body', 'a');

-- ── The objects and columns are gone ────────────────────────────────────────

DO $$
BEGIN
  PERFORM test.ok(to_regclass('public.exposed_notes') IS NULL, 'exposed_notes is dropped');
  PERFORM test.ok(to_regclass('public.note_shares') IS NULL, 'note_shares is dropped');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
                              WHERE s.nspname = 'private' AND p.proname = 'user_owns_note'),
    'private.user_owns_note is dropped');
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notes'
         AND column_name IN ('share_scope', 'share_permission', 'tags', 'kind', 'is_pinned')),
    'notes has no share_scope, share_permission, tags, kind or is_pinned',
    (SELECT string_agg(column_name::text, ', ') FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notes'
        AND column_name IN ('share_scope', 'share_permission', 'tags', 'kind', 'is_pinned')));
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'public.notes_meta'::regtype)
         AND attname = 'is_pinned' AND NOT attisdropped),
    'notes_meta has no is_pinned');
  -- No function body still names a dropped object or column.
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
       WHERE s.nspname IN ('public', 'private')
         AND p.prosrc ~ '\m(exposed_notes|note_shares|user_owns_note|share_scope|share_permission|is_pinned)\M'),
    'no function in public or private names a dropped object or column',
    (SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
      WHERE s.nspname IN ('public', 'private')
        AND p.prosrc ~ '\m(exposed_notes|note_shares|user_owns_note|share_scope|share_permission|is_pinned)\M'));
END;
$$;

-- ── Every op that inserted kind still writes ─────────────────────────────────

DO $$
DECLARE
  v_ws uuid := test.id('W');
  v_p uuid := test.id('P');
  v_new uuid := test.id('NEW');
  v_imp uuid := test.id('IMP');
  r text;
BEGIN
  r := test.as_op('O', format('SELECT public.notes_op_create(%L, %L, NULL, %L, %L)', v_ws, v_new, 'Fresh', 'b'));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (SELECT 1 FROM public.notes WHERE id = v_new),
    'notes_op_create writes a note', r);

  r := test.as_op('O', format('SELECT public.notes_op_duplicate(%L, %L)', v_ws, v_p));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (SELECT 1 FROM public.notes
                                         WHERE workspace_id = v_ws AND title = 'Roadmap (copy)'),
    'notes_op_duplicate writes a copy', r);

  r := test.as_op('O', format('SELECT public.notes_op_import(%L, %L::jsonb)', v_ws,
         jsonb_build_array(jsonb_build_object('id', v_imp, 'title', 'Imported', 'position', 'c'))));
  PERFORM test.ok(r = 'ok 1' AND EXISTS (SELECT 1 FROM public.notes WHERE id = v_imp),
    'notes_op_import writes the page', r);

  -- set_meta keeps icon and full width; an old client's isPinned is ignored.
  r := test.as_op('O', format('SELECT public.notes_op_set_meta(%L, %L, %L::jsonb)', v_ws, v_p,
         '{"icon": "📌", "isPinned": true, "fullWidth": true}'));
  PERFORM test.ok(r = 'ok 1' AND (SELECT icon = '📌' AND full_width FROM public.notes WHERE id = v_p),
    'notes_op_set_meta sets icon and full width, and ignores isPinned', r);
END;
$$;

-- ── Only the owner hands a note to someone else ─────────────────────────────

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, position) VALUES
  (test.id('YN'), test.id('W'), test.id('Y'), 'Y''s note', 'body', 'body', 'd');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('YN'), 'member', test.id('X'), 'full', test.id('Y'));

-- Clients hold no write grant on notes, so these run as the actor past RLS
-- (test.as_op), the way an op's UPDATE does.
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_op('X', format('UPDATE public.notes SET created_by = %L WHERE id = %L', test.id('X'), test.id('YN')));
  PERFORM test.ok(r LIKE '%only the note owner%',
    'someone with Full who isn''t the owner can''t take the note over', r);
  r := test.as_op('X', format('UPDATE public.notes SET title = %L WHERE id = %L', 'Renamed', test.id('YN')));
  PERFORM test.ok(r = 'ok 1', 'they can still edit the rest of it', r);
  r := test.as_op('Y', format('UPDATE public.notes SET created_by = %L WHERE id = %L', test.id('O'), test.id('YN')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT created_by = test.id('O') FROM public.notes WHERE id = test.id('YN')),
    'the owner can hand it over', r);
END;
$$;

-- ── Actor keys ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM test.ok(
    (SELECT count(*) FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confdeltype = 'n'
        AND ((c.conrelid = 'public.notes'::regclass AND c.confrelid = 'public.profiles'::regclass
              AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                     WHERE attrelid = 'public.notes'::regclass AND attname = 'edited_by')])
          OR (c.conrelid = 'public.note_updates'::regclass AND c.confrelid = 'public.profiles'::regclass
              AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                     WHERE attrelid = 'public.note_updates'::regclass AND attname = 'user_id')])
          OR (c.conrelid = 'public.note_updates'::regclass AND c.confrelid = 'public.workspace_api_keys'::regclass
              AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                     WHERE attrelid = 'public.note_updates'::regclass AND attname = 'actor_key_id')]))
    ) = 3,
    'edited_by, note_updates.user_id and note_updates.actor_key_id have ON DELETE SET NULL keys');
END;
$$;

UPDATE public.notes SET edited_by = test.id('Y'), edited_at = now() WHERE id = test.id('P');
INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64, origin, user_id, actor_key_id) VALUES
  (test.id('W'), test.id('P'), 'ns9-y', 1, 'AA==', 'user', test.id('Y'), NULL),
  (test.id('W'), test.id('P'), 'ns9-k', 1, 'AA==', 'api_key', test.id('O'), test.id('K'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.run(NULL, format('DELETE FROM auth.users WHERE id = %L', test.id('Y')), false);
  PERFORM test.ok(r = 'ok 1', 'Y''s account deletes', r);
  r := test.run(NULL, format('DELETE FROM public.workspace_api_keys WHERE id = %L', test.id('K')), false);
  PERFORM test.ok(r = 'ok 1', 'key K deletes', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok((SELECT edited_by IS NULL FROM public.notes WHERE id = test.id('P')),
    'the note''s last editor nulls out when their account goes');
  PERFORM test.ok((SELECT user_id IS NULL FROM public.note_updates
                    WHERE note_id = test.id('P') AND client_id = 'ns9-y'),
    'an update''s person nulls out when their account goes, and the update stays');
  PERFORM test.ok((SELECT actor_key_id IS NULL AND user_id = test.id('O') FROM public.note_updates
                    WHERE note_id = test.id('P') AND client_id = 'ns9-k'),
    'an update''s key nulls out when the key is deleted, and the update stays');
END;
$$;

-- ── Erasure completes ───────────────────────────────────────────────────────
-- X writes a page of their own and is erased.

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, position) VALUES
  (test.id('XP'), test.id('W'), test.id('X'), 'X''s page', 'body', 'body', 'e');
UPDATE public.notes SET share_mode = 'custom', workspace_shared = false WHERE id = test.id('XP');
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('XP');

DO $$
DECLARE
  r text;
BEGIN
  r := test.run(NULL, format('SELECT public.account_erase_workspace_data(%L, true)', test.id('X')), false);
  PERFORM test.ok(r = 'ok 1', 'erasure previews', r);
  r := test.run(NULL, format('SELECT public.account_erase_workspace_data(%L, false)', test.id('X')), false);
  PERFORM test.ok(r = 'ok 1', 'erasure runs', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notes WHERE id = test.id('XP')),
    'erasure deleted X''s private page');
END;
$$;

-- ── Byte order ──────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM test.ok(
    (SELECT collation_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notes' AND column_name = 'position') = 'C'
    AND (SELECT collation_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'note_favorites' AND column_name = 'position') = 'C',
    'notes.position and note_favorites.position are COLLATE "C"');
END;
$$;

INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text, parent_id, position)
SELECT test.id('S' || p), test.id('W'), test.id('O'), 'S' || p, '', '', test.id('P'), p
  FROM unnest(ARRAY['a', 'B', 'b', 'Z', 'a0', 'A']) AS p;
INSERT INTO public.note_favorites (user_id, workspace_id, note_id, position)
SELECT test.id('O'), test.id('W'), test.id('S' || p), p
  FROM unnest(ARRAY['a', 'B', 'b', 'Z', 'a0', 'A']) AS p;

DO $$
BEGIN
  -- A plain ORDER BY, no COLLATE: the client's code-unit order.
  PERFORM test.ok(
    (SELECT array_agg(position ORDER BY position) FROM public.notes WHERE parent_id = test.id('P'))
      = ARRAY['A', 'B', 'Z', 'a', 'a0', 'b'],
    'notes sort by position in byte order',
    (SELECT array_agg(position ORDER BY position)::text FROM public.notes WHERE parent_id = test.id('P')));
  PERFORM test.ok(
    (SELECT array_agg(position ORDER BY position) FROM public.note_favorites WHERE user_id = test.id('O'))
      = ARRAY['A', 'B', 'Z', 'a', 'a0', 'b'],
    'favorites sort by position in byte order',
    (SELECT array_agg(position ORDER BY position)::text FROM public.note_favorites WHERE user_id = test.id('O')));
END;
$$;

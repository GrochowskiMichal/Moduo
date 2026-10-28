-- NS-2 · One tree per workspace (specs/notes-schema-hardening.md, AC3,
-- Assumption 2, PQ6). Test: supabase/tests/notes_same_workspace.test.sql.
--
-- notes.parent_id, note_updates.note_id and note_favorites.note_id referenced
-- notes(id) alone, so nothing kept a note's parent, its log rows or its
-- favorites in the note's own workspace. notes_op_import inserted any
-- parentId it was given, and perm_enforce_write checks only Edit on the
-- parent. can_access gives an inherit chain the topmost ancestor's workspace
-- as its ceiling, so a note filed under another workspace's page could be
-- read by that other workspace's members.
--
-- Composite keys on (workspace_id, …) now make a cross-workspace link
-- impossible on every path, past every trigger:
--   * notes gets UNIQUE (workspace_id, id) for them to reference;
--   * the parent key sets only parent_id to NULL when the parent is deleted
--     (account erasure and NS-3's re-rooting rely on that);
--   * the log and favorite keys cascade, as before.
-- can_access is not changed: with the key in place its ceiling always equals
-- the note's own workspace.
--
-- notes_op_import checks every parentId before inserting anything: it must be
-- a note of this workspace or a new row of this batch, or the whole import
-- fails with 22023 "A note's parent isn't in this workspace" (PQ6). Before, the
-- key's violation was swallowed per row and the note silently skipped. Body
-- built on prod's (20261013120000_notes_refresh_organize.sql); its grants are
-- kept by CREATE OR REPLACE.
--
-- Prod has no cross-workspace parent, log row or favorite (checked
-- 2026-10-28), so the keys are added validated. Re-runnable.

SET LOCAL lock_timeout = '5s';

-- The single-column keys may predate migrations: drop whatever exists by catalog.
DO $do$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT k.conrelid::regclass AS tbl, k.conname
    FROM pg_constraint k
    WHERE k.contype = 'f'
      AND k.confrelid = 'public.notes'::regclass
      AND (k.conrelid, k.conkey) IN (
        ('public.notes'::regclass, ARRAY[(SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.notes'::regclass AND attname = 'parent_id')]),
        ('public.note_updates'::regclass, ARRAY[(SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.note_updates'::regclass AND attname = 'note_id')]),
        ('public.note_favorites'::regclass, ARRAY[(SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.note_favorites'::regclass AND attname = 'note_id')]))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END;
$do$;

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_parent_id_fkey;
ALTER TABLE public.note_updates DROP CONSTRAINT IF EXISTS note_updates_note_id_fkey;
ALTER TABLE public.note_favorites DROP CONSTRAINT IF EXISTS note_favorites_note_id_fkey;
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_workspace_id_id_key;

ALTER TABLE public.notes ADD CONSTRAINT notes_workspace_id_id_key UNIQUE (workspace_id, id);

ALTER TABLE public.notes ADD CONSTRAINT notes_parent_id_fkey
  FOREIGN KEY (workspace_id, parent_id) REFERENCES public.notes (workspace_id, id)
  ON DELETE SET NULL (parent_id);
ALTER TABLE public.note_updates ADD CONSTRAINT note_updates_note_id_fkey
  FOREIGN KEY (workspace_id, note_id) REFERENCES public.notes (workspace_id, id)
  ON DELETE CASCADE;
ALTER TABLE public.note_favorites ADD CONSTRAINT note_favorites_note_id_fkey
  FOREIGN KEY (workspace_id, note_id) REFERENCES public.notes (workspace_id, id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.notes_op_import(p_workspace_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_id uuid;
  v_first uuid;
  v_imported integer := 0;
  v_skipped integer := 0;
  v_batch uuid[] := '{}';
  v_parent uuid;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import rows must be an array.';
  END IF;

  -- PQ6: every parent is a note of this workspace or a new row of this batch,
  -- checked before anything is written. A malformed id is left to the row
  -- loop, which skips it as before.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := nullif(r.value ->> 'id', '')::uuid;
      IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notes WHERE id = v_id) THEN
        v_batch := v_batch || v_id;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END LOOP;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_parent := nullif(r.value ->> 'parentId', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      CONTINUE;
    END;
    IF v_parent IS NOT NULL
       AND v_parent <> ALL (v_batch)
       AND NOT EXISTS (SELECT 1 FROM public.notes
                       WHERE id = v_parent AND workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('A note''s parent isn''t in this workspace: %s', v_parent),
        DETAIL = json_build_object('parentId', v_parent)::text;
    END IF;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := coalesce(nullif(r.value ->> 'id', '')::uuid, gen_random_uuid());
      IF EXISTS (SELECT 1 FROM public.notes WHERE id = v_id) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.notes
        (id, workspace_id, created_by, parent_id, title, icon, kind, position,
         doc_state, body_text, body_md, in_inbox)
      VALUES
        (v_id, p_workspace_id, public.perm_actor_id(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
         'note',
         coalesce(r.value ->> 'position', ''),
         nullif(r.value ->> 'docStateB64', ''),
         coalesce(r.value ->> 'bodyText', ''),
         coalesce(r.value ->> 'bodyMd', ''),
         (r.value ->> 'inInbox')::boolean);
      PERFORM public.entities_op_upsert(
        p_workspace_id, 'note', v_id,
        coalesce(nullif(btrim(r.value ->> 'title'), ''), 'Untitled'), 'note');
      IF v_first IS NULL THEN v_first := v_id; END IF;
      v_imported := v_imported + 1;
    EXCEPTION WHEN data_exception OR not_null_violation OR check_violation
      OR foreign_key_violation OR invalid_text_representation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  IF v_imported > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', v_first, 'notes.import',
      jsonb_build_object('imported', v_imported, 'skipped', v_skipped));
  END IF;
  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$function$;

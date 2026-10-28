-- NS-9 · Legacy out, integrity in (specs/notes-schema-hardening.md, AC10,
-- Assumption 9, PQ5; supabase/tests/notes_legacy_dropped.test.sql).
--
--   1. Account erasure stops deleting from the legacy tables (cut into its
--      live body, as GS-8 did).
--   2. exposed_notes, note_shares (its policies, trigger and trigger function)
--      and private.user_owns_note go. Nothing reads them: publishing moved to
--      publish_token, sharing to resource_grants. Prod-only objects, so every
--      drop is IF EXISTS.
--   3. The ops stop writing kind (create, duplicate, import) and set_meta
--      stops taking isPinned; an old client's isPinned is ignored.
--   4. notes_meta loses is_pinned. ALTER TYPE … DROP ATTRIBUTE keeps every
--      function that returns it, and their grants, as they are; only
--      notes__meta, which builds the row, is re-cut.
--   5. The columns share_scope, share_permission, tags, kind and is_pinned go
--      (their CHECKs and indexes with them). Pins are gone; Favorites replace
--      them (PQ5).
--   6. notes_share_fields_owner_only keeps its remaining job: only the owner
--      hands a note over (created_by) or moves it out of its workspace.
--   7. The actor columns get foreign keys, ON DELETE SET NULL, each with a
--      partial index so a deleted person or key doesn't scan the table. Prod
--      has no dangling ids, so they are added validated.
--   8. position sorts in byte order (COLLATE "C") on notes and
--      note_favorites, the order the client sorts by.
--
-- share_mode's closed vocabulary is NOTE_SHARE_MODES in
-- functions/_shared/contracts/vocabularies.ts, pinned to notes_share_mode_chk.
-- The dormant desktop REST sync (apps/desktop/src-tauri) still names some of
-- these columns; it is dead code and left as it is.

-- The drops and the collation change lock notes briefly; wait, don't queue.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.recut(p_fn regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  -- Already cut (a re-run): the new text may contain the old, so look for it first.
  IF position(p_new IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(p_old IN v_def) = 0 THEN
    RAISE EXCEPTION '% isn''t the body this migration expects; redefine it by hand.', p_fn;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$$;

-- ── 1. Account erasure ──────────────────────────────────────────────────────

SELECT pg_temp.recut('public.account_erase_workspace_data(uuid, boolean)'::regprocedure,
$o$  -- 6. The items. Children before parents where a foreign key restricts.
  DELETE FROM public.exposed_notes x WHERE x.note_id = ANY (v_note_del::text[]);
  -- note_shares has a foreign key whose delete rule no migration records.
  DELETE FROM public.note_shares s WHERE s.note_id = ANY (v_note_del);
  -- notes.parent_id is SET NULL$o$,
$n$  -- 6. The items. Children before parents where a foreign key restricts.
  -- notes.parent_id is SET NULL$n$);

-- ── 2. The legacy objects ───────────────────────────────────────────────────

DROP TABLE IF EXISTS public.note_shares;
DROP FUNCTION IF EXISTS public.note_share_workspace_matches_note();
DROP TABLE IF EXISTS public.exposed_notes;
DROP FUNCTION IF EXISTS private.user_owns_note(uuid);

-- ── 3. The ops stop writing kind and is_pinned ──────────────────────────────

SELECT pg_temp.recut('public.notes_op_create(uuid, uuid, uuid, text, text, text)'::regprocedure,
$o$    (id, workspace_id, created_by, parent_id, title, icon, kind, position)
  VALUES
    (coalesce(p_id, gen_random_uuid()), p_workspace_id, public.perm_actor_id(), p_parent_id,
     coalesce(p_title, ''), p_icon, 'note', coalesce(p_position, ''))$o$,
$n$    (id, workspace_id, created_by, parent_id, title, icon, position)
  VALUES
    (coalesce(p_id, gen_random_uuid()), p_workspace_id, public.perm_actor_id(), p_parent_id,
     coalesce(p_title, ''), p_icon, coalesce(p_position, ''))$n$);

SELECT pg_temp.recut('public.notes_op_duplicate(uuid, uuid, text)'::regprocedure,
$o$    (workspace_id, created_by, parent_id, title, icon, kind, position,
     doc_state, doc_version, body_text, body_md, in_inbox, full_width)
  VALUES
    (p_workspace_id, public.perm_actor_id(), src.parent_id,
     CASE WHEN btrim(src.title) = '' THEN '' ELSE src.title || ' (copy)' END,
     src.icon, 'note', coalesce(nullif(p_position, ''), src.position),$o$,
$n$    (workspace_id, created_by, parent_id, title, icon, position,
     doc_state, doc_version, body_text, body_md, in_inbox, full_width)
  VALUES
    (p_workspace_id, public.perm_actor_id(), src.parent_id,
     CASE WHEN btrim(src.title) = '' THEN '' ELSE src.title || ' (copy)' END,
     src.icon, coalesce(nullif(p_position, ''), src.position),$n$);

SELECT pg_temp.recut('public.notes_op_import(uuid, jsonb)'::regprocedure,
$o$        (id, workspace_id, created_by, parent_id, title, icon, kind, position,
         doc_state, body_text, body_md, in_inbox)
      VALUES
        (v_id, p_workspace_id, public.perm_actor_id(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
         'note',
$o$,
$n$        (id, workspace_id, created_by, parent_id, title, icon, position,
         doc_state, body_text, body_md, in_inbox)
      VALUES
        (v_id, p_workspace_id, public.perm_actor_id(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
$n$);

SELECT pg_temp.recut('public.notes_op_set_meta(uuid, uuid, jsonb)'::regprocedure,
$o$ELSE icon END,
    is_pinned = CASE WHEN p_patch ? 'isPinned'
      THEN coalesce((p_patch ->> 'isPinned')::boolean, false) ELSE is_pinned END,
    full_width$o$,
$n$ELSE icon END,
    full_width$n$);

-- ── 4. notes_meta without is_pinned ─────────────────────────────────────────

ALTER TYPE public.notes_meta DROP ATTRIBUTE IF EXISTS is_pinned;

CREATE OR REPLACE FUNCTION public.notes__meta(n public.notes)
RETURNS public.notes_meta
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT n.id, n.workspace_id, n.created_by, n.parent_id, n.title, n.icon,
         n.position, n.is_archived, n.published_at, n.publish_token, n.doc_version,
         n.share_mode, n.workspace_shared, n.in_inbox, n.full_width, n.edited_by,
         n.edited_at, n.created_at, n.updated_at, n.deleted_at
$function$;

-- ── 6. Only the owner hands a note over ─────────────────────────────────────
-- Before the columns go: the old body reads share_scope and share_permission.

CREATE OR REPLACE FUNCTION public.notes_share_fields_owner_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('share.bypass', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Sharing lives in resource_grants (guarded by its own ops); what's left
  -- here is ownership.
  IF TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND OLD.created_by IS DISTINCT FROM auth.uid()
    AND (
      OLD.created_by IS DISTINCT FROM NEW.created_by
      OR OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
    )
  THEN
    RAISE EXCEPTION 'only the note owner can change sharing or ownership';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 5. The legacy columns ───────────────────────────────────────────────────

ALTER TABLE public.notes
  DROP COLUMN IF EXISTS share_scope,
  DROP COLUMN IF EXISTS share_permission,
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS is_pinned;

-- ── 7. Actor keys ───────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS notes_edited_by_idx
  ON public.notes (edited_by) WHERE edited_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS note_updates_user_id_idx
  ON public.note_updates (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS note_updates_actor_key_id_idx
  ON public.note_updates (actor_key_id) WHERE actor_key_id IS NOT NULL;

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_edited_by_fkey;
ALTER TABLE public.notes ADD CONSTRAINT notes_edited_by_fkey
  FOREIGN KEY (edited_by) REFERENCES public.profiles (id) ON DELETE SET NULL;
ALTER TABLE public.note_updates DROP CONSTRAINT IF EXISTS note_updates_user_id_fkey;
ALTER TABLE public.note_updates ADD CONSTRAINT note_updates_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE SET NULL;
ALTER TABLE public.note_updates DROP CONSTRAINT IF EXISTS note_updates_actor_key_id_fkey;
ALTER TABLE public.note_updates ADD CONSTRAINT note_updates_actor_key_id_fkey
  FOREIGN KEY (actor_key_id) REFERENCES public.workspace_api_keys (id) ON DELETE SET NULL;

-- ── 8. Byte order ───────────────────────────────────────────────────────────

ALTER TABLE public.notes ALTER COLUMN position TYPE text COLLATE "C";
ALTER TABLE public.note_favorites ALTER COLUMN position TYPE text COLLATE "C";

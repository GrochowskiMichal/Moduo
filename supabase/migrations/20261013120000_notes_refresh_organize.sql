-- NR-1 · Notes refresh: organizing data (specs/notes-refresh.md, assumptions 9–12).
--
--   1. `notes.in_inbox` — the Inbox becomes a STORED place. Classic Notes
--      derived it ("a root with no live children"), so a note jumped between
--      Inbox and the tree whenever it gained or lost its last child. Filled by
--      a trigger: a root insert lands in the Inbox unless the writer says
--      otherwise, gaining a parent always clears it, and a CHECK keeps it
--      roots-only. Backfilled to today's derived Inbox so nobody's sidebar
--      changes the day this ships.
--   2. `notes.full_width` — per-note opt-out of the reading measure.
--   3. `note_favorites` — per-user favorites (workspace pins become each
--      viewer's favorite once; `is_pinned` is no longer read by the new UI).
--   4. Ops: `notes_op_file`, `notes_op_set_favorite`; `notes_op_set_meta`
--      learns `fullWidth`; `notes_op_import` takes a per-row `inInbox`;
--      `notes_op_duplicate` keeps the copy in its source's section.
--   5. Every path that puts a shared sub-note at the top level (file, move,
--      restore, purge) keeps everyone's access to it; `notes_op_create`
--      records the actor as creator (API-key creates had none).
--
-- Additive: the classic UI never reads the new columns, and its creates still
-- land where they did (roots → Inbox). Same-signature CREATE OR REPLACE keeps
-- existing grants; new functions state theirs.

SET LOCAL lock_timeout = '5s';

-- notes_op_import below is rewritten from 20261008123000's body (it stamps
-- perm_actor_id()). Applied before that file, this would be overwritten by it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.notes_op_import(uuid, jsonb)'::regprocedure
      AND prosrc LIKE '%perm_actor_id()%'
  ) THEN
    RAISE EXCEPTION 'Apply 20261008123000_key_writes_act_as_creator.sql before this migration.';
  END IF;
END;
$$;

-- ── 1. Stored Inbox ──────────────────────────────────────────────────────────

-- The backfill runs only when the column is first added, so a manual re-run
-- can't push notes someone filed to Pages back into the Inbox.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'notes' AND column_name = 'in_inbox'
  ) THEN
    ALTER TABLE public.notes ADD COLUMN in_inbox boolean NOT NULL DEFAULT false;

    -- Today's derived Inbox: a live, unarchived ROOT with no live, unarchived
    -- children. No updated_at bump — a backfill is not an edit (Recents/Home
    -- order by it). Runs with no actor, so perm_enforce_write lets it through.
    UPDATE public.notes n
       SET in_inbox = true
     WHERE n.parent_id IS NULL
       AND n.deleted_at IS NULL
       AND NOT coalesce(n.is_archived, false)
       AND NOT EXISTS (
         SELECT 1 FROM public.notes c
          WHERE c.parent_id = n.id
            AND c.deleted_at IS NULL
            AND NOT coalesce(c.is_archived, false));

    -- No default from here on: an INSERT that omits the column arrives NULL
    -- in the BEFORE trigger, which decides (NOT NULL is checked after BEFORE
    -- triggers run).
    ALTER TABLE public.notes ALTER COLUMN in_inbox DROP DEFAULT;
  END IF;
END;
$$;

ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS full_width boolean NOT NULL DEFAULT false;

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_in_inbox_roots_only;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_in_inbox_roots_only CHECK (NOT in_inbox OR parent_id IS NULL);

CREATE OR REPLACE FUNCTION public.notes_in_inbox_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    -- Nesting is filing: a child is never an Inbox item.
    NEW.in_inbox := false;
  ELSIF TG_OP = 'INSERT' AND NEW.in_inbox IS NULL THEN
    -- A root nobody placed explicitly is a capture.
    NEW.in_inbox := true;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notes_in_inbox_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notes_in_inbox_default ON public.notes;
CREATE TRIGGER notes_in_inbox_default
  BEFORE INSERT OR UPDATE OF parent_id ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notes_in_inbox_default();

-- ── 2. Per-user favorites ────────────────────────────────────────────────────

-- Created and backfilled in one first-run-only block: a manual re-run can't
-- bring back a favorite someone removed.
DO $$
BEGIN
  IF to_regclass('public.note_favorites') IS NOT NULL THEN
    RETURN;
  END IF;

  CREATE TABLE public.note_favorites (
    workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
    -- Account erasure: deleting the auth user cascades their favorites.
    user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    note_id      uuid NOT NULL REFERENCES public.notes (id) ON DELETE CASCADE,
    position     text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, note_id)
  );

  -- Workspace pins → each member's favorite, for members who can open the note.
  INSERT INTO public.note_favorites (workspace_id, user_id, note_id, position, created_at)
  SELECT n.workspace_id, m.user_id, n.id, coalesce(n.position, ''), now()
    FROM public.notes n
    JOIN public.workspace_members m ON m.workspace_id = n.workspace_id
   WHERE coalesce(n.is_pinned, false)
     AND n.deleted_at IS NULL
     AND m.user_id IS NOT NULL
     AND public.can_access('note', n.id, 'view', m.user_id)
  ON CONFLICT (user_id, note_id) DO NOTHING;
END;
$$;

CREATE INDEX IF NOT EXISTS note_favorites_user_ws_idx
  ON public.note_favorites (user_id, workspace_id);
CREATE INDEX IF NOT EXISTS note_favorites_note_idx
  ON public.note_favorites (note_id);
COMMENT ON TABLE public.note_favorites IS
  'Per-user favorite notes (NR-1). Read: your own rows on notes you can still open. Written only through notes_op_set_favorite.';

ALTER TABLE public.note_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS note_favorites_own_read ON public.note_favorites;
CREATE POLICY note_favorites_own_read ON public.note_favorites
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.can_access('note', note_id, 'view'));
-- No INSERT/UPDATE/DELETE policies: writes go through the op.
-- Supabase's default privileges hand `authenticated` every table right; RLS
-- gates the DML but not TRUNCATE, so take the write rights back explicitly.
REVOKE ALL ON public.note_favorites FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.note_favorites FROM authenticated;
GRANT SELECT ON public.note_favorites TO authenticated;
GRANT ALL ON public.note_favorites TO service_role;

-- Someone who leaves a workspace takes their favorites with them (RLS would
-- only hide the rows, and they'd resurface on a re-invite). Account erasure
-- is covered by the auth.users cascade above.
CREATE OR REPLACE FUNCTION public.note_favorites__member_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.note_favorites
   WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.note_favorites__member_removed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS note_favorites_member_removed ON public.workspace_members;
CREATE TRIGGER note_favorites_member_removed
  AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.note_favorites__member_removed();

-- ── 3. Ops ───────────────────────────────────────────────────────────────────

-- A sub-note that follows its parent's sharing (`inherit`) has nothing to
-- follow once it becomes a root: can_access stops at a parentless inherit note
-- and only its creator and direct grants count, so everyone who reached it
-- through an ancestor would lose it. Before re-rooting, freeze what the chain
-- gave: copy each walked ancestor's member/workspace grants (highest level
-- wins) and give each walked ancestor's creator `full` (can_access ranks a
-- creator at every level it walks), then make the note `custom`. Public links
-- are not copied: a published ancestor doesn't publish a filed-away child.
CREATE OR REPLACE FUNCTION public.notes__keep_access_on_reroot(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_creator uuid;
  v_id uuid;
  v_parent uuid;
  v_mode text;
  v_creator uuid;
  v_guard int := 0;
BEGIN
  SELECT parent_id, created_by INTO v_id, v_self_creator
    FROM public.notes WHERE id = p_note_id AND workspace_id = p_workspace_id;
  IF NOT FOUND THEN RETURN; END IF;

  WHILE v_id IS NOT NULL AND v_guard < 100 LOOP
    v_guard := v_guard + 1;
    SELECT parent_id, coalesce(share_mode, 'custom'), created_by
      INTO v_parent, v_mode, v_creator
      FROM public.notes WHERE id = v_id;
    EXIT WHEN NOT FOUND;

    INSERT INTO public.resource_grants
      (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
    SELECT p_workspace_id, 'note', p_note_id, g.subject_type, g.subject_id, g.level,
           public.perm_actor_id()
      FROM public.resource_grants g
     WHERE g.resource_type = 'note' AND g.resource_id = v_id
       AND g.subject_type IN ('member', 'workspace')
    ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO UPDATE
      SET level = CASE
        WHEN public.grant_level_rank(EXCLUDED.level) > public.grant_level_rank(public.resource_grants.level)
        THEN EXCLUDED.level ELSE public.resource_grants.level END;

    IF v_creator IS NOT NULL AND v_creator IS DISTINCT FROM v_self_creator THEN
      INSERT INTO public.resource_grants
        (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
      VALUES (p_workspace_id, 'note', p_note_id, 'member', v_creator, 'full', public.perm_actor_id())
      ON CONFLICT (resource_type, resource_id, subject_type, subject_key) DO UPDATE
        SET level = 'full';
    END IF;

    EXIT WHEN v_mode IS DISTINCT FROM 'inherit' OR v_parent IS NULL;
    v_id := v_parent;
  END LOOP;

  UPDATE public.notes SET share_mode = 'custom' WHERE id = p_note_id;
END;
$$;
REVOKE ALL ON FUNCTION public.notes__keep_access_on_reroot(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__keep_access_on_reroot(uuid, uuid) TO service_role;

-- Move a note between the Inbox and Pages. Filing INTO the Inbox re-roots a
-- nested note (the Inbox only holds roots) without changing who can open it;
-- filing out keeps the note where it is in the tree. Attributed: filing is a
-- move.
CREATE OR REPLACE FUNCTION public.notes_op_file(
  p_workspace_id uuid,
  p_note_id uuid,
  p_in_inbox boolean,
  p_position text DEFAULT ''
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_was_inbox boolean;
  v_old_parent uuid;
BEGIN
  IF p_in_inbox IS NULL THEN
    RAISE EXCEPTION 'Say whether the note goes to the Inbox or to Pages.';
  END IF;
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  v_was_inbox := n.in_inbox;
  v_old_parent := n.parent_id;

  -- Re-rooting an inherit sub-note keeps everyone's access (see the helper).
  IF p_in_inbox AND n.parent_id IS NOT NULL AND coalesce(n.share_mode, 'custom') = 'inherit' THEN
    PERFORM public.notes__keep_access_on_reroot(p_workspace_id, n.id);
  END IF;

  UPDATE public.notes
     SET parent_id = CASE WHEN p_in_inbox THEN NULL ELSE parent_id END,
         in_inbox  = p_in_inbox,
         position  = coalesce(nullif(p_position, ''), position),
         updated_at = now()
   WHERE id = n.id
   RETURNING * INTO n;

  IF v_was_inbox IS DISTINCT FROM n.in_inbox OR v_old_parent IS DISTINCT FROM n.parent_id THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.file',
      jsonb_build_object(
        'to', CASE WHEN n.in_inbox THEN 'inbox' ELSE 'pages' END,
        'from_parent', v_old_parent));
  END IF;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_file(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_file(uuid, uuid, boolean, text) TO authenticated, service_role;

-- Add, reorder or remove one of the ACTOR's favorites. Personal, so no
-- activity row. Needs only view access (you can favorite what you can read).
-- A NULL position on add appends after the actor's last favorite.
CREATE OR REPLACE FUNCTION public.notes_op_set_favorite(
  p_workspace_id uuid,
  p_note_id uuid,
  p_value boolean,
  p_position text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := public.perm_actor_id();
  v_pos text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to keep favorites.';
  END IF;
  IF coalesce(public.notes_module_permission(p_workspace_id), 'none') NOT IN ('view', 'edit', 'admin') THEN
    RAISE EXCEPTION 'You do not have access to notes in this workspace.';
  END IF;

  IF NOT coalesce(p_value, false) THEN
    DELETE FROM public.note_favorites
     WHERE user_id = v_user AND note_id = p_note_id AND workspace_id = p_workspace_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notes
     WHERE id = p_note_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Note not found in this workspace.';
  END IF;
  IF NOT public.can_access('note', p_note_id, 'view') THEN
    RAISE EXCEPTION 'You do not have access to this note.';
  END IF;

  v_pos := nullif(p_position, '');
  IF v_pos IS NULL THEN
    -- A prefix sorts before any longer string that extends it, so appending
    -- one character to the current maximum always lands last. Compared by
    -- code point (COLLATE "C"), the order the client sorts favorites in.
    SELECT max(f.position COLLATE "C") || 'V' INTO v_pos
      FROM public.note_favorites f
     WHERE f.user_id = v_user AND f.workspace_id = p_workspace_id;
    v_pos := coalesce(v_pos, 'a0');
  END IF;

  INSERT INTO public.note_favorites (workspace_id, user_id, note_id, position)
  VALUES (p_workspace_id, v_user, p_note_id, v_pos)
  ON CONFLICT (user_id, note_id) DO UPDATE
    SET position = CASE WHEN p_position IS NULL OR p_position = ''
                        THEN public.note_favorites.position
                        ELSE excluded.position END;
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_set_favorite(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_set_favorite(uuid, uuid, boolean, text) TO authenticated, service_role;

-- set_meta: + `fullWidth` (same signature → grants kept). No activity row,
-- same as icon/pin: presentation, not an invariant.
CREATE OR REPLACE FUNCTION public.notes_op_set_meta(
  p_workspace_id uuid,
  p_note_id uuid,
  p_patch jsonb
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  UPDATE public.notes SET
    icon = CASE WHEN p_patch ? 'icon'
      THEN nullif(p_patch ->> 'icon', '') ELSE icon END,
    is_pinned = CASE WHEN p_patch ? 'isPinned'
      THEN coalesce((p_patch ->> 'isPinned')::boolean, false) ELSE is_pinned END,
    full_width = CASE WHEN p_patch ? 'fullWidth'
      THEN coalesce((p_patch ->> 'fullWidth')::boolean, false) ELSE full_width END,
    updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  IF p_patch ? 'icon' THEN
    PERFORM public.entities_op_upsert(
      p_workspace_id, 'note', n.id,
      coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  END IF;
  RETURN n;
END;
$$;

-- duplicate: the copy stays in its source's section (a duplicated page is a
-- page, not a fresh capture) and is attributed to the actor, so an API key's
-- duplicate is owned by the key's creator like every other key write.
-- Rebuilt from PROD's body, not the repo's 20260703 one: prod carries
-- 20261008130000_definer_reads_item_visibility (on `maciej`, applied
-- 2026-10-08), which added the can-open check below. Keep it.
CREATE OR REPLACE FUNCTION public.notes_op_duplicate(
  p_workspace_id uuid,
  p_source_note_id uuid,
  p_position text DEFAULT ''
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src public.notes;
  n public.notes;
BEGIN
  -- The copy carries the whole note, so only from a note the caller can open.
  -- Checked before the guard reads (and locks) the row, so a hidden note gets
  -- the same answer as a missing one, trashed or not.
  PERFORM public.notes_op__guard(p_workspace_id);
  IF NOT coalesce(public.can_access('note', p_source_note_id, 'view'), false) THEN
    RAISE EXCEPTION 'Note not found in this workspace.';
  END IF;
  src := public.notes_op__guard_note(p_workspace_id, p_source_note_id);
  INSERT INTO public.notes
    (workspace_id, created_by, parent_id, title, icon, kind, position,
     doc_state, doc_version, body_text, body_md, in_inbox, full_width)
  VALUES
    (p_workspace_id, public.perm_actor_id(), src.parent_id,
     CASE WHEN btrim(src.title) = '' THEN '' ELSE src.title || ' (copy)' END,
     src.icon, 'note', coalesce(nullif(p_position, ''), src.position),
     src.doc_state, src.doc_version, src.body_text, src.body_md,
     src.in_inbox, src.full_width)
  RETURNING * INTO n;

  -- The un-compacted update tail is part of the doc — copy it or the
  -- duplicate silently lacks everything typed since the last compaction.
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
  SELECT u.workspace_id, n.id, u.client_id, u.client_seq, u.update_b64
    FROM public.note_updates u WHERE u.note_id = src.id;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.duplicate',
    jsonb_build_object('source_note_id', src.id, 'title', n.title));
  RETURN n;
END;
$$;

-- import: + per-row `inInbox`. Absent → NULL → the trigger decides (a root is
-- a capture, so an MCP-created root lands in the Inbox); the wizard sends
-- `false` to file a Notion export straight into Pages.
CREATE OR REPLACE FUNCTION public.notes_op_import(
  p_workspace_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_id uuid;
  v_first uuid;
  v_imported integer := 0;
  v_skipped integer := 0;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import rows must be an array.';
  END IF;

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
$$;

-- ── 4. Every re-root keeps access; every create has a creator ────────────────
--
-- The same freeze `notes_op_file` does, for the three older paths that put a
-- sub-note at the top level (moving it there, restoring it while its parent
-- stays in the trash, deleting its parent forever). Each was hiding a shared
-- sub-note from everyone but its creator. Bodies rebuilt from PROD's, with the
-- helper call the only change. Same signatures, so grants are kept.

CREATE OR REPLACE FUNCTION public.notes_op_move(
  p_workspace_id uuid,
  p_note_id uuid,
  p_parent_id uuid DEFAULT NULL,
  p_position text DEFAULT ''
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_old_parent uuid;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  v_old_parent := n.parent_id;

  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notes
      WHERE id = p_parent_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Target parent not found in this workspace.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.notes__subtree_ids(p_workspace_id, p_note_id) s
      WHERE s = p_parent_id
    ) THEN
      RAISE EXCEPTION 'A note cannot be moved into its own subtree.';
    END IF;
  END IF;

  IF p_parent_id IS NULL AND v_old_parent IS NOT NULL
     AND coalesce(n.share_mode, 'custom') = 'inherit' THEN
    PERFORM public.notes__keep_access_on_reroot(p_workspace_id, n.id);
  END IF;

  UPDATE public.notes
    SET parent_id = p_parent_id,
        position = coalesce(p_position, ''),
        updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;

  IF v_old_parent IS DISTINCT FROM p_parent_id THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.move',
      jsonb_build_object('from_parent', v_old_parent, 'to_parent', p_parent_id));
  END IF;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notes_op_restore(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_ids uuid[];
  v_id uuid;
  v_reroot boolean := false;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id, true);
  IF n.deleted_at IS NULL THEN
    RAISE EXCEPTION 'This note is not in the trash.';
  END IF;

  SELECT array_agg(t.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
    WHERE nn.id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND nn.deleted_at IS NOT NULL
  ) t;

  IF n.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.notes p
    WHERE p.id = n.parent_id AND p.workspace_id = p_workspace_id AND p.deleted_at IS NULL
  ) THEN
    v_reroot := true;
  END IF;

  UPDATE public.notes
    SET deleted_at = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
  IF v_reroot THEN
    IF coalesce(n.share_mode, 'custom') = 'inherit' THEN
      PERFORM public.notes__keep_access_on_reroot(p_workspace_id, n.id);
    END IF;
    UPDATE public.notes SET parent_id = NULL
      WHERE workspace_id = p_workspace_id AND id = n.id;
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM public.entities_op_upsert(
      p_workspace_id, 'note', v_id,
      (SELECT coalesce(nullif(btrim(nn.title), ''), 'Untitled')
         FROM public.notes nn WHERE nn.id = v_id), 'note');
  END LOOP;

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.restore',
    jsonb_build_object('title', n.title, 'count', coalesce(array_length(v_ids, 1), 0)));

  RETURN jsonb_build_object(
    'restored_ids', to_jsonb(coalesce(v_ids, '{}'::uuid[])),
    'count', coalesce(array_length(v_ids, 1), 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.notes__purge_ids(
  p_workspace_id uuid,
  p_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_gone uuid[] := '{}';
  v_batch uuid[];
  v_survivor uuid;
BEGIN
  -- Lock what we're about to delete: a Restore of one of these notes now waits
  -- for this purge (then finds no note), or wins first and the note isn't
  -- collected. Without the lock a Restore could land between the history
  -- delete and the note delete, and the note would survive without its history.
  -- Id order keeps two overlapping purges from locking in opposite orders.
  SELECT array_agg(s.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
      WHERE nn.workspace_id = p_workspace_id
        AND nn.id = ANY (coalesce(p_ids, '{}'::uuid[]))
        AND nn.deleted_at IS NOT NULL
      ORDER BY nn.id
      FOR UPDATE
  ) s;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- Live survivors that follow a parent being deleted keep their access first
  -- (NR-1): the parent's grants are about to disappear with it.
  FOR v_survivor IN
    SELECT nn.id FROM public.notes nn
     WHERE nn.workspace_id = p_workspace_id
       AND nn.deleted_at IS NULL
       AND nn.parent_id = ANY (v_ids)
       AND coalesce(nn.share_mode, 'custom') = 'inherit'
     ORDER BY nn.id
  LOOP
    PERFORM public.notes__keep_access_on_reroot(p_workspace_id, v_survivor);
  END LOOP;

  -- Re-root live survivors so the hard delete can't strand or cascade them.
  UPDATE public.notes
    SET parent_id = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND parent_id = ANY (v_ids);

  -- History before its notes: perm_enforce_write on note_updates checks access
  -- through the note, which the FK cascade would only reach once it's gone.
  DELETE FROM public.note_updates u
    WHERE u.workspace_id = p_workspace_id
      AND u.note_id IN (SELECT nn.id FROM public.notes nn
                        WHERE nn.id = ANY (v_ids) AND nn.deleted_at IS NOT NULL);

  -- Leaves first: perm_enforce_write's access check reads a sub-note's access
  -- through its parent, which must still be there. Only rows still in the trash.
  LOOP
    WITH d AS (
      DELETE FROM public.notes nn
        WHERE nn.workspace_id = p_workspace_id
          AND nn.id = ANY (v_ids)
          AND nn.deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.notes ch
            WHERE ch.parent_id = nn.id AND ch.id = ANY (v_ids))
        RETURNING nn.id
    )
    SELECT array_agg(d.id) INTO v_batch FROM d;
    EXIT WHEN v_batch IS NULL;
    v_gone := v_gone || v_batch;
  END LOOP;

  -- Trashed rows left with no leaf among them sit in a parent cycle. Break it
  -- (re-rooting anything restored meanwhile too), then delete the trashed ones.
  IF EXISTS (SELECT 1 FROM public.notes
             WHERE workspace_id = p_workspace_id AND id = ANY (v_ids)
               AND deleted_at IS NOT NULL) THEN
    UPDATE public.notes
      SET parent_id = NULL, updated_at = now()
      WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
    WITH d AS (
      DELETE FROM public.notes
        WHERE workspace_id = p_workspace_id AND id = ANY (v_ids)
          AND deleted_at IS NOT NULL
        RETURNING id
    )
    SELECT v_gone || coalesce(array_agg(d.id), '{}'::uuid[]) INTO v_gone FROM d;
  END IF;

  IF cardinality(v_gone) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'note' AND source_id = ANY (v_gone))
        OR (target_type = 'note' AND target_id = ANY (v_gone)));

  -- Registry tombstones inline (see notes_op_trash for why not
  -- entities_op_tombstone).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id AND entity_type = 'note'
      AND entity_id = ANY (v_gone) AND deleted_at IS NULL;

  RETURN cardinality(v_gone);
END;
$$;

-- create: the creator is the actor (the signed-in person, or the API key's
-- creator) — `auth.uid()` is NULL under a key, which left MCP-created notes
-- with no owner.
CREATE OR REPLACE FUNCTION public.notes_op_create(
  p_workspace_id uuid,
  p_id uuid DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL,
  p_title text DEFAULT '',
  p_position text DEFAULT '',
  p_icon text DEFAULT NULL
)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notes
      WHERE id = p_parent_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Parent note not found in this workspace.';
    END IF;
  END IF;
  INSERT INTO public.notes
    (id, workspace_id, created_by, parent_id, title, icon, kind, position)
  VALUES
    (coalesce(p_id, gen_random_uuid()), p_workspace_id, public.perm_actor_id(), p_parent_id,
     coalesce(p_title, ''), p_icon, 'note', coalesce(p_position, ''))
  RETURNING * INTO n;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  RETURN n;
END;
$$;

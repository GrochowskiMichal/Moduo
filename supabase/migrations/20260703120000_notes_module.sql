-- Wave 3 · Notes rebuild · NO-1 — schema + intent ops (specs/notes.md).
--
-- The prod `notes` table is pre-migrations-era (client-direct writes, unknown
-- dashboard-created policies). CAL-2 pattern: extend IN PLACE, drop every
-- legacy policy by pg_policies loop, re-post RLS as member-SELECT + op-only
-- writes. Highlights:
--   - Derived `body_text` / `body_md` are CLIENT-written on save — the editor
--     is the only faithful CRDT serializer; the server never parses Yjs.
--   - `search_tsv` is a generated column over title + body_text using the
--     'simple' config (designer writes Polish AND English — no stemming beats
--     wrong-language stemming).
--   - New `note_updates`: append-only CRDT update log, idempotent by
--     (note_id, client_id, client_seq). Yjs can't merge in plpgsql, so
--     compaction is client-driven via notes_op_save_snapshot.
--   - `notes_module_permission` includes the api-key branch (scopes->>'notes')
--     FROM DAY ONE — the three-module gotcha (see 20260702170000).
--   - Kind backfill: category/folder retire; everything is a note.
--
-- ⚠ DEPLOY GATE: DO NOT APPLY BEFORE THE NO-3 CODE SHIPS. This migration
-- drops the client-direct write policies the LEGACY notes editor still uses —
-- once applied, the old editor's doc saves are RLS-filtered to 0 rows
-- *silently*. Apply only after the Wave-3 notes page (NO-1..NO-3, one branch)
-- is deployed; the new code degrades gracefully in the other direction.

-- ── 1 · Extend `notes` in place ───────────────────────────────────────────────

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS body_text     text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS body_md       text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS doc_version   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_at  timestamptz,
  ADD COLUMN IF NOT EXISTS publish_token text;

-- Generated FTS column. 'simple' keeps PL/EN both searchable; body capped so a
-- pathological doc can't overflow the tsvector limit.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', left(coalesce(body_text, ''), 150000)), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS notes_search_tsv_idx
  ON public.notes USING gin (search_tsv);
CREATE UNIQUE INDEX IF NOT EXISTS notes_publish_token_key
  ON public.notes (publish_token) WHERE publish_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_workspace_live_idx
  ON public.notes (workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS notes_parent_idx
  ON public.notes (parent_id) WHERE parent_id IS NOT NULL;

-- Everything is a note: category/folder kinds retire (DESIGN_BRIEF §1.2).
UPDATE public.notes SET kind = 'note' WHERE kind IS DISTINCT FROM 'note';

-- One-time legacy normalization: the old editor soft-deleted single rows, so
-- prod can hold LIVE notes under trashed parents. Re-root them once so the
-- subtree ops' invariant ("no live child under a trashed parent") holds for
-- pre-migration data too — without this, the first purge sweep could take
-- live descendants down with an expired parent.
UPDATE public.notes n SET parent_id = NULL
WHERE n.deleted_at IS NULL
  AND n.parent_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.notes p
    WHERE p.id = n.parent_id AND p.deleted_at IS NOT NULL
  );

-- ── 2 · note_updates — the append-only CRDT update log ──────────────────────

CREATE TABLE public.note_updates (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  note_id      uuid NOT NULL REFERENCES public.notes (id) ON DELETE CASCADE,
  client_id    text NOT NULL,
  client_seq   integer NOT NULL,
  update_b64   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Idempotent outbox pushes: a replayed batch upserts nothing twice.
  UNIQUE (note_id, client_id, client_seq)
);

CREATE INDEX note_updates_note_cursor_idx ON public.note_updates (note_id, id);

ALTER TABLE public.note_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY note_updates_workspace_read ON public.note_updates
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));
-- No INSERT/UPDATE/DELETE policies: writes go through notes_op_* only.

-- ── 3 · RLS rework on notes: member SELECT, op-only writes ──────────────────

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notes'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.notes', pol.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_workspace_read ON public.notes
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));

-- ── 4 · Permission fn (WITH the api-key branch) + guards ────────────────────

CREATE OR REPLACE FUNCTION public.notes_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_key uuid;
BEGIN
  v_key := public.module_api_key_id();
  IF v_key IS NOT NULL THEN
    RETURN coalesce((
      SELECT CASE lower(coalesce(k.scopes ->> 'notes', 'none'))
        WHEN 'edit' THEN 'edit'
        WHEN 'view' THEN 'view'
        ELSE 'none'
      END
      FROM public.workspace_api_keys k
      WHERE k.id = v_key AND k.workspace_id = p_workspace_id
        AND k.revoked_at IS NULL
    ), 'none');
  END IF;
  RETURN (SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(m.permissions_notes, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END);
END;
$$;

CREATE OR REPLACE FUNCTION public.notes_op__guard(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.notes_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You do not have edit access to notes in this workspace.';
  END IF;
END;
$$;

-- Lock + fetch a workspace-scoped note row. Trashed rows are rejected unless
-- the op explicitly works on trash (restore/purge).
CREATE OR REPLACE FUNCTION public.notes_op__guard_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_include_trashed boolean DEFAULT false
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
  SELECT * INTO n FROM public.notes
    WHERE id = p_note_id AND workspace_id = p_workspace_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found in this workspace.';
  END IF;
  IF NOT p_include_trashed AND n.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This note is in the trash.';
  END IF;
  RETURN n;
END;
$$;

-- The subtree of a note (the note itself included), depth-capped so corrupt
-- legacy data (a pre-existing cycle) can never hang an op.
CREATE OR REPLACE FUNCTION public.notes__subtree_ids(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH RECURSIVE sub AS (
    SELECT n.id, 1 AS depth FROM public.notes n
      WHERE n.id = p_note_id AND n.workspace_id = p_workspace_id
    UNION ALL
    SELECT n.id, sub.depth + 1 FROM public.notes n
      JOIN sub ON n.parent_id = sub.id
      WHERE n.workspace_id = p_workspace_id
        AND sub.depth < 100
  )
  SELECT DISTINCT id FROM sub;
$$;

-- ── 5 · Intent ops ───────────────────────────────────────────────────────────

-- notes.create — capture. Client may pre-generate the id (optimistic <200ms
-- capture) and computes the fractional position among its siblings. No
-- activity row: creation is self-evident from the row (module contract).
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
    (coalesce(p_id, gen_random_uuid()), p_workspace_id, auth.uid(), p_parent_id,
     coalesce(p_title, ''), p_icon, 'note', coalesce(p_position, ''))
  RETURNING * INTO n;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  RETURN n;
END;
$$;

-- notes.rename — continuous first-line edits: registry upsert, NO activity row
-- (module contract's plain-edit carve-out; spec assumption 7).
CREATE OR REPLACE FUNCTION public.notes_op_rename(
  p_workspace_id uuid,
  p_note_id uuid,
  p_title text
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
  UPDATE public.notes
    SET title = coalesce(p_title, ''), updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  RETURN n;
END;
$$;

-- notes.move — reparent/reorder. The cycle guard is THE invariant: a note can
-- never move under its own descendant (quiet client no-op on the raise).
-- Activity only on a real reparent — same-parent reorders are drag noise.
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

-- notes.set_meta — icon / pin. camelCase jsonb patch, key-present = apply
-- (CAL-2 convention). Cosmetic: no activity row.
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

-- notes.duplicate — single note (not subtree; "duplicate this note" is the
-- ratified affordance, a template SYSTEM is a non-goal).
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
  src := public.notes_op__guard_note(p_workspace_id, p_source_note_id);
  INSERT INTO public.notes
    (workspace_id, created_by, parent_id, title, icon, kind, position,
     doc_state, doc_version, body_text, body_md)
  VALUES
    (p_workspace_id, auth.uid(), src.parent_id,
     CASE WHEN btrim(src.title) = '' THEN '' ELSE src.title || ' (copy)' END,
     src.icon, 'note', coalesce(nullif(p_position, ''), src.position),
     src.doc_state, src.doc_version, src.body_text, src.body_md)
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

-- notes.archive / notes.unarchive — the flag lives on the ROOT of the gesture;
-- descendants follow by ancestry (computed client-side), so unarchive is
-- always a clean inverse.
CREATE OR REPLACE FUNCTION public.notes_op_archive(
  p_workspace_id uuid,
  p_note_id uuid
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
  UPDATE public.notes SET is_archived = true, updated_at = now()
    WHERE id = n.id RETURNING * INTO n;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.archive',
    jsonb_build_object('title', n.title));
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notes_op_unarchive(
  p_workspace_id uuid,
  p_note_id uuid
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
  UPDATE public.notes SET is_archived = false, updated_at = now()
    WHERE id = n.id RETURNING * INTO n;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.unarchive',
    jsonb_build_object('title', n.title));
  RETURN n;
END;
$$;

-- notes.trash — soft-delete the SUBTREE in one gesture (restorable, 30d
-- window). Registry entries tombstone so trashed notes leave search/@mention;
-- links stay (restore keeps context). Returns the affected ids for undo UI.
CREATE OR REPLACE FUNCTION public.notes_op_trash(
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
  v_now timestamptz := now();
  v_ids uuid[];
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);

  SELECT array_agg(t.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
    WHERE nn.id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND nn.deleted_at IS NULL
  ) t;

  UPDATE public.notes
    SET deleted_at = v_now, updated_at = v_now
    WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);

  -- Registry tombstones inline: entities_op_tombstone re-guards through the
  -- LINKS permission lane, which would reject an api key scoped notes-only.
  -- The notes guard already ran; this op is the authority here.
  UPDATE public.entities
    SET deleted_at = v_now, updated_at = v_now
    WHERE workspace_id = p_workspace_id AND entity_type = 'note'
      AND entity_id = ANY (v_ids) AND deleted_at IS NULL;

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.trash',
    jsonb_build_object('title', n.title, 'count', coalesce(array_length(v_ids, 1), 0)));

  RETURN jsonb_build_object(
    'trashed_ids', to_jsonb(coalesce(v_ids, '{}'::uuid[])),
    'count', coalesce(array_length(v_ids, 1), 0));
END;
$$;

-- notes.restore — clears the subtree's trash stamps. If the restored root's
-- own parent is gone/trashed it re-roots (parent_id = NULL) so it can't
-- restore into an invisible spot.
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

-- Shared purge core: hard-delete a set of TRASHED note ids (their
-- note_updates go via FK CASCADE), drop live links, keep registry tombstones
-- (chips render the standard tombstone treatment). Live rows are NEVER
-- deleted here — the set is re-filtered defensively, and any live child
-- still pointing at a purged id re-roots first (legacy data can hold live
-- children under trashed parents).
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
  v_count integer;
BEGIN
  SELECT array_agg(nn.id) INTO v_ids FROM public.notes nn
    WHERE nn.workspace_id = p_workspace_id
      AND nn.id = ANY (coalesce(p_ids, '{}'::uuid[]))
      AND nn.deleted_at IS NOT NULL;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- Re-root live survivors so the hard delete can't strand or cascade them.
  UPDATE public.notes
    SET parent_id = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND parent_id = ANY (v_ids);

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'note' AND source_id = ANY (v_ids))
        OR (target_type = 'note' AND target_id = ANY (v_ids)));

  -- Registry tombstones inline (see notes_op_trash for why not
  -- entities_op_tombstone).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id AND entity_type = 'note'
      AND entity_id = ANY (v_ids) AND deleted_at IS NULL;

  DELETE FROM public.notes
    WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- notes.purge — "Delete forever" on one trashed subtree.
CREATE OR REPLACE FUNCTION public.notes_op_purge(
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
  v_count integer;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id, true);
  IF n.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Only trashed notes can be deleted forever.';
  END IF;

  SELECT array_agg(s) INTO v_ids
    FROM public.notes__subtree_ids(p_workspace_id, p_note_id) s;
  -- notes__purge_ids re-filters to trashed rows and re-roots live children.
  v_count := public.notes__purge_ids(p_workspace_id, v_ids);

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.purge',
    jsonb_build_object('title', n.title, 'count', v_count));
  RETURN jsonb_build_object('count', v_count);
END;
$$;

-- notes.purge_expired — the client-triggered 30-day sweep (module-load pass,
-- like tasks_op_catch_up; no pg_cron dependency).
CREATE OR REPLACE FUNCTION public.notes_op_purge_expired(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root uuid;
  v_ids uuid[];
  v_all uuid[] := '{}';
  v_count integer := 0;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  FOR v_root IN
    SELECT id FROM public.notes
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
  LOOP
    IF v_root = ANY (v_all) THEN CONTINUE; END IF;
    SELECT array_agg(s) INTO v_ids
      FROM public.notes__subtree_ids(p_workspace_id, v_root) s;
    v_all := v_all || v_ids;
    v_count := v_count + public.notes__purge_ids(p_workspace_id, v_ids);
  END LOOP;

  IF v_count > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note',
      '00000000-0000-0000-0000-000000000000'::uuid, 'notes.purge_expired',
      jsonb_build_object('count', v_count));
  END IF;
  RETURN jsonb_build_object('count', v_count);
END;
$$;

-- notes.publish / notes.unpublish — revocable read-only public link.
-- Re-publishing while already published keeps the live token (links keep
-- working); unpublish clears BOTH published_at and the token, so the next
-- publish mints a fresh token and every old URL 404s instantly.
CREATE OR REPLACE FUNCTION public.notes_op_publish(
  p_workspace_id uuid,
  p_note_id uuid
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
  UPDATE public.notes
    SET published_at = now(),
        publish_token = coalesce(publish_token, encode(extensions.gen_random_bytes(16), 'hex')),
        updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.publish',
    jsonb_build_object('title', n.title));
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notes_op_unpublish(
  p_workspace_id uuid,
  p_note_id uuid
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
  UPDATE public.notes
    SET published_at = NULL, publish_token = NULL, updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.unpublish',
    jsonb_build_object('title', n.title));
  RETURN n;
END;
$$;

-- notes.apply_updates — the outbox push. Batched CRDT updates, idempotent by
-- (note_id, client_id, client_seq); derived body_text/body_md ride along when
-- the client serialized them. NO activity row (continuous edits). Locks the
-- note row, so pushes and compactions serialize.
CREATE OR REPLACE FUNCTION public.notes_op_apply_updates(
  p_workspace_id uuid,
  p_note_id uuid,
  p_client_id text,
  p_updates jsonb,
  p_body_text text DEFAULT NULL,
  p_body_md text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  r record;
  v_inserted integer := 0;
  v_duplicate integer := 0;
  v_max_id bigint;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'A client id is required.';
  END IF;

  IF p_updates IS NOT NULL AND jsonb_typeof(p_updates) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
      IF (r.value ->> 'clientSeq') IS NULL OR (r.value ->> 'updateB64') IS NULL THEN
        RAISE EXCEPTION 'Each update needs clientSeq and updateB64.';
      END IF;
      INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
      VALUES (p_workspace_id, n.id, p_client_id,
              (r.value ->> 'clientSeq')::integer, r.value ->> 'updateB64')
      ON CONFLICT (note_id, client_id, client_seq) DO NOTHING;
      IF FOUND THEN
        v_inserted := v_inserted + 1;
      ELSE
        v_duplicate := v_duplicate + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.notes SET
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md),
    updated_at = now()
    WHERE id = n.id;

  SELECT max(u.id) INTO v_max_id FROM public.note_updates u WHERE u.note_id = n.id;
  RETURN jsonb_build_object(
    'inserted', v_inserted, 'duplicates', v_duplicate, 'max_update_id', v_max_id);
END;
$$;

-- notes.save_snapshot — client-driven compaction: fold the update log (up to
-- an id the CLIENT has provably applied) into the snapshot. No activity row.
CREATE OR REPLACE FUNCTION public.notes_op_save_snapshot(
  p_workspace_id uuid,
  p_note_id uuid,
  p_snapshot_b64 text,
  p_upto_update_id bigint,
  p_body_text text DEFAULT NULL,
  p_body_md text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_folded integer;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  IF p_snapshot_b64 IS NULL OR p_snapshot_b64 = '' THEN
    RAISE EXCEPTION 'A snapshot is required.';
  END IF;

  DELETE FROM public.note_updates
    WHERE note_id = n.id AND id <= coalesce(p_upto_update_id, 0);
  GET DIAGNOSTICS v_folded = ROW_COUNT;

  UPDATE public.notes SET
    doc_state = p_snapshot_b64,
    doc_version = doc_version + 1,
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md),
    updated_at = now()
    WHERE id = n.id;

  RETURN jsonb_build_object('folded', v_folded, 'doc_version', n.doc_version + 1);
END;
$$;

-- notes.import — batched tree import (md-zip wizard, the one-time redb
-- migration). Client pre-generates ids so parent refs hold; idempotent per
-- row (an existing id = skipped, so a re-run never duplicates). Per-row
-- exception isolation: one malformed row can't wedge the batch.
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
         doc_state, body_text, body_md)
      VALUES
        (v_id, p_workspace_id, auth.uid(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
         'note',
         coalesce(r.value ->> 'position', ''),
         nullif(r.value ->> 'docStateB64', ''),
         coalesce(r.value ->> 'bodyText', ''),
         coalesce(r.value ->> 'bodyMd', ''));
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

-- notes.mention — an @mention in a note body notifies the mentioned people.
-- The activity row IS the feature: `mentioned_user_ids` (text array, matching
-- spine_activity_targets_me) makes it land in their notification feed.
CREATE OR REPLACE FUNCTION public.notes_op_mention(
  p_workspace_id uuid,
  p_note_id uuid,
  p_mentioned_user_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);
  IF p_mentioned_user_ids IS NULL OR array_length(p_mentioned_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.mention',
    jsonb_build_object(
      'title', n.title,
      'mentioned_user_ids',
      (SELECT jsonb_agg(u::text) FROM unnest(p_mentioned_user_ids) u)));
END;
$$;

-- ── 6 · Registry backfill: every live note becomes searchable/@mention-able ─

INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon, updated_at)
SELECT n.workspace_id, 'note', n.id,
       coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note', now()
FROM public.notes n
WHERE n.deleted_at IS NULL
ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE
  SET label = excluded.label, deleted_at = NULL, updated_at = now();

-- ── 7 · Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'notes_module_permission(uuid)',
    'notes_op_create(uuid, uuid, uuid, text, text, text)',
    'notes_op_rename(uuid, uuid, text)',
    'notes_op_move(uuid, uuid, uuid, text)',
    'notes_op_set_meta(uuid, uuid, jsonb)',
    'notes_op_duplicate(uuid, uuid, text)',
    'notes_op_archive(uuid, uuid)',
    'notes_op_unarchive(uuid, uuid)',
    'notes_op_trash(uuid, uuid)',
    'notes_op_restore(uuid, uuid)',
    'notes_op_purge(uuid, uuid)',
    'notes_op_purge_expired(uuid)',
    'notes_op_publish(uuid, uuid)',
    'notes_op_unpublish(uuid, uuid)',
    'notes_op_apply_updates(uuid, uuid, text, jsonb, text, text)',
    'notes_op_save_snapshot(uuid, uuid, text, bigint, text, text)',
    'notes_op_import(uuid, jsonb)',
    'notes_op_mention(uuid, uuid, uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    -- The MCP connector calls as service_role (NO-10's notes tools).
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;

-- Internal helpers stay callable only via the ops (definer context), never
-- directly by clients.
REVOKE ALL ON FUNCTION public.notes_op__guard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes_op__guard(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.notes_op__guard(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.notes_op__guard_note(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes_op__guard_note(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.notes__subtree_ids(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes__subtree_ids(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.notes__purge_ids(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notes__purge_ids(uuid, uuid[]) FROM anon;

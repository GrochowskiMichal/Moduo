-- NS-5 · Lean meta results (specs/notes-schema-hardening.md, AC6, Assumption 5).
--
-- The ten Notes meta ops (create, rename, move, set_meta, duplicate, file,
-- archive, unarchive, publish, unpublish) returned the whole public.notes row:
-- doc_state, body_text, body_md and search_tsv included. No caller adds a
-- select, so every rename while someone types a title shipped the whole
-- document, which the app's Zod schema then threw away. They now return
-- public.notes_meta: exactly the columns noteRowSchema reads
-- (supabase/functions/_shared/contracts/rows.ts), so the app, the MCP
-- connector and any other caller get the lean row. Every column an older app
-- build reads is kept, so an open tab keeps working against this database.
--
-- Bodies are the live ones (prod's pg_get_functiondef, which match their latest
-- migrations: 20260703120000, 20260704120000, 20261013120000, 20261020141000);
-- the only change is RETURNS and the final RETURN through notes__meta. A
-- changed return type needs DROP + CREATE, which resets grants, so each op
-- re-states them (authenticated and service_role, never anon or PUBLIC).
-- is_pinned stays until NS-9 removes it everywhere at once.
--
-- Re-runnable: the ops and the helper are dropped before the type.
-- Tests: supabase/tests/notes_meta_returns.test.sql,
-- apps/app/src/lib/runtime.web.notes.test.ts ("meta results still map").

DROP FUNCTION IF EXISTS public.notes_op_create(uuid, uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.notes_op_rename(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.notes_op_move(uuid, uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.notes_op_set_meta(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.notes_op_duplicate(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.notes_op_file(uuid, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.notes_op_archive(uuid, uuid);
DROP FUNCTION IF EXISTS public.notes_op_unarchive(uuid, uuid);
DROP FUNCTION IF EXISTS public.notes_op_publish(uuid, uuid);
DROP FUNCTION IF EXISTS public.notes_op_unpublish(uuid, uuid);
DROP FUNCTION IF EXISTS public.notes__meta(public.notes);
DROP TYPE IF EXISTS public.notes_meta;

-- In noteRowSchema's order. A column the app starts reading goes here too
-- (runtime.web.notes.test.ts compares the two).
CREATE TYPE public.notes_meta AS (
  id uuid,
  workspace_id uuid,
  created_by uuid,
  parent_id uuid,
  title text,
  icon text,
  is_pinned boolean,
  position text,
  is_archived boolean,
  published_at timestamptz,
  publish_token text,
  doc_version integer,
  share_mode text,
  workspace_shared boolean,
  in_inbox boolean,
  full_width boolean,
  edited_by uuid,
  edited_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
);
COMMENT ON TYPE public.notes_meta IS
  'NS-5: a note without doc_state and bodies; what the Notes meta ops return.';

-- The meta columns of a notes row. Pure: it reads only its argument.
CREATE FUNCTION public.notes__meta(n public.notes)
RETURNS public.notes_meta
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT n.id, n.workspace_id, n.created_by, n.parent_id, n.title, n.icon, n.is_pinned,
         n.position, n.is_archived, n.published_at, n.publish_token, n.doc_version,
         n.share_mode, n.workspace_shared, n.in_inbox, n.full_width, n.edited_by,
         n.edited_at, n.created_at, n.updated_at, n.deleted_at
$$;
REVOKE ALL ON FUNCTION public.notes__meta(public.notes) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__meta(public.notes) TO service_role;

CREATE FUNCTION public.notes_op_create(
  p_workspace_id uuid,
  p_id uuid DEFAULT NULL::uuid,
  p_parent_id uuid DEFAULT NULL::uuid,
  p_title text DEFAULT ''::text,
  p_position text DEFAULT ''::text,
  p_icon text DEFAULT NULL::text
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_create(p_workspace_id uuid, p_id uuid, p_parent_id uuid, p_title text, p_position text, p_icon text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_create(p_workspace_id uuid, p_id uuid, p_parent_id uuid, p_title text, p_position text, p_icon text) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_rename(
  p_workspace_id uuid,
  p_note_id uuid,
  p_title text
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_rename(p_workspace_id uuid, p_note_id uuid, p_title text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_rename(p_workspace_id uuid, p_note_id uuid, p_title text) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_move(
  p_workspace_id uuid,
  p_note_id uuid,
  p_parent_id uuid DEFAULT NULL::uuid,
  p_position text DEFAULT ''::text,
  p_follow_parent boolean DEFAULT false
)
RETURNS public.notes_meta
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

  -- New here: follow the new parent's sharing in the same transaction.
  IF coalesce(p_follow_parent, false) AND p_parent_id IS NOT NULL THEN
    PERFORM public.share_op_follow_parent(n.id);
    SELECT * INTO n FROM public.notes WHERE id = n.id;
  END IF;

  IF v_old_parent IS DISTINCT FROM p_parent_id THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.move',
      jsonb_build_object('from_parent', v_old_parent, 'to_parent', p_parent_id));
  END IF;
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_move(p_workspace_id uuid, p_note_id uuid, p_parent_id uuid, p_position text, p_follow_parent boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_move(p_workspace_id uuid, p_note_id uuid, p_parent_id uuid, p_position text, p_follow_parent boolean) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_set_meta(
  p_workspace_id uuid,
  p_note_id uuid,
  p_patch jsonb
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_set_meta(p_workspace_id uuid, p_note_id uuid, p_patch jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_set_meta(p_workspace_id uuid, p_note_id uuid, p_patch jsonb) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_duplicate(
  p_workspace_id uuid,
  p_source_note_id uuid,
  p_position text DEFAULT ''::text
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_duplicate(p_workspace_id uuid, p_source_note_id uuid, p_position text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_duplicate(p_workspace_id uuid, p_source_note_id uuid, p_position text) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_file(
  p_workspace_id uuid,
  p_note_id uuid,
  p_in_inbox boolean,
  p_position text DEFAULT ''::text
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_file(p_workspace_id uuid, p_note_id uuid, p_in_inbox boolean, p_position text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_file(p_workspace_id uuid, p_note_id uuid, p_in_inbox boolean, p_position text) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_archive(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS public.notes_meta
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notes;
  v_unpublished integer := 0;
BEGIN
  n := public.notes_op__guard_note(p_workspace_id, p_note_id);

  UPDATE public.notes SET is_archived = true, updated_at = now()
    WHERE id = n.id RETURNING * INTO n;

  UPDATE public.notes
    SET published_at = NULL, publish_token = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND published_at IS NOT NULL;
  GET DIAGNOSTICS v_unpublished = ROW_COUNT;

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.archive',
    jsonb_build_object('title', n.title, 'unpublished', v_unpublished));
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_archive(p_workspace_id uuid, p_note_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_archive(p_workspace_id uuid, p_note_id uuid) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_unarchive(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_unarchive(p_workspace_id uuid, p_note_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_unarchive(p_workspace_id uuid, p_note_id uuid) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_publish(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;
$$;
REVOKE ALL ON FUNCTION public.notes_op_publish(p_workspace_id uuid, p_note_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_publish(p_workspace_id uuid, p_note_id uuid) TO authenticated, service_role;

CREATE FUNCTION public.notes_op_unpublish(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS public.notes_meta
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
  RETURN public.notes__meta(n);
END;$$;
REVOKE ALL ON FUNCTION public.notes_op_unpublish(p_workspace_id uuid, p_note_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes_op_unpublish(p_workspace_id uuid, p_note_id uuid) TO authenticated, service_role;


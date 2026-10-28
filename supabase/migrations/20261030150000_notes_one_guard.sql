-- NS-6 · One guard (specs/notes-schema-hardening.md, Assumption 6, AC7, PQ4, PQ7).
--
-- Notes access was checked in three places: notes_op__guard/_guard_note (the
-- lossy module_member_permission mirror, so a create-only role passed it and
-- then failed in the trigger), perm_enforce_write per row, and can_access
-- checks added op by op. Every notes_op_* now states its level once:
--   notes__require(ws, note, action, trashed)  the module key notes.<action>
--     (a key: its creator's, capped by the key's Notes scope), then
--     can_access(view|edit|full) on the row, which it returns locked;
--   notes__require_module(ws, action)          the module key alone (create,
--     import, the client's trash sweep, the seed list);
--   notes__require_parent(ws, parent, trashed) edit on a parent a note goes
--     under (create, duplicate, move), the level perm_enforce_write asks.
-- A note the caller can't see and one that doesn't exist both answer P0002
-- "Note not found in this workspace." (PQ7). perm_enforce_write stays as the
-- backstop.
--
-- Going public needs one rule (PQ4): publish asks edit + ws.publish, and
-- notes__guard_reparent asks edit (not Full) + ws.publish for an inherit note
-- entering a published tree.
--
-- share_sync_note_flag's workspace_shared write is derived from a grant row
-- the share ops already checked: it now runs under share.bypass, so a
-- create-only role's new note (which gets the workspace grant) no longer fails
-- perm_enforce_write's edit check.
--
-- Every op keeps its signature and return type (CREATE OR REPLACE), and its
-- grants are re-stated.

-- The bodies below are NS-3, NS-4 and NS-5's: refuse to replay them over older ones.
DO $$
BEGIN
  IF to_regprocedure('public.notes__meta(public.notes)') IS NULL
     OR to_regprocedure('public.notes__copy_chain_access(uuid, uuid, uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.notes_op_restore(uuid, uuid)'::regprocedure
                      AND prosrc LIKE '%interval ''30 days''%') THEN
    RAISE EXCEPTION 'NS-6 needs NS-3 (20261030121000), NS-4 (20261030130000) and NS-5 (20261030140000) applied first.';
  END IF;
END;
$$;

-- ── The guard ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes__require_module(p_workspace_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_verb text := CASE p_action WHEN 'create' THEN 'add' WHEN 'view' THEN 'open' ELSE p_action END;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('create', 'edit', 'delete', 'view') THEN
    RAISE EXCEPTION 'Unknown notes action: %', p_action USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to use notes.' USING ERRCODE = '42501';
  END IF;
  IF public.module_api_key_id() IS NOT NULL THEN
    IF public.perm_rank(public.module_api_key_scope(p_workspace_id, 'notes', 'notes'))
         < public.perm_rank(CASE WHEN p_action = 'view' THEN 'view' ELSE 'edit' END)
       OR NOT public.perm_user_has(p_workspace_id, v_actor, 'notes.' || p_action) THEN
      RAISE EXCEPTION 'This API key can''t % notes.', v_verb USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.perm_user_has(p_workspace_id, v_actor, 'notes.' || p_action) THEN
    RAISE EXCEPTION 'Your role can''t % notes in this workspace.', v_verb USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.notes__require(
  p_workspace_id uuid, p_note_id uuid, p_action text, p_trashed boolean DEFAULT false)
RETURNS public.notes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid;
  n public.notes;
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, p_action);
  v_actor := public.perm_actor_id();
  -- Hidden and missing are one answer (PQ7), checked before the row is locked.
  IF NOT coalesce(public.can_access('note', p_note_id, 'view', v_actor), false) THEN
    RAISE EXCEPTION 'Note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO n FROM public.notes
   WHERE id = p_note_id AND workspace_id = p_workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(p_trashed, false) AND n.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This note is in the trash.';
  END IF;
  IF p_action <> 'view' AND NOT public.can_access(
       'note', n.id, CASE WHEN p_action = 'delete' THEN 'full' ELSE 'edit' END, v_actor) THEN
    RAISE EXCEPTION 'You can''t % this note.', p_action USING ERRCODE = '42501';
  END IF;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.notes__require_parent(
  p_workspace_id uuid, p_parent_id uuid, p_trashed boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := public.perm_actor_id();
BEGIN
  IF NOT coalesce(public.can_access('note', p_parent_id, 'view', v_actor), false)
     OR NOT EXISTS (SELECT 1 FROM public.notes
                    WHERE id = p_parent_id AND workspace_id = p_workspace_id
                      AND (coalesce(p_trashed, false) OR deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Parent note not found in this workspace.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access('note', p_parent_id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You can''t add pages inside that note.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.notes__require_module(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notes__require(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notes__require_parent(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__require_module(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.notes__require(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.notes__require_parent(uuid, uuid, boolean) TO service_role;

-- ── Create on the module ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes_op_create(p_workspace_id uuid, p_id uuid DEFAULT NULL::uuid, p_parent_id uuid DEFAULT NULL::uuid, p_title text DEFAULT ''::text, p_position text DEFAULT ''::text, p_icon text DEFAULT NULL::text)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'create');
  IF p_parent_id IS NOT NULL THEN
    PERFORM public.notes__require_parent(p_workspace_id, p_parent_id);
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
$function$;

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
  PERFORM public.notes__require_module(p_workspace_id, 'create');
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import rows must be an array.';
  END IF;

  -- PQ6: every parent is a note of this workspace or a new row earlier in
  -- this batch, checked before anything is written. A note the caller can't
  -- see answers like a missing one (PQ7); one they can see needs edit. A
  -- malformed id is left to the row loop, which skips it as before.
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_parent := nullif(r.value ->> 'parentId', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_parent := NULL;
    END;
    IF v_parent IS NOT NULL AND v_parent <> ALL (v_batch) THEN
      IF NOT EXISTS (SELECT 1 FROM public.notes
                     WHERE id = v_parent AND workspace_id = p_workspace_id)
         OR NOT coalesce(public.can_access('note', v_parent, 'view', public.perm_actor_id()), false) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('A note''s parent isn''t in this workspace: %s', v_parent),
          DETAIL = json_build_object('parentId', v_parent)::text;
      END IF;
      IF NOT public.can_access('note', v_parent, 'edit', public.perm_actor_id()) THEN
        RAISE EXCEPTION 'You can''t add pages inside that note.' USING ERRCODE = '42501';
      END IF;
    END IF;
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

-- View on the source, create, and edit on the parent the copy lands under.
CREATE OR REPLACE FUNCTION public.notes_op_duplicate(p_workspace_id uuid, p_source_note_id uuid, p_position text DEFAULT ''::text)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src public.notes;
  n public.notes;
  v_bypass text;
BEGIN
  src := public.notes__require(p_workspace_id, p_source_note_id, 'view');
  PERFORM public.notes__require_module(p_workspace_id, 'create');
  IF src.parent_id IS NOT NULL THEN
    PERFORM public.notes__require_parent(p_workspace_id, src.parent_id);
  END IF;
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
  -- duplicate silently lacks everything typed since the last compaction. It
  -- is the new note's own content, so it belongs to the create checked above,
  -- not to an edit (note_updates' trigger asks notes.edit).
  v_bypass := current_setting('share.bypass', true);
  PERFORM set_config('share.bypass', '1', true);
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64)
  SELECT u.workspace_id, n.id, u.client_id, u.client_seq, u.update_b64
    FROM public.note_updates u WHERE u.note_id = src.id;
  PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.duplicate',
    jsonb_build_object('source_note_id', src.id, 'title', n.title));
  RETURN public.notes__meta(n);
END;
$function$;

-- ── Edit ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes_op_rename(p_workspace_id uuid, p_note_id uuid, p_title text)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  UPDATE public.notes
    SET title = coalesce(p_title, ''), updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  PERFORM public.entities_op_upsert(
    p_workspace_id, 'note', n.id,
    coalesce(nullif(btrim(n.title), ''), 'Untitled'), 'note');
  RETURN public.notes__meta(n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_set_meta(p_workspace_id uuid, p_note_id uuid, p_patch jsonb)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_archive(p_workspace_id uuid, p_note_id uuid)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_unpublished integer := 0;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');

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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_unarchive(p_workspace_id uuid, p_note_id uuid)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  UPDATE public.notes SET is_archived = false, updated_at = now()
    WHERE id = n.id RETURNING * INTO n;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.unarchive',
    jsonb_build_object('title', n.title));
  RETURN public.notes__meta(n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_unpublish(p_workspace_id uuid, p_note_id uuid)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  UPDATE public.notes
    SET published_at = NULL, publish_token = NULL, updated_at = now()
    WHERE id = n.id
    RETURNING * INTO n;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.unpublish',
    jsonb_build_object('title', n.title));
  RETURN public.notes__meta(n);
END;
$function$;

-- Edit plus the workspace's publish permission (PQ4).
CREATE OR REPLACE FUNCTION public.notes_op_publish(p_workspace_id uuid, p_note_id uuid)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  IF NOT public.perm_user_has(p_workspace_id, public.perm_actor_id(), 'ws.publish') THEN
    RAISE EXCEPTION 'Your role can''t publish to the web in this workspace.' USING ERRCODE = '42501';
  END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_file(p_workspace_id uuid, p_note_id uuid, p_in_inbox boolean, p_position text DEFAULT ''::text)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_was_inbox boolean;
  v_old_parent uuid;
BEGIN
  IF p_in_inbox IS NULL THEN
    RAISE EXCEPTION 'Say whether the note goes to the Inbox or to Pages.';
  END IF;
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
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
$function$;

-- Edit, plus edit on the new parent. An inherit note entering a published
-- tree also needs ws.publish (notes__guard_reparent).
CREATE OR REPLACE FUNCTION public.notes_op_move(p_workspace_id uuid, p_note_id uuid, p_parent_id uuid DEFAULT NULL::uuid, p_position text DEFAULT ''::text, p_follow_parent boolean DEFAULT false)
 RETURNS notes_meta
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_old_parent uuid;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  v_old_parent := n.parent_id;

  IF p_parent_id IS NOT NULL THEN
    PERFORM public.notes__require_parent(p_workspace_id, p_parent_id);
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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_apply_updates(p_workspace_id uuid, p_note_id uuid, p_client_id text, p_updates jsonb, p_body_text text DEFAULT NULL::text, p_body_md text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  r record;
  v_key uuid := public.module_api_key_id();
  -- The signed-in person (perm_actor_id() is auth.uid() when no key is
  -- set); NULL for a key, whose write is attributed to the key instead.
  v_user uuid := CASE WHEN v_key IS NULL THEN public.perm_actor_id() END;
  v_origin text := CASE WHEN v_key IS NULL THEN 'user' ELSE 'api_key' END;
  v_inserted integer := 0;
  v_duplicate integer := 0;
  v_max_id bigint;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  IF p_client_id IS NULL OR btrim(p_client_id) = '' THEN
    RAISE EXCEPTION 'A client id is required.';
  END IF;

  IF p_updates IS NOT NULL AND jsonb_typeof(p_updates) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_updates) LOOP
      IF (r.value ->> 'clientSeq') IS NULL OR (r.value ->> 'updateB64') IS NULL THEN
        RAISE EXCEPTION 'Each update needs clientSeq and updateB64.';
      END IF;
      INSERT INTO public.note_updates
        (workspace_id, note_id, client_id, client_seq, update_b64, origin, actor_key_id, user_id)
      VALUES (p_workspace_id, n.id, p_client_id,
              (r.value ->> 'clientSeq')::integer, r.value ->> 'updateB64',
              v_origin, v_key, v_user)
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
    updated_at = now(),
    edited_by = CASE WHEN v_inserted > 0 AND v_user IS NOT NULL THEN v_user ELSE edited_by END,
    edited_at = CASE WHEN v_inserted > 0 AND v_user IS NOT NULL THEN now() ELSE edited_at END
    WHERE id = n.id;

  -- One attributed row per key write that changed the doc; human typing
  -- stays activity-free ("continuous edits").
  IF v_origin = 'api_key' AND v_inserted > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', n.id, 'notes.agent_edit',
      jsonb_build_object('title', n.title, 'clientId', p_client_id));
  END IF;

  SELECT max(u.id) INTO v_max_id FROM public.note_updates u WHERE u.note_id = n.id;
  RETURN jsonb_build_object(
    'inserted', v_inserted, 'duplicates', v_duplicate, 'max_update_id', v_max_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_save_snapshot(p_workspace_id uuid, p_note_id uuid, p_snapshot_b64 text, p_upto_update_id bigint, p_body_text text DEFAULT NULL::text, p_body_md text DEFAULT NULL::text, p_expected_doc_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_folded integer;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');
  IF p_snapshot_b64 IS NULL OR p_snapshot_b64 = '' THEN
    RAISE EXCEPTION 'A snapshot is required.';
  END IF;

  IF p_expected_doc_version IS NOT NULL
     AND n.doc_version IS DISTINCT FROM p_expected_doc_version THEN
    RETURN jsonb_build_object('folded', 0, 'refused', true, 'doc_version', n.doc_version);
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

  RETURN jsonb_build_object('folded', v_folded, 'refused', false, 'doc_version', n.doc_version + 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_seed_doc(p_workspace_id uuid, p_note_id uuid, p_doc_state_b64 text, p_body_text text DEFAULT NULL::text, p_body_md text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  -- Takes the note's row lock (FOR UPDATE), so concurrent seeders serialize
  -- here and exactly one of them can pass the emptiness check below.
  n := public.notes__require(p_workspace_id, p_note_id, 'edit');

  IF p_doc_state_b64 IS NULL OR btrim(p_doc_state_b64) = '' THEN
    RAISE EXCEPTION 'A doc state is required.';
  END IF;

  -- Already has a snapshot → someone materialized it first.
  IF n.doc_state IS NOT NULL AND n.doc_state <> '' THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'already_materialized');
  END IF;

  -- A note with NO snapshot can still hold content: `doc_state` is only
  -- written by compaction, so a normally-created note that has been edited
  -- lives entirely in `note_updates` until it folds. Seeding over THAT would
  -- duplicate every block. This check is what makes the op safe to call on
  -- any note, not just an imported one.
  IF EXISTS (SELECT 1 FROM public.note_updates u WHERE u.note_id = n.id) THEN
    RETURN jsonb_build_object('seeded', false, 'reason', 'has_updates');
  END IF;

  -- NOTE: `updated_at` is deliberately NOT touched. This is a repair, not an
  -- edit — the user changed nothing. Bumping it would reorder Recents and the
  -- Home notes widget (both sort by updated_at DESC) so that the first load
  -- after deploy showed nothing but backfilled notes, from a pass the user
  -- never saw. Callers pass NULL bodies too, so `body_md` (the faithful
  -- imported markdown) survives untouched via the coalesce.
  UPDATE public.notes SET
    doc_state = p_doc_state_b64,
    doc_version = doc_version + 1,
    body_text = coalesce(p_body_text, body_text),
    body_md = coalesce(p_body_md, body_md)
    WHERE id = n.id;

  RETURN jsonb_build_object('seeded', true, 'reason', NULL,
                            'doc_version', n.doc_version + 1);
END;
$function$;

-- The seed list: notes this caller could seed, so edit on the module.
CREATE OR REPLACE FUNCTION public.notes_list_unmaterialized(p_workspace_id uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(o_id uuid, o_body_md text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'edit');
  RETURN QUERY
    SELECT n.id, n.body_md
      FROM public.notes n
     WHERE n.workspace_id = p_workspace_id
       AND n.deleted_at IS NULL
       AND (n.doc_state IS NULL OR n.doc_state = '')
       AND coalesce(btrim(n.body_md), '') <> ''
       -- doc_state is only written by compaction, so "no snapshot" does NOT
       -- mean "empty" — a normally-edited note lives in note_updates until it
       -- folds. Seeding one of those would duplicate every block.
       AND NOT EXISTS (SELECT 1 FROM public.note_updates u WHERE u.note_id = n.id)
       -- Only notes this caller can seed (and so may read).
       AND public.can_access('note', n.id, 'edit')
     ORDER BY n.created_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 200), 1000));
END;
$function$;

-- ── Delete (Full) ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes_op_trash(p_workspace_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_now timestamptz := now();
  v_ids uuid[];
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'delete');

  SELECT array_agg(t.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
    WHERE nn.id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND nn.deleted_at IS NULL
  ) t;

  UPDATE public.notes
    SET deleted_at = v_now, updated_at = v_now
    WHERE workspace_id = p_workspace_id AND id = ANY (v_ids);

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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_restore(p_workspace_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_ids uuid[];
  v_id uuid;
  v_reroot boolean := false;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'delete', true);
  IF n.deleted_at IS NULL THEN
    RAISE EXCEPTION 'This note is not in the trash.';
  END IF;

  SELECT array_agg(t.id) INTO v_ids FROM (
    SELECT nn.id FROM public.notes nn
    WHERE nn.id IN (SELECT public.notes__subtree_ids(p_workspace_id, p_note_id))
      AND nn.deleted_at IS NOT NULL
      -- A sub-note trashed on its own more than 30 days ago is the purge's: it
      -- stays in the trash. The note itself is always included, so an expired
      -- one is refused by notes_restore_window.
      AND (nn.id = p_note_id OR nn.deleted_at >= now() - interval '30 days')
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
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_purge(p_workspace_id uuid, p_note_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
  v_ids uuid[];
  v_count integer;
BEGIN
  n := public.notes__require(p_workspace_id, p_note_id, 'delete', true);
  IF n.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Only trashed notes can be deleted forever.';
  END IF;

  SELECT array_agg(s) INTO v_ids
    FROM public.notes__subtree_ids(p_workspace_id, p_note_id) s;
  v_count := public.notes__purge_ids(p_workspace_id, v_ids);

  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.purge',
    jsonb_build_object('title', n.title, 'count', v_count));
  RETURN jsonb_build_object('count', v_count);
END;
$function$;

-- The client's early trash sweep (the nightly notes__purge_expired is the rule).
CREATE OR REPLACE FUNCTION public.notes_op_purge_expired(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_root uuid;
  v_ids uuid[];
  v_all uuid[] := '{}';
  v_count integer := 0;
BEGIN
  PERFORM public.notes__require_module(p_workspace_id, 'delete');
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
$function$;

-- ── View ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes_op_mention(p_workspace_id uuid, p_note_id uuid, p_mentioned_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n public.notes;
BEGIN
  -- The activity row carries the title, and both the caller (its actor) and
  -- the people named can read it, so only for a note the caller can open.
  n := public.notes__require(p_workspace_id, p_note_id, 'view');
  IF p_mentioned_user_ids IS NULL OR array_length(p_mentioned_user_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'notes', 'note', n.id, 'notes.mention',
    jsonb_build_object(
      'mentioned_user_ids',
      (SELECT jsonb_agg(u::text) FROM unnest(p_mentioned_user_ids) u)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.notes_op_set_favorite(p_workspace_id uuid, p_note_id uuid, p_value boolean, p_position text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := public.perm_actor_id();
  v_pos text;
BEGIN
  -- Taking a favorite away needs only the module: the note may since have
  -- gone out of sight, and the row is the caller's own.
  IF NOT coalesce(p_value, false) THEN
    PERFORM public.notes__require_module(p_workspace_id, 'view');
    DELETE FROM public.note_favorites
     WHERE user_id = v_user AND note_id = p_note_id AND workspace_id = p_workspace_id;
    RETURN;
  END IF;

  PERFORM public.notes__require(p_workspace_id, p_note_id, 'view');

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
$function$;

-- ── Going public: edit, not Full (PQ4) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notes__guard_reparent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_moved boolean := NEW.parent_id IS DISTINCT FROM OLD.parent_id;
BEGIN
  IF coalesce(current_setting('share.bypass', true), '') = '1' OR v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_moved THEN
    IF NOT EXISTS (SELECT 1 FROM public.notes p
                   WHERE p.id = NEW.parent_id AND p.workspace_id = NEW.workspace_id)
       OR NOT public.can_access('note', NEW.parent_id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'You don''t have access to this note.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF coalesce(NEW.share_mode, 'custom') = 'inherit'
     AND (v_moved OR coalesce(OLD.share_mode, 'custom') <> 'inherit')
     AND public.notes__in_published_tree(NEW.parent_id, true)
     -- A note that was already public (moved within or between published
     -- trees) goes on the web with nothing new.
     AND NOT (coalesce(OLD.share_mode, 'custom') = 'inherit'
              AND public.notes__in_published_tree(OLD.parent_id)) THEN
    IF NOT public.perm_user_has(NEW.workspace_id, v_actor, 'ws.publish') THEN
      RAISE EXCEPTION 'That page is published to the web, and your role can''t publish in this workspace.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access('note', OLD.id, 'edit', v_actor) THEN
      RAISE EXCEPTION 'That page is published to the web, and you can''t edit this note.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── The shared flag is derived, not an edit ────────────────────────────────

CREATE OR REPLACE FUNCTION public.share_sync_note_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type text := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_type ELSE NEW.resource_type END;
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_id ELSE NEW.resource_id END;
  v_bypass text;
BEGIN
  -- notes_orphan_custom sets the flag in the re-rooting write.
  IF coalesce(current_setting('notes.freezing', true), '') = '1' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF v_type = 'note' THEN
    -- The grant row was checked by whoever wrote it; mirroring it into the
    -- note is not an edit of the note (a create-only role's new note gets the
    -- workspace grant, NS-6).
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    UPDATE public.notes SET workspace_shared = EXISTS (
      SELECT 1 FROM public.resource_grants g
      WHERE g.resource_type = 'note' AND g.resource_id = v_id AND g.subject_type = 'workspace'
    ) WHERE id = v_id;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$function$;

-- ── The old guards go ──────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.notes_op__guard_note(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.notes_op__guard(uuid);

-- ── Grants, re-stated ──────────────────────────────────────────────────────

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.notes_op_create(uuid, uuid, uuid, text, text, text)',
    'public.notes_op_import(uuid, jsonb)',
    'public.notes_op_duplicate(uuid, uuid, text)',
    'public.notes_op_rename(uuid, uuid, text)',
    'public.notes_op_set_meta(uuid, uuid, jsonb)',
    'public.notes_op_archive(uuid, uuid)',
    'public.notes_op_unarchive(uuid, uuid)',
    'public.notes_op_unpublish(uuid, uuid)',
    'public.notes_op_publish(uuid, uuid)',
    'public.notes_op_file(uuid, uuid, boolean, text)',
    'public.notes_op_move(uuid, uuid, uuid, text, boolean)',
    'public.notes_op_apply_updates(uuid, uuid, text, jsonb, text, text)',
    'public.notes_op_save_snapshot(uuid, uuid, text, bigint, text, text, bigint)',
    'public.notes_op_seed_doc(uuid, uuid, text, text, text)',
    'public.notes_list_unmaterialized(uuid, integer)',
    'public.notes_op_trash(uuid, uuid)',
    'public.notes_op_restore(uuid, uuid)',
    'public.notes_op_purge(uuid, uuid)',
    'public.notes_op_purge_expired(uuid)',
    'public.notes_op_mention(uuid, uuid, uuid[])',
    'public.notes_op_set_favorite(uuid, uuid, boolean, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notes__guard_reparent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__guard_reparent() TO service_role;
REVOKE ALL ON FUNCTION public.share_sync_note_flag() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_sync_note_flag() TO service_role;

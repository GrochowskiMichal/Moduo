-- SECURITY DEFINER reads that skipped per-item visibility (PERM-3…8).
--
-- The functions below run as their owner, so RLS never filters what they
-- return. Since PERM-3…8 (20261006210000_perm_sharing.sql) a note, a task (via
-- its bucket), a contact or a company can be private to one person, and RLS
-- hides it from everyone else; these functions still handed it out, and none
-- of them writes the item, so no perm_enforce_write trigger stopped them.
--
-- links_suggest (newest body ← 20261006180000_perm0_privacy.sql) filtered its
-- candidates with perm_private_entity_visible, which only knows PERM-0's
-- owner-only types (event, calendar_account, email_thread, email_account) and
-- answers true for everything else. So it returned the registry label — the
-- real name or title — of items the caller can't open: a teammate's private
-- company whose domains match your contact's email ("works-at"), and any
-- private note, task, contact or company that shares a tag with the focus
-- entity or was touched within ±30 minutes of it. Each candidate now has to
-- pass perm_can_see_entity, the predicate the entities_workspace_read policy
-- already applies to direct registry reads, so the RPC returns exactly the
-- labels the caller could read from `entities` itself (module View included).
-- The focus entity has to pass it too: entity_links ids are readable across
-- the workspace, and the signals of a private item (which visible companies
-- match its email domain, what was touched around its activity) are its data.
--
-- The candidate query is unchanged apart from tie-breakers that make its order
-- total. Its rows are walked in that order and checked until the limit is met:
-- checking every candidate before the LIMIT returns the same rows in the same
-- order but costs ~20× more when a tag is on thousands of items. Both checks
-- fail closed (a NULL answer hides the row).
--
-- notes_list_unmaterialized (← 20260729120000_notes_seed_doc.sql) returned the
-- whole o_body_md of every un-materialized note in the workspace behind the
-- Notes module guard alone. It is the repair sweep's work list, and the sweep's
-- write (notes_op_seed_doc) needs Edit on the note (perm_enforce_write), so it
-- now lists only notes the caller can edit.
--
-- Three more took any id behind a module guard: notes_op_duplicate copied the
-- note (title, body, CRDT state and update tail) into one the caller owns;
-- notes_op_mention logged its title into an activity row the caller (as its
-- actor) and the people named can read; share_assign_preview quoted the
-- bucket's name. Duplicate and mention now need View on the note, checked
-- before the row is read, so a hidden note (trashed or not) answers exactly
-- like a missing one ("Note not found in this workspace."). The preview names
-- the bucket only to someone who can see it; someone with just a task in it
-- still gets the warning without the name, anyone else gets NULL.
--
-- Signatures and return types are unchanged, so CREATE OR REPLACE keeps the
-- grants; they are re-asserted below to match prod (authenticated +
-- service_role, never anon).

-- ── links_suggest ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_suggest(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  other_type text, other_id uuid, other_label text, other_icon text,
  signal text, suggested_kind text, strength int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_left int := coalesce(p_limit, 25);
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  -- Nothing to suggest for an entity the caller can't open.
  IF NOT coalesce(public.perm_can_see_entity(p_workspace_id, p_entity_type, p_entity_id), false) THEN
    RETURN;
  END IF;
  IF v_left < 1 THEN
    RETURN;
  END IF;
  FOR r IN
  WITH
  shared_tag AS (
    SELECT tl2.entity_type AS other_type, tl2.entity_id AS other_id,
           'shared-tag'::text AS signal, 'references'::text AS suggested_kind, count(*)::int AS strength
    FROM public.tag_links tl1
    JOIN public.tag_links tl2 ON tl2.workspace_id = tl1.workspace_id AND tl2.tag_id = tl1.tag_id
      AND NOT (tl2.entity_type = tl1.entity_type AND tl2.entity_id = tl1.entity_id)
    WHERE tl1.workspace_id = p_workspace_id AND tl1.entity_type = p_entity_type AND tl1.entity_id = p_entity_id
    GROUP BY tl2.entity_type, tl2.entity_id
  ),
  email_domain AS (
    SELECT 'company'::text AS other_type, co.id AS other_id,
           'email-domain'::text AS signal, 'works-at'::text AS suggested_kind, 1::int AS strength
    FROM public.contacts c
    CROSS JOIN LATERAL jsonb_array_elements(c.emails) AS ce(obj)
    JOIN public.companies co ON co.workspace_id = c.workspace_id AND co.deleted_at IS NULL
      AND lower(split_part(ce.obj->>'value', '@', 2)) = ANY (SELECT lower(d) FROM unnest(co.domains) AS d)
    WHERE p_entity_type = 'contact' AND c.workspace_id = p_workspace_id AND c.id = p_entity_id
      AND c.deleted_at IS NULL AND position('@' IN coalesce(ce.obj->>'value','')) > 0
    GROUP BY co.id
    UNION
    SELECT 'contact'::text AS other_type, c.id AS other_id,
           'email-domain'::text AS signal, 'works-at'::text AS suggested_kind, 1::int AS strength
    FROM public.companies co
    JOIN public.contacts c ON c.workspace_id = co.workspace_id AND c.deleted_at IS NULL
    CROSS JOIN LATERAL jsonb_array_elements(c.emails) AS ce(obj)
    WHERE p_entity_type = 'company' AND co.workspace_id = p_workspace_id AND co.id = p_entity_id
      AND co.deleted_at IS NULL AND position('@' IN coalesce(ce.obj->>'value','')) > 0
      AND lower(split_part(ce.obj->>'value', '@', 2)) = ANY (SELECT lower(d) FROM unnest(co.domains) AS d)
    GROUP BY c.id
  ),
  time_window AS (
    SELECT ma2.entity_type AS other_type, ma2.entity_id AS other_id,
           'time-window'::text AS signal, 'references'::text AS suggested_kind, 1::int AS strength
    FROM public.module_activity ma1
    JOIN public.module_activity ma2 ON ma2.workspace_id = ma1.workspace_id
      AND NOT (ma2.entity_type = ma1.entity_type AND ma2.entity_id = ma1.entity_id)
      AND ma2.created_at BETWEEN ma1.created_at - interval '30 minutes' AND ma1.created_at + interval '30 minutes'
    WHERE ma1.workspace_id = p_workspace_id AND ma1.entity_type = p_entity_type AND ma1.entity_id = p_entity_id
      AND ma1.created_at > now() - interval '30 days'
    GROUP BY ma2.entity_type, ma2.entity_id
  ),
  candidates AS (
    SELECT * FROM shared_tag UNION ALL SELECT * FROM email_domain UNION ALL SELECT * FROM time_window
  )
  SELECT cand.other_type, cand.other_id, e.label AS other_label, e.icon AS other_icon,
         cand.signal, cand.suggested_kind, cand.strength
  FROM candidates cand
  JOIN public.entities e ON e.workspace_id = p_workspace_id AND e.entity_type = cand.other_type
    AND e.entity_id = cand.other_id AND e.deleted_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.entity_links el WHERE el.workspace_id = p_workspace_id AND el.deleted_at IS NULL
      AND el.pair_key = public.spine_pair_key(p_entity_type, p_entity_id, cand.other_type, cand.other_id))
    AND NOT EXISTS (
    SELECT 1 FROM public.link_suggestion_declines d WHERE d.workspace_id = p_workspace_id
      AND d.pair_key = public.spine_pair_key(p_entity_type, p_entity_id, cand.other_type, cand.other_id))
  -- Tie-breakers make the order total, so which rows a limit keeps is
  -- deterministic (one entity can come back once per signal).
  ORDER BY cand.strength DESC, e.label, cand.signal, cand.other_type, cand.other_id
  LOOP
    -- PERM-3…8: only what the caller could read from `entities` itself. Checked
    -- in rank order and stopped at the limit, so a tag on thousands of items
    -- doesn't cost a check per item.
    CONTINUE WHEN NOT coalesce(public.perm_can_see_entity(p_workspace_id, r.other_type, r.other_id), false);
    other_type := r.other_type;
    other_id := r.other_id;
    other_label := r.other_label;
    other_icon := r.other_icon;
    signal := r.signal;
    suggested_kind := r.suggested_kind;
    strength := r.strength;
    RETURN NEXT;
    v_left := v_left - 1;
    EXIT WHEN v_left = 0;
  END LOOP;
END;
$$;

-- ── notes_list_unmaterialized ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notes_list_unmaterialized(
  p_workspace_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS TABLE (o_id uuid, o_body_md text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
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
$$;

-- ── notes_op_duplicate ───────────────────────────────────────────────────────
-- Newest body ← 20260703120000_notes_module.sql; one added check.
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

-- ── notes_op_mention ─────────────────────────────────────────────────────────
-- Newest body ← 20260703120000_notes_module.sql; one added check.
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
  -- The activity row carries the title, and both the caller (its actor) and
  -- the people named can read it, so only for a note the caller can open.
  -- Checked before the guard reads (and locks) the row, as in duplicate.
  PERFORM public.notes_op__guard(p_workspace_id);
  IF NOT coalesce(public.can_access('note', p_note_id, 'view'), false) THEN
    RAISE EXCEPTION 'Note not found in this workspace.';
  END IF;
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

-- ── share_assign_preview ─────────────────────────────────────────────────────
-- Newest body ← 20261006210000_perm_sharing.sql; one added check.
CREATE OR REPLACE FUNCTION public.share_assign_preview(p_bucket_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
  v_person text;
  v_sees_bucket boolean;
BEGIN
  -- The warning quotes the bucket's name, so the name only for a bucket the
  -- caller can see. Someone who only has a task in it (a task-level share)
  -- still gets the warning, without the name; anyone else gets nothing.
  v_sees_bucket := coalesce(public.can_access('bucket', p_bucket_id, 'view'), false);
  IF NOT v_sees_bucket AND NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.bucket_id = p_bucket_id AND t.deleted_at IS NULL
      AND public.can_access('task', t.id, 'view')
  ) THEN
    RETURN NULL;
  END IF;
  IF public.can_access('bucket', p_bucket_id, 'view', p_user_id) THEN RETURN NULL; END IF;
  IF v_sees_bucket THEN
    SELECT name INTO v_name FROM public.buckets WHERE id = p_bucket_id;
  END IF;
  SELECT coalesce(nullif(display_name, ''), 'They') INTO v_person FROM public.profiles WHERE id = p_user_id;
  RETURN coalesce(v_person, 'They') || ' can''t see "' || coalesce(v_name, 'this bucket') || '" — they''ll only see this task.';
END;
$$;

-- ── grants (unchanged; re-asserted) ──────────────────────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'links_suggest(uuid, text, uuid, int)',
    'notes_list_unmaterialized(uuid, integer)',
    'notes_op_duplicate(uuid, uuid, text)',
    'notes_op_mention(uuid, uuid, uuid[])',
    'share_assign_preview(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;

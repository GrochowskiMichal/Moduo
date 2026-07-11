-- DF-5 (destructive-action safety pack): the restore halves of the two soft
-- deletes that had no undo — contacts_op_delete (20260628120000) and
-- calendar_op_event_delete (20260702130000). Each mirrors its delete exactly:
-- SECURITY DEFINER + SET search_path=public, the module's permission guard,
-- an attributed module_activity row, all in one transaction. The client's
-- 8s Undo toast calls these; until this migration is applied the Undo click
-- degrades to a "Couldn't restore" error (the merge-before-apply posture).

-- ── contacts.restore ─────────────────────────────────────────────────────────
-- Un-deletes a soft-deleted contact, revives exactly the links its delete
-- dropped (they share the delete's transaction-stable now() stamp, so no
-- unrelated tombstones come back), and un-tombstones the registry entry.

CREATE OR REPLACE FUNCTION public.contacts_op_restore(
  p_workspace_id uuid,
  p_contact_id uuid
)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_deleted_at timestamptz;
BEGIN
  -- guard (edit perm on the contacts lane) + lock the DELETED row.
  PERFORM public.contacts_op__guard(p_workspace_id);

  SELECT * INTO c FROM public.contacts
    WHERE id = p_contact_id AND workspace_id = p_workspace_id
      AND deleted_at IS NOT NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found in this workspace (or not deleted).';
  END IF;
  v_deleted_at := c.deleted_at;

  UPDATE public.contacts
    SET deleted_at = NULL, updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;

  -- Revive only the links the delete dropped: contacts_op_delete stamped them
  -- with the same now() as the contact row (now() is transaction-stable).
  UPDATE public.entity_links
    SET deleted_at = NULL
    WHERE workspace_id = p_workspace_id
      AND deleted_at = v_deleted_at
      AND ((source_type = 'contact' AND source_id = c.id)
        OR (target_type = 'contact' AND target_id = c.id));

  -- Un-tombstone the registry entry directly (the inverse of
  -- entities_op_tombstone; inlined like notes_op_trash so a contacts-scoped
  -- api key isn't re-guarded through the links lane).
  UPDATE public.entities
    SET deleted_at = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'contact' AND entity_id = c.id;

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.restore',
    jsonb_build_object('name', c.name)
  );
  RETURN c;
END;
$$;

-- ── calendar.event_restore ───────────────────────────────────────────────────
-- Un-deletes a soft-deleted native event and un-tombstones its registry entry.
-- The delete drops no links, so there is nothing else to revive.

CREATE OR REPLACE FUNCTION public.calendar_op_event_restore(
  p_workspace_id uuid,
  p_event_id uuid
)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);

  SELECT * INTO e FROM public.calendar_events
    WHERE id = p_event_id AND workspace_id = p_workspace_id
      AND deleted_at IS NOT NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found in this workspace (or not deleted).';
  END IF;
  -- Mirrors the delete's native-only invariant (DESIGN_BRIEF §8): mirrored
  -- events are managed by their source calendar on both ends of the undo.
  IF e.source_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'This event is managed in its source calendar and is read-only here.';
  END IF;

  UPDATE public.calendar_events
    SET deleted_at = NULL, updated_at = now()
    WHERE id = e.id
    RETURNING * INTO e;

  UPDATE public.entities
    SET deleted_at = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'event' AND entity_id = e.id;

  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_restore',
    jsonb_build_object('title', e.title, 'recurring', e.recurring)
  );
  RETURN e;
END;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'contacts_op_restore(uuid, uuid)',
    'calendar_op_event_restore(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;

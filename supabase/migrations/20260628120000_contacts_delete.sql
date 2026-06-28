-- Contacts delete (post-CO-1 follow-up). Soft-delete a contact, drop every live
-- link touching it, and tombstone its central-registry entry so it disappears
-- from search / @mention / roll-ups. Mirrors the CO-1 op pattern: SECURITY
-- DEFINER + SET search_path=public, the contacts_op__guard_contact gate (perm +
-- lock + 404), and an attributed module_activity row, all in one transaction.
-- Soft-delete (deleted_at), so a future un-delete/Undo can revive it.

CREATE OR REPLACE FUNCTION public.contacts_op_delete(
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
BEGIN
  -- guard (edit perm) + lock the live row + 404 if missing.
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);

  UPDATE public.contacts
    SET deleted_at = now(), updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;

  -- Drop every live link touching this contact so the hub / roll-ups stop
  -- showing it (both indexed endpoints).
  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'contact' AND source_id = c.id)
        OR (target_type = 'contact' AND target_id = c.id));

  -- Tombstone the registry entry (search / @mention exclusion).
  PERFORM public.entities_op_tombstone(p_workspace_id, 'contact', c.id);

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.delete',
    jsonb_build_object('name', c.name)
  );
  RETURN c;
END;
$$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.contacts_op_delete(uuid, uuid) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.contacts_op_delete(uuid, uuid) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.contacts_op_delete(uuid, uuid) TO authenticated';
END;
$$;

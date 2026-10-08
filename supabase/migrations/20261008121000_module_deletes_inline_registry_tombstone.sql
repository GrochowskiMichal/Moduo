-- Contacts and calendar deletes tombstone their own registry row
-- (t/maciej/api-key-module-scopes).
--
-- History. Applied to prod on 2026-10-02 (version 20261002001411) from the
-- unmerged branch t/maciej/api-key-scopes, as
-- 20261002130000_module_deletes_inline_registry_tombstone.sql, which never
-- landed. These are prod's bodies, so applying this file changes nothing on
-- prod; it puts the definitions back in the repo (`bun run db:reconcile`
-- reported both as body drift).
--
-- Why. contacts_op_delete and calendar_op_event_delete used to call
-- entities_op_tombstone, which re-guards through the Links lane
-- (spine_op__guard → the key's `links` scope). A key with Edit on Contacts or
-- Calendar had its contacts_delete / calendar_delete_event refused unless it
-- also held Links Edit. notes_op_trash has inlined its tombstone for the same
-- reason since 20260703120000. Each op's own guard runs first, so it is the
-- authority for its entity's registry row.
--
-- Against today's schema (PERM-1): people need no extra Links check here. The
-- perm_enforce_write trigger on contacts / calendar_events checks the actor's
-- contacts.delete / calendar.delete, and holding either already gives that
-- person the Links lane (module_member_permission 'spine' = any module edit).
-- A key's actor is its creator, so the same trigger caps the key too.
-- email_op_ref_remove differs: 20261008122000.
--
-- Left alone: companies_op_delete, calendar_op_account_remove and
-- calendar_op_mirror_events still call entities_op_tombstone. No MCP tool
-- reaches them.
--
-- Signatures are unchanged, so CREATE OR REPLACE keeps every grant.

CREATE OR REPLACE FUNCTION public.contacts_op_delete(p_workspace_id uuid, p_contact_id uuid)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.contacts;
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);

  UPDATE public.contacts
    SET deleted_at = now(), updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'contact' AND source_id = c.id)
        OR (target_type = 'contact' AND target_id = c.id));

  -- Registry tombstone inline (not entities_op_tombstone — see the header).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'contact'
      AND entity_id = c.id
      AND deleted_at IS NULL;

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.delete',
    jsonb_build_object('name', c.name)
  );
  RETURN c;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_op_event_delete(p_workspace_id uuid, p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
BEGIN
  e := public.calendar_op__guard_event(p_workspace_id, p_event_id, true);
  UPDATE public.calendar_events
    SET deleted_at = now(), updated_at = now()
    WHERE id = e.id;
  -- Registry tombstone inline (not entities_op_tombstone — see the header).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'event'
      AND entity_id = e.id
      AND deleted_at IS NULL;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_delete',
    jsonb_build_object('title', e.title, 'recurring', e.recurring)
  );
END;
$$;

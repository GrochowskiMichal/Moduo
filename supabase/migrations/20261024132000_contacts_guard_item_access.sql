-- MOD-572 · Every contact op checks that you can edit that contact.
--
-- contacts_op__guard_contact checked only the module lane (Contacts edit in
-- this workspace) before handing the row back. The per-contact check lived in
-- perm_enforce_write, a write trigger, so a path that returned without writing
-- skipped it: contacts_op_set_status returns the row as it is when the status
-- already matches. A member with the Contacts edit lane who guessed a private
-- contact's status got its emails, phones, addresses and notes back, and a
-- wrong guess cost nothing.
--
-- The guard now asks can_access('contact', id, 'edit') for the actor (the
-- person, or an API key's creator), so every op that goes through it
-- (set_status, set_favorite, set_details, update, delete) refuses before it
-- reads anything out. System work with no actor passes, as in the trigger.
-- Deleting still needs Full, which perm_enforce_write asks on the write.
--
-- Verified on the local stack by supabase/tests/contacts_guard_access.test.sql.

CREATE OR REPLACE FUNCTION public.contacts_op__guard_contact(p_workspace_id uuid, p_contact_id uuid)
 RETURNS contacts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.contacts;
  v_actor uuid := public.perm_actor_id();
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  SELECT * INTO c FROM public.contacts
    WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found in this workspace.';
  END IF;
  IF v_actor IS NOT NULL AND NOT public.can_access('contact', c.id, 'edit', v_actor) THEN
    RAISE EXCEPTION 'You don''t have access to this contact.' USING ERRCODE = '42501';
  END IF;
  RETURN c;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.contacts_op__guard_contact(uuid, uuid) FROM PUBLIC, anon, authenticated;

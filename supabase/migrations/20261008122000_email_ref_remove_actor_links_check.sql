-- email_op_ref_remove: removing a thread checks the ACTOR's Links access, not
-- the key's Links scope (t/maciej/api-key-module-scopes).
--
-- History. Prod runs the 2026-10-02 body (version 20261002005255) from the
-- unmerged branch t/maciej/api-key-scopes
-- (20261002140000_email_ref_remove_people_keep_links_check.sql): the registry
-- tombstone is inline (as 20261008121000 does for contacts and calendar), and
-- people keep the Links-lane check that entities_op_tombstone used to impose,
-- while API keys skip it. Removing a thread drops every link touching it, so
-- the check matters: the Email guard alone doesn't imply Links access. The
-- email lane comes from the member's tier (viewer → view, else edit), not from
-- their module permissions (module_member_permission).
--
-- What was wrong with "keys skip it". A key acts as its creator (PERM-0) and
-- must never do more than that person could. Under PERM-1 a custom role can
-- hold Email edit with no module edit at all (so Links reads view). That
-- person couldn't remove a thread in the app, yet their key with Email Edit
-- could.
--
-- Now one check for both: the actor (the signed-in person, or the key's
-- creator, perm_actor_id()) needs edit on the Links lane. It reads the
-- creator's own permission, not the key's `links` scope, so an Email-Edit key
-- still doesn't need Links Edit. For people this is exactly
-- spine_op__guard's check.
--
-- Signature unchanged, so CREATE OR REPLACE keeps every grant.

CREATE OR REPLACE FUNCTION public.email_op_ref_remove(p_workspace_id uuid, p_ref_id uuid)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  -- guard (edit perm) + lock the live row + 404 if missing.
  r := public.email_op__guard_ref(p_workspace_id, p_ref_id);

  -- Removing a thread drops its links too, so the actor (person or the key's
  -- creator) must be able to change links (see the header).
  IF public.module_member_permission(p_workspace_id, public.perm_actor_id(), 'spine') NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to links in this workspace.';
  END IF;

  UPDATE public.email_refs
    SET deleted_at = now(), updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;

  -- Drop every live link touching this thread (both indexed endpoints).
  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'email_thread' AND source_id = r.id)
        OR (target_type = 'email_thread' AND target_id = r.id));

  -- Tombstone the registry entry (search / @mention exclusion) — inline, not
  -- entities_op_tombstone (see 20261008121000).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'email_thread'
      AND entity_id = r.id
      AND deleted_at IS NULL;

  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.ref_remove', '{}'::jsonb);
  RETURN r;
END;
$$;

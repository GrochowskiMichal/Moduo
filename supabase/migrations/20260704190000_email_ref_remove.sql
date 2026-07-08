-- Email ref removal (cloud) — block EM-8. A tissue ref is created by a deliberate
-- action (convert / link / snooze / follow-up / tag); the convert-to-task UNDO
-- (AC8: "Undo removes task + links + ref") needs to remove a ref it just created.
-- This mirrors contacts_op_delete: soft-delete the ref, drop every live link
-- touching the email_thread, and tombstone the registry entry.
--
-- The convert flow only calls this when it CREATED the ref (the thread wasn't
-- already in the tissue) — so dropping all of the thread's links is safe (a fresh
-- ref's only links are the ones convert just made). A pre-existing ref (already
-- snoozed / linked) keeps its state on undo; the caller never calls this for it.
--
-- Depends on: 20260704170000 (email_accounts/refs + email_op__guard_ref).

CREATE OR REPLACE FUNCTION public.email_op_ref_remove(
  p_workspace_id uuid,
  p_ref_id uuid
)
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

  -- Tombstone the registry entry (search / @mention exclusion).
  PERFORM public.entities_op_tombstone(p_workspace_id, 'email_thread', r.id);

  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', r.id, 'email.ref_remove', '{}'::jsonb);
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.email_op_ref_remove(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_op_ref_remove(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.email_op_ref_remove(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.email_op_ref_remove(uuid, uuid) TO service_role;

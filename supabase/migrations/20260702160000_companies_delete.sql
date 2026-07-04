-- Company delete (block FX-7, specs/contacts-v3-fixpack.md AC10). Soft-delete a
-- company, clear the denormalized company_id on every member contact, drop every
-- live link touching it (works-at edges included), and tombstone its central-
-- registry entry so it disappears from search / @mention / roll-ups. Contacts
-- SURVIVE — only their company chip clears. Mirrors contacts_op_delete
-- (20260628120000): SECURITY DEFINER + SET search_path=public, the contacts
-- permission guard, an attributed module_activity row, all in one transaction.
-- Soft-delete (deleted_at) so a future un-delete/Undo can revive it.

CREATE OR REPLACE FUNCTION public.companies_op_delete(
  p_workspace_id uuid,
  p_company_id uuid
)
RETURNS public.companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  co public.companies;
BEGIN
  -- guard (edit perm on the contacts lane).
  PERFORM public.contacts_op__guard(p_workspace_id);

  SELECT * INTO co FROM public.companies
    WHERE id = p_company_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found in this workspace.';
  END IF;

  UPDATE public.companies
    SET deleted_at = now(), updated_at = now()
    WHERE id = co.id
    RETURNING * INTO co;

  -- Members survive — just clear the denormalized FK so their card's company
  -- chip clears (the canonical works-at edges are dropped below).
  UPDATE public.contacts
    SET company_id = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id AND company_id = co.id AND deleted_at IS NULL;

  -- Drop every live link touching this company (both indexed endpoints), so the
  -- hub / roll-ups stop showing it — this removes the works-at edges too.
  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND ((source_type = 'company' AND source_id = co.id)
        OR (target_type = 'company' AND target_id = co.id));

  -- Tombstone the registry entry (search / @mention exclusion).
  PERFORM public.entities_op_tombstone(p_workspace_id, 'company', co.id);

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'company', co.id, 'companies.delete',
    jsonb_build_object('name', co.name)
  );
  RETURN co;
END;
$$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.companies_op_delete(uuid, uuid) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.companies_op_delete(uuid, uuid) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.companies_op_delete(uuid, uuid) TO authenticated';
END;
$$;

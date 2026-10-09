-- Check the contact before the company when a contact's company changes
-- (t/maciej/contacts-company-access; follow-up to 20261008124500, found by the
-- validator review of PR #276).
--
-- 20261008124500 made contacts_op_update and contacts_op_set_details run
-- contacts_op__guard_company before their UPDATE. Whether you may edit the
-- contact is only decided by perm_enforce_write when that UPDATE runs, so on a
-- teammate's private contact the answer depended on the company id you sent:
-- the company it already points at skipped the company check and got "You
-- don't have access to this contact.", while any other id got "No company with
-- that id in this workspace.". Guessing ids told a member which company a
-- private contact points at.
--
-- Now, when the company changes, a no-op UPDATE of the contact runs first. It
-- fires perm_enforce_write with exactly the checks the real UPDATE would get
-- (the role's contacts.edit, then Edit on this contact), so someone who can't
-- edit the contact gets the same refusal whatever company they send. Only then
-- is the company checked. Everything else is 20261008124500's bodies,
-- unchanged. Signatures are unchanged, so CREATE OR REPLACE keeps every grant.

-- 20261008124500 has to be applied first: this file builds on its guard.
DO $$
BEGIN
  IF to_regprocedure('public.contacts_op__guard_company(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261008124500_contacts_company_access_check.sql before this migration.';
  END IF;
END;
$$;

-- contacts_op_update: newest body is 20261008124500_contacts_company_access_check.sql.
CREATE OR REPLACE FUNCTION public.contacts_op_update(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_notes_inline text DEFAULT NULL,
  p_set_company boolean DEFAULT false,
  p_company_id uuid DEFAULT NULL
)
RETURNS public.contacts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_emails jsonb;
  v_phones jsonb;
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);

  -- A company that changes has to be one the actor can open. New here: the
  -- no-op UPDATE runs the write trigger's contact checks first, so the answer
  -- for a contact you can't edit never depends on the company you sent.
  IF p_set_company AND p_company_id IS DISTINCT FROM c.company_id THEN
    UPDATE public.contacts SET updated_at = updated_at WHERE id = c.id;
    PERFORM public.contacts_op__guard_company(p_workspace_id, p_company_id);
  END IF;

  v_emails := c.emails;
  IF p_email IS NOT NULL AND p_email <> ''
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.emails) e WHERE lower(e->>'value') = lower(p_email)) THEN
    v_emails := jsonb_build_array(jsonb_build_object('label','other','value',p_email,'primary',true)) || c.emails;
  END IF;
  v_phones := c.phones;
  IF p_phone IS NOT NULL AND p_phone <> ''
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.phones) p WHERE lower(p->>'value') = lower(p_phone)) THEN
    v_phones := jsonb_build_array(jsonb_build_object('label','mobile','value',p_phone,'primary',true)) || c.phones;
  END IF;

  UPDATE public.contacts
    SET name = coalesce(p_name, name),
        email = coalesce(p_email, email),
        emails = v_emails,
        phone = coalesce(p_phone, phone),
        phones = v_phones,
        title = coalesce(p_title, title),
        notes_inline = coalesce(p_notes_inline, notes_inline),
        company_id = CASE WHEN p_set_company THEN p_company_id ELSE company_id END,
        updated_at = now()
    WHERE id = c.id
    RETURNING * INTO c;

  IF p_name IS NOT NULL AND p_name <> '' THEN
    PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.update', jsonb_build_object('name', c.name));
  RETURN c;
END;
$$;

-- contacts_op_set_details: newest body is 20261008124500_contacts_company_access_check.sql.
CREATE OR REPLACE FUNCTION public.contacts_op_set_details(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_patch jsonb
)
RETURNS public.contacts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_company_id uuid;
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);

  -- A company that changes has to be one the actor can open. New here: the
  -- no-op UPDATE runs the write trigger's contact checks first, so the answer
  -- for a contact you can't edit never depends on the company you sent.
  IF p_patch ? 'companyId' THEN
    v_company_id := nullif(p_patch->>'companyId', '')::uuid;
    IF v_company_id IS DISTINCT FROM c.company_id THEN
      UPDATE public.contacts SET updated_at = updated_at WHERE id = c.id;
      PERFORM public.contacts_op__guard_company(p_workspace_id, v_company_id);
    END IF;
  END IF;

  UPDATE public.contacts SET
    name         = CASE WHEN p_patch ? 'name' THEN coalesce(p_patch->>'name', name) ELSE name END,
    title        = CASE WHEN p_patch ? 'title' THEN nullif(p_patch->>'title', '') ELSE title END,
    notes_inline = CASE WHEN p_patch ? 'notesInline' THEN coalesce(p_patch->>'notesInline', notes_inline) ELSE notes_inline END,
    status       = CASE WHEN p_patch ? 'status' THEN lower(coalesce(p_patch->>'status', '')) ELSE status END,
    is_favorite  = CASE WHEN p_patch ? 'isFavorite' THEN coalesce((p_patch->>'isFavorite')::boolean, is_favorite) ELSE is_favorite END,
    company_id   = CASE WHEN p_patch ? 'companyId' THEN nullif(p_patch->>'companyId', '')::uuid ELSE company_id END,
    emails       = CASE WHEN p_patch ? 'emails' THEN p_patch->'emails' ELSE emails END,
    phones       = CASE WHEN p_patch ? 'phones' THEN p_patch->'phones' ELSE phones END,
    addresses    = CASE WHEN p_patch ? 'addresses' THEN p_patch->'addresses' ELSE addresses END,
    urls         = CASE WHEN p_patch ? 'urls' THEN p_patch->'urls' ELSE urls END,
    dates        = CASE WHEN p_patch ? 'dates' THEN p_patch->'dates' ELSE dates END,
    custom       = CASE WHEN p_patch ? 'custom' THEN p_patch->'custom' ELSE custom END,
    email        = CASE WHEN p_patch ? 'emails' THEN public.contacts__primary_value(p_patch->'emails') ELSE email END,
    phone        = CASE WHEN p_patch ? 'phones' THEN public.contacts__primary_value(p_patch->'phones') ELSE phone END,
    updated_at   = now()
  WHERE id = c.id
  RETURNING * INTO c;

  IF p_patch ? 'name' AND coalesce(p_patch->>'name', '') <> '' THEN
    PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.update', jsonb_build_object('name', c.name));
  RETURN c;
END;
$$;

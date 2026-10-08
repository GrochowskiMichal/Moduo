-- A contact can point only at a company its writer can open
-- (t/maciej/contacts-company-access; found 2026-10-08 reviewing #247).
--
-- contacts_op_create, contacts_op_update and contacts_op_set_details took any
-- company id. can_access('company', …, 'view') grants View to anyone who can
-- view a contact that points at the company (20261006210000_perm_sharing.sql),
-- and every member can read company ids through entity_links. So a member with
-- Contacts edit could put a teammate's private company on a contact of their
-- own and then read that company: in the app, or over MCP with
-- contacts_create(company_id) and then contacts_list. A key could do no more
-- than its creator.
--
-- The three ops now check the company with contacts_op__guard_company: it has
-- to be live in this workspace and open to the actor (perm_actor_id(): the
-- signed-in user, or the key's creator). Missing, deleted, in another
-- workspace and private all get the same message, so the error never confirms
-- that a private company exists. update and set_details check a company only
-- when it changes, so re-saving a contact keeps what it already points at. No
-- company (NULL) is always allowed. The other writers of contacts.company_id
-- are covered: contacts_op_import matches and attaches only companies the
-- importer can open (20261008123000), and companies_op_delete only clears it.
--
-- Bodies: contacts_op_create is 20261008123000's; contacts_op_update and
-- contacts_op_set_details are 20260628140000_contacts_v2.sql's. Only the
-- company checks are new. Signatures are unchanged, so CREATE OR REPLACE keeps
-- every grant.

-- 20261008123000 has to be applied first. Applied after this file, it would
-- put back a contacts_op_create without the company check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.contacts_op_create(uuid, text, text, text, text, uuid, text, text)'::regprocedure
      AND prosrc LIKE '%perm_actor_id()%'
  ) THEN
    RAISE EXCEPTION 'Apply 20261008123000_key_writes_act_as_creator.sql before this migration.';
  END IF;
END;
$$;

-- ── op-internal guard: the company a contact may point at ────────────────────
CREATE OR REPLACE FUNCTION public.contacts_op__guard_company(p_workspace_id uuid, p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.companies co
    WHERE co.id = p_company_id AND co.workspace_id = p_workspace_id AND co.deleted_at IS NULL
  ) OR NOT public.can_access('company', p_company_id, 'view', public.perm_actor_id()) THEN
    RAISE EXCEPTION 'No company with that id in this workspace.';
  END IF;
END;
$$;

-- Internal, like the other *_op__guard* helpers: only the SECURITY DEFINER ops
-- below call it, and they run as its owner. anon is named because Supabase
-- grants it EXECUTE directly, not through PUBLIC (gotchas §Supabase).
REVOKE ALL ON FUNCTION public.contacts_op__guard_company(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.contacts_op__guard_company(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.contacts_op__guard_company(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contacts_op__guard_company is still callable by a client role.';
  END IF;
END;
$$;

-- contacts_op_create: newest body is 20261008123000_key_writes_act_as_creator.sql.
CREATE OR REPLACE FUNCTION public.contacts_op_create(
  p_workspace_id uuid,
  p_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_status text DEFAULT '',
  p_notes_inline text DEFAULT ''
)
RETURNS public.contacts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.contacts;
  v_emails jsonb := CASE WHEN p_email IS NOT NULL AND p_email <> ''
    THEN jsonb_build_array(jsonb_build_object('label','other','value',p_email,'primary',true)) ELSE '[]'::jsonb END;
  v_phones jsonb := CASE WHEN p_phone IS NOT NULL AND p_phone <> ''
    THEN jsonb_build_array(jsonb_build_object('label','mobile','value',p_phone,'primary',true)) ELSE '[]'::jsonb END;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  -- New here: only a company the actor can open.
  PERFORM public.contacts_op__guard_company(p_workspace_id, p_company_id);
  INSERT INTO public.contacts
    (workspace_id, owner_id, name, email, emails, phone, phones, title, company_id, status, notes_inline)
  VALUES
    (p_workspace_id, public.perm_actor_id(), coalesce(p_name, ''), p_email, v_emails, p_phone, v_phones, p_title,
     p_company_id, lower(coalesce(p_status, '')), coalesce(p_notes_inline, ''))
  RETURNING * INTO c;

  PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.create',
    jsonb_build_object('name', c.name, 'status', c.status));
  RETURN c;
END;
$$;

-- contacts_op_update: newest body is 20260628140000_contacts_v2.sql.
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

  -- New here: a company that changes has to be one the actor can open.
  IF p_set_company AND p_company_id IS DISTINCT FROM c.company_id THEN
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

-- contacts_op_set_details: newest body is 20260628140000_contacts_v2.sql.
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

  -- New here: a company that changes has to be one the actor can open.
  IF p_patch ? 'companyId' THEN
    v_company_id := nullif(p_patch->>'companyId', '')::uuid;
    IF v_company_id IS DISTINCT FROM c.company_id THEN
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

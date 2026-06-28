-- Contacts v2 (specs/contacts-v2.md): typed multi-value fields, custom fields,
-- favorites, optional status. Multi-value channels become labelled JSONB
-- ([{label,value,primary}]); custom fields are a `custom` jsonb blob + a
-- `contact_field_defs` table (defs only). The flat `email`/`phone` scalars stay
-- as the primary/dedupe fast-path, derived from the lists by the ops. No EAV.

-- ── schema ───────────────────────────────────────────────────────────────────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS phones    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS urls      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dates     jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS custom jsonb NOT NULL DEFAULT '{}'::jsonb;

-- emails text[] → jsonb [{label,value,primary}] (primary = matches the scalar).
-- The ALTER ... USING transform can't contain a subquery, so the per-element
-- conversion lives in an IMMUTABLE helper that USING just calls.
CREATE OR REPLACE FUNCTION public.contacts__emails_to_jsonb(p_arr text[], p_primary text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'label', 'other', 'value', e, 'primary', (lower(e) = lower(coalesce(p_primary, '')))
    ))
    FROM unnest(coalesce(p_arr, '{}'::text[])) AS e
  ), '[]'::jsonb);
$$;
ALTER TABLE public.contacts ALTER COLUMN emails DROP DEFAULT;
ALTER TABLE public.contacts
  ALTER COLUMN emails TYPE jsonb USING (public.contacts__emails_to_jsonb(emails, email));
ALTER TABLE public.contacts ALTER COLUMN emails SET DEFAULT '[]'::jsonb;

-- Seed phones jsonb from the existing scalar phone.
UPDATE public.contacts
  SET phones = jsonb_build_array(jsonb_build_object('label', 'mobile', 'value', phone, 'primary', true))
  WHERE phone IS NOT NULL AND phone <> '' AND phones = '[]'::jsonb;

-- Status is now OPTIONAL — default to none (''), not 'lead'. Existing rows keep
-- their value; a contact can be cleared to "no status".
ALTER TABLE public.contacts ALTER COLUMN status SET DEFAULT '';

-- ── custom-field definitions (defs only; values live in contacts.custom) ───────
CREATE TABLE IF NOT EXISTS public.contact_field_defs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  key          text NOT NULL,
  label        text NOT NULL DEFAULT '',
  type         text NOT NULL DEFAULT 'text'
    CHECK (type IN ('text', 'number', 'date', 'select', 'multi_select', 'url', 'checkbox')),
  options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
CREATE INDEX IF NOT EXISTS contact_field_defs_workspace_idx
  ON public.contact_field_defs (workspace_id, position);

ALTER TABLE public.contact_field_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_field_defs_read ON public.contact_field_defs;
CREATE POLICY contact_field_defs_read ON public.contact_field_defs
  FOR SELECT USING (public.tasks_module_can_access_workspace(workspace_id));

-- ── indexes for the new shape ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS contacts_custom_gin ON public.contacts USING gin (custom jsonb_path_ops);
CREATE INDEX IF NOT EXISTS contacts_favorite_idx ON public.contacts (workspace_id)
  WHERE is_favorite AND deleted_at IS NULL;

-- ── helper: derive the primary value from a labelled jsonb list ───────────────
CREATE OR REPLACE FUNCTION public.contacts__primary_value(p_list jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    (SELECT e->>'value' FROM jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) e
       WHERE coalesce((e->>'primary')::boolean, false) AND coalesce(e->>'value','') <> '' LIMIT 1),
    (SELECT e->>'value' FROM jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) e
       WHERE coalesce(e->>'value','') <> '' LIMIT 1)
  );
$$;

-- ── contacts.create — now writes emails as jsonb ──────────────────────────────
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
  INSERT INTO public.contacts
    (workspace_id, owner_id, name, email, emails, phone, phones, title, company_id, status, notes_inline)
  VALUES
    (p_workspace_id, auth.uid(), coalesce(p_name, ''), p_email, v_emails, p_phone, v_phones, p_title,
     p_company_id, lower(coalesce(p_status, '')), coalesce(p_notes_inline, ''))
  RETURNING * INTO c;

  PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'contact', c.id, 'contacts.create',
    jsonb_build_object('name', c.name, 'status', c.status));
  RETURN c;
END;
$$;

-- ── contacts.update — keep the existing scalar signature working (jsonb emails) ─
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

-- ── contacts.set_details — the flexible patch op the inline-edit card uses ─────
-- Applies only the keys present in p_patch (camelCase, matching the TS model);
-- derives the scalar email/phone from the primary of the lists.
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
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);

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

-- ── contacts.set_favorite ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contacts_op_set_favorite(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_value boolean
)
RETURNS public.contacts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c public.contacts;
BEGIN
  c := public.contacts_op__guard_contact(p_workspace_id, p_contact_id);
  UPDATE public.contacts SET is_favorite = coalesce(p_value, false), updated_at = now()
    WHERE id = c.id RETURNING * INTO c;
  RETURN c;
END;
$$;

-- ── companies.set_details — name/website/domains/notes/custom patch ────────────
CREATE OR REPLACE FUNCTION public.companies_op_set_details(
  p_workspace_id uuid,
  p_company_id uuid,
  p_patch jsonb
)
RETURNS public.companies
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  co public.companies;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  SELECT * INTO co FROM public.companies
    WHERE id = p_company_id AND workspace_id = p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found in this workspace.';
  END IF;

  UPDATE public.companies SET
    name         = CASE WHEN p_patch ? 'name' THEN coalesce(p_patch->>'name', name) ELSE name END,
    website      = CASE WHEN p_patch ? 'website' THEN nullif(p_patch->>'website', '') ELSE website END,
    notes_inline = CASE WHEN p_patch ? 'notesInline' THEN coalesce(p_patch->>'notesInline', notes_inline) ELSE notes_inline END,
    domains      = CASE WHEN p_patch ? 'domains'
                     THEN coalesce((SELECT array_agg(d->>0) FROM jsonb_array_elements(p_patch->'domains') d), domains)
                     ELSE domains END,
    custom       = CASE WHEN p_patch ? 'custom' THEN p_patch->'custom' ELSE custom END,
    updated_at   = now()
  WHERE id = co.id
  RETURNING * INTO co;

  IF p_patch ? 'name' AND coalesce(p_patch->>'name', '') <> '' THEN
    PERFORM public.entities_op_upsert(p_workspace_id, 'company', co.id, co.name, 'building-2');
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', 'company', co.id, 'companies.update', jsonb_build_object('name', co.name));
  RETURN co;
END;
$$;

-- ── custom-field defs: add / delete ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contacts_op_add_field_def(
  p_workspace_id uuid,
  p_key text,
  p_label text,
  p_type text DEFAULT 'text',
  p_options jsonb DEFAULT '[]',
  p_position integer DEFAULT 0
)
RETURNS public.contact_field_defs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d public.contact_field_defs;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  IF coalesce(btrim(p_key), '') = '' THEN
    RAISE EXCEPTION 'A field key is required.';
  END IF;
  INSERT INTO public.contact_field_defs (workspace_id, key, label, type, options, position)
  VALUES (p_workspace_id, p_key, coalesce(p_label, p_key),
          coalesce(p_type, 'text'), coalesce(p_options, '[]'::jsonb), coalesce(p_position, 0))
  ON CONFLICT (workspace_id, key) DO UPDATE
    SET label = excluded.label, type = excluded.type, options = excluded.options, position = excluded.position
  RETURNING * INTO d;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_op_delete_field_def(
  p_workspace_id uuid,
  p_field_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  DELETE FROM public.contact_field_defs WHERE id = p_field_id AND workspace_id = p_workspace_id;
END;
$$;

-- ── contacts.import — write emails as jsonb (keep dedupe semantics) ────────────
CREATE OR REPLACE FUNCTION public.contacts_op_import(
  p_workspace_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r            jsonb;
  v_contact    public.contacts;
  v_company_id uuid;
  v_company_nm text;
  v_name       text;
  v_email      text;
  v_status     text;
  v_created    uuid[] := '{}';
  v_merged     uuid[] := '{}';
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('created', 0, 'merged', 0, 'created_ids', '[]'::jsonb, 'merged_ids', '[]'::jsonb);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_contact := NULL;
    v_name := btrim(coalesce(r->>'name', ''));
    IF v_name = '' THEN CONTINUE; END IF;
    v_email := NULLIF(btrim(coalesce(r->>'email', '')), '');
    v_company_nm := NULLIF(btrim(coalesce(r->>'company', '')), '');
    v_status := NULLIF(lower(btrim(coalesce(r->>'status', ''))), '');
    v_company_id := NULL;

    IF v_company_nm IS NOT NULL THEN
      SELECT id INTO v_company_id FROM public.companies
        WHERE workspace_id = p_workspace_id AND deleted_at IS NULL AND lower(name) = lower(v_company_nm) LIMIT 1;
      IF v_company_id IS NULL THEN
        INSERT INTO public.companies (workspace_id, owner_id, name)
        VALUES (p_workspace_id, auth.uid(), v_company_nm) RETURNING id INTO v_company_id;
        PERFORM public.entities_op_upsert(p_workspace_id, 'company', v_company_id, v_company_nm, 'building-2');
        PERFORM public.module_activity_log(p_workspace_id, 'contacts', 'company', v_company_id, 'companies.create',
          jsonb_build_object('name', v_company_nm, 'from_csv', true));
      END IF;
    END IF;

    IF coalesce(r->>'op', 'create') = 'merge' AND NULLIF(r->>'contactId', '') IS NOT NULL THEN
      UPDATE public.contacts AS c SET
        email = coalesce(c.email, v_email),
        emails = CASE
          WHEN v_email IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.emails) e WHERE lower(e->>'value') = lower(v_email))
          THEN c.emails || jsonb_build_array(jsonb_build_object('label','other','value',v_email,'primary',(c.email IS NULL)))
          ELSE c.emails END,
        phone = coalesce(c.phone, NULLIF(btrim(coalesce(r->>'phone', '')), '')),
        title = coalesce(c.title, NULLIF(btrim(coalesce(r->>'title', '')), '')),
        company_id = coalesce(c.company_id, v_company_id),
        updated_at = now()
      WHERE c.id = (r->>'contactId')::uuid AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      RETURNING c.* INTO v_contact;
      IF v_contact.id IS NOT NULL THEN
        PERFORM public.entities_op_upsert(p_workspace_id, 'contact', v_contact.id, v_contact.name, 'user');
        PERFORM public.module_activity_log(p_workspace_id, 'contacts', 'contact', v_contact.id, 'contacts.import',
          jsonb_build_object('merged', true, 'from_csv', true));
        v_merged := array_append(v_merged, v_contact.id);
      END IF;
    ELSE
      INSERT INTO public.contacts
        (workspace_id, owner_id, name, email, emails, phone, phones, title, company_id, status)
      VALUES (
        p_workspace_id, auth.uid(), v_name, v_email,
        CASE WHEN v_email IS NOT NULL
          THEN jsonb_build_array(jsonb_build_object('label','other','value',v_email,'primary',true)) ELSE '[]'::jsonb END,
        NULLIF(btrim(coalesce(r->>'phone', '')), ''),
        CASE WHEN NULLIF(btrim(coalesce(r->>'phone','')),'') IS NOT NULL
          THEN jsonb_build_array(jsonb_build_object('label','mobile','value',btrim(r->>'phone'),'primary',true)) ELSE '[]'::jsonb END,
        NULLIF(btrim(coalesce(r->>'title', '')), ''),
        v_company_id,
        coalesce(v_status, ''))
      RETURNING * INTO v_contact;
      PERFORM public.entities_op_upsert(p_workspace_id, 'contact', v_contact.id, v_contact.name, 'user');
      PERFORM public.module_activity_log(p_workspace_id, 'contacts', 'contact', v_contact.id, 'contacts.import',
        jsonb_build_object('from_csv', true));
      v_created := array_append(v_created, v_contact.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', coalesce(array_length(v_created, 1), 0),
    'merged', coalesce(array_length(v_merged, 1), 0),
    'created_ids', to_jsonb(v_created),
    'merged_ids', to_jsonb(v_merged));
END;
$$;

-- ── links_suggest — read emails from jsonb (email-domain signal) ───────────────
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
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  RETURN QUERY
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
  ORDER BY cand.strength DESC, e.label
  LIMIT coalesce(p_limit, 25);
END;
$$;

-- ── grants ────────────────────────────────────────────────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'contacts_op_set_details(uuid, uuid, jsonb)',
    'contacts_op_set_favorite(uuid, uuid, boolean)',
    'companies_op_set_details(uuid, uuid, jsonb)',
    'contacts_op_add_field_def(uuid, text, text, text, jsonb, integer)',
    'contacts_op_delete_field_def(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.contacts__primary_value(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contacts__primary_value(jsonb) FROM anon;

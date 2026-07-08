-- Contacts CSV import — block CO-3 (specs/contacts.md AC6, "the adoption gate").
--
-- One attributed, activity-logged bulk op. The client parses the CSV, guesses the
-- column mapping, and previews dedupe (merge / duplicate / create / skip) BEFORE
-- calling this — so the server receives an explicit, already-deduped plan: an
-- array of rows each tagged op = 'create' | 'merge'. We still skip name-less rows
-- here (defense in depth), and resolve-or-create companies by name so a CSV with a
-- Company column populates `companies` too.
--
-- Mirrors the CO-1 ops exactly (20260626120000_contacts_module.sql): SECURITY
-- DEFINER + SET search_path=public, the contacts_op__guard permission gate,
-- entities_op_upsert into the central registry, and an attributed module_activity
-- row per affected contact/company — all in ONE transaction. Per-contact activity
-- (op 'contacts.import') keeps each new person's trail honest ("imported"), like
-- contacts.create logs per row.

CREATE OR REPLACE FUNCTION public.contacts_op_import(
  p_workspace_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    RETURN jsonb_build_object(
      'created', 0, 'merged', 0,
      'created_ids', '[]'::jsonb, 'merged_ids', '[]'::jsonb);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    -- Reset the row holder each iteration: a no-match UPDATE ... RETURNING leaves
    -- the target unchanged, which would otherwise re-count the previous contact.
    v_contact := NULL;

    v_name := btrim(coalesce(r->>'name', ''));
    IF v_name = '' THEN
      CONTINUE;  -- name-less rows are previewed as errors client-side; skip here too
    END IF;

    v_email := NULLIF(btrim(coalesce(r->>'email', '')), '');
    v_company_nm := NULLIF(btrim(coalesce(r->>'company', '')), '');
    v_status := NULLIF(lower(btrim(coalesce(r->>'status', ''))), '');
    v_company_id := NULL;

    -- Resolve (or create) the company by case-insensitive name.
    IF v_company_nm IS NOT NULL THEN
      SELECT id INTO v_company_id FROM public.companies
        WHERE workspace_id = p_workspace_id
          AND deleted_at IS NULL
          AND lower(name) = lower(v_company_nm)
        LIMIT 1;
      IF v_company_id IS NULL THEN
        INSERT INTO public.companies (workspace_id, owner_id, name)
        VALUES (p_workspace_id, auth.uid(), v_company_nm)
        RETURNING id INTO v_company_id;
        PERFORM public.entities_op_upsert(p_workspace_id, 'company', v_company_id, v_company_nm, 'building-2');
        PERFORM public.module_activity_log(
          p_workspace_id, 'contacts', 'company', v_company_id, 'companies.create',
          jsonb_build_object('name', v_company_nm, 'from_csv', true));
      END IF;
    END IF;

    IF coalesce(r->>'op', 'create') = 'merge' AND NULLIF(r->>'contactId', '') IS NOT NULL THEN
      -- Fill only the GAPS on an existing contact (never overwrite a value the
      -- user already has); append a genuinely new email to the array.
      UPDATE public.contacts AS c SET
        email = coalesce(c.email, v_email),
        emails = CASE
          WHEN v_email IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM unnest(c.emails) e WHERE lower(e) = lower(v_email))
          THEN array_append(c.emails, v_email)
          ELSE c.emails END,
        phone = coalesce(c.phone, NULLIF(btrim(coalesce(r->>'phone', '')), '')),
        title = coalesce(c.title, NULLIF(btrim(coalesce(r->>'title', '')), '')),
        company_id = coalesce(c.company_id, v_company_id),
        updated_at = now()
      WHERE c.id = (r->>'contactId')::uuid
        AND c.workspace_id = p_workspace_id
        AND c.deleted_at IS NULL
      RETURNING c.* INTO v_contact;

      IF v_contact.id IS NOT NULL THEN
        PERFORM public.entities_op_upsert(p_workspace_id, 'contact', v_contact.id, v_contact.name, 'user');
        PERFORM public.module_activity_log(
          p_workspace_id, 'contacts', 'contact', v_contact.id, 'contacts.import',
          jsonb_build_object('merged', true, 'from_csv', true));
        v_merged := array_append(v_merged, v_contact.id);
      END IF;
    ELSE
      INSERT INTO public.contacts
        (workspace_id, owner_id, name, email, emails, phone, title, company_id, status)
      VALUES (
        p_workspace_id, auth.uid(), v_name, v_email,
        CASE WHEN v_email IS NOT NULL THEN ARRAY[v_email] ELSE '{}'::text[] END,
        NULLIF(btrim(coalesce(r->>'phone', '')), ''),
        NULLIF(btrim(coalesce(r->>'title', '')), ''),
        v_company_id,
        coalesce(v_status, 'lead'))
      RETURNING * INTO v_contact;

      PERFORM public.entities_op_upsert(p_workspace_id, 'contact', v_contact.id, v_contact.name, 'user');
      PERFORM public.module_activity_log(
        p_workspace_id, 'contacts', 'contact', v_contact.id, 'contacts.import',
        jsonb_build_object('from_csv', true));
      v_created := array_append(v_created, v_contact.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created',     coalesce(array_length(v_created, 1), 0),
    'merged',      coalesce(array_length(v_merged, 1), 0),
    'created_ids', to_jsonb(v_created),
    'merged_ids',  to_jsonb(v_merged));
END;
$$;

-- ── grant ──────────────────────────────────────────────────────────────────────
-- Signed-in users only (mirrors the CO-1 grants; revoke anon explicitly because
-- ALTER DEFAULT PRIVILEGES grants EXECUTE to anon/authenticated by default).
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.contacts_op_import(uuid, jsonb) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.contacts_op_import(uuid, jsonb) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.contacts_op_import(uuid, jsonb) TO authenticated';
END;
$$;

-- MCP writes record the key's creator, not a NULL user
-- (t/maciej/api-key-module-scopes; the MCP-1 keyed round-trip).
--
-- Found 2026-10-08 by a keyed write round-trip on prod (rolled back): six ops
-- stamp auth.uid() into a creator/owner column. Under an API key auth.uid()
-- is NULL (the connector calls as service_role), so:
--   * links_op_create, contacts_op_link   → entity_links.created_by is NOT
--     NULL: links_create, notes_link and contacts_link failed for every key.
--   * comments_op_add                     → comments.created_by is NOT NULL:
--     comments_add failed for every key.
--   * contacts_op_create, contacts_op_import → owner_id NULL: the contact (and
--     an imported company) existed but nobody could open it (contacts are
--     private to their owner since PERM-6).
--   * notes_op_import (notes_create)      → created_by NULL: in a workspace
--     with no workspace-wide note grants the new note was visible to no one.
-- Each now stamps perm_actor_id(): the signed-in user, as before, or the key's
-- creator, the person a key acts as (PERM-0). Activity rows still name the key
-- (module_activity_log's api_key branch).
--
-- Comments also gain author_kind / author_label, like chat_messages: a key's
-- comment belongs to its creator but reads as the app that wrote it ("App ·
-- <key name>"), never as the person. Closed set ('user', 'api_key') mirrored
-- by CONTENT_AUTHOR_KINDS in supabase/functions/_shared/contracts/vocabularies.ts.
--
-- Bodies are the newest definitions, which db:reconcile shows match prod
-- (noted per function). Only the attribution expressions change, plus the
-- author columns in comments_op_add. Signatures are unchanged, so CREATE OR
-- REPLACE keeps every grant.

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS author_label text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_author_kind_check') THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_author_kind_check CHECK (author_kind IN ('user','api_key'));
  END IF;
END;
$$;

-- links_op_create: newest body is 20260625120000_spine_entity_links.sql.
CREATE OR REPLACE FUNCTION public.links_op_create(
  p_workspace_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_kind text DEFAULT 'references',
  p_origin text DEFAULT 'manual',
  p_source_label text DEFAULT NULL,
  p_source_icon text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_target_icon text DEFAULT NULL
)
RETURNS public.entity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.entity_links;
  v_kind text := coalesce(p_relation_kind, 'references');
  v_origin text := coalesce(p_origin, 'manual');
  v_pair_key text;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_source_type = p_target_type AND p_source_id = p_target_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;

  -- Ensure both endpoints exist in the registry (satisfies the FK) without
  -- clobbering an owning op's authoritative label or reviving a tombstone.
  PERFORM public.entities_op_ensure(p_workspace_id, p_source_type, p_source_id,
                                    p_source_label, p_source_icon);
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id,
                                    p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key(p_source_type, p_source_id, p_target_type, p_target_id);

  -- Idempotent insert: the partial unique index makes a re-link a no-op even
  -- under concurrent (async-multiplayer) creates from either direction.
  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, p_source_type, p_source_id, p_target_type, p_target_id, v_kind, v_origin, public.perm_actor_id())
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    -- Already linked — return the live row, no new activity (idempotent).
    SELECT * INTO v_link FROM public.entity_links
      WHERE workspace_id = p_workspace_id
        AND pair_key = v_pair_key
        AND relation_kind = v_kind
        AND deleted_at IS NULL
      LIMIT 1;
    RETURN v_link;
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', p_source_type, p_source_id, 'links.create',
    jsonb_build_object(
      'link_id', v_link.id,
      'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin)
  );
  RETURN v_link;
END;
$$;

-- contacts_op_link: newest body is 20260626120000_contacts_module.sql.
CREATE OR REPLACE FUNCTION public.contacts_op_link(
  p_workspace_id uuid,
  p_contact_type text,
  p_contact_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_kind text DEFAULT 'references',
  p_origin text DEFAULT 'manual',
  p_contact_label text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_target_icon text DEFAULT NULL
)
RETURNS public.entity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.entity_links;
  v_kind text := coalesce(p_relation_kind, 'references');
  v_origin text := coalesce(p_origin, 'manual');
  v_pair_key text;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_contact_type = p_target_type AND p_contact_id = p_target_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;

  -- Insert-if-absent only; never clobbers the authoritative label/icon the
  -- owning create/update op wrote. Icon left NULL so a company endpoint keeps its
  -- own glyph (the contact endpoint may be a 'contact' OR a 'company').
  PERFORM public.entities_op_ensure(p_workspace_id, p_contact_type, p_contact_id, p_contact_label, NULL);
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id, p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key(p_contact_type, p_contact_id, p_target_type, p_target_id);

  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, p_contact_type, p_contact_id, p_target_type, p_target_id, v_kind, v_origin, public.perm_actor_id())
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    -- Already linked — return the live row, no new activity (idempotent).
    SELECT * INTO v_link FROM public.entity_links
      WHERE workspace_id = p_workspace_id
        AND pair_key = v_pair_key
        AND relation_kind = v_kind
        AND deleted_at IS NULL
      LIMIT 1;
    RETURN v_link;
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', p_contact_type, p_contact_id, 'contacts.link',
    jsonb_build_object(
      'link_id', v_link.id,
      'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin)
  );
  RETURN v_link;
END;
$$;

-- comments_op_add: newest body is 20260714120000_comments_notify_owner_participants.sql.
CREATE OR REPLACE FUNCTION public.comments_op_add(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] DEFAULT '{}',
  p_entity_label text DEFAULT NULL,
  p_entity_icon text DEFAULT NULL
)
RETURNS public.comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment public.comments;
  v_body text := coalesce(p_body, '');
  v_mentions jsonb := to_jsonb(coalesce(p_mentioned_user_ids, '{}'::uuid[]));
  v_owner uuid;
  v_notify jsonb;
  v_key uuid := public.module_api_key_id();
  v_key_label text;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  IF trim(v_body) = '' THEN
    RAISE EXCEPTION 'A comment can''t be empty.';
  END IF;

  -- Ensure the target exists in the registry (satisfies the FK) without
  -- reviving a tombstone or clobbering an authoritative label.
  PERFORM public.entities_op_ensure(p_workspace_id, p_entity_type, p_entity_id, p_entity_label, p_entity_icon);

  -- A key's comment belongs to its creator (created_by is NOT NULL, and the
  -- creator's access governs it) but reads as the app that wrote it.
  IF v_key IS NOT NULL THEN
    SELECT k.name INTO v_key_label FROM public.workspace_api_keys k WHERE k.id = v_key;
  END IF;
  INSERT INTO public.comments
    (workspace_id, entity_type, entity_id, body, created_by, author_kind, author_label)
  VALUES (
    p_workspace_id, p_entity_type, p_entity_id, v_body, public.perm_actor_id(),
    CASE WHEN v_key IS NULL THEN 'user' ELSE 'api_key' END,
    CASE WHEN v_key IS NULL THEN NULL ELSE coalesce(v_key_label, 'App') END)
  RETURNING * INTO v_comment;

  -- Resolve the entity owner for the types that have one. Owner-less entities
  -- (contact/company/event) leave v_owner NULL → only participants notify. A
  -- soft-deleted (trashed) task/note resolves to NULL too — don't ping an owner
  -- about a comment on something in their trash.
  IF p_entity_type = 'task' THEN
    SELECT t.owner_id INTO v_owner FROM public.tasks t
      WHERE t.id = p_entity_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL;
  ELSIF p_entity_type = 'note' THEN
    SELECT n.created_by INTO v_owner FROM public.notes n
      WHERE n.id = p_entity_id AND n.workspace_id = p_workspace_id AND n.deleted_at IS NULL;
  END IF;

  -- notify_user_ids = (owner ∪ prior participants) − the actor. De-duped; TEXT
  -- ids to match the predicate's `@> jsonb_build_array(auth.uid()::text)`.
  SELECT coalesce(jsonb_agg(DISTINCT s.uid::text), '[]'::jsonb) INTO v_notify
  FROM (
    SELECT c.created_by AS uid
    FROM public.comments c
    WHERE c.workspace_id = p_workspace_id
      AND c.entity_type = p_entity_type
      AND c.entity_id = p_entity_id
      AND c.deleted_at IS NULL
    UNION
    SELECT v_owner
    WHERE v_owner IS NOT NULL
  ) s
  WHERE s.uid IS DISTINCT FROM public.perm_actor_id();

  PERFORM public.module_activity_log(
    p_workspace_id, 'comments', p_entity_type, p_entity_id, 'comments.add',
    jsonb_build_object(
      'comment_id', v_comment.id,
      -- A short excerpt for the notification card — never the full body.
      'excerpt', left(v_body, 140),
      'mentioned_user_ids', v_mentions,
      'notify_user_ids', v_notify)
  );
  RETURN v_comment;
END;
$$;

-- contacts_op_create: newest body is 20260628140000_contacts_v2.sql.
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

-- contacts_op_import: newest body is 20260628140000_contacts_v2.sql.
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
        VALUES (p_workspace_id, public.perm_actor_id(), v_company_nm) RETURNING id INTO v_company_id;
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
        p_workspace_id, public.perm_actor_id(), v_name, v_email,
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

-- notes_op_import: newest body is 20260703120000_notes_module.sql.
CREATE OR REPLACE FUNCTION public.notes_op_import(
  p_workspace_id uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_id uuid;
  v_first uuid;
  v_imported integer := 0;
  v_skipped integer := 0;
BEGIN
  PERFORM public.notes_op__guard(p_workspace_id);
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Import rows must be an array.';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      v_id := coalesce(nullif(r.value ->> 'id', '')::uuid, gen_random_uuid());
      IF EXISTS (SELECT 1 FROM public.notes WHERE id = v_id) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.notes
        (id, workspace_id, created_by, parent_id, title, icon, kind, position,
         doc_state, body_text, body_md)
      VALUES
        (v_id, p_workspace_id, public.perm_actor_id(),
         nullif(r.value ->> 'parentId', '')::uuid,
         coalesce(r.value ->> 'title', ''),
         nullif(r.value ->> 'icon', ''),
         'note',
         coalesce(r.value ->> 'position', ''),
         nullif(r.value ->> 'docStateB64', ''),
         coalesce(r.value ->> 'bodyText', ''),
         coalesce(r.value ->> 'bodyMd', ''));
      PERFORM public.entities_op_upsert(
        p_workspace_id, 'note', v_id,
        coalesce(nullif(btrim(r.value ->> 'title'), ''), 'Untitled'), 'note');
      IF v_first IS NULL THEN v_first := v_id; END IF;
      v_imported := v_imported + 1;
    EXCEPTION WHEN data_exception OR not_null_violation OR check_violation
      OR foreign_key_violation OR invalid_text_representation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  IF v_imported > 0 THEN
    PERFORM public.module_activity_log(
      p_workspace_id, 'notes', 'note', v_first, 'notes.import',
      jsonb_build_object('imported', v_imported, 'skipped', v_skipped));
  END IF;
  RETURN jsonb_build_object('imported', v_imported, 'skipped', v_skipped);
END;
$$;


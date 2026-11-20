-- MOD-593 and MOD-594, found by HV-16's RLS matrix (supabase/tests/rls_matrix.md).
--
-- MOD-593: links_op_create and contacts_op_link checked only the workspace's
-- Links (or Contacts) lane, so a member could link two items they couldn't see,
-- and the answer told them the ids existed. A link now needs the caller to be
-- able to edit at least one of its two items (a conversation they can read
-- counts for its channel or message end: anyone there may link from it). The
-- other end may be an item they can't open, as before: your own contact may
-- work at a company you can't open (contacts_company_link.test.sql).
-- email_op_link already required the caller's own thread, so it is unchanged.
-- A refusal reads the same for a missing and a hidden item. The bodies are the
-- latest definitions (pg_get_functiondef of the prod snapshot plus this
-- repo's newer migrations), changed only by the new check.
--
-- MOD-594: the legacy exposed_notes table (nothing reads or writes it since
-- notes publishing moved to publish_token) let anyone, signed in or not,
-- insert, update and delete rows through `true` policies for PUBLIC. Its write
-- policies go; the public read stays as it was. The table exists only on
-- databases built from prod, hence the guard.

CREATE OR REPLACE FUNCTION public.links__assert_may_link(
  p_workspace_id uuid, p_source_type text, p_source_id uuid, p_target_type text, p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.perm_can_edit_entity(p_workspace_id, p_source_type, p_source_id)
          OR public.perm_can_edit_entity(p_workspace_id, p_target_type, p_target_id)
          OR (p_source_type IN ('chat_channel', 'chat_message')
              AND public.perm_can_see_entity(p_workspace_id, p_source_type, p_source_id))
          OR (p_target_type IN ('chat_channel', 'chat_message')
              AND public.perm_can_see_entity(p_workspace_id, p_target_type, p_target_id))) THEN
    RAISE EXCEPTION 'You can''t link these.' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.links__assert_may_link(uuid, text, uuid, text, uuid) IS
  'Refuses a new link unless the actor can edit one of its items (a conversation they can read counts). MOD-593.';

REVOKE ALL ON FUNCTION public.links__assert_may_link(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.links__assert_may_link(uuid, text, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.links_op_create(p_workspace_id uuid, p_source_type text, p_source_id uuid, p_target_type text, p_target_id uuid, p_relation_kind text DEFAULT 'references'::text, p_origin text DEFAULT 'manual'::text, p_source_label text DEFAULT NULL::text, p_source_icon text DEFAULT NULL::text, p_target_label text DEFAULT NULL::text, p_target_icon text DEFAULT NULL::text)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
  v_kind text := coalesce(p_relation_kind, 'references');
  v_origin text := coalesce(p_origin, 'manual');
  v_pair_key text;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  -- MOD-593: the caller edits at least one of the two items.
  PERFORM public.links__assert_may_link(p_workspace_id, p_source_type, p_source_id, p_target_type, p_target_id);

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
  -- "Mentioned in" lines come from Chat's send and edit alone; checked before
  -- the registry is touched.
  IF (lower(btrim(p_source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(p_target_type)) IN ('chat_channel', 'chat_message'))
     AND (v_kind = 'mentions' OR v_origin = 'ref') THEN
    RAISE EXCEPTION 'Mentions and inline references with a conversation or a message are written by Chat only.'
      USING ERRCODE = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION public.contacts_op_link(p_workspace_id uuid, p_contact_type text, p_contact_id uuid, p_target_type text, p_target_id uuid, p_relation_kind text DEFAULT 'references'::text, p_origin text DEFAULT 'manual'::text, p_contact_label text DEFAULT NULL::text, p_target_label text DEFAULT NULL::text, p_target_icon text DEFAULT NULL::text)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
  v_kind text := coalesce(p_relation_kind, 'references');
  v_origin text := coalesce(p_origin, 'manual');
  v_pair_key text;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);
  -- MOD-593: the caller edits at least one of the two items.
  PERFORM public.links__assert_may_link(p_workspace_id, p_contact_type, p_contact_id, p_target_type, p_target_id);

  -- New here: Contacts may only start a link at its own items, as
  -- contacts_op_unlink already requires. Without it, Contacts edit access
  -- linked any two items (a task to a note) without edit access to Links.
  IF coalesce(p_contact_type, '') NOT IN ('contact', 'company') THEN
    RAISE EXCEPTION 'Contacts can link only a contact or a company, not %.',
      coalesce(p_contact_type, 'nothing');
  END IF;
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
  -- "Mentioned in" lines come from Chat's send and edit alone.
  IF lower(btrim(p_target_type)) IN ('chat_channel', 'chat_message') AND (v_kind = 'mentions' OR v_origin = 'ref') THEN
    RAISE EXCEPTION 'Mentions and inline references with a conversation or a message are written by Chat only.'
      USING ERRCODE = '42501';
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
$function$;

-- Same signatures, so the grants stand; restated by name.
REVOKE ALL ON FUNCTION public.links_op_create(uuid, text, uuid, text, uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.links_op_create(uuid, text, uuid, text, uuid, text, text, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.contacts_op_link(uuid, text, uuid, text, uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_op_link(uuid, text, uuid, text, uuid, text, text, text, text, text) TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.exposed_notes') IS NOT NULL THEN
    DROP POLICY IF EXISTS exposed_notes_anon_insert ON public.exposed_notes;
    DROP POLICY IF EXISTS exposed_notes_anon_update ON public.exposed_notes;
    DROP POLICY IF EXISTS exposed_notes_anon_delete ON public.exposed_notes;
  END IF;
END;
$$;

-- Chat v2 · CV-10-fix "Mentioned in" rows are Chat's (specs/chat-v2.md §8).
-- The stamp is provisional: it must stay after …_chat_v2_references (CV-10),
-- whose chat_conversations_for_item it starts from, and after
-- …_chat_v2_channel_lifecycle (CV-15). Every function below starts from its
-- live body. It runs again cleanly over itself.
--
-- Rules, as behaviour:
--   1. A "Mentioned in" row between a conversation (or a message) and an item
--      is written only by the chat send and edit path (chat__link_mentions:
--      source the conversation, relation `mentions`, origin `ref`).
--      links_op_create refuses relation `mentions` and origin `ref` when either
--      end is a conversation or a message (contacts_op_link and email_op_link
--      likewise for their target); every other kind and type behaves as before.
--   2. Those rows are history: links_op_delete, links_op_set_kind and
--      contacts_op_unlink refuse to remove or retype a `mentions` row with a
--      conversation or a message at either end, and links_op_set_kind refuses
--      to turn such a link into one.
--   3. chat_conversations_for_item counts only rows the chat path writes
--      (source a conversation, relation `mentions`, origin `ref`).
--   4. Once: a live mention row with a chat end that isn't in the chat path's
--      shape becomes a plain reference (closed only when the pair already has
--      one), and other live rows with a chat end lose origin `ref`, so origin
--      `ref` with a chat end marks the chat path's rows alone.
--   5. Registry labels: a message has none; a conversation carries its
--      channel's current name, none for a direct or group message or a purged
--      channel.

SET LOCAL lock_timeout = '5s';

-- ── 1. links_op_create ──────────────────────────────────────────────────────
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

REVOKE ALL ON FUNCTION public.links_op_create(uuid, text, uuid, text, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.links_op_create(uuid, text, uuid, text, uuid, text, text, text, text, text, text) TO authenticated, service_role;

-- ── 2. links_op_delete ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_op_delete(p_workspace_id uuid, p_link_id uuid)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE id = p_link_id AND workspace_id = p_workspace_id;
    IF v_link.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN v_link;
  END IF;

  -- A "Mentioned in" line is history: it stays.
  IF v_link.relation_kind = 'mentions'
     AND (lower(btrim(v_link.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(v_link.target_type)) IN ('chat_channel', 'chat_message')) THEN
    RAISE EXCEPTION 'A mention in a conversation stays: it''s part of the conversation''s history.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE id = v_link.id
    RETURNING * INTO v_link;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', v_link.source_type, v_link.source_id, 'links.delete',
    jsonb_build_object(
      'link_id', v_link.id, 'relation_kind', v_link.relation_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$function$;

REVOKE ALL ON FUNCTION public.links_op_delete(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.links_op_delete(uuid, uuid) TO authenticated, service_role;

-- ── 3. links_op_set_kind ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_op_set_kind(p_workspace_id uuid, p_link_id uuid, p_relation_kind text)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
  v_from text;
  v_kind text := p_relation_kind;
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found in this workspace.';
  END IF;
  IF v_link.relation_kind = v_kind THEN
    RETURN v_link;
  END IF;
  -- "Mentioned in" lines are Chat's: none is retyped, and none is made here.
  IF (lower(btrim(v_link.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(v_link.target_type)) IN ('chat_channel', 'chat_message'))
     AND (v_link.relation_kind = 'mentions' OR v_kind = 'mentions') THEN
    RAISE EXCEPTION 'Mentions and inline references with a conversation or a message are written by Chat only.'
      USING ERRCODE = '42501';
  END IF;

  v_from := v_link.relation_kind;
  BEGIN
    UPDATE public.entity_links
      SET relation_kind = v_kind
      WHERE id = v_link.id
      RETURNING * INTO v_link;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'These two are already linked as %.', v_kind;
  END;

  PERFORM public.module_activity_log(
    p_workspace_id, 'links', v_link.source_type, v_link.source_id, 'links.set_kind',
    jsonb_build_object(
      'link_id', v_link.id, 'from', v_from, 'to', v_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$function$;

REVOKE ALL ON FUNCTION public.links_op_set_kind(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.links_op_set_kind(uuid, uuid, text) TO authenticated, service_role;

-- ── 4. contacts_op_unlink ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contacts_op_unlink(p_workspace_id uuid, p_link_id uuid)
 RETURNS entity_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.entity_links;
BEGIN
  PERFORM public.contacts_op__guard(p_workspace_id);

  SELECT * INTO v_link FROM public.entity_links
    WHERE id = p_link_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE id = p_link_id AND workspace_id = p_workspace_id;
    IF v_link.id IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN v_link;
  END IF;

  IF v_link.source_type NOT IN ('contact', 'company')
     AND v_link.target_type NOT IN ('contact', 'company') THEN
    RAISE EXCEPTION 'This link is not owned by Contacts.';
  END IF;
  -- A "Mentioned in" line is history: it stays.
  IF v_link.relation_kind = 'mentions'
     AND (lower(btrim(v_link.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(v_link.target_type)) IN ('chat_channel', 'chat_message')) THEN
    RAISE EXCEPTION 'A mention in a conversation stays: it''s part of the conversation''s history.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.entity_links
    SET deleted_at = now()
    WHERE id = v_link.id
    RETURNING * INTO v_link;

  PERFORM public.module_activity_log(
    p_workspace_id, 'contacts', v_link.source_type, v_link.source_id, 'contacts.unlink',
    jsonb_build_object(
      'link_id', v_link.id, 'relation_kind', v_link.relation_kind,
      'target_type', v_link.target_type, 'target_id', v_link.target_id)
  );
  RETURN v_link;
END;
$function$;

REVOKE ALL ON FUNCTION public.contacts_op_unlink(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_op_unlink(uuid, uuid) TO authenticated, service_role;

-- ── 5. contacts_op_link and email_op_link: the same rule as links_op_create ─
-- (a row they made would share the chat path's pair key and keep its line out).
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

REVOKE ALL ON FUNCTION public.contacts_op_link(uuid, text, uuid, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_op_link(uuid, text, uuid, text, uuid, text, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_op_link(p_workspace_id uuid, p_thread_id uuid, p_target_type text, p_target_id uuid, p_relation_kind text DEFAULT 'references'::text, p_origin text DEFAULT 'manual'::text, p_thread_label text DEFAULT NULL::text, p_target_label text DEFAULT NULL::text, p_target_icon text DEFAULT NULL::text)
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
  PERFORM public.email_op__guard(p_workspace_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.email_refs r
    WHERE r.id = p_thread_id AND r.workspace_id = p_workspace_id
      AND r.deleted_at IS NULL AND r.owner_id = public.perm_actor_id()
  ) THEN
    RAISE EXCEPTION 'Email thread not found in this workspace.';
  END IF;

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_target_type = 'email_thread' AND p_target_id = p_thread_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;
  -- "Mentioned in" lines come from Chat's send and edit alone.
  IF lower(btrim(p_target_type)) IN ('chat_channel', 'chat_message') AND (v_kind = 'mentions' OR v_origin = 'ref') THEN
    RAISE EXCEPTION 'Mentions and inline references with a conversation or a message are written by Chat only.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.entities_op_ensure(p_workspace_id, 'email_thread', p_thread_id, p_thread_label, 'mail');
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id, p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key('email_thread', p_thread_id, p_target_type, p_target_id);

  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, 'email_thread', p_thread_id, p_target_type, p_target_id, v_kind, v_origin, public.perm_actor_id())
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE workspace_id = p_workspace_id AND pair_key = v_pair_key
        AND relation_kind = v_kind AND deleted_at IS NULL
      LIMIT 1;
    RETURN v_link;
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', p_thread_id, 'email.link',
    jsonb_build_object(
      'link_id', v_link.id, 'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin));
  RETURN v_link;
END;
$function$;

REVOKE ALL ON FUNCTION public.email_op_link(uuid, uuid, text, uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_op_link(uuid, uuid, text, uuid, text, text, text, text, text) TO authenticated, service_role;

-- ── 6. chat_conversations_for_item: only the chat path's rows ──────────────
CREATE OR REPLACE FUNCTION public.chat_conversations_for_item(p_type text, p_id uuid)
 RETURNS TABLE(channel_id uuid, workspace_id uuid, channel_kind text, channel_name text, channel_private boolean, relation text, since timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH item AS (
    SELECT CASE p_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE p_type END AS t
  ), hits AS (
    -- The rows chat__link_mentions writes: the conversation as the source,
    -- relation `mentions`, origin `ref`.
    SELECT l.workspace_id, l.source_id AS cid, min(l.created_at) AS since
      FROM public.entity_links l, item
     WHERE auth.uid() IS NOT NULL
       AND l.deleted_at IS NULL
       AND l.relation_kind = 'mentions'
       AND l.origin = 'ref'
       AND l.source_type = 'chat_channel'
       AND l.target_type = item.t AND l.target_id = p_id
     GROUP BY 1, 2
  )
  SELECT c.id, c.workspace_id, c.kind,
         CASE WHEN c.kind = 'channel' THEN c.name END,
         c.is_private, 'mentions'::text, h.since
    FROM hits h
    JOIN public.chat_channels c ON c.id = h.cid AND c.workspace_id = h.workspace_id AND c.deleted_at IS NULL
    , item
   WHERE public.chat_can_read_channel(c.id)
     AND public.perm_can_see_entity(h.workspace_id, item.t, p_id)
   ORDER BY h.since DESC, c.id
   LIMIT 50
$function$;

REVOKE ALL ON FUNCTION public.chat_conversations_for_item(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_conversations_for_item(text, uuid) TO authenticated, service_role;

-- ── 7. Mention rows with a chat end not in the chat path's shape (once) ────
-- They give no line, can't be removed through any op, and share the chat
-- path's pair key: closed here (soft delete), so a later send writes its own.
-- A row the app made on purpose (an @ in a note) stays a link: it becomes a
-- plain `references` link with origin `manual` when the pair has none yet, and
-- is closed (soft delete) only when it would duplicate one. Afterwards every
-- live row with a chat end and origin `ref` is one the chat path wrote.
UPDATE public.entity_links l
   SET relation_kind = 'references', origin = 'manual'
 WHERE l.deleted_at IS NULL
   AND l.relation_kind = 'mentions'
   AND (lower(btrim(l.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(l.target_type)) IN ('chat_channel', 'chat_message'))
   AND NOT (l.source_type = 'chat_channel' AND l.origin = 'ref')
   AND NOT EXISTS (
     SELECT 1 FROM public.entity_links r
      WHERE r.workspace_id = l.workspace_id AND r.pair_key = l.pair_key
        AND r.relation_kind = 'references' AND r.deleted_at IS NULL);

UPDATE public.entity_links l
   SET deleted_at = now()
 WHERE l.deleted_at IS NULL
   AND l.relation_kind = 'mentions'
   AND (lower(btrim(l.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(l.target_type)) IN ('chat_channel', 'chat_message'))
   AND NOT (l.source_type = 'chat_channel' AND l.origin = 'ref');

UPDATE public.entity_links l
   SET origin = 'manual'
 WHERE l.deleted_at IS NULL
   AND l.origin = 'ref'
   AND (lower(btrim(l.source_type)) IN ('chat_channel', 'chat_message') OR lower(btrim(l.target_type)) IN ('chat_channel', 'chat_message'))
   AND NOT (l.source_type = 'chat_channel' AND l.relation_kind = 'mentions');

-- ── 8. Registry labels for conversations and messages (once; idempotent) ───
UPDATE public.entities e
   SET label = '', updated_at = now()
 WHERE e.entity_type = 'chat_message'
   AND e.label IS DISTINCT FROM '';

UPDATE public.entities e
   SET label = x.label, updated_at = now()
  FROM (
    SELECT e2.workspace_id, e2.entity_id,
           coalesce(CASE WHEN c.kind = 'channel' AND c.purged_at IS NULL THEN c.name END, '') AS label
      FROM public.entities e2
      LEFT JOIN public.chat_channels c ON c.id = e2.entity_id AND c.workspace_id = e2.workspace_id
     WHERE e2.entity_type = 'chat_channel'
  ) x
 WHERE e.entity_type = 'chat_channel'
   AND e.workspace_id = x.workspace_id AND e.entity_id = x.entity_id
   AND e.label IS DISTINCT FROM x.label;

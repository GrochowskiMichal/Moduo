-- Chat v2 · CV-13 Linked channels (specs/chat-v2.md §8, §12; CH56, CH57;
-- §Assumptions #6, #25; .design/chat-v2/research/round-3-database.md §2.21).
-- The stamp is provisional: re-cut on the day it applies; it must stay after
-- …_chat_v2_references (CV-10, chat_conversations_for_item's mentions half) and
-- CV-2b's conversation ops (chat_op_create_channel's 6-argument body, live on
-- the local stack at CV-15's head, 2026-10-16). It runs again cleanly over
-- itself.
--
-- What it does:
--   1. chat_channels.linked_type / linked_id / linked_at: a channel links to
--      at most one thing, a project (`bucket`), a client (`company`,
--      `contact`) or a team (CHAT_LINK_TARGETS in @contracts). Both set or
--      both empty; channels only, never a direct message.
--   2. A new spine relation, `conversation-of` (RELATION_KINDS), re-stated in
--      entity_links' CHECK from its live list. A linked project or client gets
--      one live row from the conversation to it, so the item's Linked and the
--      spine find it; a team has no registry row, so a team link is the column
--      only. The column is the truth: a `conversation-of` row can only be
--      written for the item its conversation links to, never changed to or
--      from another kind, and a soft-deleted one comes back only while the
--      link still holds. The link ops' own kind lists stay as they are, so the
--      chat op is its only writer.
--   3. chat_op_link_channel(channel, type, id): links, relinks or (with nulls)
--      unlinks. Linking needs being in the conversation, able to post in it,
--      and edit rights on the item (a team: being in it, or its creator, the
--      workspace owner or an admin). Activity `chat.channel_link`.
--   4. chat_op_create_channel gains link_type / link_id (New conversation's
--      optional link), under the same rules.
--   5. chat_op_start_conversation(ws, type, id): "Start a conversation for X"
--      (CH56). Named after X (" 2", " 3" on a clash); public with the creator
--      in it when every workspace member who can use chat can see X, otherwise
--      private with exactly the members who can.
--   6. chat_conversations_for_item(type, id) gains the link half (relation
--      `conversation-of`, read from the column) and each line's unread count
--      for the caller and whether the conversation is archived.
--   7. chat_link_files_here(channel): whether capture from the channel files
--      into its linked project for the caller (live, not archived, editable
--      by them); otherwise the app files into the Inbox.
--   Nothing here takes a person from the caller; an API key reads no chat row.

SET LOCAL lock_timeout = '5s';

-- ── 1. The link columns ─────────────────────────────────────────────────────
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS linked_type text;
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS linked_id uuid;
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS linked_at timestamptz;

ALTER TABLE public.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_linked_type_check;
ALTER TABLE public.chat_channels ADD CONSTRAINT chat_channels_linked_type_check
  CHECK (linked_type IS NULL OR linked_type IN ('bucket', 'company', 'contact', 'team'));
ALTER TABLE public.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_linked_pair_check;
ALTER TABLE public.chat_channels ADD CONSTRAINT chat_channels_linked_pair_check
  CHECK ((linked_type IS NULL) = (linked_id IS NULL)
         AND (linked_type IS NULL OR kind = 'channel'));

CREATE INDEX IF NOT EXISTS chat_channels_linked_idx
  ON public.chat_channels (linked_type, linked_id) WHERE linked_id IS NOT NULL;

-- ── 2. The relation ─────────────────────────────────────────────────────────
ALTER TABLE public.entity_links DROP CONSTRAINT IF EXISTS entity_links_relation_kind_check;
ALTER TABLE public.entity_links ADD CONSTRAINT entity_links_relation_kind_check
  CHECK (relation_kind = ANY (ARRAY['references'::text, 'spawned-from'::text, 'blocks'::text,
    'attachment'::text, 'mentions'::text, 'works-at'::text, 'follow-up'::text, 'paid-by'::text,
    'conversation-of'::text]));

-- Does conversation p_channel link to (p_type, p_id) right now?
CREATE OR REPLACE FUNCTION public.chat__links_to(p_channel_id uuid, p_type text, p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.chat_channels c
                  WHERE c.id = p_channel_id AND c.deleted_at IS NULL
                    AND c.linked_type = p_type AND c.linked_id = p_id)
$function$;

-- The column is the truth; a `conversation-of` row only mirrors it.
CREATE OR REPLACE FUNCTION public.chat__guard_conversation_of()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.relation_kind = 'conversation-of'
       AND NOT (NEW.source_type = 'chat_channel'
                AND public.chat__links_to(NEW.source_id, NEW.target_type, NEW.target_id)) THEN
      RAISE EXCEPTION 'Link a conversation from its Details.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.relation_kind IS DISTINCT FROM OLD.relation_kind
     AND 'conversation-of' IN (NEW.relation_kind, OLD.relation_kind) THEN
    RAISE EXCEPTION 'Link a conversation from its Details.' USING ERRCODE = '42501';
  END IF;
  -- An item's restore brings its links back; a conversation's only while the
  -- conversation still links to it.
  IF NEW.relation_kind = 'conversation-of' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
     AND NOT (NEW.source_type = 'chat_channel'
              AND public.chat__links_to(NEW.source_id, NEW.target_type, NEW.target_id)) THEN
    NEW.deleted_at := OLD.deleted_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS chat_guard_conversation_of ON public.entity_links;
CREATE TRIGGER chat_guard_conversation_of
  BEFORE INSERT OR UPDATE OF relation_kind, deleted_at, source_type, source_id, target_type, target_id
  ON public.entity_links
  FOR EACH ROW EXECUTE FUNCTION public.chat__guard_conversation_of();

-- ── 3. Linking ──────────────────────────────────────────────────────────────
-- The registry's name for a link target ('project' is how the app says bucket).
CREATE OR REPLACE FUNCTION public.chat__link_type(p_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v text := CASE lower(btrim(coalesce(p_type, ''))) WHEN 'project' THEN 'bucket' ELSE lower(btrim(coalesce(p_type, ''))) END;
BEGIN
  IF v NOT IN ('bucket', 'company', 'contact', 'team') THEN
    RAISE EXCEPTION 'A conversation links to a project, a client or a team.' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$function$;

-- p_user may link a conversation in p_workspace_id to (p_type, p_id): the item
-- is live in that workspace and p_user may edit it (a team: is in it, made it,
-- owns the workspace or is an admin). Raises with the reason otherwise.
-- Runs inside the ops as the caller (perm_can_edit_entity reads the actor).
CREATE OR REPLACE FUNCTION public.chat__check_link_target(p_workspace_id uuid, p_type text, p_id uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
BEGIN
  IF p_id IS NULL OR p_user IS NULL THEN
    RAISE EXCEPTION 'Pick what to link this conversation to.' USING ERRCODE = '22023';
  END IF;
  IF p_type = 'team' THEN
    IF NOT EXISTS (SELECT 1 FROM public.teams t
                    WHERE t.id = p_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'That team no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (EXISTS (SELECT 1 FROM public.team_members tm
                     WHERE tm.team_id = p_id AND tm.workspace_id = p_workspace_id
                       AND tm.user_id = p_user AND tm.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p_id AND t.created_by = p_user)
            OR public.perm_is_owner(p_workspace_id, p_user)
            OR public.perm_user_has(p_workspace_id, p_user, 'ws.manage_roles')) THEN
      RAISE EXCEPTION 'Only the team''s people and admins can link a conversation to it.' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;
  IF (p_type = 'bucket' AND NOT EXISTS (SELECT 1 FROM public.buckets b
                                             WHERE b.id = p_id AND b.workspace_id = p_workspace_id
                                               AND b.deleted_at IS NULL AND NOT b.is_system))
     OR (p_type = 'company' AND NOT EXISTS (SELECT 1 FROM public.companies x
                                              WHERE x.id = p_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL))
     OR (p_type = 'contact' AND NOT EXISTS (SELECT 1 FROM public.contacts x
                                              WHERE x.id = p_id AND x.workspace_id = p_workspace_id AND x.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'That item no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF p_type = 'bucket' AND EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = p_id AND b.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'That project is archived.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.perm_can_edit_entity(p_workspace_id, p_type, p_id) THEN
    RAISE EXCEPTION 'You need edit access to it to link a conversation.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Point the channel at (p_type, p_id), or at nothing, and keep the mirror row
-- in step. Checks are the callers'.
CREATE OR REPLACE FUNCTION public.chat__set_link(p_channel public.chat_channels, p_type text, p_id uuid, p_actor uuid)
RETURNS public.chat_channels
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_channel public.chat_channels;
BEGIN
  UPDATE public.chat_channels
     SET linked_type = p_type, linked_id = p_id,
         linked_at = CASE WHEN p_id IS NULL THEN NULL ELSE now() END
   WHERE id = p_channel.id
  RETURNING * INTO v_channel;

  -- The old mirror goes (the column no longer points at it).
  UPDATE public.entity_links l
     SET deleted_at = now()
   WHERE l.workspace_id = p_channel.workspace_id
     AND l.source_type = 'chat_channel' AND l.source_id = p_channel.id
     AND l.relation_kind = 'conversation-of' AND l.deleted_at IS NULL;

  IF p_id IS NOT NULL AND p_type <> 'team' THEN
    INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
    VALUES (v_channel.workspace_id, 'chat_channel', v_channel.id, v_channel.name, NULL)
    ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
    -- The item joins the registry if it isn't there yet (its name as the label).
    INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
    SELECT v_channel.workspace_id, p_type, p_id,
           coalesce(CASE p_type
             WHEN 'bucket' THEN (SELECT b.name FROM public.buckets b WHERE b.id = p_id)
             WHEN 'company' THEN (SELECT x.name FROM public.companies x WHERE x.id = p_id)
             WHEN 'contact' THEN (SELECT x.name FROM public.contacts x WHERE x.id = p_id)
           END, ''), NULL
    ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
    INSERT INTO public.entity_links
      (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
    VALUES
      (v_channel.workspace_id, 'chat_channel', v_channel.id, p_type, p_id, 'conversation-of', 'manual', p_actor)
    ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
    DO NOTHING;
  END IF;

  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
    'chat.channel_link',
    CASE WHEN p_id IS NULL THEN jsonb_build_object('linked_type', NULL, 'linked_id', NULL)
         ELSE jsonb_build_object('linked_type', p_type, 'linked_id', p_id) END);
  RETURN v_channel;
END;
$function$;

-- chat_op_link_channel(channel, type, id): link the conversation to a
-- project, client or team, relink it, or unlink it (type and id null). Any
-- member who can post in it may; linking also needs edit rights on the item.
CREATE OR REPLACE FUNCTION public.chat_op_link_channel(p_channel_id uuid, p_type text DEFAULT NULL, p_id uuid DEFAULT NULL)
RETURNS public.chat_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_type text;
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages don''t link to anything.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_members mb
                  WHERE mb.channel_id = p_channel_id AND mb.user_id = v_me AND mb.left_at IS NULL)
     OR NOT public.chat__can_post(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only people who can post here can change what it links to.' USING ERRCODE = '42501';
  END IF;
  IF (p_type IS NULL) <> (p_id IS NULL) THEN
    RAISE EXCEPTION 'Pick what to link this conversation to.' USING ERRCODE = '22023';
  END IF;

  -- One order with the other channel ops: the channel row first.
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF p_id IS NULL THEN
    IF v_channel.linked_id IS NULL THEN
      RETURN v_channel;
    END IF;
    RETURN public.chat__set_link(v_channel, NULL, NULL, v_me);
  END IF;

  v_type := public.chat__link_type(p_type);
  IF v_channel.linked_type = v_type AND v_channel.linked_id = p_id THEN
    RETURN v_channel;
  END IF;
  PERFORM public.chat__check_link_target(v_channel.workspace_id, v_type, p_id, v_me);
  RETURN public.chat__set_link(v_channel, v_type, p_id, v_me);
END;
$function$;

-- ── 4. Creating a channel with a link (from CV-2b's live body) ──────────────
DROP FUNCTION IF EXISTS public.chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean);
CREATE OR REPLACE FUNCTION public.chat_op_create_channel(p_workspace_id uuid, p_name text, p_topic text DEFAULT ''::text, p_is_private boolean DEFAULT false, p_member_ids uuid[] DEFAULT '{}'::uuid[], p_announcement boolean DEFAULT false, p_link_type text DEFAULT NULL::text, p_link_id uuid DEFAULT NULL::uuid)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_name text;
  v_topic text;
  v_private boolean := coalesce(p_is_private, false);
  v_channel public.chat_channels;
  v_uid uuid;
  v_link_type text;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  IF v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_private') THEN
    RAISE EXCEPTION 'Your role can''t create private channels.' USING ERRCODE = '42501';
  ELSIF NOT v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_public') THEN
    RAISE EXCEPTION 'Your role can''t create channels.' USING ERRCODE = '42501';
  END IF;
  -- CV-13: the optional link, checked before anything is made.
  IF (p_link_type IS NULL) <> (p_link_id IS NULL) THEN
    RAISE EXCEPTION 'Pick what to link this conversation to.' USING ERRCODE = '22023';
  END IF;
  IF p_link_id IS NOT NULL THEN
    v_link_type := public.chat__link_type(p_link_type);
    PERFORM public.chat__check_link_target(p_workspace_id, v_link_type, p_link_id, v_me);
  END IF;
  v_name := public.chat__channel_name(p_name);
  v_topic := public.chat__channel_topic(p_topic);
  -- The name clashes only with channels the creator can see.
  PERFORM public.chat__lock_name(p_workspace_id, v_name);
  IF public.chat__name_taken(p_workspace_id, v_name, NULL, v_me) THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.chat_channels (workspace_id, kind, name, topic, is_private, managers_only, created_by)
    VALUES (p_workspace_id, 'channel', v_name, v_topic, v_private, coalesce(p_announcement, false), v_me)
    RETURNING * INTO v_channel;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END;

  -- The creator is on Mentions and replies, like everyone (AC1.7).
  PERFORM public.chat__enter(v_channel.id, p_workspace_id, v_me);
  FOREACH v_uid IN ARRAY coalesce(p_member_ids, '{}'::uuid[]) LOOP
    IF v_uid IS NOT NULL AND v_uid <> v_me AND public.chat_is_workspace_member(p_workspace_id, v_uid) THEN
      PERFORM public.chat__enter(v_channel.id, p_workspace_id, v_uid);
    END IF;
  END LOOP;

  PERFORM public.entities_op_upsert(p_workspace_id, 'chat_channel', v_channel.id, v_name, NULL);
  PERFORM public.module_activity_log(p_workspace_id, 'chat', 'chat_channel', v_channel.id,
    'chat.channel_create', jsonb_build_object('is_private', v_channel.is_private));
  IF p_link_id IS NOT NULL THEN
    v_channel := public.chat__set_link(v_channel, v_link_type, p_link_id, v_me);
  END IF;
  RETURN v_channel;
END;
$function$;

-- ── 5. "Start a conversation for X" (CH56) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_op_start_conversation(p_workspace_id uuid, p_type text, p_id uuid)
RETURNS public.chat_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_type text;
  v_label text;
  v_base text;
  v_name text;
  v_n integer := 1;
  v_readers uuid[];
  v_seeing uuid[];
  v_private boolean;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  v_type := public.chat__link_type(p_type);
  IF v_type = 'team' THEN
    RAISE EXCEPTION 'Start a conversation for a project or a client.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.chat__check_link_target(p_workspace_id, v_type, p_id, v_me);

  v_label := CASE v_type
    WHEN 'bucket' THEN (SELECT b.name FROM public.buckets b WHERE b.id = p_id)
    WHEN 'company' THEN (SELECT x.name FROM public.companies x WHERE x.id = p_id)
    WHEN 'contact' THEN (SELECT x.name FROM public.contacts x WHERE x.id = p_id)
  END;
  v_base := btrim(regexp_replace(coalesce(v_label, ''), '[[:cntrl:]]+', ' ', 'g'));
  IF v_base = '' THEN
    v_base := 'Conversation';
  END IF;
  v_base := btrim(left(v_base, 75));

  -- Who can use chat here, and which of them can see X.
  SELECT coalesce(array_agg(u.id), '{}'::uuid[]),
         coalesce(array_agg(u.id) FILTER (WHERE public.spine__visible_to(p_workspace_id, v_type, p_id, u.id)), '{}'::uuid[])
    INTO v_readers, v_seeing
    FROM (SELECT w.owner_id AS id FROM public.workspaces w WHERE w.id = p_workspace_id
          UNION
          SELECT wm.user_id FROM public.workspace_members wm WHERE wm.workspace_id = p_workspace_id) u
   WHERE public.chat__reads_workspace(p_workspace_id, u.id);
  v_private := cardinality(v_seeing) < cardinality(v_readers);

  -- Named after X; " 2", " 3" on a clash with a channel the creator can see.
  LOOP
    v_name := CASE WHEN v_n = 1 THEN v_base ELSE v_base || ' ' || v_n END;
    PERFORM public.chat__lock_name(p_workspace_id, v_name);
    EXIT WHEN NOT public.chat__name_taken(p_workspace_id, v_name, NULL, v_me)
          AND (v_private OR NOT EXISTS (SELECT 1 FROM public.chat_channels c
                                          WHERE c.workspace_id = p_workspace_id AND c.kind = 'channel'
                                            AND c.deleted_at IS NULL AND NOT c.is_private
                                            AND lower(c.name) = lower(v_name)));
    v_n := v_n + 1;
    IF v_n > 99 THEN
      RAISE EXCEPTION 'A channel named "%" already exists.', v_base USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN public.chat_op_create_channel(p_workspace_id, v_name, '', v_private,
    CASE WHEN v_private THEN v_seeing ELSE '{}'::uuid[] END, false, v_type, p_id);
END;
$function$;

-- Capture from a linked channel files into its project when the caller may
-- add to it (CV-10's destination): true only for a reader of the channel
-- whose linked project is live, not archived, and editable by them.
CREATE OR REPLACE FUNCTION public.chat_link_files_here(p_channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.chat_channels c
      JOIN public.buckets b ON b.id = c.linked_id AND b.workspace_id = c.workspace_id
     WHERE c.id = p_channel_id AND c.deleted_at IS NULL AND c.linked_type = 'bucket'
       AND b.deleted_at IS NULL AND b.archived_at IS NULL AND NOT b.is_system
       AND auth.uid() IS NOT NULL
       AND public.chat_can_read_channel(c.id)
       AND public.perm_can_edit_entity(c.workspace_id, 'bucket', b.id))
$function$;

-- ── 6. The item's conversations: mentions half (CV-10) + link half ──────────
DROP FUNCTION IF EXISTS public.chat_conversations_for_item(text, uuid);
CREATE OR REPLACE FUNCTION public.chat_conversations_for_item(p_type text, p_id uuid)
 RETURNS TABLE(channel_id uuid, workspace_id uuid, channel_kind text, channel_name text, channel_private boolean,
               relation text, since timestamp with time zone, unread integer, archived boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH item AS (
    SELECT CASE p_type WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread' ELSE p_type END AS t
  ), hits AS (
    SELECT l.workspace_id,
           CASE WHEN l.source_type = 'chat_channel' THEN l.source_id ELSE l.target_id END AS cid,
           'mentions'::text AS rel,
           min(l.created_at) AS since
      FROM public.entity_links l, item
     WHERE auth.uid() IS NOT NULL
       AND l.deleted_at IS NULL
       AND l.relation_kind = 'mentions'
       AND ((l.source_type = 'chat_channel' AND l.target_type = item.t AND l.target_id = p_id)
         OR (l.target_type = 'chat_channel' AND l.source_type = item.t AND l.source_id = p_id))
     GROUP BY 1, 2
    UNION ALL
    -- The link half reads the channel's own column (a team has no mirror row).
    SELECT c.workspace_id, c.id, 'conversation-of'::text, coalesce(c.linked_at, c.created_at)
      FROM public.chat_channels c, item
     WHERE auth.uid() IS NOT NULL
       AND c.linked_type = item.t AND c.linked_id = p_id
  )
  SELECT c.id, c.workspace_id, c.kind,
         CASE WHEN c.kind = 'channel' THEN c.name END,
         c.is_private, h.rel, h.since,
         CASE WHEN h.rel = 'conversation-of' THEN
           coalesce((SELECT u.unread FROM public.chat_unread_counts(c.workspace_id) u WHERE u.channel_id = c.id), 0)
         END,
         c.archived_at IS NOT NULL
    FROM hits h
    JOIN public.chat_channels c ON c.id = h.cid AND c.workspace_id = h.workspace_id AND c.deleted_at IS NULL
    , item
   WHERE public.chat_can_read_channel(c.id)
     AND public.perm_can_see_entity(h.workspace_id, item.t, p_id)
   ORDER BY h.rel = 'mentions', h.since DESC, c.id
   LIMIT 50
$function$;

-- ── 7. Grants (re-stated by name; DROP + CREATE reset them) ─────────────────
DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only the ops and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__links_to(uuid, text, uuid)',
    'chat__link_type(text)',
    'chat__check_link_target(uuid, text, uuid, uuid)',
    'chat__set_link(public.chat_channels, text, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must not be callable by clients.', fn;
    END IF;
  END LOOP;
  -- The ops and the read: signed-in people and the service role, never anon.
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_link_channel(uuid, text, uuid)',
    'chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean, text, uuid)',
    'chat_op_start_conversation(uuid, text, uuid)',
    'chat_conversations_for_item(text, uuid)',
    'chat_link_files_here(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  -- The trigger function: nobody calls it directly.
  REVOKE ALL ON FUNCTION public.chat__guard_conversation_of() FROM PUBLIC, anon, authenticated;
END;
$$;

-- Chat v2 · CV-13 Linked channels (specs/chat-v2.md §8, §12; CH56, CH57;
-- §Assumptions #6, #25; .design/chat-v2/research/round-3-database.md §2.21).
-- The stamp is provisional: re-cut on the day it applies; it must stay after
-- …_chat_v2_mention_rows (CV-10-fix: chat_conversations_for_item's mentions
-- half, chat__mentions / chat__mentions_inline), …_chat_v2_references (CV-10,
-- chat__body_refs) and CV-2b's conversation ops (chat_op_create_channel's
-- 6-argument body). Every redefined function starts from its live body on the
-- local stack (2026-10-16, with CV-10-fix, CV-11, CV-17 and CV-9 applied). It
-- runs again cleanly over itself.
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
--   8. The server reads item references with the client's grammar
--      (chat__body_refs on chat__mentions' block walk and inline reader).
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
    'conversation-of'::text])) NOT VALID;
-- Checked apart from the ALTER, so the table isn't held for the whole scan.
ALTER TABLE public.entity_links VALIDATE CONSTRAINT entity_links_relation_kind_check;

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
  -- A live row never moves to another conversation or item.
  IF NEW.relation_kind = 'conversation-of' AND NEW.deleted_at IS NULL
     AND (NEW.source_type, NEW.source_id, NEW.target_type, NEW.target_id)
         IS DISTINCT FROM (OLD.source_type, OLD.source_id, OLD.target_type, OLD.target_id)
     AND NOT (NEW.source_type = 'chat_channel'
              AND public.chat__links_to(NEW.source_id, NEW.target_type, NEW.target_id)) THEN
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

  -- Relinking to an item it linked to before brings that row back (one row
  -- per conversation and item); a new item gets a new row.
  IF p_id IS NOT NULL AND p_type <> 'team' THEN
    UPDATE public.entity_links l
       SET deleted_at = NULL
     WHERE l.id = (SELECT x.id FROM public.entity_links x
                    WHERE x.workspace_id = v_channel.workspace_id
                      AND x.source_type = 'chat_channel' AND x.source_id = v_channel.id
                      AND x.target_type = p_type AND x.target_id = p_id
                      AND x.relation_kind = 'conversation-of' AND x.deleted_at IS NOT NULL
                    ORDER BY x.deleted_at DESC, x.created_at DESC
                    LIMIT 1);
  END IF;

  IF p_id IS NOT NULL AND p_type <> 'team'
     AND NOT EXISTS (SELECT 1 FROM public.entity_links l
                      WHERE l.workspace_id = v_channel.workspace_id
                        AND l.source_type = 'chat_channel' AND l.source_id = v_channel.id
                        AND l.relation_kind = 'conversation-of' AND l.deleted_at IS NULL) THEN
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
  -- Already linked there: nothing to do, unless its row went (an item's
  -- delete and restore can leave it gone), which relinking brings back.
  IF v_channel.linked_type = v_type AND v_channel.linked_id = p_id
     AND (v_type = 'team' OR EXISTS (SELECT 1 FROM public.entity_links l
                                       WHERE l.workspace_id = v_channel.workspace_id
                                         AND l.source_type = 'chat_channel' AND l.source_id = v_channel.id
                                         AND l.relation_kind = 'conversation-of' AND l.deleted_at IS NULL)) THEN
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

-- ── 6. The item's conversations: mentions half (CV-10-fix, live body) + link half
-- The mentions half is CV-10-fix's as live: only the rows chat__link_mentions
-- writes (the conversation as the source, relation `mentions`, origin `ref`).
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
    -- The rows chat__link_mentions writes: the conversation as the source,
    -- relation `mentions`, origin `ref`.
    SELECT l.workspace_id, l.source_id AS cid, 'mentions'::text AS rel, min(l.created_at) AS since
      FROM public.entity_links l, item
     WHERE auth.uid() IS NOT NULL
       AND l.deleted_at IS NULL
       AND l.relation_kind = 'mentions'
       AND l.origin = 'ref'
       AND l.source_type = 'chat_channel'
       AND l.target_type = item.t AND l.target_id = p_id
     GROUP BY 1, 2
    UNION ALL
    -- The link half reads the channel's own column (a team has no mirror row).
    SELECT c.workspace_id, c.id, 'conversation-of'::text, coalesce(c.linked_at, c.created_at)
      FROM public.chat_channels c, item
     WHERE auth.uid() IS NOT NULL
       AND c.linked_type = item.t AND c.linked_id = p_id
  ), unread AS MATERIALIZED (
    -- The caller's unread counts, read once per workspace and only when a
    -- conversation links here.
    SELECT u.channel_id, u.unread
      FROM (SELECT DISTINCT h.workspace_id FROM hits h WHERE h.rel = 'conversation-of') w,
           LATERAL public.chat_unread_counts(w.workspace_id) u
  )
  SELECT c.id, c.workspace_id, c.kind,
         CASE WHEN c.kind = 'channel' THEN c.name END,
         c.is_private, h.rel, h.since,
         CASE WHEN h.rel = 'conversation-of' THEN coalesce(un.unread, 0) END,
         c.archived_at IS NOT NULL
    FROM hits h
    JOIN public.chat_channels c ON c.id = h.cid AND c.workspace_id = h.workspace_id AND c.deleted_at IS NULL
    LEFT JOIN unread un ON un.channel_id = c.id AND h.rel = 'conversation-of'
    , item
   WHERE public.chat_can_read_channel(c.id)
     AND public.perm_can_see_entity(h.workspace_id, item.t, p_id)
   ORDER BY h.rel = 'mentions', h.since DESC, c.id
   LIMIT 50
$function$;

-- ── 6b. The link row is changed from the conversation (live bodies, CV-10-fix) ──
-- links_op_delete and contacts_op_unlink refuse a `conversation-of` row, as
-- they refuse Chat's "Mentioned in" rows; the item's own delete still
-- closes it. Grants unchanged (CREATE OR REPLACE keeps them).
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
  -- A conversation's link to its item is changed from the conversation (CV-13).
  IF v_link.relation_kind = 'conversation-of' THEN
    RAISE EXCEPTION 'Unlink it from the conversation''s Details.' USING ERRCODE = '42501';
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
  -- A conversation's link to its item is changed from the conversation (CV-13).
  IF v_link.relation_kind = 'conversation-of' THEN
    RAISE EXCEPTION 'Unlink it from the conversation''s Details.' USING ERRCODE = '42501';
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

-- ── 7. References, read with the client's grammar ──────────────────────────
-- chat__body_refs (CV-10) read item references with a regex over the body
-- after dropping fences and single-backtick spans. It now reads them the way
-- the client's parseStored + mentionsOf do, with the one block walk and inline
-- reader chat__mentions already uses (CV-10-fix, live bodies): code spans of
-- any backtick length, backslash escapes, quotes and list items, and a link's
-- target is never a reference (`[title](moduo://…)` is one, like the bare URI).
--   chat__body_runs(body)   the block walk: each paragraph, quote and list
--                           item's inline text, fenced code left out.
--   chat__inline_scan(run)  the inline reader: every `type/uuid` reference in
--                           order, each once, and whether `@channel` appears.
--   chat__mentions_inline / chat__mentions keep their signatures and results;
--   chat__body_refs keeps its signature (first appearance order, at most 100).

CREATE OR REPLACE FUNCTION public.chat__body_runs(p_body text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  v_lines text[];
  n integer;
  i integer := 1;
  v_runs text[] := '{}';
  v_line text;
  m text[];
  v_size integer;
  v_body text[];
  v_item text[];
  v_first text[];
  v_mark text[];
  v_next text[];
  v_indent integer;
  v_para text[];
  v_prev text;
  v_cand text;
  v_cut boolean;
BEGIN
  IF p_body IS NULL THEN
    RETURN v_runs;
  END IF;
  -- The block walk is chat__body_text's; it collects the inline runs.
  v_lines := string_to_array(regexp_replace(p_body, E'\r\n?', E'\n', 'g'), E'\n');
  n := cardinality(v_lines);
  WHILE i <= n LOOP
    v_line := v_lines[i];
    m := regexp_match(v_line, '^ {0,3}(`{3,})([^`]*)$');
    IF m IS NOT NULL THEN
      v_size := length(m[1]);
      i := i + 1;
      WHILE i <= n LOOP
        m := regexp_match(v_lines[i], '^ {0,3}(`+)[ \t]*$');
        EXIT WHEN m IS NOT NULL AND length(m[1]) >= v_size;
        i := i + 1;
      END LOOP;
      i := i + 1;
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    IF v_line ~ '^ {0,3}>' THEN
      v_body := '{}';
      WHILE i <= n AND v_lines[i] ~ '^ {0,3}>' LOOP
        v_body := v_body || substring(v_lines[i] FROM '^ {0,3}> ?(.*)$');
        i := i + 1;
      END LOOP;
      v_runs := v_runs || array_to_string(v_body, E'\n');
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    v_first := public.chat__list_marker(v_line);
    IF v_first IS NOT NULL THEN
      v_mark := v_first;
      WHILE v_mark IS NOT NULL LOOP
        v_item := ARRAY[v_mark[5]];
        v_indent := v_mark[4]::integer;
        i := i + 1;
        LOOP
          EXIT WHEN i > n OR v_lines[i] = '';
          IF v_lines[i] ~ '^[[:space:]]+$' THEN
            v_item := v_item || CASE WHEN length(v_lines[i]) > v_indent THEN substr(v_lines[i], v_indent + 1) ELSE '' END;
          ELSIF left(v_lines[i], v_indent) = repeat(' ', v_indent) THEN
            v_item := v_item || substr(v_lines[i], v_indent + 1);
          ELSE
            EXIT;
          END IF;
          i := i + 1;
        END LOOP;
        v_runs := v_runs || array_to_string(v_item, E'\n');
        v_next := CASE WHEN i <= n THEN public.chat__list_marker(v_lines[i]) END;
        v_mark := CASE WHEN v_next IS NOT NULL AND v_next[1] = v_first[1] AND v_next[2] = v_first[2]
                       THEN v_next END;
      END LOOP;
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    v_para := ARRAY[v_line];
    i := i + 1;
    LOOP
      EXIT WHEN i > n;
      v_cand := v_lines[i];
      v_prev := v_lines[i - 1];
      IF v_cand ~ '^ {0,3}(`{3,})([^`]*)$' OR v_cand ~ '^ {0,3}>' THEN
        v_cut := true;
      ELSE
        v_mark := public.chat__list_marker(v_cand);
        v_cut := v_mark IS NOT NULL AND (
          v_prev = ''
          OR (btrim(v_mark[5], E' \t\n\r\f\v') <> ''
              AND (v_mark[1] = 'f' OR v_mark[3]::bigint = 1)));
      END IF;
      EXIT WHEN v_cut;
      v_para := v_para || v_cand;
      i := i + 1;
    END LOOP;
    IF i <= n AND cardinality(v_para) > 1 AND v_para[cardinality(v_para)] = '' THEN
      v_para := v_para[1:cardinality(v_para) - 1];
    ELSIF i <= n AND cardinality(v_para) = 1 AND v_para[1] = '' THEN
      CONTINUE;
    END IF;
    v_runs := v_runs || array_to_string(v_para, E'\n');
  END LOOP;
  RETURN v_runs;
END
$function$;

CREATE OR REPLACE FUNCTION public.chat__inline_scan(p_src text, OUT refs text[], OUT everyone boolean)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  c text[];
  cn integer;
  i integer;
  j integer;
  r integer;
  m text[];
  v_run integer;
  v_close integer;
  v_budget integer;
  v_ws boolean;          -- what was read last ends in whitespace (or a line starts)
  v_lbs integer[];       -- positions of a '[' that may still open a link
  v_ref_at integer;      -- position after the last reference, link or line break
  v_lb integer;
  v_href text;
  v_depth integer;
  v_ok boolean;
  v_code text;
  v_after text;
  v_before text;
  v_ref text;
  v_last_star integer;
  v_last_tilde integer;
  v_uri constant text :=
    '^moduo://(?:date/([0-9]{4}-[0-9]{2}-[0-9]{2})|([a-z][a-z_-]{0,31})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))';
BEGIN
  refs := '{}';
  everyone := false;
  IF p_src IS NULL OR p_src = '' THEN
    RETURN;
  END IF;
  v_budget := 2 * char_length(p_src) + 1000;
  c := regexp_split_to_array(p_src, '');
  cn := cardinality(c);
  i := 1;
  v_ws := true;
  v_lbs := '{}';
  v_ref_at := 0;
  WHILE i <= cn LOOP
    -- At a line's start: where its last run that could close emphasis starts,
    -- per character (an opener with no such run to its right on its line is
    -- text: `a **@channel`; a line break ends every mark).
    IF i = 1 OR c[i - 1] = E'\n' THEN
      v_last_star := 0;
      v_last_tilde := 0;
      j := i + 1;
      WHILE j <= cn AND c[j] <> E'\n' LOOP
        IF (c[j] = '*' OR c[j] = '~') AND c[j - 1] <> c[j] AND c[j - 1] !~ '[[:space:]]' THEN
          IF c[j] = '*' THEN
            v_last_star := j;
          ELSIF j < cn AND c[j + 1] = '~' AND (j + 2 > cn OR c[j + 2] <> '~') THEN
            v_last_tilde := j;
          END IF;
        END IF;
        j := j + 1;
      END LOOP;
    END IF;
    -- Plain text up to the next character that can mean something.
    IF c[i] !~ '[\\`m\[\]*~@[:space:]]' THEN
      j := i + 1;
      WHILE j <= cn AND c[j] !~ '[\\`m\[\]*~@[:space:]]' LOOP
        j := j + 1;
      END LOOP;
      v_ws := false;
      i := j;
      CONTINUE;
    END IF;
    IF c[i] ~ '[[:space:]]' THEN
      IF c[i] = E'\n' THEN
        v_ref_at := i + 1;   -- a '[' before a line break opens no link after it
      END IF;
      v_ws := true;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = '\' THEN
      -- An escaped character is text (so `moduo\://` is no reference); an
      -- escaped `@` is the text "@", which may still start `@channel`.
      IF i < cn AND c[i + 1] = '@' THEN
        i := i + 1;
        CONTINUE;
      END IF;
      i := i + CASE WHEN i < cn AND c[i + 1] ~ '^[!-/:-@\[-`{-~]$' THEN 2 ELSE 1 END;
      v_ws := false;
      CONTINUE;
    END IF;
    IF c[i] = '`' THEN
      v_run := 1;
      WHILE i + v_run <= cn AND c[i + v_run] = '`' LOOP
        v_run := v_run + 1;
      END LOOP;
      j := i + v_run;
      v_close := -1;
      WHILE j <= cn AND c[j] <> E'\n' AND v_budget > 0 LOOP
        v_budget := v_budget - 1;
        IF c[j] = '`' THEN
          r := 1;
          WHILE j + r <= cn AND c[j + r] = '`' LOOP
            r := r + 1;
          END LOOP;
          IF r = v_run THEN
            v_close := j;
            EXIT;
          END IF;
          j := j + r;
        ELSE
          j := j + 1;
        END IF;
      END LOOP;
      IF v_close < 0 THEN
        v_ws := false;
        i := i + v_run;
        CONTINUE;
      END IF;
      v_code := array_to_string(c[i + v_run:v_close - 1], '');
      IF length(v_code) >= 2 AND left(v_code, 1) = ' ' AND right(v_code, 1) = ' ' AND v_code !~ '^ +$' THEN
        v_code := substr(v_code, 2, length(v_code) - 2);
      END IF;
      v_ws := v_code ~ '[[:space:]]$';
      i := v_close + v_run;
      CONTINUE;
    END IF;
    IF c[i] = 'm' THEN
      IF c[i + 1] = 'o' AND array_to_string(c[i:i + 7], '') = 'moduo://' THEN
        m := regexp_match(array_to_string(c[i:i + 80], ''), v_uri);
        IF m IS NOT NULL AND (m[1] IS NULL OR public.chat__is_iso_day(m[1])) THEN
          IF m[2] IS NOT NULL THEN
            v_ref := m[2] || '/' || m[3]::uuid::text;
            IF NOT v_ref = ANY (refs) THEN
              refs := refs || v_ref;
            END IF;
          END IF;
          i := i + length(CASE WHEN m[1] IS NOT NULL THEN 'moduo://date/' || m[1]
                               ELSE 'moduo://' || m[2] || '/' || m[3] END);
          v_ref_at := i;
          v_ws := false;
          CONTINUE;
        END IF;
      END IF;
      v_ws := false;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = '[' THEN
      v_lbs := v_lbs || i;
      v_ws := false;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = ']' THEN
      v_lb := CASE WHEN cardinality(v_lbs) > 0 THEN v_lbs[cardinality(v_lbs)] END;
      v_ok := false;
      IF v_lb IS NOT NULL AND i < cn AND c[i + 1] = '(' AND v_ref_at <= v_lb AND i > v_lb + 1 THEN
        -- The destination, as chat__inline_text reads it.
        j := i + 2;
        v_href := '';
        IF j <= cn AND c[j] = '<' THEN
          j := j + 1;
          WHILE j <= cn AND c[j] <> '>' AND v_budget > 0 LOOP
            v_budget := v_budget - 1;
            EXIT WHEN c[j] = E'\n' OR c[j] = '<';
            IF c[j] = '\' AND j < cn AND c[j + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
              v_href := v_href || c[j + 1];
              j := j + 2;
            ELSE
              v_href := v_href || c[j];
              j := j + 1;
            END IF;
          END LOOP;
          IF j <= cn AND c[j] = '>' THEN
            j := j + 1;
            v_ok := j <= cn AND c[j] = ')';
          END IF;
        ELSE
          v_depth := 0;
          WHILE j <= cn AND v_budget > 0 LOOP
            v_budget := v_budget - 1;
            EXIT WHEN c[j] ~ '[[:space:]]' OR ascii(c[j]) < 32;
            IF c[j] = '\' AND j < cn AND c[j + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
              v_href := v_href || c[j + 1];
              j := j + 2;
              CONTINUE;
            END IF;
            IF c[j] = '(' THEN
              v_depth := v_depth + 1;
            ELSIF c[j] = ')' THEN
              EXIT WHEN v_depth = 0;
              v_depth := v_depth - 1;
            END IF;
            v_href := v_href || c[j];
            j := j + 1;
          END LOOP;
          v_ok := v_depth = 0 AND j <= cn AND c[j] = ')';
        END IF;
        IF v_ok THEN
          m := regexp_match(v_href, v_uri || '$');
          IF m IS NOT NULL AND (m[2] IS NOT NULL OR public.chat__is_iso_day(m[1])) THEN
            -- `[title](moduo://…)` reads as the bare reference.
            IF m[2] IS NOT NULL THEN
              v_ref := m[2] || '/' || m[3]::uuid::text;
              IF NOT v_ref = ANY (refs) THEN
                refs := refs || v_ref;
              END IF;
            END IF;
          ELSIF m IS NULL AND v_href ~* '^(https?://[^[:space:]]+|mailto:[^[:space:]]+)$'
                AND v_href !~ '[\x01-\x1f\x7f]' THEN
            NULL;   -- a link: its target is never read
          ELSE
            v_ok := false;
          END IF;
        END IF;
        IF v_ok THEN
          v_lbs := '{}';
          v_ref_at := j + 1;
          v_ws := false;
          i := j + 1;
          CONTINUE;
        END IF;
      END IF;
      IF v_lb IS NOT NULL THEN
        v_lbs := v_lbs[1:cardinality(v_lbs) - 1];
      END IF;
      v_ws := false;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = '*' OR c[i] = '~' THEN
      v_run := 1;
      WHILE i + v_run <= cn AND c[i + v_run] = c[i] LOOP
        v_run := v_run + 1;
      END LOOP;
      v_before := CASE WHEN i > 1 THEN c[i - 1] END;
      v_after := CASE WHEN i + v_run <= cn THEN c[i + v_run] END;
      IF (c[i] = '~' AND v_run <> 2)
         OR ((v_after IS NULL OR v_after ~ '[[:space:]]') AND (v_before IS NULL OR v_before ~ '[[:space:]]'))
         -- an opener only, with nothing to close it on its right
         OR ((v_before IS NULL OR v_before ~ '[[:space:]]')
             AND CASE c[i] WHEN '*' THEN v_last_star ELSE v_last_tilde END <= i) THEN
        v_ws := false;   -- text
      END IF;            -- an emphasis marker: transparent
      i := i + v_run;
      CONTINUE;
    END IF;
    -- '@'
    -- A whole word: what follows isn't a word character of the same text
    -- (a reference right after it ends the text).
    IF v_ws AND array_to_string(c[i:i + 7], '') = '@channel'
       AND (i + 8 > cn OR c[i + 8] !~ '[A-Za-z0-9_-]'
            OR (array_to_string(c[i + 8:i + 15], '') = 'moduo://'
                AND public.chat__mentions_ref_at(array_to_string(c[i + 8:i + 88], '')))) THEN
      everyone := true;
      i := i + 8;
    ELSE
      i := i + 1;
    END IF;
    v_ws := false;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.chat__mentions(p_body text, OUT people uuid[], OUT teams uuid[], OUT everyone boolean)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  v_run text;
  mt record;
  v_id uuid;
BEGIN
  people := '{}';
  teams := '{}';
  everyone := false;
  IF p_body IS NULL OR p_body !~ '(moduo|@channel)' THEN
    RETURN;
  END IF;
  FOREACH v_run IN ARRAY public.chat__body_runs(p_body) LOOP
    CONTINUE WHEN v_run !~ '(moduo|@channel)';
    SELECT * INTO mt FROM public.chat__mentions_inline(v_run);
    everyone := everyone OR mt.everyone;
    FOREACH v_id IN ARRAY mt.people LOOP
      IF NOT v_id = ANY (people) THEN people := people || v_id; END IF;
    END LOOP;
    FOREACH v_id IN ARRAY mt.teams LOOP
      IF NOT v_id = ANY (teams) THEN teams := teams || v_id; END IF;
    END LOOP;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.chat__mentions_inline(p_src text, OUT people uuid[], OUT teams uuid[], OUT everyone boolean)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT coalesce(array_agg(split_part(u.r, '/', 2)::uuid ORDER BY u.o)
                    FILTER (WHERE split_part(u.r, '/', 1) = 'person'), '{}'::uuid[]),
         coalesce(array_agg(split_part(u.r, '/', 2)::uuid ORDER BY u.o)
                    FILTER (WHERE split_part(u.r, '/', 1) = 'team'), '{}'::uuid[]),
         s.everyone
    FROM public.chat__inline_scan(p_src) s
    LEFT JOIN LATERAL unnest(s.refs) WITH ORDINALITY AS u(r, o) ON true
   GROUP BY s.everyone
$function$;

CREATE OR REPLACE FUNCTION public.chat__body_refs(p_body text)
 RETURNS TABLE(ref_type text, ref_id uuid)
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
DECLARE
  v_refs text[] := '{}';
  v_run text;
  v_ref text;
BEGIN
  IF p_body IS NULL OR position('moduo://' IN p_body) = 0 THEN
    RETURN;
  END IF;
  <<runs>>
  FOREACH v_run IN ARRAY public.chat__body_runs(p_body) LOOP
    CONTINUE WHEN position('moduo://' IN v_run) = 0;
    FOREACH v_ref IN ARRAY (SELECT s.refs FROM public.chat__inline_scan(v_run) s) LOOP
      IF NOT v_ref = ANY (v_refs) THEN
        v_refs := v_refs || v_ref;
        EXIT runs WHEN cardinality(v_refs) >= 100;
      END IF;
    END LOOP;
  END LOOP;
  RETURN QUERY
    SELECT split_part(u.r, '/', 1), split_part(u.r, '/', 2)::uuid
      FROM unnest(v_refs) WITH ORDINALITY AS u(r, o)
     ORDER BY u.o;
END
$function$;

-- ── 8. Grants (re-stated by name; DROP + CREATE reset them) ─────────────────
DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only the ops and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__links_to(uuid, text, uuid)',
    'chat__link_type(text)',
    'chat__check_link_target(uuid, text, uuid, uuid)',
    'chat__set_link(public.chat_channels, text, uuid, uuid)',
    'chat__body_runs(text)',
    'chat__inline_scan(text)',
    'chat__mentions_inline(text)',
    'chat__mentions(text)',
    'chat__body_refs(text)'
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

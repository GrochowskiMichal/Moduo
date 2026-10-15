-- Chat v2 · CV-2b conversation ops (specs/chat-v2.md §1, §2, §12; §Assumptions
-- #1, #11, #13, #15, #25, #30; .design/chat-v2/research/round-3-database.md §2.3,
-- §2.4, §2.23). The stamp is provisional: re-cut on the day it applies, after
-- …_chat_v2_core_ops (CV-2a) and …_chat_v2_plan_source (CV-4). It runs again
-- cleanly over itself.
--
-- What it does:
--   1. Channel names are as typed: trimmed, one line, 1–80 characters, unique
--      in the workspace ignoring case among live channels (refused with 23505).
--      Topics are up to 250 characters.
--   2. Who may do what is §12's table: Admin = the workspace owner or a role
--      with "Manage any channel"; Manager = the channel's managers who are in
--      it and in a role that posts; Poster = a role that can post (managers
--      only in an announcement channel).
--   3. Membership is a stamp, never a deleted row: leaving stamps left_at,
--      a removal stamps left_at + removed_by (the removed person's own row
--      changes, so the change reaches them live). Someone a manager removed
--      comes back only when a manager or admin adds them. A last manager who
--      leaves (or is removed) hands the channel to the workspace owner if they
--      can read it, else to its earliest remaining member whose role posts.
--   4. General: one is_default channel per workspace. chat_op_bootstrap makes
--      it if missing (or flags a live public "general") and joins every member
--      who has no row in it; a trigger on workspace_members joins new members
--      (a left_at row keeps someone out: leaving General sticks). Never into a
--      private conversation.
--   5. The read mark is a message: chat_op_mark_read(channel, message) moves
--      last_read_id forward only; chat_op_mark_unread(channel, message) moves
--      it to just before that message. v1's (channel, timestamp) signatures
--      stay as wrappers until CV-3 (v1's screens call them).
--   6. Reads: chat_unread_counts(ws) counts replies and reads the mark as a
--      message, and answers per conversation the number addressed to you and
--      its share of Catch up's count (an "Every message" conversation is one
--      item); chat_sync_ids(ws, since) is the store's access check;
--      chat_people(ws) names everyone in or writing in a conversation you can
--      read, former members flagged. None needs the plan, none answers a key.
--   7. Direct messages: one live conversation per set of 2–9 people; the
--      opener must be able to post; a deleted one is never reused.
--   8. Activity (#15, ids only): channel_create, channel_rename, channel_topic,
--      channel_archive / _unarchive, join, leave, member_add, member_remove.
--      Read marks, preferences, opening a direct message and bootstrap log none.
--
-- Every redefined function starts from its live body (2026-10-15). Grants are
-- re-stated and asserted at the end.

SET LOCAL lock_timeout = '5s';

-- ── 1. A deleted direct message is never reused ─────────────────────────────

DROP INDEX IF EXISTS public.chat_channels_dm_uq;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_live_dm_uq
  ON public.chat_channels (workspace_id, dm_key) WHERE kind = 'dm' AND deleted_at IS NULL;

-- ── 2. Helpers (internal) ───────────────────────────────────────────────────

-- A channel name as typed: trimmed, one line, 1–80 characters.
CREATE OR REPLACE FUNCTION public.chat__channel_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text := btrim(coalesce(p_name, ''), E' \t\r\n');
BEGIN
  IF v = '' THEN
    RAISE EXCEPTION 'Give the channel a name.' USING ERRCODE = '22023';
  END IF;
  IF v ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A channel name fits on one line.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v) > 80 THEN
    RAISE EXCEPTION 'A channel name can be up to 80 characters (this one has %).', char_length(v)
      USING ERRCODE = '22023',
            DETAIL = json_build_object('length', char_length(v), 'max', 80)::text;
  END IF;
  RETURN v;
END;
$function$;

-- A topic: trimmed, up to 250 characters.
CREATE OR REPLACE FUNCTION public.chat__channel_topic(p_topic text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text := btrim(coalesce(p_topic, ''), E' \t\r\n');
BEGIN
  IF char_length(v) > 250 THEN
    RAISE EXCEPTION 'A topic can be up to 250 characters (this one has %).', char_length(v)
      USING ERRCODE = '22023',
            DETAIL = json_build_object('length', char_length(v), 'max', 250)::text;
  END IF;
  RETURN v;
END;
$function$;

-- Another live channel of the workspace already has this name (ignoring case).
CREATE OR REPLACE FUNCTION public.chat__name_taken(p_workspace_id uuid, p_name text, p_except uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.chat_channels c
                  WHERE c.workspace_id = p_workspace_id AND c.kind = 'channel'
                    AND c.deleted_at IS NULL AND lower(c.name) = lower(p_name)
                    AND c.id IS DISTINCT FROM p_except)
$function$;

-- One of the channel's managers who still is one in effect: in it (not left)
-- and in a role that posts. A manager row alone (someone who left before
-- leaving stamped rows, or whose role became read-only) manages nothing.
CREATE OR REPLACE FUNCTION public.chat__is_manager(p_channel public.chat_channels, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p_user IS NOT NULL AND p_channel.id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.chat_channel_managers m
                  WHERE m.channel_id = p_channel.id AND m.user_id = p_user)
     AND EXISTS (SELECT 1 FROM public.chat_members mb
                  WHERE mb.channel_id = p_channel.id AND mb.user_id = p_user AND mb.left_at IS NULL)
     AND public.chat_has_cap(p_channel.workspace_id, p_user, 'post')
$function$;

-- Manages this channel: an admin (the owner or "Manage any channel") or one of
-- its managers in effect.
CREATE OR REPLACE FUNCTION public.chat__can_manage(p_channel public.chat_channels, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p_user IS NOT NULL AND p_channel.id IS NOT NULL
     AND (public.chat_has_cap(p_channel.workspace_id, p_user, 'manage_any')
          OR public.chat__is_manager(p_channel, p_user))
$function$;

-- Posts in this conversation: a role that can post, not removed from it, and
-- in an announcement channel one of its managers.
CREATE OR REPLACE FUNCTION public.chat__can_post(p_channel public.chat_channels, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p_user IS NOT NULL AND p_channel.id IS NOT NULL
     AND public.chat_has_cap(p_channel.workspace_id, p_user, 'post')
     AND NOT public.chat__was_removed(p_channel.id, p_user)
     AND (NOT p_channel.managers_only OR public.chat__is_manager(p_channel, p_user))
$function$;

-- Puts someone in a conversation, or back after they left or were removed,
-- with everything already there read (the history isn't addressed to them).
-- True when something changed; an active member is left as they are.
CREATE OR REPLACE FUNCTION public.chat__enter(
  p_channel_id uuid, p_workspace_id uuid, p_user uuid, p_level text DEFAULT 'mentions')
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_newest public.chat_messages;
  v_rows int;
BEGIN
  SELECT * INTO v_newest FROM public.chat_messages m
   WHERE m.channel_id = p_channel_id
   ORDER BY m.created_at DESC, m.id DESC
   LIMIT 1;
  INSERT INTO public.chat_members AS mb
    (channel_id, user_id, workspace_id, notify_level, last_read_id, last_read_at, joined_at)
  VALUES
    (p_channel_id, p_user, p_workspace_id, p_level, v_newest.id, coalesce(v_newest.created_at, now()), now())
  ON CONFLICT (channel_id, user_id) DO UPDATE
    SET left_at = NULL,
        removed_by = NULL,
        joined_at = now(),
        last_read_id = excluded.last_read_id,
        last_read_at = excluded.last_read_at
    WHERE mb.left_at IS NOT NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

-- After p_leaving stopped managing a channel: when no manager in effect is
-- left, the workspace owner takes it if they can read it, else its earliest
-- remaining member whose role posts (a read-only role never manages). Returns
-- the new manager, or NULL when none was needed or nobody can take it (admins
-- still manage it). The caller holds the channel row's lock, so two managers
-- leaving at once can't both skip the hand-over.
CREATE OR REPLACE FUNCTION public.chat__hand_over(p_channel_id uuid, p_leaving uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_channel public.chat_channels;
  v_owner uuid;
  v_new uuid;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels c WHERE c.id = p_channel_id;
  IF v_channel.id IS NULL OR v_channel.kind <> 'channel' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_channel_managers m
              WHERE m.channel_id = p_channel_id AND m.user_id <> p_leaving
                AND public.chat__can_manage(v_channel, m.user_id)) THEN
    RETURN NULL;
  END IF;
  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = v_channel.workspace_id;
  IF v_owner IS NOT NULL AND v_owner <> p_leaving
     AND public.chat__can_read_channel_as(p_channel_id, v_owner) THEN
    v_new := v_owner;
  ELSE
    SELECT cm.user_id INTO v_new
      FROM public.chat_members cm
     WHERE cm.channel_id = p_channel_id AND cm.user_id <> p_leaving AND cm.left_at IS NULL
       AND public.chat_has_cap(v_channel.workspace_id, cm.user_id, 'post')
     ORDER BY cm.joined_at, cm.user_id
     LIMIT 1;
  END IF;
  IF v_new IS NOT NULL THEN
    INSERT INTO public.chat_channel_managers (channel_id, user_id)
    VALUES (p_channel_id, v_new) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_new;
END;
$function$;

-- The workspace half of the read rule (no plan): the owner, or a member whose
-- role reads chat, in a workspace that isn't deleted.
CREATE OR REPLACE FUNCTION public.chat__reads_workspace(p_workspace_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspaces w
     WHERE w.id = p_workspace_id AND w.deleted_at IS NULL
       AND (w.owner_id = p_user
            OR EXISTS (SELECT 1 FROM public.workspace_members wm
                        WHERE wm.workspace_id = w.id AND wm.user_id = p_user
                          AND 'chat.view' = ANY (wm.perms))))
$function$;

-- Every conversation of a workspace a person can read now: chat_can_read_channel
-- set-based (the foundation's rule, word for word), for chat_sync_ids,
-- chat_people and CV-19's search.
CREATE OR REPLACE FUNCTION public.chat__readable_channel_ids(p_workspace_id uuid, p_user uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT c.id
    FROM public.chat_channels c
   WHERE c.workspace_id = p_workspace_id
     AND c.deleted_at IS NULL
     AND public.chat__reads_workspace(p_workspace_id, p_user)
     AND ((c.kind = 'channel' AND NOT c.is_private)
          OR EXISTS (SELECT 1 FROM public.chat_members m
                      WHERE m.channel_id = c.id AND m.user_id = p_user AND m.left_at IS NULL))
$function$;

-- ── 3. Making conversations ─────────────────────────────────────────────────

-- New channels: the creator manages it (share_chat_channel_guard) and needs
-- "Create public / private channels"; General is chat's own and exempt.
CREATE OR REPLACE FUNCTION public.share_chat_channel_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.kind = 'channel' AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.chat_channel_managers (channel_id, user_id)
    VALUES (NEW.id, NEW.created_by) ON CONFLICT DO NOTHING;
    IF NOT NEW.is_default THEN
      IF NEW.is_private AND NOT public.chat_has_cap(NEW.workspace_id, NEW.created_by, 'create_private') THEN
        RAISE EXCEPTION 'Your role can''t create private channels.' USING ERRCODE = '42501';
      ELSIF NOT NEW.is_private AND NOT public.chat_has_cap(NEW.workspace_id, NEW.created_by, 'create_public') THEN
        RAISE EXCEPTION 'Your role can''t create channels.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- chat_op_bootstrap(ws): General exists and every member is in it, except
-- those who left it. Returns General.
DROP FUNCTION IF EXISTS public.chat_op_bootstrap(uuid);
CREATE FUNCTION public.chat_op_bootstrap(p_workspace_id uuid)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_general public.chat_channels;
  v_owner uuid;
  v_name text;
  v_bypass text;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  -- Nothing to do (the usual open): General is there and nobody lacks a row.
  SELECT * INTO v_general FROM public.chat_channels
   WHERE workspace_id = p_workspace_id AND is_default;
  IF v_general.id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                      WHERE wm.workspace_id = p_workspace_id
                        AND NOT EXISTS (SELECT 1 FROM public.chat_members mb
                                         WHERE mb.channel_id = v_general.id AND mb.user_id = wm.user_id)) THEN
    RETURN v_general;
  END IF;
  -- One bootstrap per workspace at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat_op_bootstrap:' || p_workspace_id::text, 0));

  SELECT * INTO v_general FROM public.chat_channels
   WHERE workspace_id = p_workspace_id AND is_default;
  SELECT owner_id INTO v_owner FROM public.workspaces WHERE id = p_workspace_id;
  IF v_general.id IS NULL THEN
    -- A workspace from before General: the live public "general" v1's
    -- bootstrap made (in the owner's name) becomes it; a member's own channel
    -- of that name never does.
    UPDATE public.chat_channels c SET is_default = true
     WHERE c.id = (SELECT g.id FROM public.chat_channels g
                    WHERE g.workspace_id = p_workspace_id AND g.kind = 'channel'
                      AND lower(g.name) = 'general' AND g.deleted_at IS NULL
                      AND g.archived_at IS NULL AND NOT g.is_private
                      AND (g.created_by IS NULL OR g.created_by = v_owner)
                    ORDER BY g.created_at, g.id
                    LIMIT 1)
    RETURNING * INTO v_general;
  END IF;
  IF v_general.id IS NULL THEN
    -- Made on the workspace's behalf, whoever opens chat first (a viewer too).
    v_bypass := current_setting('share.bypass', true);
    PERFORM set_config('share.bypass', '1', true);
    FOR i IN 1..50 LOOP
      v_name := CASE WHEN i = 1 THEN 'General' ELSE 'General ' || i END;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.chat_channels c
                             WHERE c.workspace_id = p_workspace_id AND c.kind = 'channel'
                               AND lower(c.name) = lower(v_name));
      INSERT INTO public.chat_channels (workspace_id, kind, name, topic, created_by, is_default)
      VALUES (p_workspace_id, 'channel', v_name, 'Everyone in the workspace', v_owner, true)
      RETURNING * INTO v_general;
      EXIT;
    END LOOP;
    PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
    IF v_general.id IS NULL THEN
      RAISE EXCEPTION 'General couldn''t be made.' USING ERRCODE = '23505';
    END IF;
    PERFORM public.entities_op_upsert(p_workspace_id, 'chat_channel', v_general.id, v_general.name, NULL);
  END IF;

  -- Everyone in the workspace who has no row in General joins it; a row with
  -- left_at (they left, or were removed) keeps them out. Never a private one.
  IF v_general.archived_at IS NULL AND v_general.deleted_at IS NULL AND NOT v_general.is_private THEN
    INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
    SELECT v_general.id, u.user_id, p_workspace_id
      FROM (SELECT wm.user_id FROM public.workspace_members wm WHERE wm.workspace_id = p_workspace_id
            UNION
            SELECT w.owner_id FROM public.workspaces w WHERE w.id = p_workspace_id) u
     WHERE u.user_id IS NOT NULL
    ON CONFLICT (channel_id, user_id) DO NOTHING;
  END IF;
  RETURN v_general;
END;
$function$;

-- New members of a workspace join its General (unless they left it before;
-- never a private, archived or deleted one).
CREATE OR REPLACE FUNCTION public.chat__join_general()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
  SELECT c.id, NEW.user_id, NEW.workspace_id
    FROM public.chat_channels c
   WHERE c.workspace_id = NEW.workspace_id AND c.is_default AND c.kind = 'channel'
     AND NOT c.is_private AND c.deleted_at IS NULL AND c.archived_at IS NULL
  ON CONFLICT (channel_id, user_id) DO NOTHING;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS chat_join_general ON public.workspace_members;
CREATE TRIGGER chat_join_general AFTER INSERT ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.chat__join_general();

-- chat_op_create_channel(ws, name, topic, is_private, member_ids, announcement):
-- the name as typed; the creator manages it and is on Mentions and replies;
-- registered for ⌘K. CV-13 adds the link arguments.
DROP FUNCTION IF EXISTS public.chat_op_create_channel(uuid, text, text, boolean, uuid[]);
CREATE OR REPLACE FUNCTION public.chat_op_create_channel(
  p_workspace_id uuid,
  p_name text,
  p_topic text DEFAULT ''::text,
  p_is_private boolean DEFAULT false,
  p_member_ids uuid[] DEFAULT '{}'::uuid[],
  p_announcement boolean DEFAULT false)
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
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  IF v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_private') THEN
    RAISE EXCEPTION 'Your role can''t create private channels.' USING ERRCODE = '42501';
  ELSIF NOT v_private AND NOT public.chat_has_cap(p_workspace_id, v_me, 'create_public') THEN
    RAISE EXCEPTION 'Your role can''t create channels.' USING ERRCODE = '42501';
  END IF;
  v_name := public.chat__channel_name(p_name);
  v_topic := public.chat__channel_topic(p_topic);
  IF public.chat__name_taken(p_workspace_id, v_name, NULL) THEN
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
  RETURN v_channel;
END;
$function$;

-- chat_op_open_dm(ws, user_ids): the one live direct message of 2–9 people
-- (the opener included). One that exists is the opener's to open, and they are
-- back in it if they had left (a viewer too, and when someone in it has since
-- left the workspace); starting one needs a role that posts and everyone in
-- the workspace. Registered without a label.
CREATE OR REPLACE FUNCTION public.chat_op_open_dm(p_workspace_id uuid, p_user_ids uuid[])
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_ids uuid[];
  v_key text;
  v_channel public.chat_channels;
  v_uid uuid;
BEGIN
  PERFORM public.chat_op__guard(p_workspace_id);
  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_ids
    FROM unnest(coalesce(p_user_ids, '{}'::uuid[]) || v_me) u
   WHERE u IS NOT NULL;
  IF cardinality(v_ids) < 2 THEN
    RAISE EXCEPTION 'A direct message needs someone besides you.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 9 THEN
    RAISE EXCEPTION 'A direct message can include up to 9 people.' USING ERRCODE = '22023';
  END IF;
  v_key := array_to_string(v_ids, ',');

  -- One already there (its set includes the opener).
  SELECT * INTO v_channel FROM public.chat_channels
   WHERE workspace_id = p_workspace_id AND kind = 'dm' AND dm_key = v_key AND deleted_at IS NULL;
  IF v_channel.id IS NOT NULL THEN
    PERFORM public.chat__enter(v_channel.id, p_workspace_id, v_me, 'all');
    RETURN v_channel;
  END IF;

  -- Starting one.
  IF NOT public.chat_has_cap(p_workspace_id, v_me, 'post') THEN
    RAISE EXCEPTION 'Your role can''t start direct messages.' USING ERRCODE = '42501';
  END IF;
  FOREACH v_uid IN ARRAY v_ids LOOP
    IF NOT public.chat_is_workspace_member(p_workspace_id, v_uid) THEN
      RAISE EXCEPTION 'Everyone in a direct message must be in this workspace.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.chat_channels (workspace_id, kind, is_private, dm_key, created_by)
  VALUES (p_workspace_id, 'dm', true, v_key, v_me)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_channel;
  IF v_channel.id IS NULL THEN
    -- Opened at the same moment by someone else in it.
    SELECT * INTO v_channel FROM public.chat_channels
     WHERE workspace_id = p_workspace_id AND kind = 'dm' AND dm_key = v_key AND deleted_at IS NULL;
  END IF;
  PERFORM public.entities_op_upsert(p_workspace_id, 'chat_channel', v_channel.id, '', NULL);

  -- Everyone is in it; someone who left stays out unless they open it again.
  FOREACH v_uid IN ARRAY v_ids LOOP
    IF v_uid = v_me THEN
      PERFORM public.chat__enter(v_channel.id, p_workspace_id, v_uid, 'all');
    ELSE
      INSERT INTO public.chat_members (channel_id, user_id, workspace_id, notify_level)
      VALUES (v_channel.id, v_uid, p_workspace_id, 'all')
      ON CONFLICT (channel_id, user_id) DO NOTHING;
    END IF;
  END LOOP;
  RETURN v_channel;
END;
$function$;

-- ── 4. Changing a channel ───────────────────────────────────────────────────

-- chat_op_update_channel(channel, name, topic): rename is the managers' and
-- admins'; the topic is any poster's there. NULL leaves a field as it is.
CREATE OR REPLACE FUNCTION public.chat_op_update_channel(
  p_channel_id uuid, p_name text DEFAULT NULL::text, p_topic text DEFAULT NULL::text)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_name text := v_channel.name;
  v_topic text := v_channel.topic;
  v_renamed boolean := false;
  v_retopic boolean := false;
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages don''t have a name or topic.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NOT NULL THEN
    v_name := public.chat__channel_name(p_name);
    v_renamed := v_name IS DISTINCT FROM v_channel.name;
  END IF;
  IF p_topic IS NOT NULL THEN
    v_topic := public.chat__channel_topic(p_topic);
    v_retopic := v_topic IS DISTINCT FROM v_channel.topic;
  END IF;
  IF v_renamed AND NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can rename it.' USING ERRCODE = '42501';
  END IF;
  IF v_retopic AND NOT (public.chat__can_manage(v_channel, v_me) OR public.chat__can_post(v_channel, v_me)) THEN
    RAISE EXCEPTION 'Your role can''t change this channel''s topic.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_renamed AND NOT v_retopic THEN
    RETURN v_channel;
  END IF;
  IF v_renamed AND public.chat__name_taken(v_channel.workspace_id, v_name, v_channel.id) THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END IF;

  BEGIN
    UPDATE public.chat_channels SET name = v_name, topic = v_topic
     WHERE id = p_channel_id
    RETURNING * INTO v_channel;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A channel named "%" already exists.', v_name USING ERRCODE = '23505';
  END;

  IF v_renamed THEN
    PERFORM public.entities_op_upsert(v_channel.workspace_id, 'chat_channel', v_channel.id, v_name, NULL);
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
      'chat.channel_rename', '{}'::jsonb);
  END IF;
  IF v_retopic THEN
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
      'chat.channel_topic', '{}'::jsonb);
  END IF;
  RETURN v_channel;
END;
$function$;

-- chat_op_archive_channel(channel, archived): managers and admins; General
-- stays open (new members land in it). CV-15 closes Catch up items.
CREATE OR REPLACE FUNCTION public.chat_op_archive_channel(p_channel_id uuid, p_archived boolean DEFAULT true)
 RETURNS chat_channels
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_archive boolean := coalesce(p_archived, true);
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages can''t be archived.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can archive it.' USING ERRCODE = '42501';
  END IF;
  IF v_archive AND v_channel.is_default THEN
    RAISE EXCEPTION 'General can''t be archived.' USING ERRCODE = '22023';
  END IF;
  IF (v_channel.archived_at IS NOT NULL) = v_archive THEN
    RETURN v_channel;
  END IF;
  UPDATE public.chat_channels
     SET archived_at = CASE WHEN v_archive THEN now() ELSE NULL END
   WHERE id = p_channel_id
  RETURNING * INTO v_channel;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
    CASE WHEN v_archive THEN 'chat.channel_archive' ELSE 'chat.channel_unarchive' END, '{}'::jsonb);
  RETURN v_channel;
END;
$function$;

-- ── 5. Who is in it ─────────────────────────────────────────────────────────

-- chat_op_join(channel): a public, open channel; viewers too. Someone a
-- manager removed waits to be added back.
CREATE OR REPLACE FUNCTION public.chat_op_join(p_channel_id uuid)
 RETURNS chat_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_member public.chat_members;
BEGIN
  SELECT * INTO v_member FROM public.chat_members
   WHERE channel_id = p_channel_id AND user_id = v_me AND left_at IS NULL;
  IF v_member.channel_id IS NOT NULL THEN
    RETURN v_member;
  END IF;
  -- (chat_op__channel already refuses a private conversation you aren't in;
  -- this stays as the rule itself.)
  IF v_channel.kind <> 'channel' OR v_channel.is_private THEN
    RAISE EXCEPTION 'Only someone in this conversation can add you.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(p_channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this channel. A manager can add you back.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat__enter(p_channel_id, v_channel.workspace_id, v_me);
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.join', '{}'::jsonb);
  SELECT * INTO v_member FROM public.chat_members WHERE channel_id = p_channel_id AND user_id = v_me;
  RETURN v_member;
END;
$function$;

-- chat_op_leave(channel): stamps left_at, works while chat is paused. Leaving
-- General sticks. A last manager who leaves hands the channel on.
CREATE OR REPLACE FUNCTION public.chat_op_leave(p_channel_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_member public.chat_members;
  v_new uuid;
BEGIN
  -- Leaving twice is fine (the second time you may not read it any more).
  SELECT * INTO v_member FROM public.chat_members WHERE channel_id = p_channel_id AND user_id = v_me;
  IF v_member.channel_id IS NOT NULL AND v_member.left_at IS NOT NULL THEN
    RETURN;
  END IF;
  v_channel := public.chat_op__reader(p_channel_id);
  IF v_member.channel_id IS NULL THEN
    RETURN;
  END IF;
  -- One change of who manages it at a time (see chat__hand_over).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  UPDATE public.chat_members SET left_at = now(), removed_by = NULL
   WHERE channel_id = p_channel_id AND user_id = v_me;
  DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = v_me;
  IF FOUND THEN
    v_new := public.chat__hand_over(p_channel_id, v_me);
  END IF;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.leave', CASE WHEN v_new IS NOT NULL THEN jsonb_build_object('manager_id', v_new) ELSE '{}'::jsonb END);
END;
$function$;

-- chat_op_add_members(channel, user_ids): a public channel takes anyone a
-- poster adds; a private one only its managers' and admins'. Someone a
-- manager removed comes back only through a manager or admin. Returns how
-- many joined.
CREATE OR REPLACE FUNCTION public.chat_op_add_members(p_channel_id uuid, p_user_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_manage boolean;
  v_uid uuid;
  v_added uuid[] := '{}';
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Start a new direct message to add people.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  v_manage := public.chat__can_manage(v_channel, v_me);
  IF v_channel.is_private AND NOT v_manage THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can add people to it.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_manage AND (NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'post')
                       OR public.chat__was_removed(p_channel_id, v_me)) THEN
    RAISE EXCEPTION 'Your role can''t add people to channels.' USING ERRCODE = '42501';
  END IF;

  FOR v_uid IN SELECT DISTINCT u FROM unnest(coalesce(p_user_ids, '{}'::uuid[])) u WHERE u IS NOT NULL LOOP
    CONTINUE WHEN NOT public.chat_is_workspace_member(v_channel.workspace_id, v_uid);
    CONTINUE WHEN NOT v_manage AND public.chat__was_removed(p_channel_id, v_uid);
    IF public.chat__enter(p_channel_id, v_channel.workspace_id, v_uid) THEN
      v_added := v_added || v_uid;
    END IF;
  END LOOP;

  IF cardinality(v_added) > 0 THEN
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
      'chat.member_add', jsonb_build_object('user_ids', to_jsonb(v_added)));
  END IF;
  RETURN cardinality(v_added);
END;
$function$;

-- chat_op_remove_member(channel, user): managers and admins; stamps left_at and
-- removed_by on the person's row. Removing yourself is leaving.
CREATE OR REPLACE FUNCTION public.chat_op_remove_member(p_channel_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_new uuid;
BEGIN
  IF v_me IS NOT NULL AND p_user_id = v_me THEN
    PERFORM public.chat_op_leave(p_channel_id);
    RETURN;
  END IF;
  v_channel := public.chat_op__channel(p_channel_id);
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'People can''t be removed from a direct message.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can remove people.' USING ERRCODE = '42501';
  END IF;
  -- One change of who manages it at a time (see chat__hand_over).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  UPDATE public.chat_members SET left_at = now(), removed_by = v_me
   WHERE channel_id = p_channel_id AND user_id = p_user_id AND left_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = p_user_id;
  IF FOUND THEN
    v_new := public.chat__hand_over(p_channel_id, p_user_id);
  END IF;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.member_remove',
    jsonb_build_object('user_id', p_user_id)
      || CASE WHEN v_new IS NOT NULL THEN jsonb_build_object('manager_id', v_new) ELSE '{}'::jsonb END);
END;
$function$;

-- ── 6. Your own settings and read mark (no plan needed) ─────────────────────

-- chat_op_set_prefs(channel, level, starred): the level (all = Every message,
-- mentions = Mentions and replies, none = Nothing) and "Pin to sidebar".
CREATE OR REPLACE FUNCTION public.chat_op_set_prefs(
  p_channel_id uuid, p_notify_level text DEFAULT NULL::text, p_starred boolean DEFAULT NULL::boolean)
 RETURNS chat_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member public.chat_members;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  IF p_notify_level IS NOT NULL AND p_notify_level NOT IN ('all', 'mentions', 'none') THEN
    RAISE EXCEPTION 'Unknown notification level.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chat_members
     SET notify_level = coalesce(p_notify_level, notify_level),
         starred = coalesce(p_starred, starred)
   WHERE channel_id = p_channel_id AND user_id = auth.uid() AND left_at IS NULL
  RETURNING * INTO v_member;
  IF v_member.channel_id IS NULL THEN
    RAISE EXCEPTION 'Join this conversation first.' USING ERRCODE = '42501';
  END IF;
  RETURN v_member;
END;
$function$;

-- chat_op_mark_read(channel, message): the read mark moves forward to the last
-- message you saw, never back and never by the clock. CV-5 closes Catch up
-- items up to it.
CREATE OR REPLACE FUNCTION public.chat_op_mark_read(p_channel_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.channel_id <> p_channel_id THEN
    RAISE EXCEPTION 'That message isn''t in this conversation.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.chat_members mb
     SET last_read_id = v_msg.id,
         last_read_at = greatest(mb.last_read_at, v_msg.created_at)
   WHERE mb.channel_id = p_channel_id AND mb.user_id = auth.uid() AND mb.left_at IS NULL
     AND CASE WHEN mb.last_read_id IS NULL THEN v_msg.created_at > mb.last_read_at
              ELSE NOT EXISTS (SELECT 1 FROM public.chat_messages r
                                WHERE r.id = mb.last_read_id
                                  AND (r.created_at, r.id) >= (v_msg.created_at, v_msg.id)) END;
END;
$function$;

-- chat_op_mark_unread(channel, message): the read mark moves to just before
-- that message; everything from it on is unread again. Catch up is untouched.
CREATE OR REPLACE FUNCTION public.chat_op_mark_unread(p_channel_id uuid, p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
  v_prev public.chat_messages;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id;
  IF v_msg.id IS NULL OR v_msg.channel_id <> p_channel_id THEN
    RAISE EXCEPTION 'That message isn''t in this conversation.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_prev FROM public.chat_messages m
   WHERE m.channel_id = p_channel_id AND (m.created_at, m.id) < (v_msg.created_at, v_msg.id)
   ORDER BY m.created_at DESC, m.id DESC
   LIMIT 1;
  UPDATE public.chat_members
     SET last_read_id = v_prev.id,
         last_read_at = coalesce(v_prev.created_at, v_msg.created_at - interval '1 microsecond')
   WHERE channel_id = p_channel_id AND user_id = auth.uid() AND left_at IS NULL;
END;
$function$;

-- v1's signatures, until CV-3 replaces v1's screens: a time is read as the
-- newest message at or before it (mark read) or the first one at or after it
-- (mark unread).
CREATE OR REPLACE FUNCTION public.chat_op_mark_read(p_channel_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  SELECT m.id INTO v_id FROM public.chat_messages m
   WHERE m.channel_id = p_channel_id AND m.created_at <= least(coalesce(p_at, now()), now())
   ORDER BY m.created_at DESC, m.id DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM public.chat_op_mark_read(p_channel_id, v_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_mark_unread(p_channel_id uuid, p_before timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.chat_op__reader(p_channel_id);
  SELECT m.id INTO v_id FROM public.chat_messages m
   WHERE m.channel_id = p_channel_id AND m.created_at >= p_before
   ORDER BY m.created_at, m.id
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM public.chat_op_mark_unread(p_channel_id, v_id);
  END IF;
END;
$function$;

-- ── 7. Reads ────────────────────────────────────────────────────────────────

-- chat_unread_counts(ws), per conversation you're in (live, not archived):
--   unread     messages from others after your mark, replies included (bold);
--   mentions   of those, the ones naming you, a team of yours, or @channel;
--   addressed  the number shown (§2): a direct message's unread, everything
--              on Every message, and on Mentions and replies your mentions,
--              announcement posts and replies in chains you're in (you wrote
--              its first message, or replied or were named in it earlier;
--              not once you stopped following it) or to your own messages;
--              0 on Nothing;
--   catchup    its share of Catch up's count: one item per such message, one
--              per chain for replies, and one for the rest of an Every
--              message conversation (CV-5's items replace this).
-- A converted v1 reply is unread only if its root is. No plan needed.
DROP FUNCTION IF EXISTS public.chat_unread_counts(uuid);
CREATE FUNCTION public.chat_unread_counts(p_workspace_id uuid)
 RETURNS TABLE(channel_id uuid, unread integer, mentions integer, addressed integer, catchup integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (
    SELECT auth.uid() AS id
  ), mine AS (
    SELECT mb.channel_id, mb.notify_level, mb.last_read_at, r.created_at AS mark_at, r.id AS mark_id,
           c.kind, c.managers_only
      FROM public.chat_members mb
      JOIN public.chat_channels c ON c.id = mb.channel_id
      LEFT JOIN public.chat_messages r ON r.id = mb.last_read_id
     WHERE mb.user_id = (SELECT id FROM me) AND mb.workspace_id = p_workspace_id
       AND mb.left_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL
       AND public.chat__reads_workspace(p_workspace_id, (SELECT id FROM me))
  ), teams AS (
    SELECT coalesce(array_agg(tm.team_id), '{}'::uuid[]) AS ids
      FROM public.team_members tm
     WHERE tm.user_id = (SELECT id FROM me) AND tm.workspace_id = p_workspace_id AND tm.deleted_at IS NULL
  ), fresh AS (
    SELECT mi.channel_id, mi.notify_level, mi.kind, m.id, m.parent_id,
           ((SELECT id FROM me) = ANY (m.mentioned_user_ids) OR m.mentions_everyone
            OR m.mentioned_team_ids && (SELECT ids FROM teams)) AS mentioned,
           (mi.managers_only AND m.parent_id IS NULL) AS announced,
           (m.parent_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.chat_chain_mutes cm
                             WHERE cm.user_id = (SELECT id FROM me) AND cm.root_id = m.parent_id)
            AND (EXISTS (SELECT 1 FROM public.chat_messages q
                          WHERE q.id = m.reply_to_id AND q.author_id = (SELECT id FROM me))
                 OR EXISTS (SELECT 1 FROM public.chat_messages rt
                             WHERE rt.id = m.parent_id
                               AND (rt.author_id = (SELECT id FROM me)
                                    OR (SELECT id FROM me) = ANY (rt.mentioned_user_ids)))
                 OR EXISTS (SELECT 1 FROM public.chat_messages x
                             WHERE x.parent_id = m.parent_id
                               AND (x.created_at, x.id) < (m.created_at, m.id)
                               AND (x.author_id = (SELECT id FROM me)
                                    OR (SELECT id FROM me) = ANY (x.mentioned_user_ids))))) AS in_chain
      FROM mine mi
      JOIN public.chat_messages m ON m.channel_id = mi.channel_id
     WHERE m.kind = 'message' AND m.deleted_at IS NULL
       AND m.author_id IS DISTINCT FROM (SELECT id FROM me)
       AND CASE WHEN mi.mark_id IS NULL THEN m.created_at > mi.last_read_at
                ELSE (m.created_at, m.id) > (mi.mark_at, mi.mark_id) END
       AND NOT (m.v1_thread_reply AND EXISTS (
             SELECT 1 FROM public.chat_messages rt
              WHERE rt.id = m.parent_id
                AND CASE WHEN mi.mark_id IS NULL THEN rt.created_at <= mi.last_read_at
                         ELSE (rt.created_at, rt.id) <= (mi.mark_at, mi.mark_id) END))
  ), items AS (
    SELECT f.channel_id, f.mentioned,
           CASE WHEN f.notify_level = 'none' THEN NULL
                WHEN f.kind = 'dm' OR f.mentioned OR f.announced THEN 'm:' || f.id::text
                WHEN f.in_chain THEN 'c:' || f.parent_id::text
                WHEN f.notify_level = 'all' THEN 'all'
           END AS item
      FROM fresh f
  )
  SELECT mi.channel_id,
         count(i.channel_id)::int,
         (count(i.channel_id) FILTER (WHERE i.mentioned))::int,
         (CASE WHEN mi.notify_level = 'none' THEN 0
               WHEN mi.kind = 'dm' OR mi.notify_level = 'all' THEN count(i.channel_id)
               ELSE count(i.item) END)::int,
         (count(DISTINCT i.item))::int
    FROM mine mi
    LEFT JOIN items i ON i.channel_id = mi.channel_id
   GROUP BY mi.channel_id, mi.notify_level, mi.kind
$function$;

-- chat_sync_ids(ws, since): the store's access check (spike 2). Rows:
--   conversation  every conversation of the workspace you can read now;
--   member        the ones you're in (and haven't left);
--   moved_away    ids named by a moved_out line written since p_since in a
--                 conversation you can read, whose message now sits where you
--                 can't read it (or is gone);
--   checked       always one, so checked_at arrives even when nothing else does.
-- checked_at is the server's clock at the start; the store sends it back
-- (minus its lookback) as the next p_since. No plan needed.
CREATE OR REPLACE FUNCTION public.chat_sync_ids(p_workspace_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(kind text, id uuid, conversation_id uuid, checked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH t AS (
    SELECT clock_timestamp() AS at, auth.uid() AS me
  ), readable AS (
    SELECT r.id FROM t, public.chat__readable_channel_ids(p_workspace_id, t.me) AS r(id)
  ), moved AS (
    SELECT DISTINCT x.mid, e.channel_id AS source
      FROM public.chat_messages e
      JOIN readable r ON r.id = e.channel_id
     CROSS JOIN LATERAL (
       SELECT v::uuid AS mid FROM jsonb_array_elements_text(coalesce(e.event -> 'ids', '[]'::jsonb)) v
     ) x
      LEFT JOIN public.chat_messages m ON m.id = x.mid
     WHERE e.workspace_id = p_workspace_id
       AND e.kind = 'event'
       AND e.event ->> 'type' = 'moved_out'
       AND e.deleted_at IS NULL
       AND e.updated_at >= coalesce(p_since, '-infinity'::timestamptz)
       AND (m.id IS NULL OR NOT EXISTS (SELECT 1 FROM readable r2 WHERE r2.id = m.channel_id))
  )
  SELECT 'conversation'::text, r.id, r.id, t.at FROM readable r, t
  UNION ALL
  SELECT 'member'::text, m.channel_id, m.channel_id, t.at
    FROM public.chat_members m
    JOIN readable r ON r.id = m.channel_id, t
   WHERE m.user_id = t.me AND m.left_at IS NULL
  UNION ALL
  SELECT 'moved_away'::text, mv.mid, mv.source, t.at FROM moved mv, t
  UNION ALL
  SELECT 'checked'::text, NULL::uuid, NULL::uuid, t.at FROM t
$function$;

-- chat_people(ws): names and avatars of everyone in, or who wrote in, a
-- conversation you can read; former = no longer in the workspace (their
-- messages keep their name; a deleted account has no row here and reads
-- "Former member"). No plan needed.
CREATE OR REPLACE FUNCTION public.chat_people(p_workspace_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, former boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (
    SELECT auth.uid() AS id
  ), readable AS (
    SELECT r.id FROM me, public.chat__readable_channel_ids(p_workspace_id, me.id) AS r(id)
  ), people AS (
    SELECT mb.user_id FROM public.chat_members mb JOIN readable r ON r.id = mb.channel_id
     WHERE mb.left_at IS NULL
    UNION
    SELECT m.author_id FROM public.chat_messages m JOIN readable r ON r.id = m.channel_id
     WHERE m.author_id IS NOT NULL AND m.kind = 'message'
    UNION
    SELECT me.id FROM me WHERE public.chat__reads_workspace(p_workspace_id, me.id)
  )
  SELECT p.id, p.display_name, p.avatar_url,
         NOT public.chat_is_workspace_member(p_workspace_id, p.id)
    FROM people x
    JOIN public.profiles p ON p.id = x.user_id
$function$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only the ops and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__channel_name(text)',
    'chat__channel_topic(text)',
    'chat__name_taken(uuid, text, uuid)',
    'chat__is_manager(public.chat_channels, uuid)',
    'chat__can_manage(public.chat_channels, uuid)',
    'chat__can_post(public.chat_channels, uuid)',
    'chat__enter(uuid, uuid, uuid, text)',
    'chat__hand_over(uuid, uuid)',
    'chat__reads_workspace(uuid, uuid)',
    'chat__readable_channel_ids(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must not be callable by clients.', fn;
    END IF;
  END LOOP;
  -- The ops: signed-in people and the service role, never anon.
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_bootstrap(uuid)',
    'chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean)',
    'chat_op_open_dm(uuid, uuid[])',
    'chat_op_update_channel(uuid, text, text)',
    'chat_op_archive_channel(uuid, boolean)',
    'chat_op_join(uuid)',
    'chat_op_leave(uuid)',
    'chat_op_add_members(uuid, uuid[])',
    'chat_op_remove_member(uuid, uuid)',
    'chat_op_set_prefs(uuid, text, boolean)',
    'chat_op_mark_read(uuid, uuid)',
    'chat_op_mark_read(uuid, timestamp with time zone)',
    'chat_op_mark_unread(uuid, uuid)',
    'chat_op_mark_unread(uuid, timestamp with time zone)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  -- The reads answer people only: a key (the service role) and anon get nothing.
  FOREACH fn IN ARRAY ARRAY[
    'chat_unread_counts(uuid)',
    'chat_sync_ids(uuid, timestamp with time zone)',
    'chat_people(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('service_role', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people only.', fn;
    END IF;
  END LOOP;
  -- Trigger functions: nobody calls them directly.
  REVOKE ALL ON FUNCTION public.share_chat_channel_guard() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.chat__join_general() FROM PUBLIC, anon, authenticated, service_role;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.workspace_members'::regclass
                  AND tgname = 'chat_join_general' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'The chat_join_general trigger is not in place on workspace_members.';
  END IF;
END;
$$;

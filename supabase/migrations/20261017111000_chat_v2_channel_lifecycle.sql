-- CV-15: channel lifecycle and who may do what (spec §12, round-3 §2.3/§2.4,
-- Assumptions #13, #15, #25, #33). Provisional stamp: re-cut on apply day,
-- chat's order kept (after CV-12 and CV-10).
--
--   1. Columns: chat_members.access_at (the conversation's readers changed:
--      the member's own row tells their copy to check access), chat_channels.roster_at (who is in it or manages it changed;
--      readers re-read People and managers on it, not on every message),
--      chat_channels.purged_at (the purge ran), chat_catchup.channel_name (an
--      added / removed line names the channel even when you can no longer read it).
--   2. Helpers: chat__touch_roster, chat__quiet_line, chat__close_channel_items,
--      chat__may_restore.
--   3. chat_op_set_manager: managers add and remove managers; the last one stays.
--   4. chat_op_set_announcement (share_op_announce becomes its v1 wrapper; CV-23
--      drops it).
--   5. chat_op_make_private: public → private, one way.
--   6. chat_op_delete_channel / chat_op_restore_channel / chat_recently_deleted.
--   7. chat__purge_deleted + the hourly chat-purge-deleted job (small batches).
--   8. Redefined from their live bodies: chat_op_remove_member (a removal is
--      recorded whether or not they were still in it; the quiet line; their
--      items close), chat_op_add_members (the quiet line), chat_op_join and
--      chat_op_leave (the roster stamp), chat_op_archive_channel (its items close),
--      chat_op_agent_post (a deleted channel refuses an app's post).
--   9. Grants, by name.
--
-- Membership rows are only ever stamped (left_at / removed_at), never deleted
-- by an op or the purge: each person hears about their own row, and nobody
-- else's.

SET LOCAL lock_timeout = '5s';

-- ── 1. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS roster_at timestamptz;
ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS purged_at timestamptz;
ALTER TABLE public.chat_catchup ADD COLUMN IF NOT EXISTS channel_name text;
ALTER TABLE public.chat_members ADD COLUMN IF NOT EXISTS access_at timestamptz;

COMMENT ON COLUMN public.chat_members.access_at IS
  'When the conversation''s readers changed under this member (deleted, restored, made private; CV-15): their copy checks access.';

COMMENT ON COLUMN public.chat_channels.roster_at IS
  'When its people or its managers last changed (CV-15): readers re-read People and the managers on it.';
COMMENT ON COLUMN public.chat_channels.purged_at IS
  'When chat__purge_deleted erased its content, 30 days after deleted_at (CV-15).';
COMMENT ON COLUMN public.chat_catchup.channel_name IS
  'The channel''s name when an added / removed line was written (CV-15).';

CREATE INDEX IF NOT EXISTS chat_channels_purge_idx
  ON public.chat_channels (deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

-- ── 2. Helpers ───────────────────────────────────────────────────────────────

-- Who is in it, or who manages it, changed: every reader's copy of the
-- channel row moves (Realtime delivers it under the reader's rule).
CREATE OR REPLACE FUNCTION public.chat__touch_roster(p_channel_id uuid)
RETURNS void
LANGUAGE sql
SET search_path TO ''
AS $function$
  UPDATE public.chat_channels SET roster_at = clock_timestamp() WHERE id = p_channel_id;
$function$;

-- A quiet Catch up line (added / removed): no bell, no device notice, never
-- counted (chat_unread_counts skips both). Never for your own doing.
CREATE OR REPLACE FUNCTION public.chat__quiet_line(p_channel public.chat_channels, p_user uuid,
                                                   p_reason text, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF p_user IS NULL OR p_user IS NOT DISTINCT FROM p_actor OR p_reason NOT IN ('added', 'removed') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user) THEN
    RETURN;
  END IF;
  INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason, actor_id, channel_name)
  VALUES (p_channel.workspace_id, p_user, p_channel.id, p_reason,
          (SELECT p.id FROM public.profiles p WHERE p.id = p_actor), p_channel.name);
END;
$function$;

-- Close the open Catch up items of a channel ('closed': never reopened), for
-- the people named, or everyone when p_users is null; the bell twins go too.
CREATE OR REPLACE FUNCTION public.chat__close_channel_items(p_channel_id uuid, p_users uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid;
  v_n integer := 0;
BEGIN
  FOR v_user IN
    SELECT DISTINCT k.user_id FROM public.chat_catchup k
     WHERE k.channel_id = p_channel_id AND k.done_at IS NULL
       AND (p_users IS NULL OR k.user_id = ANY (p_users))
  LOOP
    v_n := v_n + public.chat__close(v_user,
      ARRAY(SELECT k.id FROM public.chat_catchup k
             WHERE k.channel_id = p_channel_id AND k.user_id = v_user AND k.done_at IS NULL),
      'closed');
  END LOOP;
  RETURN v_n;
END;
$function$;

-- Who may restore a deleted channel (and see it in Recently deleted): its
-- managers in effect, and admins who could read it before it was deleted (a
-- public channel, or a private one they're in).
CREATE OR REPLACE FUNCTION public.chat__may_restore(p_channel public.chat_channels, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT p_user IS NOT NULL AND p_channel.id IS NOT NULL AND p_channel.kind = 'channel'
     AND public.chat_is_workspace_member(p_channel.workspace_id, p_user)
     AND (public.chat__is_manager(p_channel, p_user)
          OR (public.chat_has_cap(p_channel.workspace_id, p_user, 'manage_any')
              AND (NOT p_channel.is_private
                   OR EXISTS (SELECT 1 FROM public.chat_members mb
                               WHERE mb.channel_id = p_channel.id AND mb.user_id = p_user
                                 AND mb.left_at IS NULL))))
$function$;

-- ── 3. Managers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op_set_manager(p_channel_id uuid, p_user_id uuid, p_on boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_on boolean := coalesce(p_on, true);
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages have no managers.' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Pick someone in this channel.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can change its managers.' USING ERRCODE = '42501';
  END IF;
  -- One change of who manages it at a time (see chat__hand_over).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;

  IF v_on THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_members mb
                    WHERE mb.channel_id = p_channel_id AND mb.user_id = p_user_id AND mb.left_at IS NULL) THEN
      RAISE EXCEPTION 'Add them to the channel first.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.chat_has_cap(v_channel.workspace_id, p_user_id, 'post') THEN
      RAISE EXCEPTION 'Viewers can''t manage channels.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.chat_channel_managers (channel_id, user_id)
    VALUES (p_channel_id, p_user_id) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
      'chat.manager_add', jsonb_build_object('user_id', p_user_id));
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.chat_channel_managers m
                    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id) THEN
      RETURN;
    END IF;
    -- The last manager in effect stays one (they can leave; leaving hands it on).
    -- A row that manages nothing (its holder left or became a viewer) can go.
    IF public.chat__is_manager(v_channel, p_user_id)
       AND NOT EXISTS (SELECT 1 FROM public.chat_channel_managers m
                    WHERE m.channel_id = p_channel_id AND m.user_id <> p_user_id
                      AND public.chat__can_manage(v_channel, m.user_id)) THEN
      RAISE EXCEPTION 'A channel needs a manager. Make someone else a manager first.' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = p_user_id;
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
      'chat.manager_remove', jsonb_build_object('user_id', p_user_id));
  END IF;
  PERFORM public.chat__touch_roster(p_channel_id);
END;
$function$;

-- ── 4. The announcement switch ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op_set_announcement(p_channel_id uuid, p_on boolean)
RETURNS public.chat_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_on boolean := coalesce(p_on, false);
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages can''t be announcement channels.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can change who posts.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.managers_only = v_on THEN
    RETURN v_channel;
  END IF;
  UPDATE public.chat_channels SET managers_only = v_on WHERE id = p_channel_id
  RETURNING * INTO v_channel;
  -- Not 'chat.announcement': that op is an announcement's bell row (CV-5).
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.announcement_switch', jsonb_build_object('on', v_on));
  RETURN v_channel;
END;
$function$;

-- v1's switch, kept for old builds until CV-23 drops it: v1's own refusals
-- (live body), then the change goes through the new op (its history row).
CREATE OR REPLACE FUNCTION public.share_op_announce(p_channel_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_channel public.chat_channels;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.id IS NULL OR NOT public.chat_can_read_channel(p_channel_id) THEN
    RAISE EXCEPTION 'That channel is gone.';
  END IF;
  PERFORM public.chat_op__guard(v_channel.workspace_id);
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages can''t be announcement-only.';
  END IF;
  IF NOT public.chat__can_manage(v_channel, auth.uid()) THEN
    RAISE EXCEPTION 'Only a channel manager can change this.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat_op_set_announcement(p_channel_id, coalesce(p_on, false));
END;
$function$;

-- ── 5. Make private (one way) ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op_make_private(p_channel_id uuid)
RETURNS public.chat_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_outside uuid[];
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages are already private.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.is_default THEN
    RAISE EXCEPTION 'General stays public.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can make it private.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF v_channel.is_private THEN
    RETURN v_channel;
  END IF;
  UPDATE public.chat_channels SET is_private = true WHERE id = p_channel_id
  RETURNING * INTO v_channel;

  -- Whoever read it without being in it loses it: their items close.
  SELECT coalesce(array_agg(DISTINCT k.user_id), '{}') INTO v_outside
    FROM public.chat_catchup k
   WHERE k.channel_id = p_channel_id AND k.done_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.chat_members mb
                      WHERE mb.channel_id = p_channel_id AND mb.user_id = k.user_id AND mb.left_at IS NULL);
  IF cardinality(v_outside) > 0 THEN
    PERFORM public.chat__close_channel_items(p_channel_id, v_outside);
  END IF;
  -- Those who left it hear about it on their own row (their copy checks access).
  UPDATE public.chat_members SET access_at = clock_timestamp()
   WHERE channel_id = p_channel_id AND left_at IS NOT NULL;

  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.channel_private', '{}'::jsonb);
  RETURN v_channel;
END;
$function$;

-- ── 6. Delete, restore, Recently deleted ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op_delete_channel(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
BEGIN
  IF v_channel.kind <> 'channel' THEN
    RAISE EXCEPTION 'Direct messages can''t be deleted. Leave it instead.' USING ERRCODE = '22023';
  END IF;
  IF v_channel.is_default THEN
    RAISE EXCEPTION 'General can''t be deleted.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat__can_manage(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only this channel''s managers and admins can delete it.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  -- Logged first: once it's deleted, nobody reads it (or its history).
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.channel_delete', '{}'::jsonb);
  UPDATE public.chat_channels SET deleted_at = now(), deleted_by = v_me
   WHERE id = p_channel_id AND deleted_at IS NULL;
  UPDATE public.entities SET deleted_at = coalesce(deleted_at, now()), updated_at = now()
   WHERE workspace_id = v_channel.workspace_id AND entity_type = 'chat_channel' AND entity_id = p_channel_id;
  -- The channel row no longer reaches its members (they can't read it): their
  -- own membership rows do, and their copies check access.
  UPDATE public.chat_members SET access_at = clock_timestamp()
   WHERE channel_id = p_channel_id AND left_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_restore_channel(p_channel_id uuid)
RETURNS public.chat_channels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_name text;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  -- One answer for "no such channel", "not deleted" and "not yours to restore".
  IF v_channel.id IS NULL OR v_channel.kind <> 'channel' OR v_channel.deleted_at IS NULL
     OR NOT public.chat__may_restore(v_channel, v_me) THEN
    RAISE EXCEPTION 'That channel isn''t in Recently deleted.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__guard(v_channel.workspace_id);
  IF v_channel.purged_at IS NOT NULL OR v_channel.deleted_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'That channel was deleted for good.' USING ERRCODE = 'P0002';
  END IF;
  v_name := v_channel.name;
  PERFORM public.chat__lock_name(v_channel.workspace_id, v_name);
  -- Its name was taken meanwhile (create and rename's rule: a public channel,
  -- or for a private one also a private channel the restorer is in): it comes
  -- back as "… (restored)".
  IF public.chat__name_taken(v_channel.workspace_id, v_name, v_channel.id,
                             CASE WHEN v_channel.is_private THEN v_me END) THEN
    v_name := btrim(left(v_channel.name, 69)) || ' (restored)';
    PERFORM public.chat__lock_name(v_channel.workspace_id, v_name);
  END IF;
  BEGIN
    UPDATE public.chat_channels SET deleted_at = NULL, deleted_by = NULL, name = v_name
     WHERE id = p_channel_id
    RETURNING * INTO v_channel;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A channel named "%" already exists. Rename it, then restore this one.', v_name
      USING ERRCODE = '23505';
  END;
  UPDATE public.entities SET deleted_at = NULL, label = v_name, updated_at = now()
   WHERE workspace_id = v_channel.workspace_id AND entity_type = 'chat_channel' AND entity_id = p_channel_id;
  UPDATE public.chat_members SET access_at = clock_timestamp()
   WHERE channel_id = p_channel_id AND left_at IS NULL;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.channel_restore', '{}'::jsonb);
  RETURN v_channel;
END;
$function$;

-- Recently deleted: the channels you may restore, newest first. A key, or
-- anyone outside the workspace, gets nothing.
CREATE OR REPLACE FUNCTION public.chat_recently_deleted(p_workspace_id uuid)
RETURNS TABLE(id uuid, name text, is_private boolean, deleted_at timestamptz, deleted_by uuid, purge_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT c.id, c.name, c.is_private, c.deleted_at, c.deleted_by, c.deleted_at + interval '30 days'
    FROM public.chat_channels c
   WHERE auth.uid() IS NOT NULL
     AND c.workspace_id = p_workspace_id
     AND c.kind = 'channel'
     AND c.deleted_at IS NOT NULL AND c.purged_at IS NULL
     AND c.deleted_at >= now() - interval '30 days'
     AND public.chat__may_restore(c, auth.uid())
   ORDER BY c.deleted_at DESC, c.id
   LIMIT 200
$function$;

-- ── 7. The purge ─────────────────────────────────────────────────────────────

-- Thirty days after a delete, its content goes for good: messages (their
-- Catch up items, chain mutes and typing marks with them), its Catch up
-- items, managers, notices, history and links; the registry row stays a
-- tombstone, and so do the channel row (no name, no topic) and its
-- membership rows (stamped as left).
CREATE OR REPLACE FUNCTION public.chat__purge_deleted(p_limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(c.id), '{}') INTO v_ids FROM (
    SELECT c.id FROM public.chat_channels c
     WHERE c.kind = 'channel' AND c.deleted_at IS NOT NULL AND c.purged_at IS NULL
       AND c.deleted_at < now() - interval '30 days'
     ORDER BY c.deleted_at
     LIMIT greatest(coalesce(p_limit, 200), 1)
     FOR UPDATE SKIP LOCKED) c;
  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.entity_links l
   WHERE (l.source_type = 'chat_channel' AND l.source_id = ANY (v_ids))
      OR (l.target_type = 'chat_channel' AND l.target_id = ANY (v_ids))
      OR (l.source_type = 'chat_message' AND l.source_id IN
            (SELECT m.id FROM public.chat_messages m WHERE m.channel_id = ANY (v_ids)))
      OR (l.target_type = 'chat_message' AND l.target_id IN
            (SELECT m.id FROM public.chat_messages m WHERE m.channel_id = ANY (v_ids)));
  UPDATE public.entities e SET deleted_at = coalesce(e.deleted_at, now()), label = '', updated_at = now()
   WHERE (e.entity_type = 'chat_channel' AND e.entity_id = ANY (v_ids))
      OR (e.entity_type = 'chat_message' AND e.entity_id IN
            (SELECT m.id FROM public.chat_messages m WHERE m.channel_id = ANY (v_ids)));
  DELETE FROM public.chat_catchup WHERE channel_id = ANY (v_ids);
  DELETE FROM public.notice_deliveries WHERE channel_id = ANY (v_ids);
  DELETE FROM public.chat_typing_marks WHERE channel_id = ANY (v_ids);
  DELETE FROM public.chat_channel_managers WHERE channel_id = ANY (v_ids);
  DELETE FROM public.module_activity
   WHERE module = 'chat' AND entity_type = 'chat_channel' AND entity_id = ANY (v_ids);
  -- Replies first: a chain's root is a parent of its replies.
  DELETE FROM public.chat_messages WHERE channel_id = ANY (v_ids) AND parent_id IS NOT NULL;
  DELETE FROM public.chat_messages WHERE channel_id = ANY (v_ids);
  UPDATE public.chat_members SET left_at = coalesce(left_at, now()), last_read_id = NULL
   WHERE channel_id = ANY (v_ids);
  UPDATE public.chat_channels
     SET name = CASE WHEN kind = 'channel' THEN 'Deleted channel' END,
         topic = '', managers_only = false, purged_at = now()
   WHERE id = ANY (v_ids);
  RETURN cardinality(v_ids);
END;
$function$;

SELECT cron.schedule(
  'chat-purge-deleted',
  '17 * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.chat__purge_deleted(25);$cron$
);

-- ── 8. Redefined ops ─────────────────────────────────────────────────────────

-- Removal: recorded whether they were still in it, had left, or (in a public
-- channel) had only read it; it sticks until a manager adds them back. Their
-- open items for it close and a quiet line tells them who did it.
CREATE OR REPLACE FUNCTION public.chat_op_remove_member(p_channel_id uuid, p_user_id uuid)
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
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  -- One change of who manages it at a time (see chat__hand_over).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  SELECT * INTO v_member FROM public.chat_members
   WHERE channel_id = p_channel_id AND user_id = p_user_id FOR UPDATE;

  IF v_member.channel_id IS NULL THEN
    -- Never in it: only a public channel's reader (someone in the workspace) has
    -- anything to be removed from.
    IF v_channel.is_private OR NOT public.chat_is_workspace_member(v_channel.workspace_id, p_user_id) THEN
      RETURN;
    END IF;
    INSERT INTO public.chat_members (channel_id, user_id, workspace_id, left_at, removed_at, removed_by)
    VALUES (p_channel_id, p_user_id, v_channel.workspace_id, now(), now(), v_me)
    ON CONFLICT (channel_id, user_id) DO NOTHING;
    IF NOT FOUND THEN
      -- They joined (by posting) in the meantime: remove that membership instead.
      SELECT * INTO v_member FROM public.chat_members
       WHERE channel_id = p_channel_id AND user_id = p_user_id FOR UPDATE;
      IF v_member.removed_at IS NOT NULL THEN
        RETURN;
      END IF;
      UPDATE public.chat_members
         SET left_at = coalesce(left_at, now()), removed_at = now(), removed_by = v_me
       WHERE channel_id = p_channel_id AND user_id = p_user_id;
    END IF;
  ELSIF v_member.removed_at IS NOT NULL THEN
    RETURN;
  ELSE
    -- The removal is its stamp; removed_by only says who. Someone who had left
    -- keeps the time they left.
    UPDATE public.chat_members
       SET left_at = coalesce(left_at, now()), removed_at = now(), removed_by = v_me
     WHERE channel_id = p_channel_id AND user_id = p_user_id;
  END IF;

  IF v_member.channel_id IS NOT NULL AND v_member.left_at IS NULL THEN
    DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = p_user_id;
    IF FOUND THEN
      v_new := public.chat__hand_over(p_channel_id, p_user_id);
    END IF;
  END IF;
  PERFORM public.chat__close_channel_items(p_channel_id, ARRAY[p_user_id]);
  PERFORM public.chat__quiet_line(v_channel, p_user_id, 'removed', v_me);
  PERFORM public.chat__touch_roster(p_channel_id);
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.member_remove',
    jsonb_build_object('user_id', p_user_id)
      || CASE WHEN v_new IS NOT NULL THEN jsonb_build_object('manager_id', v_new) ELSE '{}'::jsonb END);
END;
$function$;

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

  -- The channel row first, as remove and leave take it (one order, no deadlock).
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  FOR v_uid IN SELECT DISTINCT u FROM unnest(coalesce(p_user_ids, '{}'::uuid[])) u WHERE u IS NOT NULL LOOP
    CONTINUE WHEN NOT public.chat_is_workspace_member(v_channel.workspace_id, v_uid);
    CONTINUE WHEN NOT v_manage AND public.chat__was_removed(p_channel_id, v_uid);
    IF public.chat__enter(p_channel_id, v_channel.workspace_id, v_uid) THEN
      v_added := v_added || v_uid;
      PERFORM public.chat__quiet_line(v_channel, v_uid, 'added', v_me);
    END IF;
  END LOOP;

  IF cardinality(v_added) > 0 THEN
    PERFORM public.chat__touch_roster(p_channel_id);
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
      'chat.member_add', jsonb_build_object('user_ids', to_jsonb(v_added)));
  END IF;
  RETURN cardinality(v_added);
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_op_join(p_channel_id uuid)
RETURNS public.chat_members
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
  -- The channel row first, as remove and leave take it; then the removal is re-read under it.
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF public.chat__was_removed(p_channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this channel. A manager can add you back.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat__enter(p_channel_id, v_channel.workspace_id, v_me);
  PERFORM public.chat__touch_roster(p_channel_id);
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.join', '{}'::jsonb);
  SELECT * INTO v_member FROM public.chat_members WHERE channel_id = p_channel_id AND user_id = v_me;
  RETURN v_member;
END;
$function$;

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
  -- Only an active row: a removal that landed meanwhile stays a removal.
  UPDATE public.chat_members SET left_at = now(), removed_by = NULL, removed_at = NULL
   WHERE channel_id = p_channel_id AND user_id = v_me AND left_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  DELETE FROM public.chat_channel_managers WHERE channel_id = p_channel_id AND user_id = v_me;
  IF FOUND THEN
    v_new := public.chat__hand_over(p_channel_id, v_me);
  END IF;
  PERFORM public.chat__touch_roster(p_channel_id);
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id,
    'chat.leave', CASE WHEN v_new IS NOT NULL THEN jsonb_build_object('manager_id', v_new) ELSE '{}'::jsonb END);
END;
$function$;

-- Archive: read only; its open Catch up items clear (unarchiving reopens none).
CREATE OR REPLACE FUNCTION public.chat_op_archive_channel(p_channel_id uuid, p_archived boolean DEFAULT true)
RETURNS public.chat_channels
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
  IF v_archive THEN
    PERFORM public.chat__close_channel_items(p_channel_id, NULL);
  END IF;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
    CASE WHEN v_archive THEN 'chat.channel_archive' ELSE 'chat.channel_unarchive' END, '{}'::jsonb);
  RETURN v_channel;
END;
$function$;

-- An app's post (live body, 20261017106000): a deleted channel refuses it too.
CREATE OR REPLACE FUNCTION public.chat_op_agent_post(p_workspace_id uuid, p_channel_id uuid, p_body text, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key uuid := public.module_api_key_id();
  v_label text;
  v_channel public.chat_channels;
  v_parent public.chat_messages;
  v_msg public.chat_messages;
  v_body text := coalesce(p_body, '');
  v_stored text;
  v_mentions uuid[];
begin
  if v_key is null then
    raise exception 'Only an API key can post as an app.';
  end if;
  if public.chat_key_scope(p_workspace_id) <> 'edit' then
    raise exception 'This API key can''t post to chat — give it Chat: Edit in Workspace settings → API keys.';
  end if;
  if not public.chat_workspace_enabled(p_workspace_id) then
    raise exception 'Chat is available on the Duo and Team plans.';
  end if;

  select * into v_channel from public.chat_channels
   where id = p_channel_id and workspace_id = p_workspace_id;
  -- A deleted channel (Recently deleted, or purged to a tombstone) is gone for apps too (CV-15).
  if v_channel.id is null or v_channel.kind <> 'channel' or v_channel.is_private
     or v_channel.deleted_at is not null then
    raise exception 'Apps can only post in public channels.';
  end if;
  if v_channel.archived_at is not null then
    raise exception 'This channel is archived.';
  end if;
  if btrim(v_body, E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;
  v_stored := public.chat__v1_to_v2(v_body);
  if char_length(v_stored) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.chat_messages where id = p_parent_id for update;
    if v_parent.id is null or v_parent.channel_id <> p_channel_id or v_parent.parent_id is not null
       or v_parent.deleted_at is not null then
      raise exception 'That thread no longer exists.';
    end if;
  end if;

  select k.name into v_label from public.workspace_api_keys k where k.id = v_key;

  select coalesce(array_agg(distinct m[1]::uuid), '{}') into v_mentions
    from regexp_matches(v_body, '<@([0-9a-fA-F-]{36})>', 'g') m
   where public.chat_is_workspace_member(p_workspace_id, m[1]::uuid);

  insert into public.chat_messages
    (workspace_id, channel_id, parent_id, reply_to_id, author_id, author_kind, author_label, body,
     format_version, mentioned_user_ids)
  values
    (p_workspace_id, p_channel_id, p_parent_id, p_parent_id, null, 'api_key', coalesce(v_label, 'App'), v_stored,
     2, v_mentions)
  returning * into v_msg;

  if v_parent.id is not null then
    update public.chat_messages
       set reply_count = reply_count + 1, last_reply_at = v_msg.created_at
     where id = v_parent.id;
  end if;
  -- Replies post at the bottom too (as a person's send); it also orders this
  -- post's Catch up writes after a concurrent send's in the channel (CV-5).
  update public.chat_channels set last_message_at = v_msg.created_at
   where id = p_channel_id and (last_message_at is null or last_message_at < v_msg.created_at);

  -- CV-5: Catch up items and the bell, among people who can read the channel.
  perform public.chat__fan_out(v_msg, v_channel, null);
  return v_msg;
end;
$function$;

-- ── 9. Grants ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only the ops, the job and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__touch_roster(uuid)',
    'chat__quiet_line(public.chat_channels, uuid, text, uuid)',
    'chat__close_channel_items(uuid, uuid[])',
    'chat__may_restore(public.chat_channels, uuid)',
    'chat__purge_deleted(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must not be callable by clients.', fn;
    END IF;
  END LOOP;
  -- The app's post: the service role only (the connector), as on prod.
  REVOKE ALL ON FUNCTION public.chat_op_agent_post(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat_op_agent_post(uuid, uuid, text, uuid) TO service_role;
  -- The ops and the read: signed-in people and the service role, never anon
  -- (as prod's grants on the redefined ones already are; the local stack's
  -- ACLs aren't prod's, so each is re-stated from nothing).
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_set_manager(uuid, uuid, boolean)',
    'chat_op_set_announcement(uuid, boolean)',
    'chat_op_make_private(uuid)',
    'chat_op_delete_channel(uuid)',
    'chat_op_restore_channel(uuid)',
    'chat_recently_deleted(uuid)',
    'share_op_announce(uuid, boolean)',
    'chat_op_remove_member(uuid, uuid)',
    'chat_op_add_members(uuid, uuid[])',
    'chat_op_join(uuid)',
    'chat_op_leave(uuid)',
    'chat_op_archive_channel(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
END;
$$;

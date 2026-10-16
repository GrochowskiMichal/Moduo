-- Chat v2 · CV-23 Contract cleanup (specs/chat-v2.md AC12.9, AC12.10; §Assumptions
-- #4, #35; .design/chat-v2/research/round-3-database.md §2.3 "Retired"). The
-- stamp must stay after …_chat_v2_agents (CV-21). Every redefined function
-- starts from its live body on the local stack; grants are restated by name.
-- It runs again cleanly over itself (DROP … IF EXISTS, guarded VALIDATE).
--
-- It ships after the first production desktop build that sends only v2
-- signatures (1.0.21, 2026-10-16), and raises app_settings.min_build to it, so
-- an older desktop build is told to update and runs read-only instead of
-- calling a signature that is gone.
--
-- What it does:
--   1. Drops the v1 signatures kept for one release: chat_op_send's seven
--      arguments, chat_op_edit's three, chat_op_react's two (the toggle),
--      chat_op_mark_read / chat_op_mark_unread by timestamp; and
--      share_op_announce (chat_op_set_announcement replaced it) and
--      chat_normalize_channel_name (unused since CV-1).
--   2. chat_op_send stops writing client_id: a send is idempotent on the id the
--      client mints. The column and its unique index stay for v1 rows.
--   3. chat_workspace_enabled(ws) answers only for a member of that workspace
--      (its owner or a workspace_members row) or for the service role; it is
--      false for anyone else.
--   4. Drops v1's chat_messages_channel_idx (chat_messages_stream_idx serves
--      the stream in both directions).
--   5. Validates chat_channels_name_trimmed (no untrimmed name is left).
--   6. Sets app_settings.min_build to 1.0.21.

SET LOCAL lock_timeout = '5s';

-- ── 1. Retired signatures ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text);
DROP FUNCTION IF EXISTS public.chat_op_edit(uuid, text, uuid[]);
DROP FUNCTION IF EXISTS public.chat_op_react(uuid, text);
DROP FUNCTION IF EXISTS public.chat_op_mark_read(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.chat_op_mark_unread(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.share_op_announce(uuid, boolean);
DROP FUNCTION IF EXISTS public.chat_normalize_channel_name(text);

-- ── 2. chat_op_send (live body; client_id no longer written) ───────────────
CREATE OR REPLACE FUNCTION public.chat_op_send(p_id uuid, p_channel_id uuid, p_body text, p_reply_to_id uuid DEFAULT NULL::uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_body text := coalesce(p_body, '');
  v_quoted public.chat_messages;
  v_root public.chat_messages;
  v_msg public.chat_messages;
  v_people uuid[];
  v_teams uuid[];
  v_everyone boolean;
  v_files integer;
  v_root_id uuid;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'A message needs its id.' USING ERRCODE = '22023';
  END IF;
  -- A resent id returns the stored row (the outbox retries with the same id),
  -- only to its author, in its conversation, while they can still read it.
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_id;
  IF v_msg.id IS NOT NULL THEN
    IF v_me IS NOT NULL AND v_msg.author_id = v_me AND v_msg.channel_id = p_channel_id
       AND public.chat_can_read_channel(p_channel_id) THEN
      RETURN v_msg;
    END IF;
    PERFORM public.chat_op__channel(p_channel_id);
    RAISE EXCEPTION 'That message id is already used.' USING ERRCODE = '22023';
  END IF;

  v_channel := public.chat_op__channel(p_channel_id);
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(p_channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  -- Managers in effect only: in the channel, in a role that posts.
  IF v_channel.managers_only AND NOT public.chat__is_manager(v_channel, v_me) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
  END IF;
  -- CV-9: the sender's finished files uploaded under this id go with it
  -- (locked, so the composer's remove can't race the send).
  SELECT count(*) INTO v_files FROM (
    SELECT 1 FROM public.attachments a
     WHERE a.entity_type = 'chat_message' AND a.entity_id = p_id AND a.uploader_id = v_me
       AND a.workspace_id = v_channel.workspace_id AND a.status = 'ready' AND a.deleted_at IS NULL
     FOR UPDATE) f;
  IF v_files > public.attachments__chat_file_cap() THEN
    RAISE EXCEPTION 'A message holds up to % files.', public.attachments__chat_file_cap()
      USING ERRCODE = '22023';
  END IF;
  -- A message with files may have no words.
  IF v_files = 0 OR btrim(v_body, E' \n\t') <> '' THEN
    PERFORM public.chat__check_body(v_body);
  END IF;

  -- A reply posts in the conversation and joins the chain of what it answers.
  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
    IF v_quoted.id IS NULL OR v_quoted.channel_id <> p_channel_id OR v_quoted.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF v_quoted.kind <> 'message' THEN
      RAISE EXCEPTION 'Only a message can be replied to.' USING ERRCODE = '22023';
    END IF;
    -- The quoted message and its chain's root, locked in id order (as a move
    -- locks them), then read again: a move or a delete that got there first
    -- leaves nothing to answer here.
    v_root_id := coalesce(v_quoted.parent_id, v_quoted.id);
    PERFORM 1 FROM public.chat_messages
     WHERE id IN (v_quoted.id, v_root_id)
     ORDER BY id FOR UPDATE;
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
    SELECT * INTO v_root FROM public.chat_messages WHERE id = coalesce(v_quoted.parent_id, v_quoted.id);
    IF v_quoted.channel_id <> p_channel_id OR v_quoted.deleted_at IS NOT NULL
       OR v_root.id IS NULL OR v_root.channel_id <> p_channel_id THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    -- It joined another chain before the lock: that root isn't locked.
    IF v_root.id <> v_root_id OR v_root.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'That conversation just changed. Try again.' USING ERRCODE = '40001';
    END IF;
  END IF;

  -- Who it mentions is read from the text, here.
  SELECT mt.people, mt.teams, mt.everyone INTO v_people, v_teams, v_everyone
    FROM public.chat__read_mentions(v_channel, v_body, v_me) mt;

  -- Posting in a public channel joins it, or back after leaving it.
  INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
  VALUES (p_channel_id, v_me, v_channel.workspace_id)
  ON CONFLICT (channel_id, user_id) DO UPDATE SET left_at = NULL
   WHERE public.chat_members.left_at IS NOT NULL AND public.chat_members.removed_at IS NULL;

  -- A send is idempotent on its own id (the client mints it); client_id is
  -- kept on v1 rows only and no longer written.
  INSERT INTO public.chat_messages
    (id, workspace_id, channel_id, parent_id, reply_to_id, author_id, body, format_version,
     mentioned_user_ids, mentioned_team_ids, mentions_everyone, file_count)
  VALUES
    (p_id, v_channel.workspace_id, p_channel_id, v_root.id, v_quoted.id, v_me, v_body, 2,
     v_people, v_teams, v_everyone, v_files)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_msg;
  IF v_msg.id IS NULL THEN
    -- The same id sent twice at once: the first one won.
    SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_id;
    IF v_msg.author_id = v_me AND v_msg.channel_id = p_channel_id THEN
      RETURN v_msg;
    END IF;
    RAISE EXCEPTION 'That message id is already used.' USING ERRCODE = '22023';
  END IF;

  IF v_root.id IS NOT NULL THEN
    UPDATE public.chat_messages
       SET reply_count = reply_count + 1,
           last_reply_at = v_msg.created_at,
           reply_user_ids = (
             SELECT coalesce(array_agg(u), '{}') FROM (
               SELECT u FROM unnest(array[v_me] || array_remove(reply_user_ids, v_me)) WITH ORDINALITY t(u, o)
                ORDER BY o LIMIT 5) s)
     WHERE id = v_root.id
    RETURNING * INTO v_root;
    -- CV-12: a new reply to a wrapped chain reopens it, visibly (CH54).
    PERFORM public.chat__reopen_chain(v_root, v_me, v_msg.created_at);
  END IF;
  -- Replies post at the bottom too: the conversation's last message moves.
  UPDATE public.chat_channels SET last_message_at = v_msg.created_at
   WHERE id = p_channel_id AND (last_message_at IS NULL OR last_message_at < v_msg.created_at);
  -- The sender has read up to their own message.
  UPDATE public.chat_members mb
     SET last_read_id = v_msg.id,
         last_read_at = greatest(mb.last_read_at, v_msg.created_at)
   WHERE mb.channel_id = p_channel_id AND mb.user_id = v_me
     AND NOT EXISTS (SELECT 1 FROM public.chat_messages r
                      WHERE r.id = mb.last_read_id
                        AND (r.created_at, r.id) > (v_msg.created_at, v_msg.id));

  -- CV-10: the items it refers to show "Mentioned in" this conversation.
  PERFORM public.chat__link_mentions(v_msg, v_me);
  -- CV-5: Catch up items and the bell for everyone it's addressed to, and
  -- the sender's own items up to here are read.
  PERFORM public.chat__fan_out(v_msg, v_channel, v_me);
  PERFORM public.chat__close_read(v_me, p_channel_id, v_msg);
  RETURN v_msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_op_send(uuid, uuid, text, uuid) TO authenticated, service_role;

-- ── 3. chat_workspace_enabled: members and the service role only ────────────
-- Rule: it answers for a member of the workspace (its owner or a
-- workspace_members row) or for the service role (the connector); for anyone
-- else it is false.
CREATE OR REPLACE FUNCTION public.chat_workspace_enabled(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_grant text;
  v_role text;
  v_me uuid := auth.uid();
BEGIN
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  IF v_role IS DISTINCT FROM 'service_role'
     AND (v_me IS NULL OR NOT public.chat_is_workspace_member(p_workspace_id, v_me)) THEN
    RETURN false;
  END IF;

  SELECT w.owner_id INTO v_owner
    FROM public.workspaces w
   WHERE w.id = p_workspace_id
     AND w.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The owner's plan (v1's rule, unchanged).
  IF public.plan_tier_rank(public.profile_plan_tier_text(v_owner)) >= public.plan_tier_rank('duo') THEN
    RETURN true;
  END IF;

  -- A dated grant (TX-9b), when its function exists. `::text` takes a text or a
  -- plan_tier result alike; null or an unknown tier ranks 0.
  IF to_regprocedure('public.plan_grant_effective_tier(uuid)') IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    v_grant := public.plan_grant_effective_tier(p_workspace_id)::text;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat_workspace_enabled: plan_grant_effective_tier failed (%), read as no grant', SQLSTATE;
    RETURN false;
  END;
  RETURN public.plan_tier_rank(v_grant) >= public.plan_tier_rank('duo');
END;
$function$;

COMMENT ON FUNCTION public.chat_workspace_enabled(uuid) IS
  'Chat is on for this workspace: its owner''s plan is Duo or above, or it holds a dated grant (TX-9b). Answers only for a member of the workspace or the service role; false for anyone else.';

REVOKE ALL ON FUNCTION public.chat_workspace_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_workspace_enabled(uuid) TO authenticated, service_role;

-- ── 4. v1's stream index ────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.chat_messages_channel_idx;

-- ── 5. Channel names are trimmed ────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.chat_channels'::regclass
                AND conname = 'chat_channels_name_trimmed' AND NOT convalidated) THEN
    ALTER TABLE public.chat_channels VALIDATE CONSTRAINT chat_channels_name_trimmed;
  END IF;
END;
$$;

-- ── 6. The oldest build that may still save ─────────────────────────────────
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('min_build', '"1.0.21"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();

-- ── Checks ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  IF to_regprocedure('public.chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)') IS NOT NULL
     OR to_regprocedure('public.chat_op_edit(uuid, text, uuid[])') IS NOT NULL
     OR to_regprocedure('public.chat_op_react(uuid, text)') IS NOT NULL
     OR to_regprocedure('public.chat_op_mark_read(uuid, timestamptz)') IS NOT NULL
     OR to_regprocedure('public.chat_op_mark_unread(uuid, timestamptz)') IS NOT NULL
     OR to_regprocedure('public.share_op_announce(uuid, boolean)') IS NOT NULL
     OR to_regprocedure('public.chat_normalize_channel_name(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'CV-23: a retired signature is still there';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.chat_workspace_enabled(uuid)'::regprocedure,
    'public.chat_op_send(uuid, uuid, text, uuid)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p
          WHERE p.oid = v_fn AND p.prosecdef
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'CV-23: % lost its definer settings or grants', v_fn;
    END IF;
  END LOOP;
END;
$$;

-- Chat v2: Later and Remind me (CV-11, specs/chat-v2.md §9, §11; #8, #33).
--
-- Remind me and Later are one mechanism (round-3 §2.16):
--   • chat_op_remind(message | conversation, at) puts your open Catch up items
--     for that message off until `at` (Later), or, when nothing of yours is
--     open there, writes a `reminder` item that shows at `at` (Remind me on any
--     message, addressed to you or not). A conversation alone (`/remind`)
--     writes a reminder that brings back the conversation's newest message at
--     that time. `at = null` clears. One year at most; never in the past.
--   • chat__fire_later(), every minute: due items come back to the top of
--     Catch up (`later_notified_at`), their bell twin shows again, and one
--     `chat_reminder` notice goes through the gate (notice__gate).
--   • While an item is put off its bell twin is hidden too, including the
--     twin a newer reply moves a put-off chain to (trigger below).
--   • chat_catchup_open(workspace): Catch up's list for the signed-in person:
--     only open items showing now, in conversations they can still read.
-- Like the other Catch up ops: no plan check (#25), no activity row (#15),
-- keys refused (a key has no person: "Sign in first.").

SET LOCAL lock_timeout = '5s';

-- ── 1. One open conversation reminder per person and conversation ───────────

CREATE UNIQUE INDEX IF NOT EXISTS chat_catchup_open_conv_reminder_uq
  ON public.chat_catchup (user_id, channel_id)
  WHERE reason = 'reminder' AND message_id IS NULL AND done_at IS NULL;

-- ── 2. chat_op_remind ───────────────────────────────────────────────────────

-- Catch up puts items off by item (p_item_ids): a chain whose newest reply was
-- deleted shows on an older reply, which its item doesn't name.
DROP FUNCTION IF EXISTS public.chat_op_remind(uuid, uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.chat_op_remind(p_message_id uuid, p_channel_id uuid, p_at timestamptz,
                                                 p_item_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_channel public.chat_channels;
  v_n integer := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF num_nonnulls(p_message_id, p_channel_id, p_item_ids) <> 1 THEN
    RAISE EXCEPTION 'Name a message or a conversation.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_item_ids) > 1000 THEN
    RAISE EXCEPTION 'Up to 1,000 items at a time.' USING ERRCODE = '22023';
  END IF;
  IF p_at IS NOT NULL AND p_at > now() + interval '1 year' THEN
    RAISE EXCEPTION 'Pick a time within a year.' USING ERRCODE = '22023';
  END IF;
  IF p_at IS NOT NULL AND p_at <= now() THEN
    RAISE EXCEPTION 'Pick a time in the future.' USING ERRCODE = '22023';
  END IF;

  IF p_item_ids IS NOT NULL THEN
    NULL;  -- your own Catch up items: nothing to look up
  ELSIF p_message_id IS NOT NULL THEN
    SELECT m.* INTO v_msg FROM public.chat_messages m
     WHERE m.id = p_message_id AND m.kind = 'message' AND m.deleted_at IS NULL;
    -- A message you can't read answers like one that isn't there.
    IF v_msg.id IS NULL OR NOT public.chat__can_read_channel_as(v_msg.channel_id, v_me) THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    SELECT c.* INTO v_channel FROM public.chat_channels c WHERE c.id = v_msg.channel_id;
  ELSE
    SELECT c.* INTO v_channel FROM public.chat_channels c WHERE c.id = p_channel_id;
    IF v_channel.id IS NULL OR NOT public.chat__can_read_channel_as(v_channel.id, v_me) THEN
      RAISE EXCEPTION 'That conversation isn''t available.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_at IS NULL THEN
    -- Clear: a reminder is done; an item put off with Later shows again now.
    WITH mine AS (
      SELECT k.id, k.reason, k.activity_id
        FROM public.chat_catchup k
       WHERE k.user_id = v_me AND k.done_at IS NULL
         AND CASE WHEN p_item_ids IS NOT NULL THEN k.id = ANY (p_item_ids)
                  WHEN p_message_id IS NOT NULL THEN k.message_id = p_message_id
                  ELSE k.channel_id = v_channel.id AND k.reason = 'reminder' AND k.message_id IS NULL END
       FOR UPDATE
    ), done AS (
      UPDATE public.chat_catchup k SET done_at = now(), done_how = 'done'
        FROM mine WHERE k.id = mine.id AND mine.reason = 'reminder'
      RETURNING k.id
    ), shown AS (
      UPDATE public.chat_catchup k SET later_until = NULL, later_notified_at = NULL
        FROM mine WHERE k.id = mine.id AND mine.reason <> 'reminder' AND k.later_until IS NOT NULL
      RETURNING k.activity_id
    ), twins AS (
      UPDATE public.notification_state ns SET dismissed_at = NULL
        FROM shown s
       WHERE ns.user_id = v_me AND ns.activity_id = s.activity_id AND ns.dismissed_at IS NOT NULL
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM done) + (SELECT count(*) FROM shown) INTO v_n;
    RETURN v_n;
  END IF;

  IF p_message_id IS NOT NULL OR p_item_ids IS NOT NULL THEN
    -- Later: your open items for this message (a grouped item names its
    -- newest message), or the Catch up items named, are put off; their bell
    -- twins go with them.
    WITH snoozed AS (
      UPDATE public.chat_catchup k
         SET later_until = p_at, later_notified_at = NULL
       WHERE k.user_id = v_me AND k.done_at IS NULL
         AND CASE WHEN p_item_ids IS NOT NULL THEN k.id = ANY (p_item_ids)
                  ELSE k.message_id = p_message_id END
         AND k.reason NOT IN ('added', 'removed', 'level_reset')
      RETURNING k.workspace_id, k.activity_id
    ), hidden AS (
      INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
      SELECT DISTINCT s.workspace_id, v_me, s.activity_id, now()
        FROM snoozed s WHERE s.activity_id IS NOT NULL
      ON CONFLICT (user_id, activity_id) DO UPDATE
        SET dismissed_at = coalesce(public.notification_state.dismissed_at, EXCLUDED.dismissed_at)
      RETURNING 1
    )
    SELECT count(*)::int INTO v_n FROM snoozed;
    -- Items named: never a reminder in their place.
    IF v_n > 0 OR p_item_ids IS NOT NULL THEN
      RETURN v_n;
    END IF;

    -- Remind me: nothing of yours is open there, so a reminder item.
    INSERT INTO public.chat_catchup
      (workspace_id, user_id, channel_id, message_id, reason, actor_id, later_until)
    VALUES (v_channel.workspace_id, v_me, v_channel.id, v_msg.id, 'reminder', v_msg.author_id, p_at)
    ON CONFLICT (user_id, message_id, reason) WHERE message_id IS NOT NULL
    DO UPDATE SET done_at = NULL, done_how = NULL, later_until = EXCLUDED.later_until,
                  later_notified_at = NULL, channel_id = EXCLUDED.channel_id;
    RETURN 1;
  END IF;

  -- /remind: the conversation, its newest message chosen when it comes due.
  INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason, later_until)
  VALUES (v_channel.workspace_id, v_me, v_channel.id, 'reminder', p_at)
  ON CONFLICT (user_id, channel_id) WHERE reason = 'reminder' AND message_id IS NULL AND done_at IS NULL
  DO UPDATE SET later_until = EXCLUDED.later_until, later_notified_at = NULL;
  RETURN 1;
END;
$function$;

-- ── 3. A put-off item's newer bell twin stays hidden ────────────────────────
-- The fan-out moves a grouped item (a chain, an Every-message line) to the
-- newest message and gives it that message's bell row; while the item is put
-- off, that row is hidden too (the item keeps its Later, CV-5).

CREATE OR REPLACE FUNCTION public.chat__catchup_snoozed_twin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.notification_state (workspace_id, user_id, activity_id, dismissed_at)
  VALUES (NEW.workspace_id, NEW.user_id, NEW.activity_id, now())
  ON CONFLICT (user_id, activity_id) DO UPDATE
    SET dismissed_at = coalesce(public.notification_state.dismissed_at, EXCLUDED.dismissed_at);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS chat_catchup_snoozed_twin ON public.chat_catchup;
CREATE TRIGGER chat_catchup_snoozed_twin
  AFTER UPDATE OF activity_id ON public.chat_catchup
  FOR EACH ROW
  WHEN (NEW.activity_id IS NOT NULL AND NEW.activity_id IS DISTINCT FROM OLD.activity_id
        AND NEW.done_at IS NULL AND NEW.later_until IS NOT NULL AND NEW.later_notified_at IS NULL)
  EXECUTE FUNCTION public.chat__catchup_snoozed_twin();

-- ── 4. The minute job ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat__fire_later(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  r record;
  v_n integer := 0;
  v_channel public.chat_channels;
  v_msg public.chat_messages;
  v_alive public.chat_messages;
  v_readable boolean;
  v_newest uuid;
  v_gate text;
  v_where text;
  v_ws text;
BEGIN
  FOR r IN
    SELECT k.id, k.user_id, k.workspace_id, k.channel_id, k.message_id, k.reason, k.activity_id, k.chain_root_id
      FROM public.chat_catchup k
     WHERE k.done_at IS NULL AND k.later_notified_at IS NULL AND k.later_until <= p_now
     ORDER BY k.later_until, k.id
     LIMIT greatest(least(coalesce(p_limit, 500), 5000), 1)
     FOR UPDATE OF k SKIP LOCKED
  LOOP
    -- One item at a time: an item that fails comes back without a notice
    -- (and is logged) instead of holding up everyone's due items each minute.
    <<one_item>>
    BEGIN
      v_n := v_n + 1;
      v_msg := NULL;
      v_alive := NULL;
      v_newest := NULL;
      SELECT c.* INTO v_channel FROM public.chat_channels c WHERE c.id = r.channel_id;
      v_readable := public.chat__can_read_channel_as(r.channel_id, r.user_id);

      -- A conversation's reminder brings back its newest message (unless you
      -- already keep a reminder on that one: then it stays the conversation's).
      IF r.message_id IS NULL AND r.reason = 'reminder' AND v_readable THEN
        SELECT m.id INTO v_newest FROM public.chat_messages m
         WHERE m.channel_id = r.channel_id AND m.kind = 'message' AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
        IF v_newest IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.chat_catchup o
              WHERE o.user_id = r.user_id AND o.message_id = v_newest AND o.reason = 'reminder') THEN
          r.message_id := v_newest;
        END IF;
      END IF;

      UPDATE public.chat_catchup k
         SET later_notified_at = p_now, message_id = r.message_id
       WHERE k.id = r.id;

      IF r.message_id IS NOT NULL THEN
        SELECT m.* INTO v_msg FROM public.chat_messages m WHERE m.id = r.message_id;
        -- A chain or Every-message line whose newest message was deleted rings
        -- about the message Catch up lists it on: its newest live one from
        -- someone else, still unread (chat_catchup_open).
        IF v_msg.id IS NOT NULL AND v_msg.deleted_at IS NOT NULL AND r.reason IN ('reply', 'every_message') THEN
          SELECT x.* INTO v_alive
            FROM public.chat_messages x
            LEFT JOIN public.chat_members mem
              ON mem.channel_id = x.channel_id AND mem.user_id = r.user_id AND mem.left_at IS NULL
            LEFT JOIN public.chat_messages rm ON rm.id = mem.last_read_id
           WHERE x.channel_id = v_msg.channel_id AND x.kind = 'message' AND x.deleted_at IS NULL
             AND x.author_id IS DISTINCT FROM r.user_id
             AND (r.reason = 'every_message' OR x.parent_id = r.chain_root_id)
             AND (x.created_at, x.id) < (v_msg.created_at, v_msg.id)
             AND (mem.channel_id IS NULL
                  OR CASE WHEN rm.id IS NULL THEN x.created_at > coalesce(mem.last_read_at, '-infinity'::timestamptz)
                          ELSE (x.created_at, x.id) > (rm.created_at, rm.id) END)
           ORDER BY x.created_at DESC, x.id DESC
           LIMIT 1;
          IF v_alive.id IS NOT NULL THEN
            v_msg := v_alive;
          END IF;
        END IF;
        v_readable := v_msg.id IS NOT NULL AND v_msg.deleted_at IS NULL
                      AND public.chat__can_read_channel_as(v_msg.channel_id, r.user_id);
        IF v_readable AND v_msg.channel_id <> v_channel.id THEN
          SELECT c.* INTO v_channel FROM public.chat_channels c WHERE c.id = v_msg.channel_id;
        END IF;
      END IF;

      -- One notice, through the gate; nothing about what they can't read.
      EXIT one_item WHEN NOT v_readable OR v_channel.id IS NULL;

      -- Its bell twin shows again (only for what they can still read).
      IF r.activity_id IS NOT NULL THEN
        UPDATE public.notification_state ns SET dismissed_at = NULL
         WHERE ns.user_id = r.user_id AND ns.activity_id = r.activity_id AND ns.dismissed_at IS NOT NULL;
      END IF;

      v_gate := public.notice__gate(r.user_id, v_channel.workspace_id, 'chat_reminder', p_now);
      EXIT one_item WHEN v_gate NOT IN ('send', 'hold');

      v_where := CASE WHEN v_channel.kind <> 'dm' AND nullif(btrim(v_channel.name), '') IS NOT NULL
                      THEN '#' || left(btrim(v_channel.name), 80) ELSE 'Direct message' END;
      SELECT left(nullif(btrim(w.name), ''), 80) INTO v_ws
        FROM public.workspaces w WHERE w.id = v_channel.workspace_id;

      INSERT INTO public.notice_deliveries
        (user_id, workspace_id, kind, title, body, url, channel_id, message_id, tag, push_after, held_for_focus)
      SELECT r.user_id, v_channel.workspace_id, 'chat_reminder',
             left('Reminder · '
                  || CASE WHEN v_msg.id IS NOT NULL
                          THEN public.chat__sender_label(v_msg, v_msg.author_id) || ' · ' ELSE '' END
                  || v_where || coalesce(' · ' || v_ws, ''), 300),
             CASE WHEN v_msg.id IS NOT NULL AND coalesce(up.notice_show_text, true)
                  THEN left(public.chat__notice_text(v_msg.body, v_channel.workspace_id, r.user_id), 500) END,
             '/chat?c=' || v_channel.id || coalesce('&m=' || v_msg.id, ''),
             v_channel.id, v_msg.id,
             'chat:' || v_channel.id || ':remind:' || r.id,
             p_now, v_gate = 'hold'
        FROM (SELECT 1) one
        LEFT JOIN public.user_preferences up ON up.user_id = r.user_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'chat__fire_later: item % failed: %', r.id, SQLERRM;
      UPDATE public.chat_catchup k SET later_notified_at = p_now WHERE k.id = r.id;
    END;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- ── 4b. Undo brings back "X removed you from Q" too ─────────────────────────
-- Catch up lists that line though the conversation can't be read (section 5),
-- so Done on it can be undone (live body: 20261017106000_chat_v2_catchup).

CREATE OR REPLACE FUNCTION public.chat__reopen(p_user uuid, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  WITH cand AS (
    SELECT k.id, k.reason, k.channel_id, k.chain_root_id,
           coalesce(m.created_at, k.created_at) AS at, coalesce(m.id, k.id) AS tie
      FROM public.chat_catchup k
      LEFT JOIN public.chat_messages m ON m.id = k.message_id
     WHERE k.user_id = p_user AND k.id = ANY (coalesce(p_ids, '{}'::uuid[]))
       AND k.done_at IS NOT NULL AND k.done_how <> 'closed'
       AND (public.chat__can_read_channel_as(k.channel_id, p_user)
            OR (k.reason = 'removed' AND k.message_id IS NULL
                AND public.chat__reads_workspace(k.workspace_id, p_user)))
       AND NOT (k.reason = 'reply' AND EXISTS (
             SELECT 1 FROM public.chat_chain_mutes cm
              WHERE cm.user_id = p_user AND cm.root_id = k.chain_root_id))
  ), grouped AS (
    SELECT DISTINCT ON (c.reason, coalesce(c.chain_root_id, c.channel_id))
           c.id, c.reason, c.channel_id, c.chain_root_id, c.at, c.tie
      FROM cand c
     WHERE c.reason IN ('reply', 'every_message')
     ORDER BY c.reason, coalesce(c.chain_root_id, c.channel_id), c.at DESC, c.tie DESC
  ), pick AS (
    SELECT c.id FROM cand c WHERE c.reason NOT IN ('reply', 'every_message')
    UNION ALL
    SELECT g.id FROM grouped g
     WHERE NOT EXISTS (
       SELECT 1 FROM public.chat_catchup o
         LEFT JOIN public.chat_messages om ON om.id = o.message_id
        WHERE o.user_id = p_user AND o.reason = g.reason AND o.id <> g.id
          AND CASE WHEN g.reason = 'reply' THEN o.chain_root_id = g.chain_root_id
                   ELSE o.channel_id = g.channel_id END
          AND (o.done_at IS NULL
               OR (coalesce(om.created_at, o.created_at), coalesce(om.id, o.id)) > (g.at, g.tie)))
  ), opened AS (
    UPDATE public.chat_catchup k
       SET done_at = NULL, done_how = NULL
      FROM pick
     WHERE k.id = pick.id
    RETURNING k.activity_id
  ), shown AS (
    UPDATE public.notification_state ns
       SET dismissed_at = NULL
      FROM opened o
     WHERE ns.user_id = p_user AND ns.activity_id = o.activity_id AND ns.dismissed_at IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM opened;
  RETURN v_n;
END;
$function$;

-- ── 5. Catch up's list ──────────────────────────────────────────────────────
-- Open items showing now (not put off), in conversations the person can still
-- read, about messages still there. The same rules as chat_unread_counts'
-- Catch up share, except that a conversation set to Nothing still lists its
-- items (CH40: "waits here silently") and quiet lines are listed (not
-- counted). `at` orders the list: the newest message, or when it came back.

DROP FUNCTION IF EXISTS public.chat_catchup_open(uuid);
CREATE FUNCTION public.chat_catchup_open(p_workspace_id uuid)
RETURNS TABLE (
  id uuid,
  channel_id uuid,
  message_id uuid,
  chain_root_id uuid,
  reason text,
  actor_id uuid,
  created_at timestamptz,
  later_until timestamptz,
  returned_at timestamptz,
  at timestamptz,
  channel_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT k.id, coalesce(m.channel_id, k.channel_id),
         -- A chain or Every-message line whose newest message was deleted shows
         -- its newest live message from someone else (the count keeps it too).
         CASE WHEN m.deleted_at IS NULL THEN k.message_id ELSE alive.id END,
         k.chain_root_id, k.reason, k.actor_id,
         k.created_at, k.later_until, k.later_notified_at,
         greatest(coalesce(CASE WHEN m.deleted_at IS NULL THEN m.created_at ELSE alive.created_at END,
                           k.created_at),
                  coalesce(k.later_notified_at, '-infinity'::timestamptz)),
         k.channel_name
    FROM public.chat_catchup k
    LEFT JOIN public.chat_messages m ON m.id = k.message_id
    LEFT JOIN public.chat_members mem
      ON mem.channel_id = coalesce(m.channel_id, k.channel_id) AND mem.user_id = v_me AND mem.left_at IS NULL
    LEFT JOIN public.chat_messages rm ON rm.id = mem.last_read_id
    LEFT JOIN LATERAL (
      SELECT x.id, x.created_at FROM public.chat_messages x
       WHERE m.deleted_at IS NOT NULL AND k.reason IN ('reply', 'every_message')
         AND x.channel_id = m.channel_id AND x.kind = 'message' AND x.deleted_at IS NULL
         AND x.author_id IS DISTINCT FROM v_me
         AND (k.reason = 'every_message' OR x.parent_id = k.chain_root_id)
         AND (x.created_at, x.id) < (m.created_at, m.id)
         -- still unread (past your read mark), as chat_unread_counts keeps it
         AND (mem.channel_id IS NULL
              OR CASE WHEN rm.id IS NULL THEN x.created_at > coalesce(mem.last_read_at, '-infinity'::timestamptz)
                      ELSE (x.created_at, x.id) > (rm.created_at, rm.id) END)
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT 1
    ) alive ON true
   WHERE k.user_id = v_me AND k.workspace_id = p_workspace_id AND k.done_at IS NULL
     AND (k.later_until IS NULL OR k.later_notified_at IS NOT NULL OR k.later_until <= now())
     AND (k.message_id IS NULL OR (m.id IS NOT NULL AND (m.deleted_at IS NULL OR alive.id IS NOT NULL)))
     AND NOT (k.reason = 'team_mention' AND public.chat__team_muted(v_me))
     AND NOT (k.reason = 'every_message' AND coalesce(mem.notify_level, '') <> 'all')
     AND NOT (k.reason = 'reply' AND EXISTS (
           SELECT 1 FROM public.chat_chain_mutes cm
            WHERE cm.user_id = v_me AND cm.root_id = k.chain_root_id))
     -- Readable conversations only; "X removed you from Q" is the one line
     -- about a conversation you can no longer read (no message, its stored name).
     AND (public.chat__can_read_channel_as(coalesce(m.channel_id, k.channel_id), v_me)
          OR (k.reason = 'removed' AND k.message_id IS NULL
              AND public.chat__reads_workspace(p_workspace_id, v_me)))
   ORDER BY 10 DESC, k.id DESC
   LIMIT 2000;
END;
$function$;

-- ── 6. Grants ───────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- The op: signed-in people (a key reaches it as the service role and is refused inside).
  REVOKE ALL ON FUNCTION public.chat_op_remind(uuid, uuid, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat_op_remind(uuid, uuid, timestamptz, uuid[]) TO authenticated, service_role;
  -- The list answers people only, like chat_unread_counts.
  REVOKE ALL ON FUNCTION public.chat_catchup_open(uuid) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.chat_catchup_open(uuid) TO authenticated;
  -- Server-only: the job, the trigger's function and Undo's helper (as 20261017106000).
  REVOKE ALL ON FUNCTION public.chat__reopen(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat__reopen(uuid, uuid[]) TO service_role;
  REVOKE ALL ON FUNCTION public.chat__fire_later(timestamptz, integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat__fire_later(timestamptz, integer) TO service_role;
  REVOKE ALL ON FUNCTION public.chat__catchup_snoozed_twin() FROM PUBLIC, anon, authenticated;

  IF has_function_privilege('anon', 'public.chat_op_remind(uuid, uuid, timestamptz, uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.chat_op_remind(uuid, uuid, timestamptz, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chat_catchup_open(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.chat_catchup_open(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.chat_catchup_open(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__fire_later(timestamptz, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chat__fire_later(timestamptz, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__catchup_snoozed_twin()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__reopen(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Grants on the Later functions are not as intended.';
  END IF;
END;
$$;

-- ── 7. Every minute ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-fire-later') THEN
    PERFORM cron.unschedule('chat-fire-later');
  END IF;
END;
$$;
SELECT cron.schedule(
  'chat-fire-later',
  '* * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.chat__fire_later(now());$cron$
);

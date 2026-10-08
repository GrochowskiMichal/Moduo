-- Apps can post in chat again: the chat message guard checks the key's
-- creator when a message has no author (t/maciej/api-key-module-scopes).
--
-- Found 2026-10-08 by the keyed round-trip on prod (rolled back).
-- chat_op_agent_post (20261006160000_chat_agent_access) stores an app's
-- message with author_id NULL: it is the app's, shown with an "App" badge.
-- share_chat_message_guard (20261006210000_perm_sharing) then checks
-- chat_has_cap(workspace, author_id, 'post'), which is false for NULL, so
-- every key's chat_post has been refused with "Your role can't post in chat."
-- since that migration.
--
-- Now the guard checks the actor when there is no author: perm_actor_id(),
-- which under a key is its creator (PERM-0). An app posts only where its
-- creator could, a managers-only channel needs the creator to be a manager,
-- and @channel needs the creator's mention_everyone. People's messages are
-- checked as before (author_id is the poster), and a message with neither an
-- author nor an actor is still refused.
--
-- Body is the 20261006210000 one (db:reconcile: matches prod) with the author
-- resolved once. Same trigger, same signature.

CREATE OR REPLACE FUNCTION public.share_chat_message_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel public.chat_channels;
  -- An app's message has no author; it posts as its key's creator.
  v_author uuid := coalesce(NEW.author_id, public.perm_actor_id());
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = NEW.channel_id;
  IF NOT public.chat_has_cap(NEW.workspace_id, v_author, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.managers_only
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_channel_managers m
       WHERE m.channel_id = NEW.channel_id AND m.user_id = v_author
     ) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
  END IF;
  IF (position('@channel' in lower(NEW.body)) > 0 OR position('@everyone' in lower(NEW.body)) > 0)
     AND NOT public.chat_has_cap(NEW.workspace_id, v_author, 'mention_everyone') THEN
    RAISE EXCEPTION 'Your role can''t mention everyone.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

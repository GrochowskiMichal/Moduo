-- Chat v2 · CV-1 conversion of live v1 data (specs/chat-v2.md Assumption #27;
-- .design/chat-v2/research/round-3-database.md §2.6). Provisional stamp: re-cut on
-- the day it applies, right after …_chat_v2_foundation, which defines
-- chat__convert_v1() and everything it calls.
--
-- One pass over every workspace, idempotent per step (a second run changes no row):
--   1. bodies in v1 markup → the v2 stored form (format_version 1 → 2); v1 thread
--      replies flagged (v1_thread_reply), so they count as read with their root;
--   2. a notes-to-self conversation → one private note "Notes to self (from
--      Chat)" in its person's Notes Inbox, every message in order with its time;
--      the conversation is deleted;
--   3. channels on Every message → Mentions and replies, with one quiet Catch up
--      line (level_reset) per person and conversation; direct messages untouched;
--   4. each workspace's first live "general" is flagged General; nobody is added;
--   5. the read mark as a message (last_read_id) from last_read_at;
--   6. every live conversation registered (label = its name, none for a DM);
--   7. the bell's old excerpts rewritten so they draw like new ones.
-- Channel names (v1 slugs) stay until someone renames them. v1 agent posts keep
-- their null author and read as "<key name> (app)".
--
-- It refuses, before changing anything, a v1 body holding U+0001/U+0002 (the
-- converter's markers) or one that would grow past 8,000 characters; check prod
-- read-only before the release train (docs/build/chat-v2/CV-1.md).

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_counts jsonb;
  v_again jsonb;
BEGIN
  IF to_regprocedure('public.chat__convert_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION '…_chat_v2_foundation must be applied first.';
  END IF;

  v_counts := public.chat__convert_v1(NULL);
  RAISE NOTICE 'chat v1 → v2: %', v_counts;

  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE format_version = 1) THEN
    RAISE EXCEPTION 'chat v1 → v2: messages are still in the v1 form.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE parent_id IS NOT NULL AND NOT v1_thread_reply) THEN
    RAISE EXCEPTION 'chat v1 → v2: a v1 thread reply is not flagged.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_members m JOIN public.chat_channels c ON c.id = m.channel_id
              WHERE c.kind = 'channel' AND c.deleted_at IS NULL AND m.notify_level = 'all') THEN
    RAISE EXCEPTION 'chat v1 → v2: a channel is still on Every message.';
  END IF;

  -- Idempotent: running it again finds nothing to do.
  v_again := public.chat__convert_v1(NULL);
  IF EXISTS (SELECT 1 FROM jsonb_each_text(v_again) WHERE value::integer <> 0) THEN
    RAISE EXCEPTION 'chat v1 → v2: a second pass changed rows (%).', v_again;
  END IF;
END;
$$;

-- Drop the calendar publish/ICS backend: `calendar_public_feed(text)` and
-- `calendar_op_publish(uuid, text)`.
--
-- `calendar_public_feed` was SECURITY DEFINER and anon could call it: anyone
-- holding a calendar's publish token got its events. PERM-5 built it, then hid
-- the link on 2026-10-06 because nothing serves the feed. `calendar_op_publish`
-- is the only writer of that token, and no app, desktop or Edge Function code
-- has ever called either function.
--
-- Probed on prod 2026-10-23 before writing this: 0 of 33 calendars hold a
-- publish token. Nothing depends on either function, and no function body,
-- policy, view or cron job references them. `calendars.publish_token` and
-- `publish_level` (+ their index and CHECK) stay, though empty and now unread:
-- publishing a calendar is still a ratified feature (specs/permissions.md §c),
-- so whether its data model goes is the calendar re-plan's call. A real feed
-- comes back as its own block, built behind a served endpoint. Re-runnable.
DROP FUNCTION IF EXISTS public.calendar_public_feed(text);
DROP FUNCTION IF EXISTS public.calendar_op_publish(uuid, text);

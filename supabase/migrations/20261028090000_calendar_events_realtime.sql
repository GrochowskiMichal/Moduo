-- CALR-7 · Live events (specs/calendar-rethink.md block 7, AC42, hole K10).
--
-- An event added, changed or deleted elsewhere (another device, quick
-- capture, an assistant through MCP, a teammate whose calendar you can see)
-- reaches the open week within seconds through Supabase Realtime
-- `postgres_changes`. A table only streams changes once it is in the
-- `supabase_realtime` publication; this adds `calendar_events`.
--
-- Who receives what:
--   * Inserts and updates: Realtime checks each subscriber's SELECT policy
--     (`calendar_events_owner_read`) on the new row, so nobody receives an
--     event they couldn't read. Nothing here widens it.
--   * Deletes: Realtime can't check RLS on a row that is gone, so a DELETE
--     reaches every subscriber of the table carrying ONLY the primary key
--     (with RLS on, Realtime drops the other old columns whatever the replica
--     identity; the table keeps the default one). The key is a random uuid.
--     Events delete softly (an UPDATE of deleted_at, so RLS applies); hard
--     deletes only come from account removal cascades, and they give away
--     nothing but the row id.
--
-- The client decides which of two versions of an event is newer by
-- updated_at, so the database stamps it on every insert and update with its
-- own clock (clock_timestamp(), reusing tasks_stamp_updated_at() from
-- 20261008224500_tasks_server_updated_at.sql). A sent updated_at is quietly
-- replaced. The trigger is named to run after the other BEFORE triggers
-- (they fire in name order), so nothing after it changes the row.
--
-- Idempotent: an already published table is skipped, the trigger is
-- recreated.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'calendar_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
  END IF;
END;
$$;

-- An app's OAuth token reaches nothing but the connector (MCPO-1,
-- 20261022230000_app_token_lockout.sql): postgres-changes runs each
-- subscriber's RLS, so a newly published table takes the same restrictive
-- policy. It only takes rows away from app tokens; a person's own session and
-- the service role are untouched.
DROP POLICY IF EXISTS app_tokens_refused ON public.calendar_events;
CREATE POLICY app_tokens_refused ON public.calendar_events AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING ((SELECT public.request_app_client_id()) IS NULL)
  WITH CHECK ((SELECT public.request_app_client_id()) IS NULL);

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.calendar_events;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_updated_at();

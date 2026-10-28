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
--   * Deletes: Realtime can't check RLS on a row that is gone, and with the
--     default replica identity (kept) a DELETE carries only the primary key, a
--     random uuid. The app's channel filters on workspace_id, which a bare id
--     can't match, so it receives no DELETE at all: events delete softly (an
--     UPDATE of deleted_at, so RLS applies), and the rare hard delete (an
--     account removal cascade) reaches open apps on their next resync.
--   * Private events: not masked yet. CALR-15 masks them through a view, which
--     postgres_changes can't stream, so CALR-15 must also keep teammates'
--     private rows off this channel (specs/calendar-rethink.md, CALR-15).
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

-- A sync sends every mirrored event in its window each time; now that the table
-- streams, rewriting the unchanged ones would broadcast all of them to every
-- open calendar. Re-cut from the live body (CALR-6's), with that one guard.
CREATE OR REPLACE FUNCTION public.calendar_op_mirror_events(p_workspace_id uuid, p_account_id uuid, p_events jsonb, p_deleted_external_ids text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.calendar_accounts;
  r jsonb;
  e public.calendar_events;
  v_ext text;
  v_link text;
  v_split record;
  v_set_link boolean;
  v_new_link text;
  v_upserted int := 0;
  v_removed int := 0;
  v_skipped int := 0;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO a FROM public.calendar_accounts
    WHERE id = p_account_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar account not found in this workspace.';
  END IF;
  IF a.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the connecting user can sync this account.';
  END IF;

  IF p_events IS NOT NULL AND jsonb_typeof(p_events) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(p_events) LOOP
      -- One malformed provider event must never wedge the whole sync: each
      -- row is validated and isolated; failures count as skipped.
      BEGIN
        v_ext := NULLIF(btrim(coalesce(r->>'externalEventId', '')), '');
        IF v_ext IS NULL
           OR NULLIF(r->>'startsAt', '') IS NULL
           OR NULLIF(r->>'endsAt', '') IS NULL THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
        -- The provider's meeting link, or NULL when absent, null or no web address.
        v_link := public.calendar__web_address(r->>'conferenceUrl');
        -- Split the place here rather than leave it to the trigger: the trigger
        -- can't tell a re-sent link from an unchanged one, so a Meet link plus a
        -- Zoom URL in the location would swap on every sync. The provider's own
        -- link wins; a meeting URL in the location fills in only when it has none.
        SELECT * INTO v_split FROM public.calendar__split_location(
          CASE WHEN r ? 'location' THEN NULLIF(r->>'location', '') END);
        v_set_link := (r ? 'conferenceUrl') OR v_split.url IS NOT NULL;
        v_new_link := CASE WHEN r ? 'conferenceUrl' THEN coalesce(v_link, v_split.url) ELSE v_split.url END;
        e := NULL;
        UPDATE public.calendar_events AS ce SET
          title = coalesce(r->>'title', ce.title),
          description = coalesce(r->>'description', ce.description),
          start_time = coalesce((r->>'startsAt')::timestamptz, ce.start_time),
          end_time = coalesce((r->>'endsAt')::timestamptz, ce.end_time),
          all_day = coalesce((r->>'allDay')::boolean, ce.all_day),
          -- Key PRESENT (even as JSON null) = the provider's current truth,
          -- so null/'' clears the recurrence; key ABSENT keeps it.
          recurrence_rule = CASE WHEN r ? 'rrule' THEN NULLIF(r->>'rrule', '')
                                 ELSE ce.recurrence_rule END,
          recurring = CASE WHEN r ? 'rrule'
                           THEN r->>'rrule' IS NOT NULL AND r->>'rrule' <> ''
                           ELSE ce.recurring END,
          status = coalesce(NULLIF(r->>'status', ''), ce.status),
          calendar_id = coalesce(NULLIF(r->>'calendarId', ''), ce.calendar_id),
          -- Key PRESENT = the provider's place now; ABSENT keeps it.
          location = CASE WHEN r ? 'location' THEN v_split.place
                          ELSE ce.location END,
          -- Key PRESENT = the provider's meeting link now; ABSENT keeps it.
          conference_url = CASE WHEN v_set_link THEN v_new_link
                                ELSE ce.conference_url END,
          conference_provider = CASE WHEN v_set_link
                                     THEN public.calendar__meeting_provider(v_new_link)
                                     ELSE ce.conference_provider END,
          updated_at = now()
        WHERE ce.source_account_id = a.id AND ce.external_event_id = v_ext
          AND ce.deleted_at IS NULL
          -- CALR-7: an event the provider sends unchanged is not rewritten, so a
          -- sync doesn't re-stamp and broadcast every mirrored event to every
          -- open calendar. The row list mirrors the SET list above.
          AND ROW(
            coalesce(r->>'title', ce.title),
            coalesce(r->>'description', ce.description),
            coalesce((r->>'startsAt')::timestamptz, ce.start_time),
            coalesce((r->>'endsAt')::timestamptz, ce.end_time),
            coalesce((r->>'allDay')::boolean, ce.all_day),
            CASE WHEN r ? 'rrule' THEN NULLIF(r->>'rrule', '') ELSE ce.recurrence_rule END,
            CASE WHEN r ? 'rrule' THEN r->>'rrule' IS NOT NULL AND r->>'rrule' <> ''
                 ELSE ce.recurring END,
            coalesce(NULLIF(r->>'status', ''), ce.status),
            coalesce(NULLIF(r->>'calendarId', ''), ce.calendar_id),
            CASE WHEN r ? 'location' THEN v_split.place ELSE ce.location END,
            CASE WHEN v_set_link THEN v_new_link ELSE ce.conference_url END,
            CASE WHEN v_set_link THEN public.calendar__meeting_provider(v_new_link)
                 ELSE ce.conference_provider END
          ) IS DISTINCT FROM ROW(
            ce.title, ce.description, ce.start_time, ce.end_time, ce.all_day,
            ce.recurrence_rule, ce.recurring, ce.status, ce.calendar_id,
            ce.location, ce.conference_url, ce.conference_provider
          )
        RETURNING ce.* INTO e;
        -- No row updated: either it's unchanged (count it, nothing to write) or new.
        IF e.id IS NULL AND EXISTS (
             SELECT 1 FROM public.calendar_events ce
              WHERE ce.source_account_id = a.id AND ce.external_event_id = v_ext
                AND ce.deleted_at IS NULL) THEN
          v_upserted := v_upserted + 1;
          CONTINUE;
        END IF;
        IF e.id IS NULL THEN
          INSERT INTO public.calendar_events
            (workspace_id, owner_id, source_account_id, external_event_id, calendar_id,
             title, description, location, start_time, end_time, all_day, recurring,
             recurrence_rule, status, conference_url, conference_provider)
          VALUES
            (p_workspace_id, a.owner_id, a.id, v_ext,
             coalesce(NULLIF(r->>'calendarId', ''), a.provider),
             coalesce(r->>'title', ''), coalesce(r->>'description', ''),
             v_split.place,
             (r->>'startsAt')::timestamptz, (r->>'endsAt')::timestamptz,
             coalesce((r->>'allDay')::boolean, false),
             coalesce(r->>'rrule', '') <> '', NULLIF(r->>'rrule', ''),
             coalesce(NULLIF(r->>'status', ''), 'confirmed'),
             v_new_link, public.calendar__meeting_provider(v_new_link))
          RETURNING * INTO e;
        END IF;
        PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');
        v_upserted := v_upserted + 1;
      EXCEPTION WHEN data_exception OR not_null_violation OR check_violation THEN
        v_skipped := v_skipped + 1;
      END;
    END LOOP;
  END IF;

  IF p_deleted_external_ids IS NOT NULL THEN
    FOR v_ext IN SELECT unnest(p_deleted_external_ids) LOOP
      e := NULL;
      UPDATE public.calendar_events AS ce
        SET deleted_at = now(), updated_at = now()
        WHERE ce.source_account_id = a.id AND ce.external_event_id = v_ext
          AND ce.deleted_at IS NULL
        RETURNING ce.* INTO e;
      IF e.id IS NOT NULL THEN
        PERFORM public.entities_op_tombstone(p_workspace_id, 'event', e.id);
        v_removed := v_removed + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.calendar_accounts
    SET last_sync_at = now(), status = 'ok', updated_at = now()
    WHERE id = a.id;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'calendar_account', a.id, 'calendar.mirror',
    jsonb_build_object('upserted', v_upserted, 'removed', v_removed, 'skipped', v_skipped)
  );
  RETURN jsonb_build_object('upserted', v_upserted, 'removed', v_removed, 'skipped', v_skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.calendar_op_mirror_events(uuid, uuid, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_mirror_events(uuid, uuid, jsonb, text[]) TO authenticated, service_role;

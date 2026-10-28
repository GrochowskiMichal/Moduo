-- New events go to: one event, never two (specs/calendar-rethink.md, Assumptions
-- "New events go to ... one event, never two").
--
-- An event Moduo creates on Google is kept only as the mirror of Google's reply,
-- keyed on (source_account_id, external_event_id), so a later sync updates that
-- row. The mirror now stores Google's iCalUID, so the app can show a meeting
-- reached through two logins once. An event the mirror meets for the first time
-- on an account revives its tombstone instead of inserting a twin: a row this
-- account's sync removed, or one of a removed account for the same calendar
-- (Remove, then connect it again). Never across owners or workspaces. Re-runnable.
--
--   calendar_events.ical_uid     new column; a partial index for the revive's lookup
--   calendar_op_mirror_events    ← 20261028170000_calendar_one_occurrence.sql, plus
--                                  the iCalUID key and the revive
--   calendar_events_visible      ← 20261028150000_calendar_private_masking.sql, plus
--                                  ical_uid in the mask list
-- Test: supabase/tests/calendar_new_events_one_event.test.sql.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS ical_uid text;

-- The revive's lookup: a tombstone by its key (the live key is calendar_events_external_key).
CREATE INDEX IF NOT EXISTS calendar_events_external_key_dead_idx
  ON public.calendar_events (source_account_id, external_event_id)
  WHERE external_event_id IS NOT NULL AND deleted_at IS NOT NULL;

-- Mirror (20261028170000): new, the iCalUID key (present = stored, absent keeps)
-- and the revive of a tombstoned row before any insert.
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
  v_attendees jsonb;
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
        -- CALR-8: the provider's guests (key present), or NULL when absent or a list
        -- calendar__attendees refuses: NULL keeps the stored guests, never skips the event.
        v_attendees := CASE WHEN r ? 'attendees'
                            THEN public.calendar__attendees_or_null(r->'attendees') END;
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
          -- CALR-8: key PRESENT = the provider's privacy and guests now; ABSENT keeps them.
          is_private = CASE WHEN r ? 'isPrivate' THEN coalesce((r->>'isPrivate')::boolean, false)
                            ELSE ce.is_private END,
          attendees = coalesce(v_attendees, ce.attendees),
          -- CALR-11: key PRESENT = which Google repeat this is an instance of; ABSENT keeps it.
          external_series_id = CASE WHEN r ? 'externalSeriesId' THEN NULLIF(r->>'externalSeriesId', '')
                                    ELSE ce.external_series_id END,
          original_start = CASE WHEN r ? 'originalStart' THEN (r->>'originalStart')::timestamptz
                                ELSE ce.original_start END,
          -- Key PRESENT = Google's iCalUID; ABSENT keeps it.
          ical_uid = CASE WHEN r ? 'iCalUID' THEN NULLIF(r->>'iCalUID', '') ELSE ce.ical_uid END,
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
                 ELSE ce.conference_provider END,
            CASE WHEN r ? 'isPrivate' THEN coalesce((r->>'isPrivate')::boolean, false)
                 ELSE ce.is_private END,
            coalesce(v_attendees, ce.attendees),
            CASE WHEN r ? 'externalSeriesId' THEN NULLIF(r->>'externalSeriesId', '')
                 ELSE ce.external_series_id END,
            CASE WHEN r ? 'originalStart' THEN (r->>'originalStart')::timestamptz
                 ELSE ce.original_start END,
            CASE WHEN r ? 'iCalUID' THEN NULLIF(r->>'iCalUID', '') ELSE ce.ical_uid END
          ) IS DISTINCT FROM ROW(
            ce.title, ce.description, ce.start_time, ce.end_time, ce.all_day,
            ce.recurrence_rule, ce.recurring, ce.status, ce.calendar_id,
            ce.location, ce.conference_url, ce.conference_provider,
            ce.is_private, ce.attendees, ce.external_series_id, ce.original_start, ce.ical_uid
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
        -- New to this account: revive its tombstone instead of inserting a twin.
        -- First a row this account's sync removed, else one of a removed account
        -- for the same calendar (a reconnect makes a new account row). Never
        -- across owners or workspaces.
        IF e.id IS NULL THEN
          SELECT ce.* INTO e FROM public.calendar_events ce
           WHERE ce.external_event_id = v_ext AND ce.deleted_at IS NOT NULL
             AND ce.workspace_id = p_workspace_id AND ce.owner_id = a.owner_id
             AND (ce.source_account_id = a.id OR ce.source_account_id IN (
                   SELECT ca.id FROM public.calendar_accounts ca
                    WHERE ca.deleted_at IS NOT NULL AND ca.workspace_id = a.workspace_id
                      AND ca.owner_id = a.owner_id AND ca.provider = a.provider
                      AND ca.external_id = a.external_id))
           ORDER BY (ce.source_account_id = a.id) DESC, ce.deleted_at DESC
           LIMIT 1
           FOR UPDATE OF ce;
        END IF;
        IF e.id IS NOT NULL AND e.deleted_at IS NOT NULL THEN
          UPDATE public.calendar_events AS ce SET
            deleted_at = NULL,
            source_account_id = a.id,
            -- A removed account's row moves to the reconnected calendar, so its
            -- sharing follows that calendar's grants, not the orphaned one's.
            calendar_ref = CASE WHEN e.source_account_id = a.id THEN ce.calendar_ref
                                ELSE public.share_ensure_account_calendar(a.id) END,
            calendar_id = coalesce(NULLIF(r->>'calendarId', ''), a.provider),
            title = coalesce(r->>'title', ''),
            description = coalesce(r->>'description', ''),
            location = v_split.place,
            start_time = (r->>'startsAt')::timestamptz,
            end_time = (r->>'endsAt')::timestamptz,
            all_day = coalesce((r->>'allDay')::boolean, false),
            recurring = coalesce(r->>'rrule', '') <> '',
            recurrence_rule = NULLIF(r->>'rrule', ''),
            status = coalesce(NULLIF(r->>'status', ''), 'confirmed'),
            conference_url = v_new_link,
            conference_provider = public.calendar__meeting_provider(v_new_link),
            is_private = coalesce((r->>'isPrivate')::boolean, false),
            attendees = coalesce(v_attendees, '[]'::jsonb),
            external_series_id = NULLIF(r->>'externalSeriesId', ''),
            original_start = (r->>'originalStart')::timestamptz,
            ical_uid = NULLIF(r->>'iCalUID', ''),
            updated_at = now()
          WHERE ce.id = e.id
          RETURNING ce.* INTO e;
        ELSIF e.id IS NULL THEN
          INSERT INTO public.calendar_events
            (workspace_id, owner_id, source_account_id, external_event_id, calendar_id,
             title, description, location, start_time, end_time, all_day, recurring,
             recurrence_rule, status, conference_url, conference_provider,
             is_private, attendees, external_series_id, original_start, ical_uid)
          VALUES
            (p_workspace_id, a.owner_id, a.id, v_ext,
             coalesce(NULLIF(r->>'calendarId', ''), a.provider),
             coalesce(r->>'title', ''), coalesce(r->>'description', ''),
             v_split.place,
             (r->>'startsAt')::timestamptz, (r->>'endsAt')::timestamptz,
             coalesce((r->>'allDay')::boolean, false),
             coalesce(r->>'rrule', '') <> '', NULLIF(r->>'rrule', ''),
             coalesce(NULLIF(r->>'status', ''), 'confirmed'),
             v_new_link, public.calendar__meeting_provider(v_new_link),
             coalesce((r->>'isPrivate')::boolean, false), coalesce(v_attendees, '[]'::jsonb),
             NULLIF(r->>'externalSeriesId', ''), (r->>'originalStart')::timestamptz,
             NULLIF(r->>'iCalUID', ''))
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

-- Masked read (20261028150000): new, a teammate's private row carries no
-- iCalUID. It would tell them which private rows are the same meeting (who
-- meets whom), so it joins the mask list with the other details.
CREATE OR REPLACE FUNCTION public.calendar_events_visible(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF public.calendar_events LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$
DECLARE v_user uuid := public.perm_actor_id();
BEGIN
  IF v_user IS NULL OR p_workspace_id IS NULL OR public.calendar_module_permission(p_workspace_id) NOT IN ('view','edit','admin') THEN RETURN; END IF;
  RETURN QUERY
  -- Every calendar the actor can view, their own included: a teammate's event
  -- on your calendar (they can edit it) is yours to see, as the table policy says.
  WITH cals AS (SELECT c.id FROM public.calendars c WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
                  AND public.can_access('calendar', c.id, 'view', v_user))
  -- The row is built once in a LATERAL (a bare (CASE … END).* would rebuild
  -- it once per column). A new sensitive column joins the mask list here.
  SELECT (m.r).*
  FROM public.calendar_events e
  CROSS JOIN LATERAL (SELECT CASE WHEN e.owner_id = v_user OR NOT e.is_private THEN e
     ELSE jsonb_populate_record(e, jsonb_build_object('title','Busy','description',null,'location',null,'attendees','[]'::jsonb,
       'conference_url',null,'conference_provider',null,'tags','[]'::jsonb,'reminders','[]'::jsonb,'external_event_id',null,
       'external_series_id',null,'focus_task_id',null,'offer_id',null,'color',null,'ical_uid',null)) END AS r) m
  WHERE e.workspace_id = p_workspace_id AND e.deleted_at IS NULL
    AND (e.owner_id = v_user OR e.calendar_ref IN (SELECT id FROM cals))
    AND (e.recurrence_rule IS NOT NULL OR (e.start_time <= p_to AND e.end_time >= p_from))
  ORDER BY e.start_time, e.id;
END $f$;
REVOKE ALL ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_events_visible(uuid, timestamptz, timestamptz) TO authenticated, service_role;

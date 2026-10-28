-- CALR-8 · Google two-way, online (specs/calendar-rethink.md block 8, AC43).
--
-- A Google event edited in Moduo saves to Google first (calendar-google-web);
-- the app then hands Google's answer to calendar_op_mirror_events, so the mirror must store
-- everything the app lets you change there. It already stored title, times,
-- place and meeting link; this adds privacy (`isPrivate` -> is_private) and
-- guests (`attendees` -> attendees, normalised by calendar__attendees).
--
-- Key PRESENT = the provider's truth now; key ABSENT keeps what is stored (the
-- rule every other mirrored field follows). A guest list calendar__attendees
-- refuses (a guest without an email, over 200 people) must not skip the event
-- or wedge the sync: calendar__attendees_or_null answers NULL instead, and the
-- stored guests stay. Both new fields join the CALR-7 "unchanged" guard, so a
-- sync that re-sends them unchanged rewrites (and broadcasts) nothing.
--
-- calendar_op__guard_event stays native-only: Google events never go through
-- calendar_op_event_update.
--
-- Re-cut from the live body (CALR-7's, 20261028090000_calendar_events_realtime.sql).
-- Idempotent: CREATE OR REPLACE, grants restated.

-- calendar__attendees, but NULL instead of an error for a list it refuses.
CREATE OR REPLACE FUNCTION public.calendar__attendees_or_null(p_attendees jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN public.calendar__attendees(p_attendees);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar__attendees_or_null(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar__attendees_or_null(jsonb) TO service_role;

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
            coalesce(v_attendees, ce.attendees)
          ) IS DISTINCT FROM ROW(
            ce.title, ce.description, ce.start_time, ce.end_time, ce.all_day,
            ce.recurrence_rule, ce.recurring, ce.status, ce.calendar_id,
            ce.location, ce.conference_url, ce.conference_provider,
            ce.is_private, ce.attendees
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
             recurrence_rule, status, conference_url, conference_provider,
             is_private, attendees)
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
             coalesce((r->>'isPrivate')::boolean, false), coalesce(v_attendees, '[]'::jsonb))
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

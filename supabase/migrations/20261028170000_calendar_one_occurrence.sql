-- CALR-11: one occurrence (specs/calendar-rethink.md AC44, K15; "Repeating events").
--
-- This event changes one occurrence of a Moduo repeat: an edit makes an override
-- row (series_id + original_start, its own times, no repeat), a delete an exdate
-- on the series. An override's original start is an exdate too, so the series
-- never draws that occurrence twice. All events edits the series, and its
-- overrides come along: other fields carry over, a moved anchor moves the
-- exdates and original starts, a delete and its Undo take the overrides with it.
-- Google instances keep their series id and original start in the mirror.
--
-- Reading order, top to bottom:
--   1. one live override per occurrence (index)
--   2. the occurrence ops: update (reuses calendar_op_event_update for the patch),
--      delete (reuses calendar_op_event_delete), restore (reuses calendar_op_event_restore)
--   3. calendar_op_event_update, _delete, _restore and calendar_op_mirror_events,
--      re-cut from their live bodies
-- Test: supabase/tests/calendar_one_occurrence.test.sql.

SET LOCAL lock_timeout = '5s';

-- Refuse to apply before the bodies this file re-cuts from: an older mirror or
-- update op replaced here would lose their keys, and a later apply of them
-- would silently drop this file's.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calendar__attendees_or_null')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calendar__kind')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calendar_events_visible') THEN
    RAISE EXCEPTION 'CALR-11 needs 20261027230000, 20261028120000 and 20261028150000 applied first.';
  END IF;
END;
$$;

-- ── 1. Index ────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_override_once_idx
  ON public.calendar_events (series_id, original_start)
  WHERE deleted_at IS NULL AND series_id IS NOT NULL;

-- ── 2. Occurrence ops ───────────────────────────────────────────────────────────

-- The series an occurrence op works on: yours, native, live, and a repeat of its
-- own (an override is one occurrence, not a series).
CREATE OR REPLACE FUNCTION public.calendar_op__guard_series(p_workspace_id uuid, p_series_id uuid, p_original_start timestamptz)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.calendar_events;
BEGIN
  s := public.calendar_op__guard_event(p_workspace_id, p_series_id, true);
  IF s.recurrence_rule IS NULL OR s.series_id IS NOT NULL THEN
    RAISE EXCEPTION 'This event doesn''t repeat, so it has no occurrences to change.';
  END IF;
  -- Whether the time is really an occurrence of the rule is the app's to know
  -- (it expands the rule); here only what can't be one is refused.
  IF p_original_start IS NULL OR p_original_start < s.start_time THEN
    RAISE EXCEPTION 'That isn''t an occurrence of this event.';
  END IF;
  RETURN s;
END;
$$;

-- This event, edited: the occurrence's override (made from the series the first
-- time), with the patch applied by calendar_op_event_update.
CREATE OR REPLACE FUNCTION public.calendar_op_event_occurrence_update(
  p_workspace_id uuid, p_series_id uuid, p_original_start timestamptz, p_patch jsonb)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.calendar_events;
  v_id uuid;
BEGIN
  s := public.calendar_op__guard_series(p_workspace_id, p_series_id, p_original_start);

  SELECT id INTO v_id FROM public.calendar_events
    WHERE series_id = s.id AND original_start = p_original_start AND deleted_at IS NULL;
  IF v_id IS NULL THEN
    INSERT INTO public.calendar_events
      (workspace_id, owner_id, calendar_id, calendar_ref, title, description, location,
       start_time, end_time, all_day, color, recurring, recurrence_rule, status,
       attendees, reminders, tags, conference_url, conference_provider, is_private,
       kind, focus_task_id, series_id, original_start)
    VALUES
      (s.workspace_id, s.owner_id, s.calendar_id, s.calendar_ref, s.title, s.description, s.location,
       p_original_start, p_original_start + (s.end_time - s.start_time), s.all_day, s.color,
       false, NULL, s.status,
       s.attendees, s.reminders, s.tags, s.conference_url, s.conference_provider, s.is_private,
       s.kind, s.focus_task_id, s.id, p_original_start)
    RETURNING id INTO v_id;
    PERFORM public.entities_op_upsert(p_workspace_id, 'event', v_id, s.title, 'calendar');
    PERFORM public.module_activity_log(
      p_workspace_id, 'calendar', 'event', s.id, 'calendar.occurrence_update',
      jsonb_build_object('originalStart', p_original_start, 'override', v_id));
  END IF;

  UPDATE public.calendar_events
    SET exdates = exdates || p_original_start, updated_at = now()
    WHERE id = s.id AND NOT (p_original_start = ANY (exdates));

  RETURN public.calendar_op_event_update(p_workspace_id, v_id, coalesce(p_patch, '{}'::jsonb));
END;
$$;

-- This event, deleted: an exdate on the series, and its override (if any) deleted
-- through calendar_op_event_delete.
CREATE OR REPLACE FUNCTION public.calendar_op_event_occurrence_delete(
  p_workspace_id uuid, p_series_id uuid, p_original_start timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.calendar_events;
  v_id uuid;
BEGIN
  s := public.calendar_op__guard_series(p_workspace_id, p_series_id, p_original_start);
  UPDATE public.calendar_events
    SET exdates = exdates || p_original_start, updated_at = now()
    WHERE id = s.id AND NOT (p_original_start = ANY (exdates));
  SELECT id INTO v_id FROM public.calendar_events
    WHERE series_id = s.id AND original_start = p_original_start AND deleted_at IS NULL;
  IF v_id IS NOT NULL THEN
    PERFORM public.calendar_op_event_delete(p_workspace_id, v_id);
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', s.id, 'calendar.occurrence_delete',
    jsonb_build_object('originalStart', p_original_start));
END;
$$;

-- The delete's Undo: a deleted override comes back (its exdate stays), else the
-- exdate goes and the series draws the occurrence again. Returns the series.
CREATE OR REPLACE FUNCTION public.calendar_op_event_occurrence_restore(
  p_workspace_id uuid, p_series_id uuid, p_original_start timestamptz)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.calendar_events;
  v_id uuid;
BEGIN
  s := public.calendar_op__guard_series(p_workspace_id, p_series_id, p_original_start);
  SELECT id INTO v_id FROM public.calendar_events
    WHERE series_id = s.id AND original_start = p_original_start AND deleted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.calendar_events
                        WHERE series_id = s.id AND original_start = p_original_start
                          AND deleted_at IS NULL)
    ORDER BY deleted_at DESC
    LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM public.calendar_op_event_restore(p_workspace_id, v_id);
  ELSIF NOT EXISTS (SELECT 1 FROM public.calendar_events
                      WHERE series_id = s.id AND original_start = p_original_start
                        AND deleted_at IS NULL) THEN
    -- A live override keeps its exdate: a second Undo never draws the occurrence twice.
    UPDATE public.calendar_events
      SET exdates = array_remove(exdates, p_original_start), updated_at = now()
      WHERE id = s.id
      RETURNING * INTO s;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', s.id, 'calendar.occurrence_restore',
    jsonb_build_object('originalStart', p_original_start));
  RETURN s;
END;
$$;

-- ── 3. Ops, re-cut from their live bodies ───────────────────────────────────────

-- Update (20261027230000): new, an override refuses a repeat, and a series hands
-- its change to its overrides.
CREATE OR REPLACE FUNCTION public.calendar_op_event_update(p_workspace_id uuid, p_event_id uuid, p_patch jsonb)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
  v_calendar uuid;
  v_location text;
  v_attendees jsonb;
  v_url text;
  v_provider text;
  v_private boolean;
  v_kind text;
  v_task uuid;
  v_old_start timestamptz;
  v_carry jsonb;
  v_override uuid;
BEGIN
  e := public.calendar_op__guard_event(p_workspace_id, p_event_id, true);
  -- CALR-11: an override is one occurrence; repeating is its series' business.
  IF e.series_id IS NOT NULL AND p_patch ? 'rrule' THEN
    RAISE EXCEPTION 'A changed occurrence can''t repeat on its own; change the series.';
  END IF;
  v_old_start := e.start_time;

  -- Calendar: JSON null is back to the owner's Moduo calendar.
  v_calendar := e.calendar_ref;
  IF p_patch ? 'calendarId' THEN
    IF jsonb_typeof(p_patch->'calendarId') = 'null' THEN
      v_calendar := public.share_ensure_moduo_calendar(p_workspace_id, e.owner_id);
    ELSE
      v_calendar := public.calendar_op__guard_calendar(p_workspace_id, (p_patch->>'calendarId')::uuid);
    END IF;
  END IF;

  -- Place: a meeting URL in it moves to the link (calendar_events_meeting_link).
  v_location := e.location;
  IF p_patch ? 'location' THEN
    v_location := NULLIF(btrim(p_patch->>'location'), '');
  END IF;

  -- People: the list is replaced as a whole.
  v_attendees := e.attendees;
  IF p_patch ? 'attendees' THEN
    v_attendees := public.calendar__attendees(p_patch->'attendees');
  END IF;

  -- Link: a changed link brings its own provider unless one is given; null removes both.
  v_url := e.conference_url;
  v_provider := e.conference_provider;
  IF p_patch ? 'conferenceUrl' THEN
    v_url := p_patch->>'conferenceUrl';
    IF NULLIF(btrim(v_url), '') IS DISTINCT FROM e.conference_url THEN
      v_provider := NULL;
    END IF;
  END IF;
  IF p_patch ? 'conferenceProvider' THEN
    v_provider := p_patch->>'conferenceProvider';
  END IF;
  IF p_patch ? 'conferenceUrl' OR p_patch ? 'conferenceProvider' THEN
    SELECT c.url, c.provider INTO v_url, v_provider
      FROM public.calendar__conference(v_url, v_provider) c;
  END IF;

  v_private := e.is_private;
  IF p_patch ? 'isPrivate' THEN
    v_private := coalesce((p_patch->>'isPrivate')::boolean, e.is_private);
  END IF;

  -- Kind, then the task against the kind it will have: leaving focus lets the task go.
  v_kind := e.kind;
  v_task := e.focus_task_id;
  IF p_patch ? 'kind' THEN
    v_kind := public.calendar__kind(p_patch->>'kind');
    IF v_kind <> 'focus' THEN
      v_task := NULL;
    END IF;
  END IF;
  IF p_patch ? 'focusTaskId' THEN
    v_task := public.calendar_op__guard_focus_task(p_workspace_id, v_kind, (p_patch->>'focusTaskId')::uuid);
  END IF;

  UPDATE public.calendar_events AS ce SET
    title       = CASE WHEN p_patch ? 'title'
                       THEN coalesce(NULLIF(btrim(p_patch->>'title'), ''), ce.title)
                       ELSE ce.title END,
    description = CASE WHEN p_patch ? 'description'
                       THEN coalesce(p_patch->>'description', '')
                       ELSE ce.description END,
    start_time  = CASE WHEN p_patch ? 'startsAt'
                       THEN coalesce((p_patch->>'startsAt')::timestamptz, ce.start_time)
                       ELSE ce.start_time END,
    end_time    = CASE WHEN p_patch ? 'endsAt'
                       THEN coalesce((p_patch->>'endsAt')::timestamptz, ce.end_time)
                       ELSE ce.end_time END,
    all_day     = CASE WHEN p_patch ? 'allDay'
                       THEN coalesce((p_patch->>'allDay')::boolean, ce.all_day)
                       ELSE ce.all_day END,
    recurrence_rule = CASE WHEN p_patch ? 'rrule'
                       THEN NULLIF(p_patch->>'rrule', '')
                       ELSE ce.recurrence_rule END,
    recurring   = CASE WHEN p_patch ? 'rrule'
                       THEN p_patch->>'rrule' IS NOT NULL AND p_patch->>'rrule' <> ''
                       ELSE ce.recurring END,
    calendar_ref        = v_calendar,
    location            = v_location,
    attendees           = v_attendees,
    conference_url      = v_url,
    conference_provider = v_provider,
    is_private          = v_private,
    kind                = v_kind,
    focus_task_id       = v_task,
    updated_at  = now()
  WHERE ce.id = e.id
  RETURNING ce.* INTO e;
  IF e.end_time <= e.start_time THEN
    RAISE EXCEPTION 'An event needs a valid time range.';
  END IF;
  IF p_patch ? 'title' THEN
    PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');
  END IF;

  -- CALR-11, All events on a series: a moved anchor moves its exdates and its
  -- overrides' original starts by the same amount, so the same occurrences stay
  -- replaced (overrides keep their own times); every other key carries over to
  -- the live overrides through this same op.
  -- The exdates move even with no override (a deleted occurrence stays deleted).
  IF e.series_id IS NULL AND e.start_time <> v_old_start AND cardinality(e.exdates) > 0 THEN
    UPDATE public.calendar_events
      SET exdates = ARRAY(SELECT x + (e.start_time - v_old_start) FROM unnest(exdates) AS x ORDER BY 1),
          updated_at = now()
      WHERE id = e.id
      RETURNING * INTO e;
  END IF;
  IF e.series_id IS NULL AND EXISTS (SELECT 1 FROM public.calendar_events WHERE series_id = e.id) THEN
    IF e.start_time <> v_old_start THEN
      -- One row at a time, the far end first: one UPDATE would trip the unique
      -- (series_id, original_start) index when one override lands on the next one's start.
      FOR v_override IN SELECT id FROM public.calendar_events WHERE series_id = e.id
                          ORDER BY CASE WHEN e.start_time > v_old_start THEN original_start END DESC,
                                   original_start LOOP
        UPDATE public.calendar_events
          SET original_start = original_start + (e.start_time - v_old_start), updated_at = now()
          WHERE id = v_override;
      END LOOP;
    END IF;
    v_carry := p_patch - ARRAY['startsAt', 'endsAt', 'allDay', 'rrule'];
    IF v_carry <> '{}'::jsonb THEN
      FOR v_override IN SELECT id FROM public.calendar_events
                          WHERE series_id = e.id AND deleted_at IS NULL LOOP
        PERFORM public.calendar_op_event_update(p_workspace_id, v_override, v_carry);
      END LOOP;
    END IF;
  END IF;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_update',
    jsonb_build_object('keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_patch) AS k))
  );
  RETURN e;
END;
$$;
-- Delete (20261008121000): new, a series takes its live overrides with it, at the
-- same stamp, so its Undo knows which ones to bring back.
CREATE OR REPLACE FUNCTION public.calendar_op_event_delete(p_workspace_id uuid, p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
  v_override uuid;
BEGIN
  e := public.calendar_op__guard_event(p_workspace_id, p_event_id, true);
  UPDATE public.calendar_events
    SET deleted_at = now(), updated_at = now()
    WHERE id = e.id;
  -- Registry tombstone inline (not entities_op_tombstone — see 20261008121000's header).
  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'event'
      AND entity_id = e.id
      AND deleted_at IS NULL;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_delete',
    jsonb_build_object('title', e.title, 'recurring', e.recurring)
  );
  -- CALR-11: now() is the transaction's, so each override gets the series' stamp.
  FOR v_override IN SELECT id FROM public.calendar_events
                      WHERE series_id = e.id AND deleted_at IS NULL LOOP
    PERFORM public.calendar_op_event_delete(p_workspace_id, v_override);
  END LOOP;
END;
$$;

-- Restore (20261006180000): new, a series brings back the overrides its delete
-- took (deleted at its stamp), not those deleted on their own before.
CREATE OR REPLACE FUNCTION public.calendar_op_event_restore(
  p_workspace_id uuid,
  p_event_id uuid
)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
  v_deleted_at timestamptz;
  v_override uuid;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);

  SELECT * INTO e FROM public.calendar_events
    WHERE id = p_event_id AND workspace_id = p_workspace_id
      AND deleted_at IS NOT NULL
      AND owner_id = public.perm_actor_id()   -- PERM-0
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found in this workspace (or not deleted).';
  END IF;
  -- Mirrors the delete's native-only invariant (DESIGN_BRIEF §8): mirrored
  -- events are managed by their source calendar on both ends of the undo.
  IF e.source_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'This event is managed in its source calendar and is read-only here.';
  END IF;
  v_deleted_at := e.deleted_at;

  UPDATE public.calendar_events
    SET deleted_at = NULL, updated_at = now()
    WHERE id = e.id
    RETURNING * INTO e;

  UPDATE public.entities
    SET deleted_at = NULL, updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'event' AND entity_id = e.id;

  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_restore',
    jsonb_build_object('title', e.title, 'recurring', e.recurring)
  );

  FOR v_override IN SELECT id FROM public.calendar_events
                      WHERE series_id = e.id AND deleted_at = v_deleted_at LOOP
    PERFORM public.calendar_op_event_restore(p_workspace_id, v_override);
  END LOOP;
  RETURN e;
END;
$$;

-- Mirror (20261028120000): new, the externalSeriesId and originalStart keys of a
-- Google instance. Present = stored; absent keeps what is stored.
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
                 ELSE ce.original_start END
          ) IS DISTINCT FROM ROW(
            ce.title, ce.description, ce.start_time, ce.end_time, ce.all_day,
            ce.recurrence_rule, ce.recurring, ce.status, ce.calendar_id,
            ce.location, ce.conference_url, ce.conference_provider,
            ce.is_private, ce.attendees, ce.external_series_id, ce.original_start
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
             is_private, attendees, external_series_id, original_start)
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
             NULLIF(r->>'externalSeriesId', ''), (r->>'originalStart')::timestamptz)
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
-- ── Grants ──────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.calendar_op__guard_series(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_op__guard_series(uuid, uuid, timestamptz) TO service_role;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'calendar_op_event_occurrence_update(uuid,uuid,timestamptz,jsonb)',
    'calendar_op_event_occurrence_delete(uuid,uuid,timestamptz)',
    'calendar_op_event_occurrence_restore(uuid,uuid,timestamptz)',
    'calendar_op_event_update(uuid,uuid,jsonb)',
    'calendar_op_event_delete(uuid,uuid)',
    'calendar_op_event_restore(uuid,uuid)',
    'calendar_op_mirror_events(uuid,uuid,jsonb,text[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

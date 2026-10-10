-- TX-5 · Booking emails: the host's bell (specs/transactional-email.md T16).
--
-- booking_op_commit / booking_op_release already log `calendar.booking_create`
-- / `calendar.booking_cancel` activity rows, but nothing marks them for anyone,
-- so the host's bell never shows a booking. Both now add
-- `notify_user_ids: [owner]` plus what the bell line needs (title, guest, guest
-- name, start). `spine_activity_targets_me` already returns rows whose
-- notify_user_ids name the caller, without the actor≠me guard (the host is
-- recorded as the actor), so `notifications_list` returns them for the host.
--
-- Same signatures as before (CREATE OR REPLACE keeps the grants; they are
-- re-stated anyway). Bodies are 20261006210000_perm_sharing.sql's commit and
-- 20261001180000_booking_links.sql's release, verified identical to prod on
-- 2026-10-10, with only the activity payload changed. Release reads the event
-- before it soft-deletes it: it has no attendee parameters.

CREATE OR REPLACE FUNCTION public.booking_op_commit(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_attendee_name text,
  p_attendee_email text,
  p_host_email text,
  p_source_account_id uuid DEFAULT NULL,
  p_external_event_id text DEFAULT NULL,
  p_calendar_id text DEFAULT NULL,
  p_cohost_ids uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.calendar_events;
  c public.contacts;
  v_emails jsonb;
  v_pair text;
  v_cal uuid;
  v_host uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_owner_id IS NULL THEN RAISE EXCEPTION 'booking_missing_owner'; END IF;
  IF p_ends_at <= p_starts_at THEN RAISE EXCEPTION 'booking_bad_range'; END IF;

  SELECT id INTO v_cal FROM public.calendars
  WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
    AND (
      (p_source_account_id IS NULL AND owner_id = p_owner_id AND kind = 'moduo')
      OR account_id = p_source_account_id
    )
  LIMIT 1;

  INSERT INTO public.calendar_events
    (workspace_id, owner_id, source_account_id, external_event_id, calendar_id, calendar_ref,
     title, description, location, start_time, end_time, all_day, recurring, status, attendees)
  VALUES (
    p_workspace_id, p_owner_id, p_source_account_id,
    CASE WHEN p_source_account_id IS NULL THEN NULL ELSE NULLIF(p_external_event_id, '') END,
    CASE WHEN p_source_account_id IS NULL THEN 'moduo' ELSE coalesce(NULLIF(p_calendar_id, ''), 'google') END,
    v_cal,
    btrim(p_title), coalesce(p_description, ''), NULLIF(p_location, ''),
    p_starts_at, p_ends_at, false, false, 'confirmed',
    jsonb_build_array(
      jsonb_build_object('email', p_host_email, 'self', true),
      jsonb_build_object('email', p_attendee_email, 'name', p_attendee_name)
    )
  ) RETURNING * INTO e;

  PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');

  SELECT * INTO c FROM public.contacts
  WHERE workspace_id = p_workspace_id AND deleted_at IS NULL AND owner_id = p_owner_id
    AND email IS NOT NULL AND lower(email) = lower(p_attendee_email)
  LIMIT 1;

  IF NOT FOUND THEN
    v_emails := jsonb_build_array(jsonb_build_object('label', 'other', 'value', p_attendee_email, 'primary', true));
    INSERT INTO public.contacts (workspace_id, owner_id, name, email, emails, status, notes_inline, origin)
    VALUES (p_workspace_id, p_owner_id, coalesce(p_attendee_name, ''), p_attendee_email, v_emails, '', '', 'booking')
    RETURNING * INTO c;
  END IF;

  PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');
  v_pair := public.spine_pair_key('contact', c.id, 'event', e.id);
  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES (p_workspace_id, 'contact', c.id, 'event', e.id, 'references', 'manual', p_owner_id)
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL DO NOTHING;

  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, payload)
  VALUES (p_workspace_id, 'calendar', 'event', e.id, 'calendar.booking_create', 'user', p_owner_id,
    jsonb_strip_nulls(jsonb_build_object(
      'title', e.title,
      'guest', p_attendee_email,
      'guest_name', NULLIF(btrim(coalesce(p_attendee_name, '')), ''),
      'start', p_starts_at,
      -- T16: the host's bell. Text ids: spine_activity_targets_me compares
      -- against auth.uid()::text.
      'notify_user_ids', jsonb_build_array(p_owner_id::text)
    )));

  IF p_cohost_ids IS NOT NULL THEN
    FOREACH v_host IN ARRAY p_cohost_ids LOOP
      IF v_host IS NULL OR v_host = p_owner_id THEN CONTINUE; END IF;
      SELECT id INTO v_cal FROM public.calendars
      WHERE workspace_id = p_workspace_id AND owner_id = v_host AND kind = 'moduo' AND deleted_at IS NULL
      LIMIT 1;
      INSERT INTO public.calendar_events
        (workspace_id, owner_id, calendar_id, calendar_ref, title, description, location,
         start_time, end_time, all_day, recurring, status, attendees)
      VALUES (
        p_workspace_id, v_host, 'moduo', v_cal, btrim(p_title), coalesce(p_description, ''),
        NULLIF(p_location, ''), p_starts_at, p_ends_at, false, false, 'confirmed',
        jsonb_build_array(jsonb_build_object('email', p_attendee_email, 'name', p_attendee_name))
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('event_id', e.id, 'contact_id', c.id);
END;
$$;
REVOKE ALL ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text, uuid[]
) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_op_release(
  p_workspace_id uuid,
  p_owner_id uuid,
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_start timestamptz;
  v_guest jsonb;
BEGIN
  -- booking_op_commit writes the host first and the guest second.
  SELECT e.title, e.start_time, e.attendees -> 1
    INTO v_title, v_start, v_guest
    FROM public.calendar_events e
   WHERE e.id = p_event_id
     AND e.workspace_id = p_workspace_id;

  UPDATE public.calendar_events
    SET deleted_at = now(), updated_at = now()
    WHERE id = p_event_id
      AND workspace_id = p_workspace_id
      AND deleted_at IS NULL;

  UPDATE public.entities
    SET deleted_at = now(), updated_at = now()
    WHERE workspace_id = p_workspace_id
      AND entity_type = 'event'
      AND entity_id = p_event_id
      AND deleted_at IS NULL;

  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, payload)
  VALUES
    (p_workspace_id, 'calendar', 'event', p_event_id, 'calendar.booking_cancel', 'user', p_owner_id,
     jsonb_strip_nulls(jsonb_build_object(
       'title', v_title,
       'guest', v_guest ->> 'email',
       'guest_name', NULLIF(btrim(coalesce(v_guest ->> 'name', '')), ''),
       'start', v_start,
       'notify_user_ids', jsonb_build_array(p_owner_id::text)
     )));
END;
$$;

REVOKE ALL ON FUNCTION public.booking_op_release(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_release(uuid, uuid, uuid) TO service_role;

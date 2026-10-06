-- Booking + calendar fixes (2026-10-02).
-- 1. A booked meeting written to Google is ONE event: the Moduo row doubles as
--    the Google mirror row, instead of a Moduo copy plus a mirrored copy.
-- 2. Mirrored events carry their meeting link / location.
-- 3. Booking links can be deleted (soft delete keeps cancel links working).
-- 4. One-off: merge bookings already duplicated.

-- ── 1. booking_op_commit: optional mirror identity ──────────────────────────

DROP FUNCTION IF EXISTS public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text
);

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
  p_calendar_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
  c public.contacts;
  v_emails jsonb;
  v_pair text;
BEGIN
  IF p_workspace_id IS NULL OR p_owner_id IS NULL THEN
    RAISE EXCEPTION 'booking_missing_owner';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'booking_bad_range';
  END IF;

  -- When the meeting was also written to Google, this row IS that event's
  -- mirror (same account + external id), so the next sync updates it instead
  -- of adding a second copy.
  INSERT INTO public.calendar_events
    (workspace_id, owner_id, source_account_id, external_event_id, calendar_id,
     title, description, location,
     start_time, end_time, all_day, recurring, status, attendees)
  VALUES (
    p_workspace_id, p_owner_id,
    p_source_account_id,
    CASE WHEN p_source_account_id IS NULL THEN NULL ELSE NULLIF(p_external_event_id, '') END,
    CASE WHEN p_source_account_id IS NULL THEN 'moduo' ELSE coalesce(NULLIF(p_calendar_id, ''), 'google') END,
    btrim(p_title), coalesce(p_description, ''),
    NULLIF(p_location, ''),
    p_starts_at, p_ends_at, false, false, 'confirmed',
    jsonb_build_array(
      jsonb_build_object('email', p_host_email, 'self', true),
      jsonb_build_object('email', p_attendee_email, 'name', p_attendee_name)
    )
  )
  RETURNING * INTO e;

  PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');

  SELECT * INTO c FROM public.contacts
    WHERE workspace_id = p_workspace_id
      AND deleted_at IS NULL
      AND email IS NOT NULL
      AND lower(email) = lower(p_attendee_email)
    LIMIT 1;

  IF NOT FOUND THEN
    v_emails := jsonb_build_array(
      jsonb_build_object('label', 'other', 'value', p_attendee_email, 'primary', true)
    );
    INSERT INTO public.contacts
      (workspace_id, owner_id, name, email, emails, status, notes_inline)
    VALUES
      (p_workspace_id, p_owner_id, coalesce(p_attendee_name, ''), p_attendee_email,
       v_emails, '', '')
    RETURNING * INTO c;
  END IF;

  PERFORM public.entities_op_upsert(p_workspace_id, 'contact', c.id, c.name, 'user');

  v_pair := public.spine_pair_key('contact', c.id, 'event', e.id);
  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, 'contact', c.id, 'event', e.id, 'references', 'manual', p_owner_id)
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING;

  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, payload)
  VALUES
    (p_workspace_id, 'calendar', 'event', e.id, 'calendar.booking_create', 'user', p_owner_id,
     jsonb_build_object('title', e.title, 'guest', p_attendee_email));

  RETURN jsonb_build_object('event_id', e.id, 'contact_id', c.id);
END;
$$;

REVOKE ALL ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, uuid, text, text
) TO service_role;

-- ── 2. mirror upsert keeps the meeting link ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op_mirror_events(
  p_workspace_id uuid,
  p_account_id uuid,
  p_events jsonb,
  p_deleted_external_ids text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.calendar_accounts;
  r jsonb;
  e public.calendar_events;
  v_ext text;
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
          -- Key PRESENT = the provider's meeting link / location now; ABSENT keeps it.
          location = CASE WHEN r ? 'location' THEN NULLIF(r->>'location', '')
                          ELSE ce.location END,
          updated_at = now()
        WHERE ce.source_account_id = a.id AND ce.external_event_id = v_ext
          AND ce.deleted_at IS NULL
        RETURNING ce.* INTO e;
        IF e.id IS NULL THEN
          INSERT INTO public.calendar_events
            (workspace_id, owner_id, source_account_id, external_event_id, calendar_id,
             title, description, location, start_time, end_time, all_day, recurring,
             recurrence_rule, status)
          VALUES
            (p_workspace_id, a.owner_id, a.id, v_ext,
             coalesce(NULLIF(r->>'calendarId', ''), a.provider),
             coalesce(r->>'title', ''), coalesce(r->>'description', ''),
             NULLIF(r->>'location', ''),
             (r->>'startsAt')::timestamptz, (r->>'endsAt')::timestamptz,
             coalesce((r->>'allDay')::boolean, false),
             coalesce(r->>'rrule', '') <> '', NULLIF(r->>'rrule', ''),
             coalesce(NULLIF(r->>'status', ''), 'confirmed'))
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
$$;

-- ── 3. delete a booking link ────────────────────────────────────────────────

ALTER TABLE public.exposed_slot_links
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── 4. one-off: merge bookings already duplicated ───────────────────────────
-- The Moduo row (it holds the contact link and the meeting link) takes over
-- the mirror identity; the plain mirror copy is tombstoned.

DO $do$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT b.calendar_event_id AS keep_id, m.id AS mirror_id,
           m.source_account_id, m.external_event_id, m.calendar_id, m.workspace_id
    FROM public.slot_bookings b
    JOIN public.calendar_events k ON k.id = b.calendar_event_id
      AND k.deleted_at IS NULL AND k.source_account_id IS NULL
    JOIN public.calendar_events m ON m.external_event_id = b.meeting_id
      AND m.source_account_id IS NOT NULL AND m.deleted_at IS NULL
      AND m.workspace_id = k.workspace_id
    WHERE b.meeting_id IS NOT NULL AND b.calendar_event_id IS NOT NULL
  LOOP
    UPDATE public.calendar_events SET deleted_at = now(), updated_at = now()
      WHERE id = rec.mirror_id;
    -- entities_op_tombstone needs a signed-in member; a migration has none.
    UPDATE public.entities SET deleted_at = now(), updated_at = now()
      WHERE workspace_id = rec.workspace_id AND entity_type = 'event'
        AND entity_id = rec.mirror_id AND deleted_at IS NULL;
    UPDATE public.calendar_events
      SET source_account_id = rec.source_account_id,
          external_event_id = rec.external_event_id,
          calendar_id = rec.calendar_id,
          updated_at = now()
      WHERE id = rec.keep_id;
  END LOOP;
END;
$do$;

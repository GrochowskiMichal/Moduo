-- TX-6 · Booking reminders + host-side cancel (specs/transactional-email.md T17,
-- AC31–AC33).
--
-- 1. Booking links get "Remind guests": guest_reminder_minutes, 60 or 1440
--    (NULL = off). New and existing links start at 1440 (Q36).
-- 2. Bookings keep the email context booking-public builds when it confirms
--    one (host, link, video, zone, links; everything the C6/C7 templates
--    print), so SQL can queue those emails later with nobody's request open.
--    Bookings confirmed before this migration have none and get no C6/C7.
-- 3. C7 (booking_guest_reminder) is queued when a booking becomes confirmed,
--    for the booker and each extra guest, at start − the link's reminder; not
--    when that moment has already passed. Any move away from confirmed
--    cancels it.
-- 4. The host cancels by deleting the booked event in Moduo (native events) or
--    in Google (the mirror sync tombstones the row): the booking is released,
--    its reminders cancelled, and C6 (booking_guest_host_cancelled) is queued
--    2 minutes later. Undo in Moduo within those 2 minutes restores the
--    booking and cancels C6. A guest cancel goes through booking_op_release,
--    which now marks its booking cancelled first, so it never reads as the
--    host's. Disconnecting a calendar account tombstones its events too: the
--    trigger runs at commit (deferred), sees the account gone, and does nothing.
-- 5. The event's time changes (a Moduo edit or a Google reschedule synced in):
--    the booking's times follow, and its reminders move with them.
--
-- Dedupe keys carry the moment they were queued, so a re-queue (an undo, a
-- move) never collides with the cancelled row before it, which would make
-- email_enqueue a silent no-op: C7:<booking>:<queued µs>:<email>,
-- C6:<booking>:<cancel epoch>:<email>. email_cancel('C7:<booking>') /
-- ('C6:<booking>') cancel every version.

-- ---- 1 + 2: columns and the index -----------------------------------------

ALTER TABLE public.exposed_slot_links
  ADD COLUMN IF NOT EXISTS guest_reminder_minutes integer DEFAULT 1440;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exposed_slot_links'::regclass
      AND conname = 'exposed_slot_links_guest_reminder_minutes_check'
  ) THEN
    ALTER TABLE public.exposed_slot_links
      ADD CONSTRAINT exposed_slot_links_guest_reminder_minutes_check
      CHECK (guest_reminder_minutes IS NULL OR guest_reminder_minutes IN (60, 1440));
  END IF;
END $$;

ALTER TABLE public.slot_bookings
  ADD COLUMN IF NOT EXISTS email_context jsonb,
  ADD COLUMN IF NOT EXISTS host_cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS slot_bookings_calendar_event_id
  ON public.slot_bookings (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

-- ---- helpers ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking__iso(p_at timestamptz)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- Who a booking's guest emails go to: the booker ("booker") first, then each
-- extra guest once ("added"), lower-cased, never the booker twice.
CREATE OR REPLACE FUNCTION public.booking__recipients(b public.slot_bookings)
RETURNS TABLE (email text, recipient text)
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT lower(btrim(b.attendee_email)), 'booker'
  WHERE btrim(coalesce(b.attendee_email, '')) <> ''
  UNION ALL
  SELECT DISTINCT lower(btrim(g)), 'added'
  FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(b.guest_emails) = 'array' THEN b.guest_emails ELSE '[]'::jsonb END
       ) AS g
  WHERE btrim(g) <> '' AND lower(btrim(g)) <> lower(btrim(coalesce(b.attendee_email, '')))
$$;

-- Queues C7 for a confirmed booking, unless the link's reminder is off, the
-- context is missing, or the reminder moment has passed (booked inside the window).
CREATE OR REPLACE FUNCTION public.booking__queue_reminders(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.slot_bookings;
  v_minutes integer;
  v_send timestamptz;
  v_count integer := 0;
  v_stamp bigint := (extract(epoch FROM clock_timestamp()) * 1000000)::bigint;
  r record;
BEGIN
  SELECT * INTO b FROM public.slot_bookings WHERE id = p_booking_id;
  IF b.id IS NULL OR b.status <> 'confirmed' OR b.email_context IS NULL THEN RETURN 0; END IF;
  SELECT l.guest_reminder_minutes INTO v_minutes
    FROM public.exposed_slot_links l WHERE l.slot_id = b.slot_id LIMIT 1;
  IF v_minutes IS NULL THEN RETURN 0; END IF;
  v_send := b.start_at - make_interval(mins => v_minutes);
  IF v_send <= now() THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.booking__recipients(b) LOOP
    PERFORM public.email_enqueue(
      'booking_guest_reminder', r.email, NULL,
      b.email_context || jsonb_build_object(
        'bookingId', b.id::text,
        'start', public.booking__iso(b.start_at),
        'end', public.booking__iso(b.end_at),
        'at', public.booking__iso(v_send),
        'sendAt', public.booking__iso(v_send),
        'reminderMinutes', v_minutes,
        'recipient', r.recipient
      ),
      format('C7:%s:%s:%s', b.id, v_stamp, r.email),
      v_send
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Queues C6 two minutes from now (the undo window) for the booker and each extra guest.
CREATE OR REPLACE FUNCTION public.booking__queue_host_cancel(p_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.slot_bookings;
  v_count integer := 0;
  r record;
BEGIN
  SELECT * INTO b FROM public.slot_bookings WHERE id = p_booking_id;
  IF b.id IS NULL OR b.email_context IS NULL OR b.host_cancelled_at IS NULL THEN RETURN 0; END IF;
  -- Nobody is told about a meeting that already started.
  IF b.start_at <= now() THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM public.booking__recipients(b) LOOP
    PERFORM public.email_enqueue(
      'booking_guest_host_cancelled', r.email, NULL,
      b.email_context || jsonb_build_object(
        'bookingId', b.id::text,
        'start', public.booking__iso(b.start_at),
        'end', public.booking__iso(b.end_at),
        'at', public.booking__iso(b.host_cancelled_at),
        'recipient', r.recipient
      ),
      format('C6:%s:%s:%s', b.id, extract(epoch FROM b.host_cancelled_at)::bigint, r.email),
      b.host_cancelled_at + interval '2 minutes'
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ---- 3: the booking's own state --------------------------------------------

CREATE OR REPLACE FUNCTION public.slot_bookings__email_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
    PERFORM public.booking__queue_reminders(NEW.id);
  ELSIF OLD.status = 'confirmed' AND NEW.status IS DISTINCT FROM 'confirmed' THEN
    PERFORM public.email_cancel('C7:' || NEW.id::text);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS slot_bookings_email_follow ON public.slot_bookings;
CREATE TRIGGER slot_bookings_email_follow
  AFTER UPDATE ON public.slot_bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.slot_bookings__email_follow();

-- ---- 4 + 5: the booked event ----------------------------------------------

CREATE OR REPLACE FUNCTION public.calendar_events__booking_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
  b public.slot_bookings;
  v_gone boolean;
  v_account_gone boolean := false;
BEGIN
  SELECT * INTO b FROM public.slot_bookings
   WHERE calendar_event_id = NEW.id
   ORDER BY created_at DESC
   LIMIT 1;
  IF b.id IS NULL THEN RETURN NULL; END IF;

  -- Deferred to commit: read the event as the transaction leaves it.
  SELECT * INTO e FROM public.calendar_events WHERE id = NEW.id;
  v_gone := e.id IS NULL OR e.deleted_at IS NOT NULL OR e.status = 'cancelled';

  IF v_gone THEN
    IF b.status <> 'confirmed' THEN RETURN NULL; END IF;
    -- Disconnecting the calendar account tombstones its events: not a cancel.
    IF e.source_account_id IS NOT NULL THEN
      SELECT a.deleted_at IS NOT NULL INTO v_account_gone
        FROM public.calendar_accounts a WHERE a.id = e.source_account_id;
      IF coalesce(v_account_gone, true) THEN RETURN NULL; END IF;
    END IF;
    UPDATE public.slot_bookings
       SET status = 'cancelled', host_cancelled_at = now(), updated_at = now()
     WHERE id = b.id;
    PERFORM public.booking__queue_host_cancel(b.id);
    RETURN NULL;
  END IF;

  -- Back within the undo window: the booking stands again and C6 never goes.
  IF b.status = 'cancelled' AND b.host_cancelled_at IS NOT NULL
     AND b.host_cancelled_at > now() - interval '2 minutes' THEN
    BEGIN
      UPDATE public.slot_bookings
         SET status = 'confirmed', host_cancelled_at = NULL,
             start_at = e.start_time, end_at = e.end_time, updated_at = now()
       WHERE id = b.id;
      PERFORM public.email_cancel('C6:' || b.id::text);
    EXCEPTION WHEN unique_violation THEN
      -- Someone booked the freed time meanwhile: theirs stands, this one stays
      -- cancelled, and its C6 still goes.
      NULL;
    END;
    RETURN NULL;
  END IF;

  -- The meeting moved: the booking follows, and so do its reminders.
  IF b.status = 'confirmed'
     AND (e.start_time IS DISTINCT FROM b.start_at OR e.end_time IS DISTINCT FROM b.end_at) THEN
    BEGIN
      UPDATE public.slot_bookings
         SET start_at = e.start_time, end_at = e.end_time, updated_at = now()
       WHERE id = b.id;
    EXCEPTION WHEN unique_violation THEN
      -- Another booking holds that start on the same link; the slot record stays put.
      RETURN NULL;
    END;
    PERFORM public.email_cancel('C7:' || b.id::text);
    PERFORM public.booking__queue_reminders(b.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS calendar_events_booking_follow ON public.calendar_events;
CREATE CONSTRAINT TRIGGER calendar_events_booking_follow
  AFTER UPDATE ON public.calendar_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (
    OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.start_time IS DISTINCT FROM NEW.start_time
    OR OLD.end_time IS DISTINCT FROM NEW.end_time
  )
  EXECUTE FUNCTION public.calendar_events__booking_follow();

-- ---- the guest cancel marks its booking first ------------------------------
-- 20261010160147_tx5_booking_bell.sql's body, plus the first UPDATE.

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
  v_guest_name text;
  v_guest_email text;
BEGIN
  -- TX-6: a guest cancel, so the event's deferred trigger never takes it for the host's.
  UPDATE public.slot_bookings
     SET status = 'cancelled', updated_at = now()
   WHERE calendar_event_id = p_event_id AND status = 'confirmed';

  SELECT e.title, e.start_time
    INTO v_title, v_start
    FROM public.calendar_events e
   WHERE e.id = p_event_id
     AND e.workspace_id = p_workspace_id;

  SELECT b.attendee_name, b.attendee_email
    INTO v_guest_name, v_guest_email
    FROM public.slot_bookings b
   WHERE b.calendar_event_id = p_event_id
   ORDER BY b.created_at DESC
   LIMIT 1;

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
       'guest', NULLIF(btrim(coalesce(v_guest_email, '')), ''),
       'guest_name', NULLIF(btrim(coalesce(v_guest_name, '')), ''),
       'start', v_start,
       'notify_user_ids', jsonb_build_array(p_owner_id::text)
     )));
END;
$$;

-- ---- grants: internal helpers, service role only ---------------------------

REVOKE ALL ON FUNCTION public.booking_op_release(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_release(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.booking__iso(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking__recipients(public.slot_bookings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking__queue_reminders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking__queue_host_cancel(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.slot_bookings__email_follow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calendar_events__booking_follow() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking__queue_reminders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking__queue_host_cancel(uuid) TO service_role;

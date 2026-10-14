-- TX-6 · Booking reminders and the host's cancel, row by row
-- (supabase/migrations/20261014170000_tx6_booking_reminders.sql).
-- specs/transactional-email.md T17; AC31, AC32, AC33.
--
-- Cast: O hosts link L (reminder 24 h), L60 (1 h) and LOFF (off) in
-- workspace W. Each booking B* has its own event E*. The event trigger is
-- deferred to commit, so each step ends with SET CONSTRAINTS ... IMMEDIATE,
-- which runs it there and then.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Northwind Studio'),
  (test.id('W-other'), test.id('O'), 'Elsewhere');

INSERT INTO public.exposed_slot_links (id, slot_id, slug, owner_user_id, workspace_id, name, guest_reminder_minutes)
VALUES
  (test.id('L'), 'slot-L', 'tx6-l', test.id('O')::text, test.id('W'), 'Intro call', 1440),
  (test.id('L60'), 'slot-L60', 'tx6-l60', test.id('O')::text, test.id('W'), 'Quick chat', 60),
  (test.id('LOFF'), 'slot-LOFF', 'tx6-loff', test.id('O')::text, test.id('W'), 'No reminder', NULL);
INSERT INTO public.exposed_slot_links (id, slot_id, slug, owner_user_id, workspace_id, name)
VALUES (test.id('LNEW'), 'slot-LNEW', 'tx6-lnew', test.id('O')::text, test.id('W'), 'Default');

INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider)
VALUES (test.id('ACC'), test.id('W'), test.id('O'), 'google');

-- An event at +p_days and its pending booking on p_slot (confirmed by the caller).
CREATE FUNCTION test.booking(p_name text, p_slot text, p_start timestamptz, p_account text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.calendar_events (id, workspace_id, owner_id, title, start_time, end_time, source_account_id, external_event_id)
  VALUES (test.id('E' || p_name), test.id('W'), test.id('O'), 'Intro call', p_start, p_start + interval '30 minutes',
          CASE WHEN p_account IS NULL THEN NULL ELSE test.id(p_account) END,
          CASE WHEN p_account IS NULL THEN NULL ELSE 'ext-' || p_name END);
  INSERT INTO public.slot_bookings (id, slot_id, slot_slug, start_at, end_at, timezone, attendee_name, attendee_email,
                                    status, calendar_event_id, guest_emails, email_context)
  VALUES (test.id('B' || p_name), p_slot, 'tx6', p_start, p_start + interval '30 minutes', 'Europe/Warsaw',
          'Tom Becker', 'tom@becker.studio', 'pending', test.id('E' || p_name),
          '["sam@lee.design", "TOM@becker.studio"]'::jsonb,
          jsonb_build_object('linkName', 'Intro call', 'durationMinutes', 30, 'zone', 'Europe/Warsaw',
            'video', 'Zoom', 'joinUrl', 'https://zoom.example/j/1', 'hostName', 'Anna Carter',
            'hostEmail', 'anna@northwind.studio', 'guestName', 'Tom Becker', 'guestEmail', 'tom@becker.studio',
            'guests', '["sam@lee.design"]'::jsonb, 'googleInvites', false,
            'cancelUrl', 'https://moduo.app/book/cancel?token=t', 'rebookUrl', 'https://moduo.app/book/tx6-l'));
  UPDATE public.slot_bookings SET status = 'confirmed' WHERE id = test.id('B' || p_name);
END;
$$;

CREATE FUNCTION test.queued(p_kind text, p_booking text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.email_outbox
  WHERE kind = p_kind AND status = 'queued' AND payload->>'bookingId' = test.id('B' || p_booking)::text
$$;
CREATE FUNCTION test.cancelled(p_kind text, p_booking text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.email_outbox
  WHERE kind = p_kind AND status = 'cancelled' AND payload->>'bookingId' = test.id('B' || p_booking)::text
$$;
CREATE FUNCTION test.booking_status(p_booking text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.slot_bookings WHERE id = test.id('B' || p_booking)
$$;

-- ---- AC31: the setting -------------------------------------------------------

SELECT test.ok((SELECT guest_reminder_minutes FROM public.exposed_slot_links WHERE id = test.id('LNEW')) = 1440,
  'a new link starts at 24 hours');
DO $$
BEGIN
  BEGIN
    UPDATE public.exposed_slot_links SET guest_reminder_minutes = 30 WHERE id = test.id('L');
    PERFORM test.ok(false, 'a reminder other than off, 1 h or 24 h is refused');
  EXCEPTION WHEN check_violation THEN
    PERFORM test.ok(true, 'a reminder other than off, 1 h or 24 h is refused');
  END;
END $$;

-- ---- AC32: queued at confirm, skipped inside the window or when off -------------

SELECT test.booking('1', 'slot-L', date_trunc('minute', now()) + interval '3 days');
SELECT test.ok(test.queued('booking_guest_reminder', '1') = 2, 'C7 queued for the booker and the one extra guest (booker not twice)');
SELECT test.ok((SELECT bool_and(send_after = (SELECT start_at FROM public.slot_bookings WHERE id = test.id('B1')) - interval '1 day')
                  FROM public.email_outbox WHERE kind = 'booking_guest_reminder' AND payload->>'bookingId' = test.id('B1')::text),
  'C7 is due 24 hours before the meeting');
SELECT test.ok((SELECT string_agg(payload->>'recipient', ',' ORDER BY payload->>'recipient')
                  FROM public.email_outbox WHERE kind = 'booking_guest_reminder' AND payload->>'bookingId' = test.id('B1')::text)
               = 'added,booker', 'the booker and the added guest are told apart (cancel link for the booker only)');
SELECT test.ok((SELECT bool_and(payload->>'reminderMinutes' = '1440' AND payload ? 'sendAt' AND payload->>'zone' = 'Europe/Warsaw')
                  FROM public.email_outbox WHERE kind = 'booking_guest_reminder' AND payload->>'bookingId' = test.id('B1')::text),
  'C7 renders from its payload (minutes, send time, guest zone)');

SELECT test.booking('2', 'slot-L', date_trunc('minute', now()) + interval '2 hours');
SELECT test.ok(test.queued('booking_guest_reminder', '2') = 0, 'booked inside the 24-hour window: no reminder');
SELECT test.booking('3', 'slot-L60', date_trunc('minute', now()) + interval '3 hours');
SELECT test.ok((SELECT count(*) FROM public.email_outbox WHERE kind = 'booking_guest_reminder'
                  AND payload->>'bookingId' = test.id('B3')::text
                  AND send_after = date_trunc('minute', now()) + interval '2 hours') = 2,
  'a 1-hour link reminds an hour before');
SELECT test.booking('4', 'slot-LOFF', date_trunc('minute', now()) + interval '3 days');
SELECT test.ok(test.queued('booking_guest_reminder', '4') = 0, 'reminders off: none');

-- ---- AC33: the host deletes the booked meeting, then undoes ---------------------

UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E1');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('1') = 'cancelled', 'host delete releases the booking (its slot opens)');
SELECT test.ok(test.cancelled('booking_guest_reminder', '1') = 2, 'host delete cancels the reminders');
SELECT test.ok(test.queued('booking_guest_host_cancelled', '1') = 2, 'C6 queued for the booker and the extra guest');
SELECT test.ok((SELECT bool_and(send_after = now() + interval '2 minutes 10 seconds') FROM public.email_outbox
                  WHERE kind = 'booking_guest_host_cancelled' AND payload->>'bookingId' = test.id('B1')::text),
  'C6 waits until just after the 2-minute undo window');

UPDATE public.calendar_events SET deleted_at = NULL WHERE id = test.id('E1');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('1') = 'confirmed', 'undo within 2 minutes restores the booking');
SELECT test.ok(test.queued('booking_guest_host_cancelled', '1') = 0, 'undo within 2 minutes sends nothing');
SELECT test.ok(test.queued('booking_guest_reminder', '1') = 2, 'undo re-queues the reminders');

-- Undo after the window: the booking stays cancelled and C6 goes.
SELECT test.booking('5', 'slot-L', date_trunc('minute', now()) + interval '4 days');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E5');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.slot_bookings SET host_cancelled_at = now() - interval '3 minutes' WHERE id = test.id('B5');
UPDATE public.calendar_events SET deleted_at = NULL WHERE id = test.id('E5');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('5') = 'cancelled', 'undo after 2 minutes leaves the booking cancelled');
SELECT test.ok(test.queued('booking_guest_host_cancelled', '5') = 2, 'undo after 2 minutes keeps C6');

-- The window's edges: 1:50 after the delete still restores; 2:01 doesn't.
SELECT test.booking('18', 'slot-L', date_trunc('minute', now()) + interval '18 days');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E18');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.slot_bookings SET host_cancelled_at = now() - interval '110 seconds' WHERE id = test.id('B18');
UPDATE public.calendar_events SET deleted_at = NULL WHERE id = test.id('E18');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('18') = 'confirmed', 'an undo 1:50 after the delete restores the booking');
SELECT test.booking('19', 'slot-L', date_trunc('minute', now()) + interval '19 days');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E19');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.slot_bookings SET host_cancelled_at = now() - interval '121 seconds' WHERE id = test.id('B19');
UPDATE public.calendar_events SET deleted_at = NULL WHERE id = test.id('E19');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('19') = 'cancelled', 'an undo 2:01 after the delete leaves it cancelled');

-- ---- AC32: the meeting moves --------------------------------------------------

SELECT test.booking('6', 'slot-L', date_trunc('minute', now()) + interval '5 days');
UPDATE public.calendar_events SET start_time = start_time + interval '1 day', end_time = end_time + interval '1 day'
WHERE id = test.id('E6');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok((SELECT start_at FROM public.slot_bookings WHERE id = test.id('B6')) = date_trunc('minute', now()) + interval '6 days',
  'the booking follows the meeting''s new time');
SELECT test.ok(test.cancelled('booking_guest_reminder', '6') = 2 AND test.queued('booking_guest_reminder', '6') = 2,
  'the old reminders are cancelled and new ones queued');
SELECT test.ok((SELECT bool_and(send_after = date_trunc('minute', now()) + interval '5 days') FROM public.email_outbox
                  WHERE kind = 'booking_guest_reminder' AND status = 'queued' AND payload->>'bookingId' = test.id('B6')::text),
  'the reminder moved with the meeting');

-- ---- the guest's own cancel is not the host's --------------------------------

SELECT test.booking('7', 'slot-L', date_trunc('minute', now()) + interval '7 days');
SELECT public.booking_op_release(test.id('W'), test.id('O'), test.id('E7'));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('7') = 'cancelled', 'guest cancel releases the booking');
SELECT test.ok(test.queued('booking_guest_host_cancelled', '7') = 0, 'guest cancel queues no C6');
SELECT test.ok(test.cancelled('booking_guest_reminder', '7') = 2, 'guest cancel cancels the reminders');
SELECT test.ok((SELECT host_cancelled_at IS NULL FROM public.slot_bookings WHERE id = test.id('B7')), 'guest cancel is not marked as the host''s');

-- ---- Google: a tombstone from sync cancels; disconnecting the account doesn't ---

SELECT test.booking('8', 'slot-L', date_trunc('minute', now()) + interval '8 days', 'ACC');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E8');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('8') = 'cancelled' AND test.queued('booking_guest_host_cancelled', '8') = 2,
  'a meeting cancelled in Google (synced away) cancels the booking and queues C6');

SELECT test.booking('9', 'slot-L', date_trunc('minute', now()) + interval '9 days', 'ACC');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E9');
UPDATE public.calendar_accounts SET deleted_at = now() WHERE id = test.id('ACC');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('9') = 'confirmed' AND test.queued('booking_guest_host_cancelled', '9') = 0,
  'disconnecting the calendar account cancels nothing and emails nobody');

-- ---- a meeting that already started -------------------------------------------

SELECT test.booking('10', 'slot-LOFF', date_trunc('minute', now()) - interval '10 minutes');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E10');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('10') = 'confirmed' AND test.queued('booking_guest_host_cancelled', '10') = 0,
  'a meeting that already started is history: a delete (or a sync dropping it) changes nothing and emails nobody');

-- ---- undo after someone took the freed time ----------------------------------

SELECT test.booking('11', 'slot-L', date_trunc('minute', now()) + interval '11 days');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E11');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.slot_bookings (id, slot_id, slot_slug, start_at, end_at, attendee_name, attendee_email, status)
VALUES (test.id('B11b'), 'slot-L', 'tx6', date_trunc('minute', now()) + interval '11 days',
        date_trunc('minute', now()) + interval '11 days 30 minutes', 'Priya Nair', 'priya@nair.dev', 'confirmed');
UPDATE public.calendar_events SET deleted_at = NULL WHERE id = test.id('E11');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('11') = 'cancelled' AND test.queued('booking_guest_host_cancelled', '11') = 2,
  'an undo after someone booked the freed time leaves the booking cancelled, and C6 still goes');

-- ---- a move onto another booking's start -------------------------------------

SELECT test.booking('12', 'slot-L', date_trunc('minute', now()) + interval '12 days');
SELECT test.booking('13', 'slot-L', date_trunc('minute', now()) + interval '13 days');
UPDATE public.calendar_events SET start_time = start_time + interval '1 day', end_time = end_time + interval '1 day'
WHERE id = test.id('E12');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok((SELECT start_at FROM public.slot_bookings WHERE id = test.id('B12')) = date_trunc('minute', now()) + interval '12 days'
  AND (SELECT deleted_at IS NULL AND start_time = date_trunc('minute', now()) + interval '13 days' FROM public.calendar_events WHERE id = test.id('E12')),
  'a move onto another booking''s start keeps the event edit and the booking''s slot record');

-- ---- the host changes the link's reminder ---------------------------------------

SELECT test.booking('14', 'slot-L60', date_trunc('minute', now()) + interval '14 days');
UPDATE public.exposed_slot_links SET guest_reminder_minutes = 1440 WHERE id = test.id('L60');
SELECT test.ok((SELECT count(*) FROM public.email_outbox WHERE kind = 'booking_guest_reminder' AND status = 'queued'
                  AND payload->>'bookingId' = test.id('B14')::text
                  AND send_after = date_trunc('minute', now()) + interval '13 days') = 2,
  'switching a link from 1 h to 24 h moves its upcoming reminders');
UPDATE public.exposed_slot_links SET guest_reminder_minutes = NULL WHERE id = test.id('L60');
SELECT test.ok(test.queued('booking_guest_reminder', '14') = 0, 'switching a link off cancels its upcoming reminders');

-- ---- an email problem never blocks the calendar --------------------------------

SELECT test.booking('15', 'slot-LOFF', date_trunc('minute', now()) + interval '15 days');
UPDATE public.slot_bookings SET guest_emails = '["not an address"]'::jsonb WHERE id = test.id('B15');
UPDATE public.calendar_events SET deleted_at = now() WHERE id = test.id('E15');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('15') = 'cancelled' AND test.queued('booking_guest_host_cancelled', '15') = 1
  AND (SELECT deleted_at IS NOT NULL FROM public.calendar_events WHERE id = test.id('E15')),
  'an unusable guest address skips only that email; the delete and the booker''s C6 go through');

-- ---- a meeting that already started can still be moved -------------------------

SELECT test.booking('20', 'slot-LOFF', date_trunc('minute', now()) - interval '5 minutes');
UPDATE public.calendar_events SET start_time = date_trunc('minute', now()) + interval '20 days',
  end_time = date_trunc('minute', now()) + interval '20 days 30 minutes' WHERE id = test.id('E20');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok((SELECT start_at FROM public.slot_bookings WHERE id = test.id('B20')) = date_trunc('minute', now()) + interval '20 days',
  'moving a no-show to a later day moves the booking too');

-- ---- account erasure takes the booking's emails with it -------------------------

SELECT test.booking('16', 'slot-L', date_trunc('minute', now()) + interval '16 days');
SELECT test.ok(test.queued('booking_guest_reminder', '16') = 2, 'erasure setup: reminders queued');
DELETE FROM public.slot_bookings WHERE id = test.id('B16');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM public.email_outbox WHERE payload->>'bookingId' = test.id('B16')::text),
  'deleting a booking (account erasure) deletes its queued emails and their details');

-- ---- a guest cancel in another workspace's name does nothing ---------------------

SELECT test.booking('17', 'slot-L', date_trunc('minute', now()) + interval '17 days');
SELECT public.booking_op_release(test.id('W-other'), test.id('O'), test.id('E17'));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT test.ok(test.booking_status('17') = 'confirmed', 'release scoped to another workspace leaves the booking alone');

-- ---- internals stay internal ---------------------------------------------------

SELECT test.ok(NOT has_function_privilege('authenticated', 'public.booking__queue_reminders(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.booking__queue_host_cancel(uuid)', 'EXECUTE'),
  'the queue helpers are not callable by app users');

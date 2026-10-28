-- Holds release together (CALR-19, specs/calendar-rethink.md AC34). An offer
-- is a handful of times from one of your booking links, sent as one link
-- (/book/r/<slug>). Each held time is a calendar item of kind 'hold' on your
-- Moduo calendar, so every availability read counts it as busy. The guest's
-- pick (booking_op_offer_book, booking-public's offer mode) books one time and
-- releases the rest in the same transaction; Release holds and 48 hours
-- (slot_offers_expire, run by pg_cron) release them all.
--
-- Cast: O owns workspace W and the booking link "Intro call" (L, 30 minutes).
-- M is a member; B a member with Busy only on O's Moduo calendar; X owns W2
-- and isn't in W. KO is O's API key with Calendar edit, KV O's key with
-- Calendar view, KM M's key with Calendar edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'B', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Hale & Co'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('B'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KO'), test.id('W'), 'O agent', 'mdo_ko', md5('db-test-ko'), '{"calendar": "edit"}'::jsonb, test.id('O')),
  (test.id('KV'), test.id('W'), 'O reader', 'mdo_kv', md5('db-test-kv'), '{"calendar": "view"}'::jsonb, test.id('O')),
  (test.id('KM'), test.id('W'), 'M agent', 'mdo_km', md5('db-test-km'), '{"calendar": "edit"}'::jsonb, test.id('M'));
INSERT INTO public.exposed_slot_links
  (id, slot_id, workspace_id, owner_user_id, owner_email, name, link_name, slug, duration_minutes,
   video_provider, host_timezone, min_notice_minutes)
VALUES
  (test.id('L'), 'db-test-slot-l', test.id('W')::text, test.id('O')::text, 'db-test-o@example.com',
   'Intro call', 'Intro call', 'db-test-intro', 30, 'google_meet', 'Europe/Warsaw', 240),
  (test.id('LX'), 'db-test-slot-lx', test.id('W2')::text, test.id('X')::text, 'db-test-x@example.com',
   'Outsider call', 'Outsider call', 'db-test-outsider', 30, 'google_meet', 'UTC', 0);

-- Offers by name: ids are read back as the superuser, never under another role.
CREATE TEMP TABLE offer_ids (name text PRIMARY KEY, id uuid);
CREATE FUNCTION pg_temp.offer(p_name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM offer_ids WHERE name = p_name
$$;
CREATE FUNCTION pg_temp.create_sql(p_times text, p_extra text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT (public.calendar_op_offer_create(p_workspace_id => %L, p_link_id => %L,
    p_starts_at => %s%s))->>'id'$q$, md5('db-test:W')::uuid, md5('db-test:L')::uuid, p_times, p_extra)
$$;
CREATE FUNCTION pg_temp.live_holds(p_offer uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.calendar_events WHERE offer_id = p_offer AND kind = 'hold' AND deleted_at IS NULL
$$;

-- ── Making an offer ─────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  r := test.value_as('O', pg_temp.create_sql(
    $t$ARRAY['2030-03-05 09:00+00', '2030-03-06 13:00+00', '2030-03-07 10:00+00']::timestamptz[]$t$,
    $x$, p_hold => true, p_title => 'Investor meeting', p_duration_minutes => 45$x$));
  PERFORM test.ok(r ~ '^[0-9a-f-]{36}$', 'O offers three held times from their link', r);
  INSERT INTO offer_ids VALUES ('held', r::uuid);
END;
$$;

DO $$
DECLARE
  v_offer uuid := pg_temp.offer('held');
  o public.slot_offers;
BEGIN
  SELECT * INTO o FROM public.slot_offers WHERE id = v_offer;
  PERFORM test.ok(o.status = 'open' AND o.owner_id = test.id('O') AND o.workspace_id = test.id('W')
              AND o.link_id = test.id('L'), 'the offer is open, O''s, in W, from L');
  PERFORM test.ok(o.title = 'Investor meeting' AND o.duration_minutes = 45 AND o.hold,
    'it keeps the title, length and hold it was made with');
  PERFORM test.ok(o.expires_at = now() + interval '48 hours', 'holds last 48 hours', o.expires_at::text);
  PERFORM test.ok(o.slug ~ '^[0-9a-f]{32}$' AND position('db-test-intro' IN o.slug) = 0,
    'its slug is a random token of its own that never names the link', o.slug);
  PERFORM test.ok((SELECT count(*) FROM public.slot_offer_times t WHERE t.offer_id = v_offer
                    AND t.end_at = t.start_at + interval '45 minutes') = 3,
    'three offered times, each as long as the meeting');
  PERFORM test.ok(pg_temp.live_holds(v_offer) = 3, 'each time is held on O''s calendar');
  PERFORM test.ok((SELECT count(*) FROM public.calendar_events e
                    JOIN public.calendars c ON c.id = e.calendar_ref
                   WHERE e.offer_id = v_offer AND e.owner_id = test.id('O') AND e.workspace_id = test.id('W')
                     AND c.kind = 'moduo' AND e.title = 'Held · Investor meeting'
                     AND e.end_time = e.start_time + interval '45 minutes') = 3,
    'as "Held · Investor meeting" on O''s Moduo calendar, the length of the meeting');
  PERFORM test.ok((SELECT count(*) FROM public.slot_offer_times t
                    JOIN public.calendar_events e ON e.id = t.hold_event_id
                   WHERE t.offer_id = v_offer AND e.start_time = t.start_at) = 3,
    'each offered time points at its hold');
END;
$$;

-- Without a title or length the offer takes the link's; without a hold, nothing is held.
DO $$
DECLARE
  r text;
  o public.slot_offers;
BEGIN
  r := test.value_as('O', pg_temp.create_sql($t$ARRAY['2030-03-08 09:00+00']::timestamptz[]$t$, ', p_hold => false'));
  PERFORM test.ok(r ~ '^[0-9a-f-]{36}$', 'O offers one time without holding it', r);
  INSERT INTO offer_ids VALUES ('unheld', r::uuid);
  SELECT * INTO o FROM public.slot_offers WHERE id = r::uuid;
  PERFORM test.ok(o.title = 'Intro call' AND o.duration_minutes = 30 AND NOT o.hold AND o.status = 'open',
    'it takes the link''s title and length, and holds nothing');
  PERFORM test.ok(pg_temp.live_holds(r::uuid) = 0
              AND (SELECT count(*) FROM public.slot_offer_times WHERE offer_id = r::uuid) = 1,
    'one offered time, no hold on the calendar');
  PERFORM test.ok((SELECT slug FROM public.slot_offers WHERE id = pg_temp.offer('held')) <> o.slug,
    'each offer has its own slug');
END;
$$;

-- Refusals: someone else's link, no times, past times, too many; the key's own reach.
DO $$
DECLARE
  r text;
BEGIN
  r := test.value_as('M', pg_temp.create_sql($t$ARRAY['2030-03-05 09:00+00']::timestamptz[]$t$));
  PERFORM test.ok(r LIKE 'ERROR %Booking link not found.%', 'M can''t offer times from O''s link', r);
  r := test.value_as('X', pg_temp.create_sql($t$ARRAY['2030-03-05 09:00+00']::timestamptz[]$t$));
  PERFORM test.ok(r LIKE 'ERROR %', 'an outsider can''t offer in W', r);
  r := test.value_as('X', format($q$SELECT (public.calendar_op_offer_create(p_workspace_id => %L, p_link_id => %L,
    p_starts_at => ARRAY['2030-03-05 09:00+00']::timestamptz[]))->>'id'$q$, test.id('W2'), test.id('L')));
  PERFORM test.ok(r LIKE 'ERROR %Booking link not found.%', 'nor name O''s link from their own workspace', r);
  r := test.value_as('O', pg_temp.create_sql($t$ARRAY[]::timestamptz[]$t$));
  PERFORM test.ok(r LIKE 'ERROR %Pick at least one time.%', 'an offer needs a time', r);
  r := test.value_as('O', pg_temp.create_sql($t$ARRAY['2020-01-07 09:00+00']::timestamptz[]$t$));
  PERFORM test.ok(r LIKE 'ERROR %Times must be in the future.%', 'and times ahead', r);
  r := test.value_as('O', pg_temp.create_sql(
    $t$(SELECT array_agg(timestamptz '2030-04-01 09:00+00' + n * interval '1 day') FROM generate_series(1, 11) n)$t$));
  PERFORM test.ok(r LIKE 'ERROR %At most 10 times.%', 'and at most ten of them', r);
  PERFORM test.ok((SELECT count(*) FROM public.slot_offers WHERE link_id = test.id('L')) = 2,
    'no refused call left an offer behind');

  r := test.as_key('KO', pg_temp.create_sql($t$ARRAY['2030-03-12 09:00+00']::timestamptz[]$t$));
  PERFORM test.ok(r = 'ok 1', 'O''s key with Calendar edit offers times for O', r);
  r := test.as_key('KV', pg_temp.create_sql($t$ARRAY['2030-03-12 10:00+00']::timestamptz[]$t$));
  PERFORM test.ok(r NOT LIKE 'ok%', 'a Calendar view key can''t', r);
  r := test.as_key('KM', pg_temp.create_sql($t$ARRAY['2030-03-12 11:00+00']::timestamptz[]$t$));
  PERFORM test.ok(r LIKE '%Booking link not found.%', 'M''s key can''t use O''s link', r);
  PERFORM test.ok((SELECT count(*) FROM public.slot_offers WHERE link_id = test.id('L')
                    AND owner_id = test.id('O')) = 3, 'only the edit key''s offer was made');
END;
$$;

-- A hold still can't be made by hand.
DO $$
DECLARE
  r text;
BEGIN
  r := test.try('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L, p_title => 'Sneaky',
    p_starts_at => '2030-03-05 09:00+00', p_ends_at => '2030-03-05 10:00+00', p_kind => 'hold')$q$, test.id('W')));
  PERFORM test.ok(r LIKE '%Held times come from an offer.%', 'holds come only from offers', r);
END;
$$;

-- ── Who reads an offer (RLS) ────────────────────────────────────────────────
DO $$
DECLARE
  v_offer uuid := pg_temp.offer('held');
BEGIN
  PERFORM test.ok(test.value_as('O', format('SELECT count(*) FROM public.slot_offers WHERE id = %L', v_offer)) = '1',
    'O reads their offer');
  PERFORM test.ok(test.value_as('O', format('SELECT count(*) FROM public.slot_offer_times WHERE offer_id = %L', v_offer)) = '3',
    'and its times');
  PERFORM test.ok(test.value_as('M', format('SELECT count(*) FROM public.slot_offers WHERE id = %L', v_offer)) = '0',
    'a member doesn''t read O''s offer');
  PERFORM test.ok(test.value_as('M', format('SELECT count(*) FROM public.slot_offer_times WHERE offer_id = %L', v_offer)) = '0',
    'nor its times');
  PERFORM test.ok(test.value_as('B', 'SELECT count(*) FROM public.slot_offers') = '0', 'nor does B, who sees O''s busy time');
  PERFORM test.ok(test.value_as('X', format('SELECT count(*) FROM public.slot_offers WHERE id = %L', v_offer)) = '0',
    'an outsider doesn''t');
END;
$$;

DO $$
DECLARE
  v_offer uuid := pg_temp.offer('held');
  r text;
  v_anon bigint;
BEGIN
  -- anon: no rows, or no grant at all (checked after the role is back: anon can't write results).
  BEGIN
    SET LOCAL ROLE anon;
    SELECT (SELECT count(*) FROM public.slot_offers) + (SELECT count(*) FROM public.slot_offer_times) INTO v_anon;
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    v_anon := 0;
  END;
  PERFORM test.ok(v_anon = 0, 'anon reads no offers and no offered times', v_anon::text);

  -- Writes go through the ops only: even the owner can't change a row directly.
  r := test.as_user('O', format($q$UPDATE public.slot_offers SET status = 'booked', expires_at = now() + interval '1 year' WHERE id = %L$q$, v_offer));
  PERFORM test.ok(r NOT LIKE 'ok 1', 'O can''t update their offer directly', r);
  r := test.as_user('O', format($q$DELETE FROM public.slot_offers WHERE id = %L$q$, v_offer));
  PERFORM test.ok(r NOT LIKE 'ok 1', 'nor delete it', r);
  r := test.as_user('O', format($q$INSERT INTO public.slot_offers (workspace_id, owner_id, link_id, slug, title, duration_minutes, expires_at)
    VALUES (%L, %L, %L, 'db-test-planted', 'Planted', 30, now() + interval '1 day')$q$, test.id('W'), test.id('O'), test.id('L')));
  PERFORM test.ok(r NOT LIKE 'ok%', 'nor insert one', r);
  r := test.as_user('O', format($q$UPDATE public.slot_offer_times SET start_at = start_at + interval '1 day' WHERE offer_id = %L$q$, v_offer));
  PERFORM test.ok(r NOT LIKE 'ok 3', 'nor move its times', r);
  r := test.as_user('M', format($q$UPDATE public.slot_offers SET status = 'released' WHERE id = %L$q$, v_offer));
  PERFORM test.ok(r NOT LIKE 'ok 1', 'nor can M', r);
  PERFORM test.ok((SELECT status = 'open' AND expires_at = now() + interval '48 hours'
                     FROM public.slot_offers WHERE id = v_offer)
              AND (SELECT count(*) FROM public.slot_offer_times WHERE offer_id = v_offer
                    AND start_at IN ('2030-03-05 09:00+00', '2030-03-06 13:00+00', '2030-03-07 10:00+00')) = 3,
    'the offer is as it was made');
  PERFORM test.ok((SELECT count(*) FROM public.slot_offers WHERE slug = 'db-test-planted') = 0, 'nothing was planted');
END;
$$;

-- The status is a closed vocabulary.
DO $$
DECLARE
  v_state text;
BEGIN
  BEGIN
    UPDATE public.slot_offers SET status = 'maybe' WHERE id = pg_temp.offer('unheld');
    v_state := 'ok';
  EXCEPTION WHEN check_violation THEN
    v_state := 'check';
  END;
  PERFORM test.ok(v_state = 'check', 'an unknown offer status is refused', v_state);
END;
$$;

-- ── Holds are busy ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cal uuid;
  r text;
BEGIN
  SELECT calendar_ref INTO v_cal FROM public.calendar_events WHERE offer_id = pg_temp.offer('held') LIMIT 1;
  DELETE FROM public.resource_grants WHERE resource_type = 'calendar' AND resource_id = v_cal;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'calendar', v_cal, 'member', test.id('B'), 'freebusy', test.id('O'));
  r := test.value_as('B', format($q$SELECT string_agg(to_char(start_time AT TIME ZONE 'UTC', 'DD HH24:MI'), ',' ORDER BY start_time)
    FROM public.calendar_busy_blocks(%L, '2030-03-04 00:00+00', '2030-03-09 00:00+00')$q$, test.id('W')));
  PERFORM test.ok(r = '05 09:00,06 13:00,07 10:00', 'B sees O''s three held times as busy', r);
END;
$$;

-- ── The guest picks one: it books, and the rest release in the same transaction
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.booking_op_offer_book(p_offer_id => %L, p_start_at => '2030-03-06 13:00+00',
    p_description => '', p_location => '', p_attendee_name => 'Tom', p_attendee_email => 'tom@example.com',
    p_host_email => 'db-test-o@example.com')$q$, pg_temp.offer('held')));
  PERFORM test.ok(r LIKE '42501%', 'a signed-in person can''t book an offer directly (booking-public does)', r);
  r := test.as_user('O', 'SELECT public.slot_offers_expire()');
  PERFORM test.ok(r LIKE '42501%', 'nor run the expiry', r);
END;
$$;

CREATE TEMP TABLE picked (event_id uuid, contact_id uuid, offer_id uuid);
DO $$
BEGIN
  INSERT INTO picked
  SELECT (j->>'event_id')::uuid, (j->>'contact_id')::uuid, (j->>'offer_id')::uuid
    FROM (SELECT public.booking_op_offer_book(
            p_offer_id => pg_temp.offer('held'), p_start_at => '2030-03-06 13:00+00',
            p_description => '<p>Booked with Tom</p>', p_location => 'https://meet.google.com/abc-defg-hij',
            p_attendee_name => 'Tom', p_attendee_email => 'tom@example.com',
            p_host_email => 'db-test-o@example.com') AS j) s;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
END;
$$;

DO $$
DECLARE
  v_offer uuid := pg_temp.offer('held');
  v_event uuid := (SELECT event_id FROM picked);
  r text;
BEGIN
  PERFORM test.ok(v_event IS NOT NULL AND (SELECT offer_id FROM picked) = v_offer, 'the pick answers the booked event and the offer');
  PERFORM test.ok((SELECT status = 'booked' AND booked_event_id = v_event FROM public.slot_offers WHERE id = v_offer),
    'the offer is booked, with its event');
  PERFORM test.ok(pg_temp.live_holds(v_offer) = 0
              AND (SELECT count(*) FROM public.calendar_events WHERE offer_id = v_offer AND kind = 'hold') = 3,
    'every hold is released (soft-deleted), the picked one too');
  PERFORM test.ok((SELECT count(*) FROM public.calendar_events
                    WHERE id = v_event AND deleted_at IS NULL AND kind = 'event' AND owner_id = test.id('O')
                      AND title = 'Investor meeting' AND start_time = '2030-03-06 13:00+00'
                      AND end_time = '2030-03-06 13:45+00') = 1,
    'one real event stands at the picked time, named and timed as the offer');
  r := test.value_as('B', format($q$SELECT string_agg(to_char(start_time AT TIME ZONE 'UTC', 'DD HH24:MI'), ',' ORDER BY start_time)
    FROM public.calendar_busy_blocks(%L, '2030-03-04 00:00+00', '2030-03-09 00:00+00')$q$, test.id('W')));
  PERFORM test.ok(r = '06 13:00', 'B now sees only the booked time busy', coalesce(r, 'none'));
END;
$$;

-- A second pick on a booked offer is refused and books nothing.
DO $$
DECLARE
  v_state text := 'ok';
BEGIN
  BEGIN
    PERFORM public.booking_op_offer_book(
      p_offer_id => pg_temp.offer('held'), p_start_at => '2030-03-07 10:00+00', p_description => '',
      p_location => '', p_attendee_name => 'Ann', p_attendee_email => 'ann@example.com',
      p_host_email => 'db-test-o@example.com');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLERRM;
  END;
  PERFORM test.ok(v_state LIKE '%offer_closed%', 'a booked offer takes no second pick', v_state);
  PERFORM test.ok((SELECT count(*) FROM public.calendar_events WHERE workspace_id = test.id('W')
                    AND start_time = '2030-03-07 10:00+00' AND deleted_at IS NULL) = 0,
    'and no event was made for it');
END;
$$;

-- A pick of a time the offer doesn't have changes nothing.
DO $$
DECLARE
  r text;
  v_state text := 'ok';
BEGIN
  r := test.value_as('O', pg_temp.create_sql(
    $t$ARRAY['2030-03-13 09:00+00', '2030-03-14 09:00+00']::timestamptz[]$t$, ', p_hold => true'));
  INSERT INTO offer_ids VALUES ('stray', r::uuid);
  BEGIN
    PERFORM public.booking_op_offer_book(
      p_offer_id => r::uuid, p_start_at => '2030-03-13 09:30+00', p_description => '', p_location => '',
      p_attendee_name => 'Ann', p_attendee_email => 'ann@example.com', p_host_email => 'db-test-o@example.com');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLERRM;
  END;
  PERFORM test.ok(v_state LIKE '%offer_time_unknown%', 'a time the offer doesn''t have is refused', v_state);
  PERFORM test.ok(pg_temp.live_holds(r::uuid) = 2 AND (SELECT status FROM public.slot_offers WHERE id = r::uuid) = 'open',
    'and the offer and its holds stand');
END;
$$;

-- ── Release holds ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_stray uuid := pg_temp.offer('stray');
  r text;
BEGIN
  r := test.value_as('M', format('SELECT public.calendar_op_offer_release(%L, %L)', test.id('W'), v_stray));
  PERFORM test.ok(r LIKE 'ERROR %Offer not found.%', 'M can''t release O''s holds', r);
  PERFORM test.ok(pg_temp.live_holds(v_stray) = 2, 'and they stand');
  r := test.as_key('KM', format('SELECT public.calendar_op_offer_release(%L, %L)', test.id('W'), v_stray));
  PERFORM test.ok(r LIKE '%Offer not found.%', 'nor can M''s key', r);
  r := test.value_as('O', format('SELECT public.calendar_op_offer_release(%L, %L)', test.id('W'), v_stray));
  PERFORM test.ok(r = 'released', 'O releases the holds', r);
  PERFORM test.ok(pg_temp.live_holds(v_stray) = 0 AND (SELECT status FROM public.slot_offers WHERE id = v_stray) = 'released',
    'together, and the offer is released');
  r := test.value_as('O', format('SELECT public.calendar_op_offer_release(%L, %L)', test.id('W'), v_stray));
  PERFORM test.ok(r = 'released', 'releasing again changes nothing', r);
  r := test.value_as('O', format('SELECT public.calendar_op_offer_release(%L, %L)', test.id('W'), pg_temp.offer('held')));
  PERFORM test.ok(r = 'booked', 'a booked offer stays booked', r);
  PERFORM test.ok((SELECT count(*) FROM public.calendar_events WHERE id = (SELECT event_id FROM picked) AND deleted_at IS NULL) = 1,
    'and its meeting stays');
  r := test.as_key('KO', format('SELECT public.calendar_op_offer_release(%L, %L)', test.id('W'), pg_temp.offer('unheld')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT status FROM public.slot_offers WHERE id = pg_temp.offer('unheld')) = 'released',
    'O''s edit key releases for O', r);
END;
$$;

-- A booked or released offer can't be picked.
DO $$
DECLARE
  v_state text := 'ok';
BEGIN
  BEGIN
    PERFORM public.booking_op_offer_book(
      p_offer_id => pg_temp.offer('stray'), p_start_at => '2030-03-13 09:00+00', p_description => '',
      p_location => '', p_attendee_name => 'Ann', p_attendee_email => 'ann@example.com',
      p_host_email => 'db-test-o@example.com');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLERRM;
  END;
  PERFORM test.ok(v_state LIKE '%offer_closed%', 'a released offer takes no pick', v_state);
END;
$$;

-- ── 48 hours ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r text;
  v_late uuid;
  v_fresh uuid;
  v_unswept uuid;
  v_state text := 'ok';
  v_count int;
BEGIN
  r := test.value_as('O', pg_temp.create_sql($t$ARRAY['2030-03-18 09:00+00', '2030-03-19 09:00+00']::timestamptz[]$t$, ', p_hold => true'));
  v_late := r::uuid;
  r := test.value_as('O', pg_temp.create_sql($t$ARRAY['2030-03-20 09:00+00']::timestamptz[]$t$, ', p_hold => true'));
  v_fresh := r::uuid;
  r := test.value_as('O', pg_temp.create_sql($t$ARRAY['2030-03-21 09:00+00']::timestamptz[]$t$, ', p_hold => true'));
  v_unswept := r::uuid;
  INSERT INTO offer_ids VALUES ('fresh', v_fresh);

  -- Time passes for two of them (one transaction: now() can't move).
  UPDATE public.slot_offers SET expires_at = now() - interval '1 minute' WHERE id IN (v_late, v_unswept);

  -- Before the sweep, the guest's pick already refuses a lapsed offer.
  BEGIN
    PERFORM public.booking_op_offer_book(
      p_offer_id => v_unswept, p_start_at => '2030-03-21 09:00+00', p_description => '', p_location => '',
      p_attendee_name => 'Ann', p_attendee_email => 'ann@example.com', p_host_email => 'db-test-o@example.com');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLERRM;
  END;
  PERFORM test.ok(v_state LIKE '%offer_expired%', 'a pick after 48 hours is refused, swept or not', v_state);

  -- Only offers in this test may lapse here: set every other open offer aside.
  UPDATE public.slot_offers SET expires_at = expires_at + interval '100 years'
   WHERE status = 'open' AND expires_at <= now() AND id NOT IN (v_late, v_unswept);
  v_count := public.slot_offers_expire();
  PERFORM test.ok(v_count = 2, 'the sweep expires the two lapsed offers', v_count::text);
  PERFORM test.ok((SELECT count(*) FROM public.slot_offers WHERE id IN (v_late, v_unswept) AND status = 'expired') = 2
              AND pg_temp.live_holds(v_late) = 0 AND pg_temp.live_holds(v_unswept) = 0,
    'they are expired and their holds released together');
  PERFORM test.ok((SELECT status FROM public.slot_offers WHERE id = v_fresh) = 'open' AND pg_temp.live_holds(v_fresh) = 1,
    'an offer inside its 48 hours keeps its holds');
  PERFORM test.ok((SELECT status FROM public.slot_offers WHERE id = pg_temp.offer('held')) = 'booked',
    'a booked offer is never expired');
  PERFORM test.ok(public.slot_offers_expire() = 0, 'a second sweep finds nothing');
  PERFORM test.ok((SELECT count(*) FROM cron.job WHERE jobname = 'slot-offers-expire'
                    AND command LIKE '%slot_offers_expire%') = 1,
    'pg_cron runs the sweep');
END;
$$;

-- ── Erasure: offers go with their link and their person ─────────────────────
DO $$
DECLARE
  v_fresh uuid := pg_temp.offer('fresh');
BEGIN
  PERFORM test.ok((SELECT count(*) FROM pg_constraint c
                    WHERE c.conrelid = 'public.slot_offers'::regclass AND c.contype = 'f'
                      AND c.confrelid = 'auth.users'::regclass AND c.confdeltype = 'c') = 1,
    'an offer is deleted with its person (delete-account)');
  PERFORM test.ok((SELECT count(*) FROM pg_constraint c
                    WHERE c.conrelid = 'public.slot_offers'::regclass AND c.contype = 'f'
                      AND c.confrelid = 'public.workspaces'::regclass AND c.confdeltype = 'c') = 1,
    'and with its workspace');
  DELETE FROM public.exposed_slot_links WHERE id = test.id('L');
  PERFORM test.ok((SELECT count(*) FROM public.slot_offers WHERE link_id = test.id('L')) = 0
              AND (SELECT count(*) FROM public.slot_offer_times WHERE offer_id = v_fresh) = 0,
    'deleting the link deletes its offers and their times (delete-account removes links)');
  PERFORM test.ok(pg_temp.live_holds(v_fresh) = 0, 'and an open offer''s holds stop being busy');
  PERFORM test.ok((SELECT count(*) FROM public.calendar_events WHERE id = (SELECT event_id FROM picked) AND deleted_at IS NULL) = 1,
    'a meeting already booked from an offer stays');
END;
$$;

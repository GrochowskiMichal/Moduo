-- CALR-19 · Offers with holds (specs/calendar-rethink.md AC34). An offer is a
-- handful of times from one of your booking links, sent as one link
-- (/book/r/<slug>). With hold, each time is a calendar item of kind 'hold' on
-- your Moduo calendar, so every availability read counts it as busy. The holds
-- release together: when the offer stops being open (booked, released, expired)
-- or is deleted (its link or person goes), one trigger soft-deletes them; a
-- link soft-deleted in the app releases its open offers.
-- calendar_events.offer_id has no FK on purpose (CALR-6). Re-runnable.
-- Test: supabase/tests/slot_offers.test.sql.

CREATE TABLE IF NOT EXISTS public.slot_offers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  link_id          uuid NOT NULL REFERENCES public.exposed_slot_links(id) ON DELETE CASCADE,
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  video_provider   text CHECK (video_provider IS NULL OR video_provider IN ('google_meet','zoom','guest_choice')),
  hold             boolean NOT NULL DEFAULT true,
  expires_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','released','expired')),
  booked_event_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slot_offers_link_idx ON public.slot_offers (link_id);
CREATE INDEX IF NOT EXISTS slot_offers_owner_idx ON public.slot_offers (owner_id);
CREATE INDEX IF NOT EXISTS slot_offers_open_idx ON public.slot_offers (expires_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.slot_offer_times (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      uuid NOT NULL REFERENCES public.slot_offers(id) ON DELETE CASCADE,
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  hold_event_id uuid,
  UNIQUE (offer_id, start_at)
);
SET LOCAL lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS calendar_events_offer_idx ON public.calendar_events (offer_id) WHERE offer_id IS NOT NULL;

-- RLS: the owner reads their own; nobody writes directly (the ops do).
ALTER TABLE public.slot_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_offer_times ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slot_offers_owner_read ON public.slot_offers;
CREATE POLICY slot_offers_owner_read ON public.slot_offers FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS slot_offer_times_owner_read ON public.slot_offer_times;
CREATE POLICY slot_offer_times_owner_read ON public.slot_offer_times FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.slot_offers o WHERE o.id = offer_id AND o.owner_id = (SELECT auth.uid())));
REVOKE ALL ON TABLE public.slot_offers, public.slot_offer_times FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.slot_offers, public.slot_offer_times TO authenticated;
GRANT ALL ON TABLE public.slot_offers, public.slot_offer_times TO service_role;

-- Holds release together: an offer that stops being open, or is deleted.
CREATE OR REPLACE FUNCTION public.slot_offers__release_holds()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'open' THEN RETURN NULL; END IF;
  -- A workspace being deleted takes its events with it.
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN RETURN NULL; END IF;
  UPDATE public.calendar_events SET deleted_at = now()
   WHERE offer_id = OLD.id AND kind = 'hold' AND deleted_at IS NULL;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS slot_offers_release_holds ON public.slot_offers;
CREATE TRIGGER slot_offers_release_holds AFTER UPDATE OF status OR DELETE ON public.slot_offers
  FOR EACH ROW EXECUTE FUNCTION public.slot_offers__release_holds();

-- The app deletes a link by stamping deleted_at: its open offers release with it.
CREATE OR REPLACE FUNCTION public.exposed_slot_links__release_offers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.slot_offers SET status = 'released', updated_at = now()
     WHERE link_id = NEW.id AND status = 'open';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS exposed_slot_links_release_offers ON public.exposed_slot_links;
CREATE TRIGGER exposed_slot_links_release_offers AFTER UPDATE OF deleted_at ON public.exposed_slot_links
  FOR EACH ROW EXECUTE FUNCTION public.exposed_slot_links__release_offers();

CREATE OR REPLACE FUNCTION public.calendar_op_offer_create(
  p_workspace_id uuid,
  p_link_id uuid,
  p_starts_at timestamptz[],
  p_hold boolean DEFAULT true,
  p_title text DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_video_provider text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.exposed_slot_links;
  o public.slot_offers;
  v_start timestamptz;
  v_hold uuid;
  v_holds uuid[] := '{}';
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO l FROM public.exposed_slot_links
   WHERE id = p_link_id AND workspace_id = p_workspace_id::text AND deleted_at IS NULL
     AND owner_user_id = public.perm_actor_id()::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking link not found.'; END IF;
  IF coalesce(cardinality(p_starts_at), 0) = 0 THEN RAISE EXCEPTION 'Pick at least one time.'; END IF;
  IF cardinality(p_starts_at) > 10 THEN RAISE EXCEPTION 'At most 10 times.'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_starts_at) s WHERE s IS NULL OR s <= now()) THEN
    RAISE EXCEPTION 'Times must be in the future.';
  END IF;

  INSERT INTO public.slot_offers
    (workspace_id, owner_id, link_id, slug, title, duration_minutes, video_provider, hold, expires_at)
  VALUES (p_workspace_id, public.perm_actor_id(), l.id,
          -- Its own random token, never the link's slug: an offer sent to one guest must
          -- not lead them to the host's open booking page.
          encode(extensions.gen_random_bytes(16), 'hex'),
          coalesce(NULLIF(btrim(p_title), ''), NULLIF(btrim(l.name), ''), l.link_name),
          coalesce(p_duration_minutes, l.duration_minutes), p_video_provider,
          coalesce(p_hold, true), now() + interval '48 hours')
  RETURNING * INTO o;

  FOR v_start IN SELECT DISTINCT s FROM unnest(p_starts_at) s ORDER BY 1 LOOP
    v_hold := NULL;
    IF o.hold THEN
      INSERT INTO public.calendar_events
        (workspace_id, owner_id, calendar_id, title, description, start_time, end_time,
         all_day, recurring, status, kind, offer_id)
      VALUES (p_workspace_id, o.owner_id, 'moduo', 'Held · ' || o.title, '', v_start,
              v_start + make_interval(mins => o.duration_minutes), false, false, 'confirmed', 'hold', o.id)
      RETURNING id INTO v_hold;
      v_holds := v_holds || v_hold;
    END IF;
    INSERT INTO public.slot_offer_times (offer_id, start_at, end_at, hold_event_id)
    VALUES (o.id, v_start, v_start + make_interval(mins => o.duration_minutes), v_hold);
  END LOOP;

  PERFORM public.module_activity_log(p_workspace_id, 'calendar', 'offer', o.id, 'calendar.offer_create',
    jsonb_build_object('title', o.title,
      'times', (SELECT count(DISTINCT s) FROM unnest(p_starts_at) s), 'hold', o.hold));
  RETURN jsonb_build_object('id', o.id, 'slug', o.slug, 'status', o.status,
                            'expires_at', o.expires_at, 'hold_event_ids', to_jsonb(v_holds));
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_op_offer_release(p_workspace_id uuid, p_offer_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.slot_offers;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO o FROM public.slot_offers
   WHERE id = p_offer_id AND workspace_id = p_workspace_id AND owner_id = public.perm_actor_id()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found.'; END IF;
  IF o.status <> 'open' THEN RETURN o.status; END IF;
  UPDATE public.slot_offers SET status = 'released', updated_at = now() WHERE id = o.id;
  PERFORM public.module_activity_log(p_workspace_id, 'calendar', 'offer', o.id, 'calendar.offer_release',
    jsonb_build_object('title', o.title));
  RETURN 'released';
END;
$$;

-- The guest's pick (booking-public, service role): book one time, release the rest.
CREATE OR REPLACE FUNCTION public.booking_op_offer_book(
  p_offer_id uuid,
  p_start_at timestamptz,
  p_description text,
  p_location text,
  p_attendee_name text,
  p_attendee_email text,
  p_host_email text,
  p_source_account_id uuid DEFAULT NULL,
  p_external_event_id text DEFAULT NULL,
  p_calendar_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.slot_offers;
  t public.slot_offer_times;
  v jsonb;
BEGIN
  SELECT * INTO o FROM public.slot_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'open' THEN RAISE EXCEPTION 'offer_closed'; END IF;
  IF o.expires_at <= now() THEN RAISE EXCEPTION 'offer_expired'; END IF;
  SELECT * INTO t FROM public.slot_offer_times
   WHERE offer_id = o.id AND start_at = date_trunc('second', p_start_at);
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_time_unknown'; END IF;

  v := public.booking_op_commit(o.workspace_id, o.owner_id, o.title, p_description, t.start_at, t.end_at,
    p_location, p_attendee_name, p_attendee_email, p_host_email, p_source_account_id,
    p_external_event_id, p_calendar_id);
  UPDATE public.slot_offers SET status = 'booked', booked_event_id = (v->>'event_id')::uuid, updated_at = now()
   WHERE id = o.id;
  RETURN v || jsonb_build_object('offer_id', o.id);
END;
$$;

-- 48 hours: open offers past their time expire (pg_cron, every 15 minutes).
CREATE OR REPLACE FUNCTION public.slot_offers_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.slot_offers SET status = 'expired', updated_at = now()
   WHERE status = 'open' AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.slot_offers__release_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exposed_slot_links__release_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exposed_slot_links__release_offers() TO service_role;
GRANT EXECUTE ON FUNCTION public.slot_offers__release_holds() TO service_role;
REVOKE ALL ON FUNCTION public.calendar_op_offer_create(uuid, uuid, timestamptz[], boolean, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_offer_create(uuid, uuid, timestamptz[], boolean, text, integer, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.calendar_op_offer_release(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_offer_release(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_op_offer_book(uuid, timestamptz, text, text, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_offer_book(uuid, timestamptz, text, text, text, text, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.slot_offers_expire() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slot_offers_expire() TO service_role;

SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'slot-offers-expire';
SELECT cron.schedule('slot-offers-expire', '*/15 * * * *', $job$SELECT public.slot_offers_expire()$job$);

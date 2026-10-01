-- Booking links (Calendly-style). Extends the legacy exposed_slot_links /
-- slot_bookings tables (they survived CLEAN-1 with no app consumer) and adds
-- the commit/release ops the public edge function calls as service_role.
-- Guests never write these tables directly.

-- ── tables (fresh installs) + columns (existing prod rows) ──────────────────

CREATE TABLE IF NOT EXISTS public.exposed_slot_links (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                 text NOT NULL,
  slug                    text NOT NULL,
  link_name               text NOT NULL DEFAULT '',
  name                    text NOT NULL DEFAULT '',
  description             text NOT NULL DEFAULT '',
  duration_minutes        integer NOT NULL DEFAULT 30,
  buffer_before_minutes   integer NOT NULL DEFAULT 0,
  buffer_after_minutes    integer NOT NULL DEFAULT 0,
  date_range_days         integer NOT NULL DEFAULT 14,
  location_type           text NOT NULL DEFAULT 'video',
  video_provider          text,
  questions_json          jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_type           text NOT NULL DEFAULT 'weekly',
  conflict_calendars      text NOT NULL DEFAULT '[]',
  owner_user_id           uuid NOT NULL,
  owner_handle            text NOT NULL DEFAULT '',
  owner_email             text,
  owner_display_name      text,
  owner_avatar_url        text,
  workspace_id            uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.slot_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id           text NOT NULL,
  slot_slug         text NOT NULL DEFAULT '',
  start_at          timestamptz NOT NULL,
  end_at            timestamptz NOT NULL,
  timezone          text NOT NULL DEFAULT 'UTC',
  attendee_name     text NOT NULL DEFAULT '',
  attendee_email    text NOT NULL DEFAULT '',
  attendee_notes    text,
  status            text NOT NULL DEFAULT 'confirmed',
  meeting_id        text,
  meeting_link      text,
  calendar_synced   boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.exposed_slot_links
  ADD COLUMN IF NOT EXISTS weekly_hours jsonb NOT NULL DEFAULT '{
    "sun": [],
    "mon": [{"start":"09:00","end":"17:00"}],
    "tue": [{"start":"09:00","end":"17:00"}],
    "wed": [{"start":"09:00","end":"17:00"}],
    "thu": [{"start":"09:00","end":"17:00"}],
    "fri": [{"start":"09:00","end":"17:00"}],
    "sat": []
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS min_notice_minutes integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS busy_calendar_ids jsonb NOT NULL DEFAULT '["moduo"]'::jsonb,
  ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS host_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS note_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.slot_bookings
  ADD COLUMN IF NOT EXISTS calendar_event_id uuid,
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS answers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cancel_token text;

CREATE UNIQUE INDEX IF NOT EXISTS exposed_slot_links_slug_key
  ON public.exposed_slot_links (slug);
CREATE INDEX IF NOT EXISTS exposed_slot_links_owner_idx
  ON public.exposed_slot_links (owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS slot_bookings_active_start
  ON public.slot_bookings (slot_id, start_at)
  WHERE status IN ('pending', 'confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS slot_bookings_cancel_token
  ON public.slot_bookings (cancel_token)
  WHERE cancel_token IS NOT NULL;

-- ── RLS: the host manages links; bookings are written only by the edge fn ──

ALTER TABLE public.exposed_slot_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_bookings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('exposed_slot_links', 'slot_bookings')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Legacy columns are text (pre-uuid). Compare as text; cast the workspace
-- id only when calling the uuid-typed membership helper.
CREATE POLICY exposed_slot_links_host ON public.exposed_slot_links
  FOR ALL
  USING (owner_user_id = auth.uid()::text)
  WITH CHECK (
    owner_user_id = auth.uid()::text
    AND (
      workspace_id IS NULL
      OR public.tasks_module_can_access_workspace(workspace_id::uuid)
    )
  );

CREATE POLICY slot_bookings_host_read ON public.slot_bookings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exposed_slot_links l
      WHERE l.slot_id = slot_bookings.slot_id
        AND l.owner_user_id = auth.uid()::text
    )
  );

REVOKE ALL ON public.exposed_slot_links FROM PUBLIC, anon;
REVOKE ALL ON public.slot_bookings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exposed_slot_links TO authenticated;
GRANT SELECT ON public.slot_bookings TO authenticated;
GRANT ALL ON public.exposed_slot_links TO service_role;
GRANT ALL ON public.slot_bookings TO service_role;

-- ── host: is a Google refresh token stored for booking? ────────────────────

CREATE OR REPLACE FUNCTION public.booking_google_connected()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_integrations
    WHERE user_id = auth.uid()::text
      AND provider = 'google_calendar'
      AND refresh_token_enc IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.booking_google_connected() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_google_connected() TO authenticated, service_role;

-- ── service_role: materialize the Moduo event + contact + link ─────────────

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
  p_host_email text
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

  INSERT INTO public.calendar_events
    (workspace_id, owner_id, calendar_id, title, description, location,
     start_time, end_time, all_day, recurring, status, attendees)
  VALUES (
    p_workspace_id, p_owner_id, 'moduo', btrim(p_title), coalesce(p_description, ''),
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
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_commit(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text
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
BEGIN
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
     '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.booking_op_release(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_op_release(uuid, uuid, uuid) TO service_role;

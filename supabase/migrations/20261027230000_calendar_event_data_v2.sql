-- CALR-6: event data v2 (specs/calendar-rethink.md §Assumptions "Data model", AC41).
--
-- calendar_events gains privacy, a meeting link (conference_url + conference_provider),
-- a kind (event, focus, hold), a focus task, an offer and the repeat-exception columns.
-- calendar_op_event_create and calendar_op_event_update take place, people, link,
-- privacy, kind, focus task and calendar (custom calendars included, AC41), and
-- meeting URLs move out of location on every write and in the backfill.
--
-- Reading order, top to bottom:
--   1. columns, CHECKs, indexes
--   2. one helper per rule (each create, update, the mirror and the triggers share them)
--   3. the triggers (meeting URL out of location; calendar_ref checked on insert)
--   4. the backfill
--   5. the ops, re-cut from their live bodies
-- Tests: supabase/tests/calendar_event_data_v2.test.sql,
--        supabase/tests/calendar_custom_calendar_events.test.sql.

SET LOCAL lock_timeout = '5s';

-- ── 1. Columns, CHECKs, indexes ─────────────────────────────────────────────────

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conference_url text,
  ADD COLUMN IF NOT EXISTS conference_provider text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS focus_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  -- The slot offer a hold came from. No foreign key yet: slot_offers arrives in CALR-19,
  -- which adds the reference.
  ADD COLUMN IF NOT EXISTS offer_id uuid,
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS original_start timestamptz,
  ADD COLUMN IF NOT EXISTS exdates timestamptz[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS external_series_id text;

-- The IN-lists mirror CONFERENCE_PROVIDERS and CALENDAR_ITEM_KINDS in
-- supabase/functions/_shared/contracts/vocabularies.ts (drift-gates.test.ts reads this text).
ALTER TABLE public.calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_conference_provider_check,
  DROP CONSTRAINT IF EXISTS calendar_events_kind_check,
  DROP CONSTRAINT IF EXISTS calendar_events_conference_url_check,
  DROP CONSTRAINT IF EXISTS calendar_events_conference_pair_check,
  DROP CONSTRAINT IF EXISTS calendar_events_focus_task_check,
  DROP CONSTRAINT IF EXISTS calendar_events_series_check;

ALTER TABLE public.calendar_events
  ADD CONSTRAINT calendar_events_conference_provider_check
    CHECK (conference_provider IN ('google_meet','zoom','teams','other')),
  ADD CONSTRAINT calendar_events_kind_check
    CHECK (kind IN ('event','focus','hold')),
  -- A meeting link is a web address (never javascript:, mailto:, ftp:).
  ADD CONSTRAINT calendar_events_conference_url_check
    CHECK (conference_url IS NULL OR conference_url ~* '^https?://[^[:space:]]+$'),
  -- A provider exactly when there is a link.
  ADD CONSTRAINT calendar_events_conference_pair_check
    CHECK ((conference_url IS NULL) = (conference_provider IS NULL)),
  ADD CONSTRAINT calendar_events_focus_task_check
    CHECK (focus_task_id IS NULL OR kind = 'focus'),
  -- An exception row points at its series, never at itself.
  ADD CONSTRAINT calendar_events_series_check
    CHECK (series_id IS NULL OR series_id <> id);

-- Task deletes (ON DELETE SET NULL) and series lookups use these instead of a scan.
CREATE INDEX IF NOT EXISTS calendar_events_focus_task_idx
  ON public.calendar_events (focus_task_id) WHERE focus_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_series_idx
  ON public.calendar_events (series_id) WHERE series_id IS NOT NULL;

-- ── 2. Helpers: one rule each ───────────────────────────────────────────────────

-- The trimmed text when it is a web address, else NULL. The same test as the
-- calendar_events_conference_url_check CHECK.
CREATE OR REPLACE FUNCTION public.calendar__web_address(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN btrim(p_text) ~* '^https?://[^[:space:]]+$' THEN btrim(p_text) END
$$;

-- Who hosts a meeting link, read from its host: google_meet, zoom, teams, or other
-- for any other web address. NULL for no link.
CREATE OR REPLACE FUNCTION public.calendar__meeting_provider(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_host text;
BEGIN
  IF p_url IS NULL THEN
    RETURN NULL;
  END IF;
  v_host := lower(substring(p_url FROM '(?i)^https?://([^/?#:]+)'));
  IF v_host = 'meet.google.com' THEN
    RETURN 'google_meet';
  ELSIF v_host = 'zoom.us' OR v_host LIKE '%.zoom.us' THEN
    RETURN 'zoom';
  ELSIF v_host IN ('teams.microsoft.com', 'teams.live.com') THEN
    RETURN 'teams';
  END IF;
  RETURN 'other';
END;
$$;

-- Split a location into its place and a known meeting URL in it (the hosts of
-- KNOWN in apps/app/src/features/calendar/meeting-link.ts). A URL that is no
-- meeting (a map link) stays part of the place. No meeting URL: place is the
-- location as it was, url and provider are NULL.
CREATE OR REPLACE FUNCTION public.calendar__split_location(
  p_location text, OUT place text, OUT url text, OUT provider text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_found text;
BEGIN
  place := p_location;
  v_found := substring(p_location FROM
    '(?i)https://(?:meet\.google\.com|[a-z0-9_-]+\.zoom\.us|zoom\.us|teams\.microsoft\.com|teams\.live\.com)/[^[:space:]<>"'')]+');
  IF v_found IS NULL THEN
    RETURN;
  END IF;
  -- Sentence punctuation after a URL is not part of it.
  url := regexp_replace(v_found, '[.,;:!?]+$', '');
  provider := public.calendar__meeting_provider(url);
  -- The place is what is left, without the spaces and separators around the URL.
  place := NULLIF(btrim(replace(p_location, v_found, ''), E' \t\r\n,;·|-'), '');
END;
$$;

-- A meeting link given by a person (create, update): trimmed; none when empty (and
-- then no provider either); refused when it is no web address or names an unknown
-- provider; the provider is read from the link when none is given.
CREATE OR REPLACE FUNCTION public.calendar__conference(
  p_url text, p_provider text, OUT url text, OUT provider text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  url := NULLIF(btrim(p_url), '');
  IF url IS NULL THEN
    provider := NULL;
    RETURN;
  END IF;
  IF public.calendar__web_address(url) IS NULL THEN
    RAISE EXCEPTION 'A meeting link must be a web address (https://…).';
  END IF;
  provider := NULLIF(btrim(p_provider), '');
  IF provider IS NULL THEN
    provider := public.calendar__meeting_provider(url);
  ELSIF provider NOT IN ('google_meet', 'zoom', 'teams', 'other') THEN
    RAISE EXCEPTION 'Unknown meeting link provider "%".', provider;
  END IF;
END;
$$;

-- The people on an event (create, update): a JSON list of objects, each with an
-- email. Each becomes {email (trimmed, lower-case), name (trimmed or ""), status
-- (as given or "needsAction")}; the first row for an email wins, order kept.
CREATE OR REPLACE FUNCTION public.calendar__attendees(p_attendees jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_person jsonb;
  v_email text;
  v_name text;
  v_status text;
  v_seen text[] := '{}';
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_attendees IS NULL OR jsonb_typeof(p_attendees) = 'null' THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_attendees) <> 'array' THEN
    RAISE EXCEPTION 'People must be a list, each with an email address.';
  END IF;
  FOR v_person IN
    SELECT a.value FROM jsonb_array_elements(p_attendees) WITH ORDINALITY AS a(value, n) ORDER BY a.n
  LOOP
    IF jsonb_typeof(v_person) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_person->'email') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Each person needs an email address.';
    END IF;
    v_email := lower(btrim(v_person->>'email'));
    IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION '"%" is not an email address.', v_email;
    END IF;
    CONTINUE WHEN v_email = ANY (v_seen);
    v_seen := v_seen || v_email;
    v_name := '';
    IF jsonb_typeof(v_person->'name') = 'string' THEN
      v_name := btrim(v_person->>'name');
    END IF;
    v_status := 'needsAction';
    IF jsonb_typeof(v_person->'status') = 'string' AND btrim(v_person->>'status') <> '' THEN
      v_status := v_person->>'status';
    END IF;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object('email', v_email, 'name', v_name, 'status', v_status));
  END LOOP;
  RETURN v_out;
END;
$$;

-- An event's kind (create, update): NULL is a plain event; holds come only from
-- offers (CALR-19), never by hand.
CREATE OR REPLACE FUNCTION public.calendar__kind(p_kind text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_kind text := coalesce(p_kind, 'event');
BEGIN
  IF v_kind NOT IN ('event', 'focus', 'hold') THEN
    RAISE EXCEPTION 'Unknown event kind "%".', v_kind;
  END IF;
  IF v_kind = 'hold' THEN
    RAISE EXCEPTION 'Held times come from an offer.';
  END IF;
  RETURN v_kind;
END;
$$;

-- The calendar an event goes on (create, update, and the insert trigger for direct
-- writes): in this workspace and not deleted, a Moduo or custom calendar (a connected
-- account's calendar saves through its account), and editable by the actor.
CREATE OR REPLACE FUNCTION public.calendar_op__guard_calendar(p_workspace_id uuid, p_calendar_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
BEGIN
  SELECT c.kind INTO v_kind
    FROM public.calendars c
   WHERE c.id = p_calendar_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar not found in this workspace.';
  END IF;
  IF v_kind NOT IN ('moduo', 'custom') THEN
    RAISE EXCEPTION 'Events on a connected calendar are saved through its account.';
  END IF;
  -- No actor (the booking functions, service role): the workspace check above is the rule.
  IF public.perm_actor_id() IS NOT NULL
     AND NOT public.can_access('calendar', p_calendar_id, 'edit') THEN
    RAISE EXCEPTION 'You can''t add events to this calendar.' USING ERRCODE = '42501';
  END IF;
  RETURN p_calendar_id;
END;
$$;

-- The task focus time is for (create, update): none is fine; a task needs kind
-- focus; the task is in this workspace, not deleted, and visible to the actor.
CREATE OR REPLACE FUNCTION public.calendar_op__guard_focus_task(
  p_workspace_id uuid, p_kind text, p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_task_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_kind IS DISTINCT FROM 'focus' THEN
    RAISE EXCEPTION 'Only focus time can hold a task.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tasks t
                  WHERE t.id = p_task_id AND t.workspace_id = p_workspace_id AND t.deleted_at IS NULL)
     OR NOT public.can_access('task', p_task_id, 'view') THEN
    RAISE EXCEPTION 'Task not found in this workspace.';
  END IF;
  RETURN p_task_id;
END;
$$;

-- ── 3. Triggers ─────────────────────────────────────────────────────────────────

-- A meeting URL never stays in location: any write that puts one there (the
-- booking path's booking_op_commit, older mirror clients) moves it to
-- conference_url, unless the row already names a link. The provider is read from
-- the link when none is set. A provider without a link is left for the
-- calendar_events_conference_pair_check CHECK to refuse.
CREATE OR REPLACE FUNCTION public.calendar_events__meeting_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
BEGIN
  IF NEW.location IS NOT NULL THEN
    SELECT * INTO s FROM public.calendar__split_location(NEW.location);
    IF s.url IS NOT NULL THEN
      NEW.location := s.place;
      NEW.conference_url := coalesce(NEW.conference_url, s.url);
    END IF;
  END IF;
  IF NEW.conference_url IS NOT NULL AND NEW.conference_provider IS NULL THEN
    NEW.conference_provider := public.calendar__meeting_provider(NEW.conference_url);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_events_meeting_link ON public.calendar_events;
CREATE TRIGGER calendar_events_meeting_link
  BEFORE INSERT OR UPDATE OF location, conference_url, conference_provider ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.calendar_events__meeting_link();

-- Re-cut from the live body: no calendar named keeps the default (the account's
-- calendar for a mirrored row, the owner's Moduo calendar otherwise); a native row
-- that names one goes through calendar_op__guard_calendar.
CREATE OR REPLACE FUNCTION public.share_event_calendar_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.calendar_ref IS NULL AND NEW.workspace_id IS NOT NULL THEN
    IF NEW.source_account_id IS NOT NULL THEN
      NEW.calendar_ref := public.share_ensure_account_calendar(NEW.source_account_id);
    ELSE
      NEW.calendar_ref := public.share_ensure_moduo_calendar(NEW.workspace_id, NEW.owner_id);
    END IF;
  ELSIF NEW.calendar_ref IS NOT NULL AND NEW.source_account_id IS NULL THEN
    PERFORM public.calendar_op__guard_calendar(NEW.workspace_id, NEW.calendar_ref);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Backfill: meeting URLs already in location move to the link ──────────────
-- Not an edit: triggers off, so updated_at, notices and Realtime stay quiet.

ALTER TABLE public.calendar_events DISABLE TRIGGER USER;

WITH split AS (
  SELECT ce.id, s.place, s.url, s.provider
    FROM public.calendar_events ce
   CROSS JOIN LATERAL public.calendar__split_location(ce.location) s
   WHERE ce.location IS NOT NULL AND s.url IS NOT NULL
)
UPDATE public.calendar_events ce
   SET location = split.place,
       conference_url = split.url,
       conference_provider = split.provider
  FROM split
 WHERE ce.id = split.id;

ALTER TABLE public.calendar_events ENABLE TRIGGER USER;

-- ── 5. Ops ──────────────────────────────────────────────────────────────────────

-- Create: the old seven parameters, then the new fields. DROP first, so there is one
-- signature (a defaulted trailing argument would shadow the old one).
DROP FUNCTION IF EXISTS public.calendar_op_event_create(uuid, text, timestamptz, timestamptz, boolean, text, text);

CREATE OR REPLACE FUNCTION public.calendar_op_event_create(
  p_workspace_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean DEFAULT false,
  p_rrule text DEFAULT NULL,
  p_description text DEFAULT '',
  p_calendar_id uuid DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_attendees jsonb DEFAULT '[]',
  p_conference_url text DEFAULT NULL,
  p_conference_provider text DEFAULT NULL,
  p_is_private boolean DEFAULT false,
  p_kind text DEFAULT 'event',
  p_focus_task_id uuid DEFAULT NULL)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
  v_calendar uuid;
  v_attendees jsonb;
  v_url text;
  v_provider text;
  v_kind text;
  v_task uuid;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  IF btrim(coalesce(p_title, '')) = '' THEN
    RAISE EXCEPTION 'An event needs a title.';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'An event needs a valid time range.';
  END IF;

  -- Each field through its one helper (calendar_op_event_update uses the same ones).
  -- No calendar named: NULL, and the insert trigger puts it on your Moduo calendar.
  IF p_calendar_id IS NOT NULL THEN
    v_calendar := public.calendar_op__guard_calendar(p_workspace_id, p_calendar_id);
  END IF;
  v_attendees := public.calendar__attendees(p_attendees);
  SELECT c.url, c.provider INTO v_url, v_provider
    FROM public.calendar__conference(p_conference_url, p_conference_provider) c;
  v_kind := public.calendar__kind(p_kind);
  v_task := public.calendar_op__guard_focus_task(p_workspace_id, v_kind, p_focus_task_id);

  -- One write. A meeting URL in the location moves to the link (calendar_events_meeting_link).
  INSERT INTO public.calendar_events
    (workspace_id, owner_id, calendar_id, calendar_ref, title, description, location,
     start_time, end_time, all_day, recurring, recurrence_rule, status,
     attendees, conference_url, conference_provider, is_private, kind, focus_task_id)
  VALUES
    (p_workspace_id, public.perm_actor_id(), 'moduo', v_calendar, btrim(p_title),
     coalesce(p_description, ''), NULLIF(btrim(p_location), ''),
     p_starts_at, p_ends_at, coalesce(p_all_day, false),
     p_rrule IS NOT NULL AND p_rrule <> '', NULLIF(p_rrule, ''), 'confirmed',
     v_attendees, v_url, v_provider, coalesce(p_is_private, false), v_kind, v_task)
  RETURNING * INTO e;

  PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_create',
    jsonb_build_object('title', e.title, 'startsAt', e.start_time, 'allDay', e.all_day,
                       'recurring', e.recurring, 'calendar', e.calendar_ref,
                       'kind', e.kind, 'private', e.is_private)
  );
  RETURN e;
END;
$$;

-- Update: only present keys change. The new fields are worked out first, as the row
-- will be after the patch, through the same helpers as create; then one UPDATE.
-- Mirrored rows stay read-only here (calendar_op__guard_event(…, true); two-way
-- edits are CALR-8).
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
BEGIN
  e := public.calendar_op__guard_event(p_workspace_id, p_event_id, true);

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
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_update',
    jsonb_build_object('keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_patch) AS k))
  );
  RETURN e;
END;
$$;

-- Mirror: re-cut from the live body. New: the conferenceUrl key. Present = the
-- provider's truth (no web address is dropped to NULL, so the row still mirrors;
-- JSON null clears link and provider); absent keeps what is stored. Location keeps
-- its rule; calendar_events_meeting_link moves a meeting URL out of it.
CREATE OR REPLACE FUNCTION public.calendar_op_mirror_events(
  p_workspace_id uuid, p_account_id uuid, p_events jsonb, p_deleted_external_ids text[] DEFAULT '{}'::text[])
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
  v_link text;
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
          location = CASE WHEN r ? 'location' THEN NULLIF(r->>'location', '')
                          ELSE ce.location END,
          -- Key PRESENT = the provider's meeting link now; ABSENT keeps it.
          conference_url = CASE WHEN r ? 'conferenceUrl' THEN v_link
                                ELSE ce.conference_url END,
          conference_provider = CASE WHEN r ? 'conferenceUrl'
                                     THEN public.calendar__meeting_provider(v_link)
                                     ELSE ce.conference_provider END,
          updated_at = now()
        WHERE ce.source_account_id = a.id AND ce.external_event_id = v_ext
          AND ce.deleted_at IS NULL
        RETURNING ce.* INTO e;
        IF e.id IS NULL THEN
          INSERT INTO public.calendar_events
            (workspace_id, owner_id, source_account_id, external_event_id, calendar_id,
             title, description, location, start_time, end_time, all_day, recurring,
             recurrence_rule, status, conference_url, conference_provider)
          VALUES
            (p_workspace_id, a.owner_id, a.id, v_ext,
             coalesce(NULLIF(r->>'calendarId', ''), a.provider),
             coalesce(r->>'title', ''), coalesce(r->>'description', ''),
             NULLIF(r->>'location', ''),
             (r->>'startsAt')::timestamptz, (r->>'endsAt')::timestamptz,
             coalesce((r->>'allDay')::boolean, false),
             coalesce(r->>'rrule', '') <> '', NULLIF(r->>'rrule', ''),
             coalesce(NULLIF(r->>'status', ''), 'confirmed'),
             v_link, public.calendar__meeting_provider(v_link))
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

-- ── Grants ──────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal: helpers, guards and trigger functions run only inside definer code.
  FOREACH fn IN ARRAY ARRAY[
    'calendar__web_address(text)',
    'calendar__meeting_provider(text)',
    'calendar__split_location(text)',
    'calendar__conference(text,text)',
    'calendar__attendees(jsonb)',
    'calendar__kind(text)',
    'calendar_op__guard_calendar(uuid,uuid)',
    'calendar_op__guard_focus_task(uuid,text,uuid)',
    'calendar_events__meeting_link()',
    'share_event_calendar_ref()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;

  -- App RPCs: signed-in people and the service role, never anon.
  FOREACH fn IN ARRAY ARRAY[
    'calendar_op_event_create(uuid,text,timestamptz,timestamptz,boolean,text,text,uuid,text,jsonb,text,text,boolean,text,uuid)',
    'calendar_op_event_update(uuid,uuid,jsonb)',
    'calendar_op_mirror_events(uuid,uuid,jsonb,text[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

-- Calendar module (Wave 2, CAL-2) — native events end-to-end.
-- specs/calendar.md assumption 3: one migration — calendar_accounts +
-- calendar_events (+ ops incl. the batched mirror op), RLS = member SELECT,
-- writes op-only, permission lane = the Tasks lane (the CT-1/CO-1 call).
--
-- NOTE: a LEGACY public.calendar_events table already exists in prod (the
-- pre-Wave-2 exploratory calendar wrote to it owner-scoped, straight from the
-- client). This migration EXTENDS it in place (new columns for the mirror +
-- attribution), then replaces its RLS with the module posture: workspace-
-- member SELECT, mutations only via SECURITY DEFINER ops. Legacy rows with
-- workspace_id IS NULL become invisible (throwaway exploratory data — the
-- legacy localStorage store is retired by the same block).

-- ── permission helper (Tasks lane; legacy read/write vocabulary normalized) ──

CREATE OR REPLACE FUNCTION public.calendar_module_permission(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = auth.uid() AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(m.permissions_tasks, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      LIMIT 1
    ), 'none')
  END;
$$;

REVOKE ALL ON FUNCTION public.calendar_module_permission(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calendar_module_permission(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.calendar_module_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_module_permission(uuid) TO service_role;

-- ── calendar_accounts (new) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calendar_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  owner_id          uuid DEFAULT auth.uid(),
  provider          text NOT NULL,                 -- 'google' | 'microsoft' | 'caldav' | 'moduo'
  external_id       text NOT NULL DEFAULT '',      -- provider account id
  display_label     text NOT NULL DEFAULT '',      -- "Personal — me@gmail.com"
  is_default_target boolean NOT NULL DEFAULT false, -- v2 write-back seat
  color             text,                          -- raw hex lives ONLY here (R1 posture)
  sync_token        text,
  last_sync_at      timestamptz,
  status            text NOT NULL DEFAULT 'ok',    -- 'ok' | 'error'
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS calendar_accounts_workspace_id_idx
  ON public.calendar_accounts (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_accounts_provider_key
  ON public.calendar_accounts (workspace_id, provider, external_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.calendar_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_accounts_workspace_read ON public.calendar_accounts;
CREATE POLICY calendar_accounts_workspace_read ON public.calendar_accounts
  FOR SELECT
  USING (public.tasks_module_can_access_workspace(workspace_id));
-- No INSERT/UPDATE/DELETE policies — ops bypass via SECURITY DEFINER.

-- ── calendar_events (extend the legacy table in place) ──────────────────────

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES public.calendar_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_event_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed';

-- Sane defaults so the ops can insert narrow rows into the wide legacy shape.
ALTER TABLE public.calendar_events
  ALTER COLUMN calendar_id SET DEFAULT 'moduo',
  ALTER COLUMN all_day SET DEFAULT false,
  ALTER COLUMN recurring SET DEFAULT false,
  ALTER COLUMN attendees SET DEFAULT '[]'::jsonb,
  ALTER COLUMN reminders SET DEFAULT '[]'::jsonb,
  ALTER COLUMN tags SET DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS calendar_events_workspace_start_idx
  ON public.calendar_events (workspace_id, start_time);
CREATE INDEX IF NOT EXISTS calendar_events_source_account_idx
  ON public.calendar_events (source_account_id);
-- Mirror idempotency: one live row per (account, provider event id).
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_external_key
  ON public.calendar_events (source_account_id, external_event_id)
  WHERE external_event_id IS NOT NULL AND deleted_at IS NULL;

-- Replace ALL legacy policies (created pre-migrations, names unknown) with the
-- module posture. The legacy client-direct upsert path dies here by design.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'calendar_events'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.calendar_events', pol.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_events_workspace_read ON public.calendar_events
  FOR SELECT
  USING (
    workspace_id IS NOT NULL
    AND public.tasks_module_can_access_workspace(workspace_id)
  );

-- ── op guards ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op__guard(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.calendar_module_permission(p_workspace_id) NOT IN ('edit', 'admin') THEN
    RAISE EXCEPTION 'You don''t have edit access to Calendar in this workspace.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_op__guard(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calendar_op__guard(uuid) FROM authenticated;

-- Permission + row lock + native-only check where the caller demands it.
CREATE OR REPLACE FUNCTION public.calendar_op__guard_event(
  p_workspace_id uuid,
  p_event_id uuid,
  p_native_only boolean DEFAULT true
)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO e FROM public.calendar_events
    WHERE id = p_event_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found in this workspace.';
  END IF;
  -- External (mirrored) events are structurally read-only in v1: no edit op
  -- accepts them, so no outward write path exists (DESIGN_BRIEF §8).
  IF p_native_only AND e.source_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'This event is managed in its source calendar and is read-only here.';
  END IF;
  RETURN e;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_op__guard_event(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calendar_op__guard_event(uuid, uuid, boolean) FROM authenticated;

-- ── intent ops: native events ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calendar_op_event_create(
  p_workspace_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean DEFAULT false,
  p_rrule text DEFAULT NULL,
  p_description text DEFAULT ''
)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  IF btrim(coalesce(p_title, '')) = '' THEN
    RAISE EXCEPTION 'An event needs a title.';  -- empty draw discards client-side too
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'An event needs a valid time range.';
  END IF;
  INSERT INTO public.calendar_events
    (workspace_id, owner_id, calendar_id, title, description,
     start_time, end_time, all_day, recurring, recurrence_rule, status)
  VALUES
    (p_workspace_id, auth.uid(), 'moduo', btrim(p_title), coalesce(p_description, ''),
     p_starts_at, p_ends_at, coalesce(p_all_day, false),
     p_rrule IS NOT NULL AND p_rrule <> '', NULLIF(p_rrule, ''), 'confirmed')
  RETURNING * INTO e;
  PERFORM public.entities_op_upsert(p_workspace_id, 'event', e.id, e.title, 'calendar');
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_create',
    jsonb_build_object('title', e.title, 'startsAt', e.start_time, 'allDay', e.all_day,
                       'recurring', e.recurring)
  );
  RETURN e;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_op_event_update(
  p_workspace_id uuid,
  p_event_id uuid,
  p_patch jsonb
)
RETURNS public.calendar_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
BEGIN
  e := public.calendar_op__guard_event(p_workspace_id, p_event_id, true);
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

CREATE OR REPLACE FUNCTION public.calendar_op_event_delete(
  p_workspace_id uuid,
  p_event_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.calendar_events;
BEGIN
  e := public.calendar_op__guard_event(p_workspace_id, p_event_id, true);
  UPDATE public.calendar_events
    SET deleted_at = now(), updated_at = now()
    WHERE id = e.id;
  PERFORM public.entities_op_tombstone(p_workspace_id, 'event', e.id);
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'event', e.id, 'calendar.event_delete',
    jsonb_build_object('title', e.title, 'recurring', e.recurring)
  );
END;
$$;

-- ── intent ops: accounts + the mirror (CAL-6's write surface, shipped now) ──

CREATE OR REPLACE FUNCTION public.calendar_op_account_upsert(
  p_workspace_id uuid,
  p_provider text,
  p_external_id text,
  p_display_label text,
  p_color text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_last_sync_at timestamptz DEFAULT NULL
)
RETURNS public.calendar_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.calendar_accounts;
  v_inserted boolean;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  -- Atomic vs the partial unique index (a double-clicked Connect / two
  -- devices must not surface a raw 23505): serialize concurrent connects for
  -- the same identity, then re-check under the lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('calendar_account:' || p_workspace_id::text || ':' || p_provider
                     || ':' || coalesce(p_external_id, ''), 0)
  );
  SELECT * INTO a FROM public.calendar_accounts
    WHERE workspace_id = p_workspace_id AND provider = p_provider
      AND external_id = coalesce(p_external_id, '') AND deleted_at IS NULL
    FOR UPDATE;
  v_inserted := NOT FOUND;
  IF v_inserted THEN
    INSERT INTO public.calendar_accounts
      (workspace_id, owner_id, provider, external_id, display_label, color, status, last_sync_at)
    VALUES
      (p_workspace_id, auth.uid(), p_provider, coalesce(p_external_id, ''),
       coalesce(p_display_label, ''), p_color, coalesce(p_status, 'ok'), p_last_sync_at)
    RETURNING * INTO a;
    PERFORM public.module_activity_log(
      p_workspace_id, 'calendar', 'calendar_account', a.id, 'calendar.account_connect',
      jsonb_build_object('provider', a.provider, 'label', a.display_label)
    );
  ELSE
    UPDATE public.calendar_accounts SET
      display_label = coalesce(NULLIF(p_display_label, ''), display_label),
      color = coalesce(p_color, color),
      status = coalesce(p_status, status),
      last_sync_at = coalesce(p_last_sync_at, last_sync_at),
      updated_at = now()
    WHERE id = a.id
    RETURNING * INTO a;
  END IF;
  RETURN a;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_op_account_remove(
  p_workspace_id uuid,
  p_account_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.calendar_accounts;
  v_event record;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO a FROM public.calendar_accounts
    WHERE id = p_account_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar account not found in this workspace.';
  END IF;
  -- Tombstone its mirrored events + their registry entries (spine links
  -- degrade to tombstoned targets, the recorded cascade posture).
  FOR v_event IN
    SELECT id FROM public.calendar_events
    WHERE source_account_id = a.id AND deleted_at IS NULL
  LOOP
    UPDATE public.calendar_events
      SET deleted_at = now(), updated_at = now()
      WHERE id = v_event.id;
    PERFORM public.entities_op_tombstone(p_workspace_id, 'event', v_event.id);
  END LOOP;
  UPDATE public.calendar_accounts
    SET deleted_at = now(), updated_at = now()
    WHERE id = a.id;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'calendar_account', a.id, 'calendar.account_remove',
    jsonb_build_object('provider', a.provider, 'label', a.display_label)
  );
END;
$$;

-- Batched idempotent mirror upsert, keyed by (source_account_id,
-- external_event_id). Owner-scoped: only the connecting user's desktop engine
-- writes the mirror. ONE activity row per sync (never one per event).
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
          updated_at = now()
        WHERE ce.source_account_id = a.id AND ce.external_event_id = v_ext
          AND ce.deleted_at IS NULL
        RETURNING ce.* INTO e;
        IF e.id IS NULL THEN
          INSERT INTO public.calendar_events
            (workspace_id, owner_id, source_account_id, external_event_id, calendar_id,
             title, description, start_time, end_time, all_day, recurring, recurrence_rule, status)
          VALUES
            (p_workspace_id, a.owner_id, a.id, v_ext,
             coalesce(NULLIF(r->>'calendarId', ''), a.provider),
             coalesce(r->>'title', ''), coalesce(r->>'description', ''),
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

-- ── grants ───────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'calendar_op_event_create(uuid, text, timestamptz, timestamptz, boolean, text, text)',
    'calendar_op_event_update(uuid, uuid, jsonb)',
    'calendar_op_event_delete(uuid, uuid)',
    'calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz)',
    'calendar_op_account_remove(uuid, uuid)',
    'calendar_op_mirror_events(uuid, uuid, jsonb, text[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END;
$$;

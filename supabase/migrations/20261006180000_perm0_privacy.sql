-- PERM-0 (specs/permissions.md): privacy fixes before collaborative plans ship.
--
-- 1) Calendar is owner-only. calendar_events + calendar_accounts were readable
--    by every workspace member (a teammate could read your synced Google
--    Calendar titles/descriptions). Now: owner reads; every op that touches an
--    event/account by id re-checks ownership. Booking availability is
--    computed by the booking-public Edge Function under service_role; that
--    function now counts only the HOST's events (it counted every member's).
--    Teammate free/busy arrives with PERM-5.
-- 2) Email refs are owner-only. email_refs (the threads pulled into the spine)
--    were workspace-readable. The per-workspace thread uniqueness becomes
--    per-owner, so two members who both received a thread each get their own
--    ref instead of the second upsert silently rewriting (and returning) the
--    first member's row.
-- 3) The spine doesn't leak them back: `entities` labels for events/email
--    threads and calendar/email `module_activity` rows follow the same owner
--    rule (search, @mention, activity feeds all read those tables).
-- 4) API keys act as their creator. A key's effective scope is
--    (key scope) ∩ (its creator's current permission); a key whose creator
--    left the workspace (or is unknown) gets nothing. Ops that stamp an owner
--    use perm_actor_id() = auth.uid() or, under a key, the key's creator.
--
-- Contacts: nothing to change yet — there is no auto-capture path (every
-- contact is a deliberate add/import); private-by-default lands with PERM-6.
--
-- Every function below that already existed is re-created from its NEWEST
-- definition (gotchas: applying an old body late regresses newer fixes):
--   *_module_permission     ← 20260612160000 (tasks), 20260702170000
--                              (calendar/contacts/spine), 20260703120000
--                              (notes), 20260704170000 (email)
--   calendar_op__guard_event, calendar_op_event_create,
--   calendar_op_account_remove ← 20260702130000
--   calendar_op_account_upsert ← 20260703130000
--   calendar_op_event_restore  ← 20260710120000
--   email_op__guard_ref, email_op_ref_upsert, email_op_link ← 20260704170000

-- ── helpers ──────────────────────────────────────────────────────────────────

-- Permission ladder rank (none < view < edit < admin).
CREATE OR REPLACE FUNCTION public.perm_rank(p_level text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_level WHEN 'admin' THEN 3 WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0 END
$$;

-- A user's module permission in a workspace, on one permission lane
-- ('tasks' | 'notes' | 'email'). Identical to the human branch every
-- *_module_permission carried inline until now.
CREATE OR REPLACE FUNCTION public.module_member_permission(
  p_workspace_id uuid,
  p_user_id uuid,
  p_lane text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 'none'
    WHEN EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = p_workspace_id AND w.owner_id = p_user_id AND w.deleted_at IS NULL
    ) THEN 'admin'
    ELSE COALESCE((
      SELECT CASE lower(coalesce(
          CASE p_lane
            WHEN 'notes' THEN m.permissions_notes
            WHEN 'email' THEN m.permissions_email
            ELSE m.permissions_tasks
          END, 'edit'))
        WHEN 'admin' THEN 'admin'
        WHEN 'edit'  THEN 'edit'
        WHEN 'write' THEN 'edit'   -- legacy vocabulary
        WHEN 'view'  THEN 'view'
        WHEN 'read'  THEN 'view'   -- legacy vocabulary
        WHEN 'none'  THEN 'none'
        ELSE 'edit'                -- unknown → the client's historical default
      END
      FROM public.workspace_members m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
      LIMIT 1
    ), 'none')
  END
$$;

-- The creator of the live API key on this request (NULL for user calls, a
-- revoked key, or a legacy key with no recorded creator).
CREATE OR REPLACE FUNCTION public.module_api_key_creator()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.created_by
  FROM public.workspace_api_keys k
  WHERE k.id = public.module_api_key_id() AND k.revoked_at IS NULL
$$;

-- Who is acting: the signed-in user, or the creator of the calling API key.
CREATE OR REPLACE FUNCTION public.perm_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(auth.uid(), public.module_api_key_creator())
$$;

-- A key's effective scope for one module: its own scope, capped by what its
-- creator can currently do on that module's lane. Admin is never key-grantable,
-- so the result is none | view | edit.
CREATE OR REPLACE FUNCTION public.module_api_key_scope(
  p_workspace_id uuid,
  p_scope_key text,
  p_lane text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key_scope text;
  v_creator   uuid;
  v_member    text;
BEGIN
  SELECT CASE lower(coalesce(k.scopes ->> p_scope_key, 'none'))
           WHEN 'edit' THEN 'edit'
           WHEN 'view' THEN 'view'
           ELSE 'none'
         END,
         k.created_by
    INTO v_key_scope, v_creator
    FROM public.workspace_api_keys k
   WHERE k.id = public.module_api_key_id()
     AND k.workspace_id = p_workspace_id
     AND k.revoked_at IS NULL;

  IF v_key_scope IS NULL OR v_creator IS NULL THEN
    RETURN 'none';
  END IF;

  v_member := public.module_member_permission(p_workspace_id, v_creator, p_lane);
  IF public.perm_rank(v_member) < public.perm_rank(v_key_scope) THEN
    RETURN CASE WHEN v_member = 'view' THEN 'view' ELSE 'none' END;
  END IF;
  RETURN v_key_scope;
END;
$$;

-- All of a key's effective scopes at once — the MCP connector reads this at
-- auth time so its direct (service-role) reads honour the same cap. Keys whose
-- creator is unknown or no longer in the workspace resolve to all-'none'.
CREATE OR REPLACE FUNCTION public.module_api_key_effective_scopes(p_key_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k        public.workspace_api_keys;
  v_out    jsonb := '{}'::jsonb;
  v_scope  record;
  v_member text;
  v_lane   text;
BEGIN
  SELECT * INTO k FROM public.workspace_api_keys WHERE id = p_key_id AND revoked_at IS NULL;
  IF k.id IS NULL THEN
    RETURN v_out;
  END IF;
  FOR v_scope IN SELECT key, lower(coalesce(value, 'none')) AS value FROM jsonb_each_text(coalesce(k.scopes, '{}'::jsonb)) LOOP
    v_lane := CASE v_scope.key WHEN 'notes' THEN 'notes' WHEN 'email' THEN 'email' ELSE 'tasks' END;
    v_member := public.module_member_permission(k.workspace_id, k.created_by, v_lane);
    v_out := v_out || jsonb_build_object(v_scope.key,
      CASE
        WHEN v_scope.value NOT IN ('view', 'edit') THEN 'none'
        WHEN public.perm_rank(v_member) >= public.perm_rank(v_scope.value) THEN v_scope.value
        WHEN v_member = 'view' THEN 'view'
        ELSE 'none'
      END);
  END LOOP;
  RETURN v_out;
END;
$$;

-- Is this private (owner-only) entity visible to the current actor? Non-private
-- entity types return true — they keep today's workspace visibility.
CREATE OR REPLACE FUNCTION public.perm_private_entity_visible(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_entity_type
    WHEN 'event' THEN EXISTS (
      SELECT 1 FROM public.calendar_events e
      WHERE e.id = p_entity_id AND e.owner_id = public.perm_actor_id())
    WHEN 'calendar_account' THEN EXISTS (
      SELECT 1 FROM public.calendar_accounts a
      WHERE a.id = p_entity_id AND a.owner_id = public.perm_actor_id())
    WHEN 'email_thread' THEN EXISTS (
      SELECT 1 FROM public.email_refs r
      WHERE r.id = p_entity_id AND r.owner_id = public.perm_actor_id())
    WHEN 'email_account' THEN EXISTS (
      SELECT 1 FROM public.email_accounts a
      WHERE a.id = p_entity_id AND a.owner_id = public.perm_actor_id())
    ELSE true
  END
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'perm_rank(text)',
    'module_member_permission(uuid, uuid, text)',
    'module_api_key_creator()',
    'perm_actor_id()',
    'module_api_key_scope(uuid, text, text)',
    'module_api_key_effective_scopes(uuid)',
    'perm_private_entity_visible(text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END;
$$;
-- Only perm_private_entity_visible (+ perm_rank) is needed by the signed-in
-- role directly; the rest are called from SECURITY DEFINER functions (which
-- run as their owner) or by the connector under service_role. Keep them away
-- from browsers — module_member_permission would otherwise answer "what is
-- user X's role in workspace Y" for anyone who knows the ids.
REVOKE EXECUTE ON FUNCTION public.module_member_permission(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.module_api_key_creator() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.perm_actor_id() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.module_api_key_scope(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.module_api_key_effective_scopes(uuid) FROM authenticated;

-- ── module permissions: key branch = creator-capped scope ────────────────────
-- CREATE OR REPLACE keeps each function's existing grants.

CREATE OR REPLACE FUNCTION public.tasks_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'tasks', 'tasks');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'tasks');
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'calendar', 'tasks');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'tasks');
END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'contacts', 'tasks');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'tasks');
END;
$$;

CREATE OR REPLACE FUNCTION public.spine_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'links', 'tasks');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'tasks');
END;
$$;

CREATE OR REPLACE FUNCTION public.notes_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'notes', 'notes');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'notes');
END;
$$;

CREATE OR REPLACE FUNCTION public.email_module_permission(p_workspace_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
BEGIN
  IF public.module_api_key_id() IS NOT NULL THEN
    RETURN public.module_api_key_scope(p_workspace_id, 'email', 'email');
  END IF;
  RETURN public.module_member_permission(p_workspace_id, auth.uid(), 'email');
END;
$$;

-- ── read policies ────────────────────────────────────────────────────────────
-- Scoped TO authenticated (anon never has a uid; and the new helpers are not
-- anon-executable — gotchas: revoke-vs-policy-role).

DROP POLICY IF EXISTS calendar_events_workspace_read ON public.calendar_events;
DROP POLICY IF EXISTS calendar_events_owner_read ON public.calendar_events;
CREATE POLICY calendar_events_owner_read ON public.calendar_events
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND owner_id = (SELECT auth.uid())
    AND public.tasks_module_can_access_workspace(workspace_id)
  );

DROP POLICY IF EXISTS calendar_accounts_workspace_read ON public.calendar_accounts;
DROP POLICY IF EXISTS calendar_accounts_owner_read ON public.calendar_accounts;
CREATE POLICY calendar_accounts_owner_read ON public.calendar_accounts
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    AND public.tasks_module_can_access_workspace(workspace_id)
  );

DROP POLICY IF EXISTS email_refs_workspace_read ON public.email_refs;
DROP POLICY IF EXISTS email_refs_owner_read ON public.email_refs;
CREATE POLICY email_refs_owner_read ON public.email_refs
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    AND public.tasks_module_can_access_workspace(workspace_id)
  );

-- Inlined EXISTS (not the definer helper) so the planner can use the PK
-- lookups, and `(select auth.uid())` is evaluated once per query — the label
-- search scans every event entity of a synced calendar.
DROP POLICY IF EXISTS entities_workspace_read ON public.entities;
CREATE POLICY entities_workspace_read ON public.entities
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND (
      entity_type NOT IN ('event', 'email_thread')
      OR (entity_type = 'event' AND EXISTS (
            SELECT 1 FROM public.calendar_events e
            WHERE e.id = entities.entity_id AND e.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'email_thread' AND EXISTS (
            SELECT 1 FROM public.email_refs r
            WHERE r.id = entities.entity_id AND r.owner_id = (SELECT auth.uid())))
    )
  );

-- Keyed on the ENTITY, not the module: comment/link activity about a private
-- event or thread (module 'comments', 'links', …) is hidden too.
DROP POLICY IF EXISTS module_activity_workspace_read ON public.module_activity;
CREATE POLICY module_activity_workspace_read ON public.module_activity
  FOR SELECT TO authenticated
  USING (
    public.tasks_module_can_access_workspace(workspace_id)
    AND (
      entity_type NOT IN ('event', 'calendar_account', 'email_thread', 'email_account')
      OR (actor_type = 'user' AND actor_id = (SELECT auth.uid()))
      OR (entity_type = 'event' AND EXISTS (
            SELECT 1 FROM public.calendar_events e
            WHERE e.id = module_activity.entity_id AND e.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'calendar_account' AND EXISTS (
            SELECT 1 FROM public.calendar_accounts a
            WHERE a.id = module_activity.entity_id AND a.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'email_thread' AND EXISTS (
            SELECT 1 FROM public.email_refs r
            WHERE r.id = module_activity.entity_id AND r.owner_id = (SELECT auth.uid())))
      OR (entity_type = 'email_account' AND EXISTS (
            SELECT 1 FROM public.email_accounts a
            WHERE a.id = module_activity.entity_id AND a.owner_id = (SELECT auth.uid())))
    )
  );

-- ── uniqueness becomes per owner ─────────────────────────────────────────────
-- Strictly looser than before, so building them can't fail on existing rows.

DROP INDEX IF EXISTS public.calendar_accounts_provider_key;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_accounts_owner_provider_key
  ON public.calendar_accounts (workspace_id, owner_id, provider, external_id)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS public.email_refs_thread_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS email_refs_owner_thread_uidx
  ON public.email_refs (workspace_id, owner_id, thread_key)
  WHERE deleted_at IS NULL;

-- ── calendar ops: ownership ──────────────────────────────────────────────────

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
      AND owner_id = public.perm_actor_id()   -- PERM-0: someone else's event reads as absent
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
REVOKE ALL ON FUNCTION public.calendar_op__guard_event(uuid, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.calendar_op__guard_event(uuid, uuid, boolean) FROM authenticated;

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
    -- PERM-0: under an API key the event belongs to the key's creator.
    (p_workspace_id, public.perm_actor_id(), 'moduo', btrim(p_title), coalesce(p_description, ''),
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
  RETURN e;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_op_account_upsert(
  p_workspace_id uuid,
  p_provider text,
  p_external_id text,
  p_display_label text,
  p_color text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_last_sync_at timestamptz DEFAULT NULL,
  p_sync_token text DEFAULT NULL
)
RETURNS public.calendar_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.calendar_accounts;
  v_inserted boolean;
  v_owner uuid := public.perm_actor_id();
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  -- Atomic vs the partial unique index (a double-clicked Connect / two
  -- devices must not surface a raw 23505): serialize concurrent connects for
  -- the same identity, then re-check under the lock. PERM-0: the identity is
  -- per owner — two members connecting the same shared Google calendar each
  -- get their own (private) account row.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('calendar_account:' || p_workspace_id::text || ':' || v_owner::text
                     || ':' || p_provider || ':' || coalesce(p_external_id, ''), 0)
  );
  SELECT * INTO a FROM public.calendar_accounts
    WHERE workspace_id = p_workspace_id AND owner_id = v_owner AND provider = p_provider
      AND external_id = coalesce(p_external_id, '') AND deleted_at IS NULL
    FOR UPDATE;
  v_inserted := NOT FOUND;
  IF v_inserted THEN
    INSERT INTO public.calendar_accounts
      (workspace_id, owner_id, provider, external_id, display_label, color, status, last_sync_at, sync_token)
    VALUES
      (p_workspace_id, v_owner, p_provider, coalesce(p_external_id, ''),
       coalesce(p_display_label, ''), p_color, coalesce(p_status, 'ok'), p_last_sync_at, p_sync_token)
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
      sync_token = coalesce(p_sync_token, sync_token),
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
      AND owner_id = public.perm_actor_id()   -- PERM-0: only the owner disconnects
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

-- ── email ops: ownership ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_op__guard_ref(p_workspace_id uuid, p_ref_id uuid)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);
  SELECT * INTO r FROM public.email_refs
    WHERE id = p_ref_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
      AND owner_id = public.perm_actor_id()   -- PERM-0
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Email thread not found in this workspace.';
  END IF;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.email_op__guard_ref(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_op__guard_ref(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.email_op__guard_ref(uuid, uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.email_op_ref_upsert(
  p_workspace_id uuid,
  p_thread_key text,
  p_account_id uuid DEFAULT NULL,
  p_message_key text DEFAULT NULL,
  p_from_addr text DEFAULT NULL,
  p_from_name text DEFAULT NULL,
  p_subject text DEFAULT '',
  p_snippet text DEFAULT '',
  p_sent_at timestamptz DEFAULT NULL
)
RETURNS public.email_refs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.email_refs;
  v_thread text := trim(coalesce(p_thread_key, ''));
  v_owner uuid := public.perm_actor_id();
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);
  IF v_thread = '' THEN
    RAISE EXCEPTION 'A thread key is required.';
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.email_refs
    (workspace_id, owner_id, account_id, thread_key, message_key,
     from_addr, from_name, subject, snippet, sent_at)
  VALUES
    (p_workspace_id, v_owner, p_account_id, v_thread, p_message_key,
     p_from_addr, p_from_name, coalesce(p_subject, ''), coalesce(p_snippet, ''), p_sent_at)
  -- PERM-0: per-owner identity (email_refs_owner_thread_uidx).
  ON CONFLICT (workspace_id, owner_id, thread_key) WHERE deleted_at IS NULL
  DO UPDATE SET
    account_id  = coalesce(p_account_id, public.email_refs.account_id),
    message_key = coalesce(p_message_key, public.email_refs.message_key),
    from_addr   = coalesce(p_from_addr, public.email_refs.from_addr),
    from_name   = coalesce(p_from_name, public.email_refs.from_name),
    subject     = coalesce(NULLIF(p_subject, ''), public.email_refs.subject),
    snippet     = coalesce(NULLIF(p_snippet, ''), public.email_refs.snippet),
    sent_at     = coalesce(p_sent_at, public.email_refs.sent_at),
    updated_at  = now()
  RETURNING * INTO r;

  PERFORM public.entities_op_upsert(
    p_workspace_id, 'email_thread', r.id,
    coalesce(NULLIF(r.subject, ''), '(no subject)'), 'mail');
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_op_link(
  p_workspace_id uuid,
  p_thread_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_kind text DEFAULT 'references',
  p_origin text DEFAULT 'manual',
  p_thread_label text DEFAULT NULL,
  p_target_label text DEFAULT NULL,
  p_target_icon text DEFAULT NULL
)
RETURNS public.entity_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.entity_links;
  v_kind text := coalesce(p_relation_kind, 'references');
  v_origin text := coalesce(p_origin, 'manual');
  v_pair_key text;
BEGIN
  PERFORM public.email_op__guard(p_workspace_id);

  -- PERM-0: you can only link your own thread (ids are visible on
  -- entity_links rows, so knowing one must not be enough).
  IF NOT EXISTS (
    SELECT 1 FROM public.email_refs r
    WHERE r.id = p_thread_id AND r.workspace_id = p_workspace_id
      AND r.deleted_at IS NULL AND r.owner_id = public.perm_actor_id()
  ) THEN
    RAISE EXCEPTION 'Email thread not found in this workspace.';
  END IF;

  IF v_kind NOT IN ('references', 'spawned-from', 'blocks', 'attachment',
                    'mentions', 'works-at', 'follow-up', 'paid-by') THEN
    RAISE EXCEPTION 'Unknown relation kind: %', v_kind;
  END IF;
  IF v_origin NOT IN ('manual', 'drag', 'mention', 'ref', 'suggest') THEN
    RAISE EXCEPTION 'Unknown link origin: %', v_origin;
  END IF;
  IF p_target_type = 'email_thread' AND p_target_id = p_thread_id THEN
    RAISE EXCEPTION 'An entity cannot link to itself.';
  END IF;

  PERFORM public.entities_op_ensure(p_workspace_id, 'email_thread', p_thread_id, p_thread_label, 'mail');
  PERFORM public.entities_op_ensure(p_workspace_id, p_target_type, p_target_id, p_target_label, p_target_icon);

  v_pair_key := public.spine_pair_key('email_thread', p_thread_id, p_target_type, p_target_id);

  INSERT INTO public.entity_links
    (workspace_id, source_type, source_id, target_type, target_id, relation_kind, origin, created_by)
  VALUES
    (p_workspace_id, 'email_thread', p_thread_id, p_target_type, p_target_id, v_kind, v_origin, public.perm_actor_id())
  ON CONFLICT (workspace_id, pair_key, relation_kind) WHERE deleted_at IS NULL
  DO NOTHING
  RETURNING * INTO v_link;

  IF v_link.id IS NULL THEN
    SELECT * INTO v_link FROM public.entity_links
      WHERE workspace_id = p_workspace_id AND pair_key = v_pair_key
        AND relation_kind = v_kind AND deleted_at IS NULL
      LIMIT 1;
    RETURN v_link; -- already linked, idempotent — no new activity
  END IF;

  PERFORM public.module_activity_log(
    p_workspace_id, 'email', 'email_thread', p_thread_id, 'email.link',
    jsonb_build_object(
      'link_id', v_link.id, 'target_type', p_target_type, 'target_id', p_target_id,
      'relation_kind', v_kind, 'origin', v_origin));
  RETURN v_link;
END;
$$;

-- ── re-assert op grants (signatures unchanged; defensive vs drift) ───────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'calendar_op_event_create(uuid, text, timestamptz, timestamptz, boolean, text, text)',
    'calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text)',
    'calendar_op_account_remove(uuid, uuid)',
    'email_op_ref_upsert(uuid, text, uuid, text, text, text, text, text, timestamptz)',
    'email_op_link(uuid, uuid, text, uuid, text, text, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
  -- Restore stays user-only, as DF-5 shipped it.
  REVOKE ALL ON FUNCTION public.calendar_op_event_restore(uuid, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.calendar_op_event_restore(uuid, uuid) FROM anon;
  GRANT EXECUTE ON FUNCTION public.calendar_op_event_restore(uuid, uuid) TO authenticated;
END;
$$;

-- ── links_suggest: never suggest someone else's private entity ─────────────
-- Newest body ← 20260628140000_contacts_v2.sql; one added predicate.
CREATE OR REPLACE FUNCTION public.links_suggest(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  other_type text, other_id uuid, other_label text, other_icon text,
  signal text, suggested_kind text, strength int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.spine_op__guard(p_workspace_id);
  RETURN QUERY
  WITH
  shared_tag AS (
    SELECT tl2.entity_type AS other_type, tl2.entity_id AS other_id,
           'shared-tag'::text AS signal, 'references'::text AS suggested_kind, count(*)::int AS strength
    FROM public.tag_links tl1
    JOIN public.tag_links tl2 ON tl2.workspace_id = tl1.workspace_id AND tl2.tag_id = tl1.tag_id
      AND NOT (tl2.entity_type = tl1.entity_type AND tl2.entity_id = tl1.entity_id)
    WHERE tl1.workspace_id = p_workspace_id AND tl1.entity_type = p_entity_type AND tl1.entity_id = p_entity_id
    GROUP BY tl2.entity_type, tl2.entity_id
  ),
  email_domain AS (
    SELECT 'company'::text AS other_type, co.id AS other_id,
           'email-domain'::text AS signal, 'works-at'::text AS suggested_kind, 1::int AS strength
    FROM public.contacts c
    CROSS JOIN LATERAL jsonb_array_elements(c.emails) AS ce(obj)
    JOIN public.companies co ON co.workspace_id = c.workspace_id AND co.deleted_at IS NULL
      AND lower(split_part(ce.obj->>'value', '@', 2)) = ANY (SELECT lower(d) FROM unnest(co.domains) AS d)
    WHERE p_entity_type = 'contact' AND c.workspace_id = p_workspace_id AND c.id = p_entity_id
      AND c.deleted_at IS NULL AND position('@' IN coalesce(ce.obj->>'value','')) > 0
    GROUP BY co.id
    UNION
    SELECT 'contact'::text AS other_type, c.id AS other_id,
           'email-domain'::text AS signal, 'works-at'::text AS suggested_kind, 1::int AS strength
    FROM public.companies co
    JOIN public.contacts c ON c.workspace_id = co.workspace_id AND c.deleted_at IS NULL
    CROSS JOIN LATERAL jsonb_array_elements(c.emails) AS ce(obj)
    WHERE p_entity_type = 'company' AND co.workspace_id = p_workspace_id AND co.id = p_entity_id
      AND co.deleted_at IS NULL AND position('@' IN coalesce(ce.obj->>'value','')) > 0
      AND lower(split_part(ce.obj->>'value', '@', 2)) = ANY (SELECT lower(d) FROM unnest(co.domains) AS d)
    GROUP BY c.id
  ),
  time_window AS (
    SELECT ma2.entity_type AS other_type, ma2.entity_id AS other_id,
           'time-window'::text AS signal, 'references'::text AS suggested_kind, 1::int AS strength
    FROM public.module_activity ma1
    JOIN public.module_activity ma2 ON ma2.workspace_id = ma1.workspace_id
      AND NOT (ma2.entity_type = ma1.entity_type AND ma2.entity_id = ma1.entity_id)
      AND ma2.created_at BETWEEN ma1.created_at - interval '30 minutes' AND ma1.created_at + interval '30 minutes'
    WHERE ma1.workspace_id = p_workspace_id AND ma1.entity_type = p_entity_type AND ma1.entity_id = p_entity_id
      AND ma1.created_at > now() - interval '30 days'
    GROUP BY ma2.entity_type, ma2.entity_id
  ),
  candidates AS (
    SELECT * FROM shared_tag UNION ALL SELECT * FROM email_domain UNION ALL SELECT * FROM time_window
  )
  SELECT cand.other_type, cand.other_id, e.label AS other_label, e.icon AS other_icon,
         cand.signal, cand.suggested_kind, cand.strength
  FROM candidates cand
  JOIN public.entities e ON e.workspace_id = p_workspace_id AND e.entity_type = cand.other_type
    AND e.entity_id = cand.other_id AND e.deleted_at IS NULL
    AND public.perm_private_entity_visible(cand.other_type, cand.other_id)  -- PERM-0
  WHERE NOT EXISTS (
    SELECT 1 FROM public.entity_links el WHERE el.workspace_id = p_workspace_id AND el.deleted_at IS NULL
      AND el.pair_key = public.spine_pair_key(p_entity_type, p_entity_id, cand.other_type, cand.other_id))
    AND NOT EXISTS (
    SELECT 1 FROM public.link_suggestion_declines d WHERE d.workspace_id = p_workspace_id
      AND d.pair_key = public.spine_pair_key(p_entity_type, p_entity_id, cand.other_type, cand.other_id))
  ORDER BY cand.strength DESC, e.label
  LIMIT coalesce(p_limit, 25);
END;
$$;

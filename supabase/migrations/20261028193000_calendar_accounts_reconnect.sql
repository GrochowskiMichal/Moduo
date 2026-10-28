-- Calendar accounts: reconnect, read-only calendars, busy default, Remove's Undo.
--
-- A Google login whose refresh token was revoked is `reauth` (with the reason in
-- last_error) until a reconnect clears it; a failed sync ('error') never hides it.
-- read_only: Google doesn't let you write this calendar. busy_default: it counts
-- as busy for new booking links. Re-runnable.
--
--   calendar_op_account_upsert  ← 20261006180000_perm0_privacy.sql, plus p_read_only, p_busy_default
--   calendar_op_account_set     new: the owner's Counts as busy
--   calendar_op_account_restore new: Undo of calendar_op_account_remove
--   calendar_op__google_reauth  new: service role only (calendar-google-web)

ALTER TABLE public.calendar_accounts
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS busy_default boolean NOT NULL DEFAULT true;

ALTER TABLE public.calendar_accounts DROP CONSTRAINT IF EXISTS calendar_accounts_status_contract;
ALTER TABLE public.calendar_accounts
  ADD CONSTRAINT calendar_accounts_status_contract CHECK (status IN ('ok','error','reauth'));

-- ── upsert: two trailing args (the old signature is dropped, not overloaded) ──
DROP FUNCTION IF EXISTS public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text);

CREATE OR REPLACE FUNCTION public.calendar_op_account_upsert(
  p_workspace_id uuid,
  p_provider text,
  p_external_id text,
  p_display_label text,
  p_color text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_last_sync_at timestamptz DEFAULT NULL,
  p_sync_token text DEFAULT NULL,
  p_read_only boolean DEFAULT NULL,
  p_busy_default boolean DEFAULT NULL
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
      (workspace_id, owner_id, provider, external_id, display_label, color, status, last_sync_at,
       sync_token, read_only, busy_default)
    VALUES
      (p_workspace_id, v_owner, p_provider, coalesce(p_external_id, ''),
       coalesce(p_display_label, ''), p_color, coalesce(p_status, 'ok'), p_last_sync_at, p_sync_token,
       coalesce(p_read_only, false), coalesce(p_busy_default, NOT coalesce(p_read_only, false)))
    RETURNING * INTO a;
    PERFORM public.module_activity_log(
      p_workspace_id, 'calendar', 'calendar_account', a.id, 'calendar.account_connect',
      jsonb_build_object('provider', a.provider, 'label', a.display_label)
    );
  ELSE
    UPDATE public.calendar_accounts SET
      display_label = coalesce(NULLIF(p_display_label, ''), display_label),
      color = coalesce(p_color, color),
      -- A failed sync never hides a revoked login; a good one clears it.
      status = CASE WHEN p_status = 'error' AND status = 'reauth' THEN status
                    ELSE coalesce(p_status, status) END,
      last_error = CASE WHEN p_status = 'ok' THEN NULL ELSE last_error END,
      last_sync_at = coalesce(p_last_sync_at, last_sync_at),
      sync_token = coalesce(p_sync_token, sync_token),
      read_only = coalesce(p_read_only, read_only),
      busy_default = coalesce(p_busy_default, busy_default),
      updated_at = now()
    WHERE id = a.id
    RETURNING * INTO a;
  END IF;
  RETURN a;
END;
$$;

-- ── Counts as busy for booking links (owner only; NULL keeps) ────────────────
CREATE OR REPLACE FUNCTION public.calendar_op_account_set(
  p_workspace_id uuid,
  p_account_id uuid,
  p_busy_default boolean DEFAULT NULL
)
RETURNS public.calendar_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.calendar_accounts;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  UPDATE public.calendar_accounts SET
      busy_default = coalesce(p_busy_default, busy_default),
      updated_at = now()
    WHERE id = p_account_id AND workspace_id = p_workspace_id AND deleted_at IS NULL
      AND owner_id = public.perm_actor_id()
    RETURNING * INTO a;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'Calendar account not found in this workspace.';
  END IF;
  RETURN a;
END;
$$;

-- ── Remove's Undo: the account and only what that Remove stamped ─────────────
-- calendar_op_account_remove stamps the account, its events and their registry
-- rows with one now(); an event an earlier sync removed has another stamp.
CREATE OR REPLACE FUNCTION public.calendar_op_account_restore(
  p_workspace_id uuid,
  p_account_id uuid
)
RETURNS public.calendar_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.calendar_accounts;
  v_at timestamptz;
BEGIN
  PERFORM public.calendar_op__guard(p_workspace_id);
  SELECT * INTO a FROM public.calendar_accounts
    WHERE id = p_account_id AND workspace_id = p_workspace_id AND deleted_at IS NOT NULL
      AND owner_id = public.perm_actor_id()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Calendar account not found in this workspace.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.calendar_accounts
              WHERE workspace_id = a.workspace_id AND owner_id = a.owner_id
                AND provider = a.provider AND external_id = a.external_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This calendar is connected again.';
  END IF;
  v_at := a.deleted_at;
  UPDATE public.entities en
    SET deleted_at = NULL, updated_at = now()
    FROM public.calendar_events e
    WHERE e.source_account_id = a.id AND e.deleted_at = v_at
      AND en.workspace_id = p_workspace_id AND en.entity_type = 'event'
      AND en.entity_id = e.id AND en.deleted_at = v_at;
  UPDATE public.calendar_events
    SET deleted_at = NULL, updated_at = now()
    WHERE source_account_id = a.id AND deleted_at = v_at;
  UPDATE public.calendar_accounts
    SET deleted_at = NULL, updated_at = now()
    WHERE id = a.id
    RETURNING * INTO a;
  PERFORM public.module_activity_log(
    p_workspace_id, 'calendar', 'calendar_account', a.id, 'calendar.account_restore',
    jsonb_build_object('provider', a.provider, 'label', a.display_label)
  );
  RETURN a;
END;
$$;

-- ── reauth by Google login, every workspace (calendar-google-web only) ───────
-- external_id is 'google:<email>' or 'google:<email>:<calendar>'; compared by
-- prefix text, never LIKE, so robin@example.community isn't robin@example.com.
CREATE OR REPLACE FUNCTION public.calendar_op__google_reauth(
  p_owner_id uuid,
  p_email text,
  p_reauth boolean,
  p_error text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := 'google:' || lower(coalesce(p_email, ''));
  v_count int;
BEGIN
  UPDATE public.calendar_accounts SET
      status = CASE WHEN p_reauth THEN 'reauth' ELSE 'ok' END,
      last_error = CASE WHEN p_reauth THEN p_error ELSE NULL END,
      updated_at = now()
    WHERE owner_id = p_owner_id AND provider = 'google' AND deleted_at IS NULL
      AND (external_id = v_key OR left(external_id, length(v_key) + 1) = v_key || ':')
      AND (CASE WHEN p_reauth THEN status IS DISTINCT FROM 'reauth' OR last_error IS DISTINCT FROM p_error
                ELSE status = 'reauth' END);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text, boolean, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.calendar_op_account_set(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_account_set(uuid, uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.calendar_op_account_restore(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_account_restore(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.calendar_op__google_reauth(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_op__google_reauth(uuid, text, boolean, text) TO service_role;

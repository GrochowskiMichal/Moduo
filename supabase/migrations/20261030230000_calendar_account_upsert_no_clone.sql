-- A failed sync never creates a calendar account. The sync loop reports a
-- failure with calendar_op_account_upsert(p_status => 'error'), and this op
-- matches the row by the CALLER's id, so a caller with no live row got a fresh
-- one. On 2026-10-06 that cloned one member's Google calendars into a
-- teammate's account, and it brings back an account removed while a sync was
-- running. An 'error' upsert now only updates a live row of the caller and
-- otherwise returns NULL (the client ignores the result on that path).
-- Test: supabase/tests/calendar_account_upsert_no_clone.test.sql.

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
  -- A sync failure reports on an account; it never connects one.
  IF v_inserted AND p_status = 'error' THEN
    RETURN NULL;
  END IF;
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
REVOKE ALL ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text, boolean, boolean) TO authenticated, service_role;

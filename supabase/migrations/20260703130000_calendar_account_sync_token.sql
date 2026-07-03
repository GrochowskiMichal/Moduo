-- CAL-8 (CalDAV/ICS read-only): `calendar_op_account_upsert` gains
-- `p_sync_token text DEFAULT NULL` writing the EXISTING `sync_token` column.
-- NULL (or an omitted arg) keeps the stored value, so the desktop sync loop's
-- per-sync re-assert never clobbers a connect-time descriptor.
--
-- The column carries the client-readable, NON-SECRET connection descriptor for
-- CalDAV/ICS rows (rail grouping + Reconnect prefill):
--   {"kind":"caldav","serverUrl":…,"username":…,"calendarUrl":…,"calendarName":…}
--   {"kind":"ics"}
-- The password / feed URL never leaves the OS keychain. Recorded posture:
-- server + username become member-visible, same class as display labels.
--
-- The old 7-arg signature is DROPPED (not overloaded) — PostgREST resolves
-- RPCs by named args and an overload pair would be ambiguous for calls that
-- omit the optional args.

DROP FUNCTION IF EXISTS public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz);

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
      (workspace_id, owner_id, provider, external_id, display_label, color, status, last_sync_at, sync_token)
    VALUES
      (p_workspace_id, auth.uid(), p_provider, coalesce(p_external_id, ''),
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

-- Grants are per-signature: re-apply the calendar module's op posture.
REVOKE ALL ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calendar_op_account_upsert(uuid, text, text, text, text, text, timestamptz, text) TO authenticated;

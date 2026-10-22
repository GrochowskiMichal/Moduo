-- MCPO-3 · Connections: an app that signed in with OAuth holds a workspace API
-- key row without a secret (specs/mcp-oauth.md, Assumptions #1, #5, #11;
-- docs/decisions/mcp.md 2026-10-22).
--
-- A connection is a workspace_api_keys row with oauth_client_id (the app's
-- client in auth.oauth_clients) instead of key_hash / key_prefix. Everything
-- keyed on the key id (scopes and their caps, expiry, revoke, agent sessions,
-- the trail, private chat) works for it unchanged: moduo-mcp exchanges the
-- app's token for the row (sub + client_id → the live row) and calls exactly
-- as for a pasted key, service role + x-moduo-key-id.
--
-- One live connection per person and app (the partial unique index), in one
-- workspace. workspace_api_keys_connect_oauth is the consent screen's Approve:
-- it creates the connection, or updates the same row on a reconnect, or moves
-- it to another workspace (the old row is revoked). A new connection rings the
-- person's own bell, quietly (no push).
--
-- Deploy: this migration, then moduo-mcp (its OAuth branch reads the new
-- columns). Pasted keys are untouched either way.

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE public.workspace_api_keys
  ADD COLUMN IF NOT EXISTS oauth_client_id uuid,
  ADD COLUMN IF NOT EXISTS oauth_client_domain text;

COMMENT ON COLUMN public.workspace_api_keys.oauth_client_id IS
  'MCPO-3: the app (auth.oauth_clients.id) this connection belongs to; null for a pasted key. No foreign key into auth: a deleted client leaves a row nobody can sign in to.';
COMMENT ON COLUMN public.workspace_api_keys.oauth_client_domain IS
  'MCPO-3: the host of the app''s first registered redirect URI, read from auth.oauth_clients at connect time (never from the browser).';

-- Settings → API keys lists connections (MCPO-4); RLS keeps rows to managers,
-- and key_hash stays unreadable.
GRANT SELECT (oauth_client_id, oauth_client_domain) ON public.workspace_api_keys TO authenticated;

ALTER TABLE public.workspace_api_keys
  ALTER COLUMN key_hash DROP NOT NULL,
  ALTER COLUMN key_prefix DROP NOT NULL;

-- Exactly one way in: a secret (hash + prefix) or an app.
ALTER TABLE public.workspace_api_keys
  ADD CONSTRAINT workspace_api_keys_secret_or_app CHECK (
    (key_hash IS NOT NULL AND key_prefix IS NOT NULL AND oauth_client_id IS NULL AND oauth_client_domain IS NULL)
    OR (key_hash IS NULL AND key_prefix IS NULL AND oauth_client_id IS NOT NULL AND created_by IS NOT NULL)
  );

-- One live connection per person and app. Revoked rows (disconnected, moved
-- away) stay as history; an expired row is still the one a reconnect renews.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_api_keys_one_connection_idx
  ON public.workspace_api_keys (created_by, oauth_client_id)
  WHERE oauth_client_id IS NOT NULL AND revoked_at IS NULL;

-- ── Connect (the consent screen's Approve) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.workspace_api_keys_connect_oauth(
  p_workspace_id uuid,
  p_client_id uuid,
  p_scopes jsonb DEFAULT '{"tasks": "view"}'::jsonb,
  p_expires_in_days integer DEFAULT 90,
  p_include_private_chat boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  name text,
  scopes jsonb,
  expires_at timestamptz,
  include_private_chat boolean,
  created boolean,
  moved_from uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_client record;
  v_domain text;
  v_name text;
  v_expires timestamptz;
  v_old public.workspace_api_keys;
  v_row public.workspace_api_keys;
  v_moved uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to connect an app.' USING ERRCODE = '42501';
  END IF;
  -- The app's name and domain come from Supabase Auth's registration, never
  -- from the browser.
  SELECT c.client_name, c.redirect_uris INTO v_client
    FROM auth.oauth_clients c
    WHERE c.id = p_client_id AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This app isn''t registered with Moduo. Go back to it and connect again.'
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.workspace_api_keys_can_manage(p_workspace_id) THEN
    RAISE EXCEPTION 'Your role doesn''t include API keys here. Ask the workspace owner.'
      USING ERRCODE = '42501';
  END IF;
  IF p_expires_in_days IS NOT NULL AND (p_expires_in_days < 1 OR p_expires_in_days > 730) THEN
    RAISE EXCEPTION 'A connection can last 1–730 days, or never expire.' USING ERRCODE = '22023';
  END IF;
  IF p_include_private_chat IS NULL THEN
    RAISE EXCEPTION 'Say whether to include private channels.' USING ERRCODE = '22023';
  END IF;
  -- The person gives the app at most their own access (as for a key they create).
  PERFORM public.workspace_api_keys__check_scopes(p_workspace_id, v_me, '{}'::jsonb, p_scopes, true);

  -- Approve clicked twice, or in two tabs: one connection.
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_api_keys_connect_oauth:' || v_me || ':' || p_client_id, 0));

  SELECT * INTO v_old FROM public.workspace_api_keys k
    WHERE k.created_by = v_me AND k.oauth_client_id = p_client_id AND k.revoked_at IS NULL
    FOR UPDATE;

  -- The 20 cap counts keys and connections alike; the connection being
  -- updated in place doesn't count against itself.
  IF (SELECT count(*) FROM public.workspace_api_keys k
      WHERE k.workspace_id = p_workspace_id AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > now())
        AND k.id IS DISTINCT FROM CASE WHEN v_old.workspace_id = p_workspace_id THEN v_old.id END) >= 20 THEN
    RAISE EXCEPTION 'This workspace has 20 keys and connections. Disconnect or revoke one in Settings → API keys first.'
      USING ERRCODE = '54000';
  END IF;

  v_domain := nullif(lower(substring(btrim(split_part(v_client.redirect_uris, ',', 1))
                                     FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]]*\]|[^:/?#]+)')), '');
  v_expires := CASE WHEN p_expires_in_days IS NULL THEN NULL
                    ELSE now() + make_interval(days => p_expires_in_days) END;

  IF v_old.id IS NOT NULL AND v_old.workspace_id = p_workspace_id THEN
    -- A reconnect: the same row, with the access just approved. Its name
    -- stays (the person may have renamed it).
    UPDATE public.workspace_api_keys k
      SET scopes = p_scopes,
          expires_at = v_expires,
          include_private_chat = p_include_private_chat,
          oauth_client_domain = v_domain
      WHERE k.id = v_old.id
      RETURNING * INTO v_row;
    RETURN QUERY SELECT v_row.id, v_row.workspace_id, v_row.name, v_row.scopes, v_row.expires_at,
                        v_row.include_private_chat, false, NULL::uuid;
    RETURN;
  END IF;

  IF v_old.id IS NOT NULL THEN
    -- Moving to another workspace ends the connection in the first one.
    UPDATE public.workspace_api_keys k SET revoked_at = now() WHERE k.id = v_old.id;
    v_moved := v_old.workspace_id;
    v_name := v_old.name;
  ELSE
    v_name := left(nullif(btrim(coalesce(v_client.client_name, '')), ''), 80);
    v_name := coalesce(v_name, coalesce(v_domain, 'An app'));
  END IF;

  INSERT INTO public.workspace_api_keys
    (workspace_id, name, scopes, created_by, expires_at, include_private_chat,
     oauth_client_id, oauth_client_domain)
  VALUES (p_workspace_id, v_name, p_scopes, v_me, v_expires, p_include_private_chat,
          p_client_id, v_domain)
  RETURNING * INTO v_row;

  -- The person's own bell, nobody else's: "Claude connected to Moduo · View:
  -- Tasks". module_activity rows reach only the people their payload names
  -- (spine_activity_targets_me); no notice_deliveries row, so no push.
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (
    p_workspace_id, 'api_keys', 'api_key', v_row.id, 'api_keys.connected', 'api_key', v_row.id, v_row.name,
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(v_me::text),
      'app_name', v_row.name,
      'client_domain', v_domain,
      'scopes', v_row.scopes,
      'include_private_chat', v_row.include_private_chat,
      'expires_at', v_row.expires_at,
      'moved_from', v_moved
    )
  );

  RETURN QUERY SELECT v_row.id, v_row.workspace_id, v_row.name, v_row.scopes, v_row.expires_at,
                      v_row.include_private_chat, true, v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_connect_oauth(uuid, uuid, jsonb, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_connect_oauth(uuid, uuid, jsonb, integer, boolean) TO authenticated;

-- ── Rename (a key or a connection; the trail's name) ─────────────────────────
CREATE OR REPLACE FUNCTION public.workspace_api_keys_rename(p_key_id uuid, p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k public.workspace_api_keys;
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  SELECT * INTO k FROM public.workspace_api_keys WHERE workspace_api_keys.id = p_key_id FOR UPDATE;
  IF k.id IS NULL OR NOT public.workspace_api_keys_can_manage(k.workspace_id) THEN
    RAISE EXCEPTION 'API key not found.' USING ERRCODE = 'P0002';
  END IF;
  IF k.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This key was revoked — create a new one instead.';
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Key name must be 1–80 characters.' USING ERRCODE = '22023';
  END IF;
  IF k.name IS DISTINCT FROM v_name THEN
    UPDATE public.workspace_api_keys SET name = v_name WHERE workspace_api_keys.id = k.id;
  END IF;
  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_rename(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_rename(uuid, text) TO authenticated;

-- MOD-576 (security): read the host an OAuth sign-in returns to the way a
-- browser does, or not at all.
--
-- connect_oauth and oauth_request took the host with
-- `^scheme://(?:[^@/?#]*@)?(host)`, which ends the userinfo at the FIRST '@'.
-- Browsers (and Go) end it at the LAST one, so a registered redirect
-- `https://x@claude.ai:@evil.com/cb` was stored and shown as claude.ai (the
-- trusted-app badge, "Returns to", the same-app replace offer) while the code
-- went to evil.com. Dynamic client registration is open, so no Moduo account
-- was needed.
--
-- Now one helper reads the host, and gives NULL ("hasn't checked", no domain)
-- for any authority a browser could read differently: one holding '@'
-- (userinfo), '\' (a path separator to browsers), '%', spaces, control or
-- any non-ASCII characters (lower() folds 'İ' to 'i' where a browser makes
-- punycode of it), or anything that isn't a plain host or [IPv6] with an optional
-- port. Both functions are the 20261024090000 bodies (prod's next) with only
-- the domain line swapped; signatures and grants unchanged (re-stated).
-- Stored connections whose domain came from such a redirect lose it.

CREATE OR REPLACE FUNCTION public.workspace_api_keys__oauth_redirect_host(p_redirect text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN s.authority IS NULL OR s.authority ~ '[^!-~]' OR s.authority ~ '[@\\%]' THEN NULL
           ELSE lower(nullif(substring(s.authority FROM '^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::[0-9]*)?$'), ''))
         END
  FROM (SELECT substring(btrim(p_redirect) FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]*)') AS authority) s
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys__oauth_redirect_host(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys__oauth_redirect_host(text) TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_connect_oauth(
  p_workspace_id uuid,
  p_authorization_id text,
  p_scopes jsonb DEFAULT '{"tasks": "view"}'::jsonb,
  p_expires_in_days integer DEFAULT 90,
  p_include_private_chat boolean DEFAULT false,
  p_replace_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  name text,
  scopes jsonb,
  expires_at timestamptz,
  include_private_chat boolean,
  created boolean,
  moved_from uuid,
  replaced uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := auth.uid();
  v_client_id uuid;
  v_redirect text;
  v_client_name text;
  v_domain text;
  v_scheme text;
  v_name text;
  v_expires timestamptz;
  v_old public.workspace_api_keys;
  v_row public.workspace_api_keys;
  v_moved uuid;
  v_app_name text;
  v_replaced uuid[] := '{}';
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to connect an app.' USING ERRCODE = '42501';
  END IF;
  -- The sign-in being approved: this person's (Supabase Auth ties it to them
  -- when the consent page reads it) and not expired or denied. It may already
  -- read approved: when the person consented to the app before, Supabase Auth
  -- approves a new sign-in the moment the consent page reads it, and the page
  -- holds the redirect back until Approve here. The app, and the domain
  -- the person is sent back to, come from it, never from the browser: an app can
  -- register several redirects, and only the one in this sign-in is where the
  -- person's approval goes.
  SELECT a.client_id, a.redirect_uri, c.client_name INTO v_client_id, v_redirect, v_client_name
    FROM auth.oauth_authorizations a
    JOIN auth.oauth_clients c ON c.id = a.client_id AND c.deleted_at IS NULL
    WHERE a.authorization_id = p_authorization_id
      AND a.user_id = v_me
      AND a.status IN ('pending', 'approved')
      AND a.expires_at > now();
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'This sign-in link has expired. Go back to the app and connect again.'
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

  v_domain := public.workspace_api_keys__oauth_redirect_host(v_redirect);
  -- The scheme too: `someapp://claude.ai/cb` returns to a local program, not claude.ai.
  v_scheme := nullif(lower(substring(btrim(v_redirect) FROM '^([a-zA-Z][a-zA-Z0-9+.-]*):')), '');
  -- The name a new connection to this app gets, and what "the same app" is matched on.
  v_app_name := public.workspace_api_keys__oauth_app_name(v_client_name, v_domain);

  -- Approve clicked twice, or in two tabs: one connection. The workspace lock
  -- keeps two connects from both passing the cap.
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_api_keys_connect_oauth:' || v_me || ':' || v_client_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_api_keys_cap:' || p_workspace_id, 0));

  SELECT * INTO v_old FROM public.workspace_api_keys k
    WHERE k.created_by = v_me AND k.oauth_client_id = v_client_id AND k.revoked_at IS NULL
    FOR UPDATE;

  -- MCPO-5 follow-up: the person chose to replace their other connections to
  -- this app (same name, scheme and domain, another registration; Claude
  -- registers anew on every Connect). Only those are ended: an id that isn't
  -- one (someone else's, a key, this app's own, already ended) is skipped,
  -- and what was ended is answered. Before the cap count, so a replaced
  -- connection frees its place.
  IF p_replace_ids IS NOT NULL AND cardinality(p_replace_ids) > 0 THEN
    WITH ended AS (
      UPDATE public.workspace_api_keys k SET revoked_at = now()
        WHERE k.id = ANY (p_replace_ids)
          AND public.workspace_api_keys__same_oauth_app(k, v_me, v_client_id, v_app_name, v_scheme, v_domain)
        RETURNING k.id
    )
    SELECT coalesce(array_agg(e.id ORDER BY e.id), '{}') INTO v_replaced FROM ended e;
  END IF;

  -- The 20 cap counts keys and connections alike; the connection being
  -- updated in place doesn't count against itself.
  IF (SELECT count(*) FROM public.workspace_api_keys k
      WHERE k.workspace_id = p_workspace_id AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > now())
        AND k.id IS DISTINCT FROM CASE WHEN v_old.workspace_id = p_workspace_id THEN v_old.id END) >= 20 THEN
    RAISE EXCEPTION 'This workspace has 20 keys and connections. Disconnect or revoke one in Settings → API keys first.'
      USING ERRCODE = '54000';
  END IF;

  v_expires := CASE WHEN p_expires_in_days IS NULL THEN NULL
                    ELSE now() + make_interval(days => p_expires_in_days) END;

  IF v_old.id IS NOT NULL AND v_old.workspace_id = p_workspace_id THEN
    -- A reconnect: the same row, with the access just approved. Its name
    -- stays (the person may have renamed it).
    UPDATE public.workspace_api_keys k
      SET scopes = p_scopes,
          expires_at = v_expires,
          include_private_chat = p_include_private_chat,
          oauth_client_domain = v_domain,
          oauth_client_scheme = v_scheme
      WHERE k.id = v_old.id
      RETURNING * INTO v_row;
    RETURN QUERY SELECT v_row.id, v_row.workspace_id, v_row.name, v_row.scopes, v_row.expires_at,
                        v_row.include_private_chat, false, NULL::uuid, v_replaced;
    RETURN;
  END IF;

  IF v_old.id IS NOT NULL THEN
    -- Moving to another workspace ends the connection in the first one.
    UPDATE public.workspace_api_keys k SET revoked_at = now() WHERE k.id = v_old.id;
    v_moved := v_old.workspace_id;
    v_name := v_old.name;
  ELSE
    v_name := v_app_name;
  END IF;

  INSERT INTO public.workspace_api_keys
    (workspace_id, name, scopes, created_by, expires_at, include_private_chat,
     oauth_client_id, oauth_client_domain, oauth_client_scheme)
  VALUES (p_workspace_id, v_name, p_scopes, v_me, v_expires, p_include_private_chat,
          v_client_id, v_domain, v_scheme)
  RETURNING * INTO v_row;

  -- The person's own bell, nobody else's: "Claude connected to Moduo · View:
  -- Tasks". module_activity rows reach only the people their payload names
  -- (spine_activity_targets_me) and are read only by the key's person
  -- (perm_can_see_entity's api_key branch below); no notice_deliveries row, so
  -- no push.
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (
    p_workspace_id, 'api_keys', 'api_key', v_row.id, 'api_keys.connected', 'api_key', v_row.id, v_row.name,
    jsonb_build_object(
      'notify_user_ids', jsonb_build_array(v_me::text),
      'app_name', v_row.name,
      'client_domain', v_domain,
      'client_scheme', v_scheme,
      'scopes', v_row.scopes,
      'include_private_chat', v_row.include_private_chat,
      'expires_at', v_row.expires_at,
      'moved_from', v_moved,
      'replaced', to_jsonb(v_replaced)
    )
  );

  RETURN QUERY SELECT v_row.id, v_row.workspace_id, v_row.name, v_row.scopes, v_row.expires_at,
                      v_row.include_private_chat, true, v_moved, v_replaced;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_connect_oauth(uuid, text, jsonb, integer, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_connect_oauth(uuid, text, jsonb, integer, boolean, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.workspace_api_keys_oauth_request(p_authorization_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_client_id uuid;
  v_redirect text;
  v_client_name text;
  v_domain text;
  v_scheme text;
  v_conn public.workspace_api_keys;
  v_full jsonb;
  v_others jsonb;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to connect an app.' USING ERRCODE = '42501';
  END IF;
  SELECT a.client_id, a.redirect_uri, c.client_name INTO v_client_id, v_redirect, v_client_name
    FROM auth.oauth_authorizations a
    JOIN auth.oauth_clients c ON c.id = a.client_id AND c.deleted_at IS NULL
    WHERE a.authorization_id = p_authorization_id
      AND a.user_id = v_me
      AND a.status IN ('pending', 'approved')
      AND a.expires_at > now();
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'This sign-in link has expired. Go back to the app and connect again.'
      USING ERRCODE = 'P0002';
  END IF;

  -- As connect stores it (20261023200000): NULL, not '', when unreadable.
  v_scheme := nullif(lower(substring(btrim(v_redirect) FROM '^([a-zA-Z][a-zA-Z0-9+.-]*):')), '');
  -- The same host connect stores as oauth_client_domain.
  v_domain := public.workspace_api_keys__oauth_redirect_host(v_redirect);

  SELECT * INTO v_conn FROM public.workspace_api_keys k
    WHERE k.created_by = v_me AND k.oauth_client_id = v_client_id AND k.revoked_at IS NULL;

  SELECT coalesce(jsonb_agg(w.id ORDER BY w.id), '[]'::jsonb) INTO v_full
    FROM public.workspaces w
    WHERE w.deleted_at IS NULL
      AND (w.owner_id = v_me OR EXISTS (
            SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id = v_me))
      AND public.workspace_api_keys_can_manage(w.id)
      AND (SELECT count(*) FROM public.workspace_api_keys k
           WHERE k.workspace_id = w.id AND k.revoked_at IS NULL
             AND (k.expires_at IS NULL OR k.expires_at > now())
             AND k.id IS DISTINCT FROM v_conn.id) >= 20;

  -- MCPO-5 follow-up: the person's other live connections to the same app
  -- (Claude registers anew on every Connect, leaving identical "Claude"
  -- rows), newest use first, so the page can offer to replace them.
  -- recently_used: used in the last two minutes (the connector stamps
  -- last_used_at at most once a minute), so it may be the one in use now.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'workspace_id', o.workspace_id,
           'name', o.name,
           'created_at', o.created_at,
           'last_used_at', o.last_used_at,
           'recently_used', coalesce(o.last_used_at > now() - interval '2 minutes', false)
         ) ORDER BY o.last_used_at DESC NULLS LAST, o.created_at DESC, o.id), '[]'::jsonb)
    INTO v_others
    FROM (SELECT k.* FROM public.workspace_api_keys k
          WHERE public.workspace_api_keys__same_oauth_app(
                  k, v_me, v_client_id,
                  public.workspace_api_keys__oauth_app_name(v_client_name, v_domain), v_scheme, v_domain)
          ORDER BY k.last_used_at DESC NULLS LAST, k.created_at DESC, k.id
          LIMIT 10) o;

  RETURN jsonb_build_object(
    'client_id', v_client_id,
    'app_name', left(nullif(btrim(coalesce(v_client_name, '')), ''), 80),
    'client_domain', v_domain,
    'client_scheme', v_scheme,
    'connection', CASE WHEN v_conn.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conn.id,
      'workspace_id', v_conn.workspace_id,
      'name', v_conn.name,
      'scopes', v_conn.scopes,
      'expires_at', v_conn.expires_at,
      'include_private_chat', v_conn.include_private_chat
    ) END,
    'full_workspace_ids', v_full,
    'others', v_others
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_oauth_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_oauth_request(text) TO authenticated;

-- Recompute stored connections (a function, so supabase/tests can run it
-- again). The redirect a connection was approved on isn't kept, only its
-- client, so a connection keeps its domain only when one of the client's
-- registered redirects returns there by the reading above, and the client
-- registered no redirect the old reading took differently (a deceptive one).
-- A deleted or unknown client keeps no domain either.
CREATE OR REPLACE FUNCTION public.workspace_api_keys__recheck_oauth_domains()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.workspace_api_keys k
     SET oauth_client_domain = NULL
   WHERE k.oauth_client_id IS NOT NULL
     AND k.oauth_client_domain IS NOT NULL
     AND NOT EXISTS (
           SELECT 1
             FROM auth.oauth_clients c
            CROSS JOIN LATERAL regexp_split_to_table(c.redirect_uris, '\s*,\s*') AS r(uri)
            WHERE c.id = k.oauth_client_id
              AND public.workspace_api_keys__oauth_redirect_host(r.uri) = k.oauth_client_domain)
      OR k.oauth_client_id IS NOT NULL
     AND k.oauth_client_domain IS NOT NULL
     AND EXISTS (
           SELECT 1
             FROM auth.oauth_clients c
            CROSS JOIN LATERAL regexp_split_to_table(c.redirect_uris, '\s*,\s*') AS r(uri)
            WHERE c.id = k.oauth_client_id
              AND public.workspace_api_keys__oauth_redirect_host(r.uri) IS DISTINCT FROM
                  nullif(lower(substring(btrim(r.uri)
                         FROM '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]]*\]|[^:/?#]+)')), ''));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys__recheck_oauth_domains() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys__recheck_oauth_domains() TO service_role;

SELECT public.workspace_api_keys__recheck_oauth_domains();

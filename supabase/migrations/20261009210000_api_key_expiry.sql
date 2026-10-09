-- API-KEY-EXP-1: optional expiry on workspace API keys.
--
-- `expires_at` is null for a key that never expires (every existing key stays
-- that way). The connector (edge function `moduo-mcp`) refuses a key once
-- expires_at has passed, exactly as it refuses a revoked one; the SQL resolvers
-- are only reached through the connector, which sets the key header after that
-- check. An expired key stays listed so it can be seen and revoked.
--
-- workspace_api_keys_create gains p_expires_in_days (null = never; 1–730).
-- The return type changes, so the old function is dropped and its grants are
-- restated below (a new function opens EXECUTE to PUBLIC/anon by default).

ALTER TABLE public.workspace_api_keys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.workspace_api_keys
  DROP CONSTRAINT IF EXISTS workspace_api_keys_expires_after_created;
ALTER TABLE public.workspace_api_keys
  ADD CONSTRAINT workspace_api_keys_expires_after_created
  CHECK (expires_at IS NULL OR expires_at > created_at);

-- Column-level grant: authenticated clients read the new column (key_hash stays hidden).
GRANT SELECT (expires_at) ON public.workspace_api_keys TO authenticated;

DROP FUNCTION IF EXISTS public.workspace_api_keys_create(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.workspace_api_keys_create(
  p_workspace_id uuid,
  p_name text,
  p_scopes jsonb DEFAULT '{"tasks": "view"}'::jsonb,
  p_expires_in_days integer DEFAULT NULL
)
RETURNS TABLE (
  id uuid, name text, key_prefix text, scopes jsonb,
  created_at timestamptz, expires_at timestamptz, secret text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_secret text;
  v_entry record;
BEGIN
  IF NOT public.workspace_api_keys_can_manage(p_workspace_id) THEN
    RAISE EXCEPTION 'Your role doesn''t include API keys in this workspace.';
  END IF;
  v_name := trim(coalesce(p_name, ''));
  IF v_name = '' OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Key name must be 1–80 characters.';
  END IF;
  IF p_expires_in_days IS NOT NULL AND (p_expires_in_days < 1 OR p_expires_in_days > 730) THEN
    RAISE EXCEPTION 'A key can last 1–730 days, or never expire.';
  END IF;
  -- A new key acts as the caller, who may give it up to their own access.
  PERFORM public.workspace_api_keys__check_scopes(p_workspace_id, auth.uid(), '{}'::jsonb, p_scopes, true);
  IF (SELECT count(*) FROM public.workspace_api_keys k
      WHERE k.workspace_id = p_workspace_id AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > now())) >= 20 THEN
    RAISE EXCEPTION 'This workspace already has 20 active keys — revoke one first.';
  END IF;

  v_secret := 'moduo_sk_' || encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.workspace_api_keys
    (workspace_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
  VALUES (
    p_workspace_id, v_name, left(v_secret, 15),
    encode(extensions.digest(v_secret, 'sha256'), 'hex'),
    p_scopes, auth.uid(),
    CASE WHEN p_expires_in_days IS NULL THEN NULL
         ELSE now() + make_interval(days => p_expires_in_days) END
  )
  RETURNING * INTO v_entry;

  RETURN QUERY SELECT v_entry.id, v_entry.name, v_entry.key_prefix,
                      v_entry.scopes, v_entry.created_at, v_entry.expires_at, v_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_api_keys_create(uuid, text, jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspace_api_keys_create(uuid, text, jsonb, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.workspace_api_keys_create(uuid, text, jsonb, integer) TO authenticated;

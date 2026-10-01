-- Landing waitlist: add the `footer` source (footer signup cell).
-- Mirrors @contracts WAITLIST_SOURCES. CREATE OR REPLACE keeps the signature,
-- so grants survive; they are re-asserted anyway.

BEGIN;

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_source_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_source_check
  CHECK (source IS NULL OR source IN ('nav','hero','close','footer'));

CREATE OR REPLACE FUNCTION public.waitlist_join(
  p_email text,
  p_source text,
  p_ip_hash text,
  p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip_hits int;
  v_global_hits int;
BEGIN
  IF char_length(v_email) NOT BETWEEN 3 AND 254
     OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('nav','hero','close','footer') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = '22023';
  END IF;
  IF p_ip_hash IS NULL OR char_length(p_ip_hash) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'invalid_ip_hash' USING ERRCODE = '22023';
  END IF;

  -- Serialise per IP so parallel bursts can't slip past the count.
  PERFORM pg_advisory_xact_lock(hashtext('waitlist_join:' || p_ip_hash));

  SELECT count(*) INTO v_ip_hits
    FROM public.waitlist_attempts
   WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour';
  IF v_ip_hits >= 8 THEN
    RETURN 'rate_limited';
  END IF;

  SELECT count(*) INTO v_global_hits
    FROM public.waitlist_attempts
   WHERE created_at > now() - interval '10 minutes';
  IF v_global_hits >= 500 THEN
    RETURN 'rate_limited';
  END IF;

  INSERT INTO public.waitlist_attempts (ip_hash) VALUES (p_ip_hash);
  DELETE FROM public.waitlist_attempts WHERE created_at < now() - interval '2 days';

  INSERT INTO public.waitlist (email, source, ip_hash, user_agent, referrer)
  VALUES (
    v_email,
    p_source,
    p_ip_hash,
    left(nullif(btrim(p_user_agent), ''), 512),
    left(nullif(btrim(p_referrer), ''), 512)
  )
  ON CONFLICT (email) DO NOTHING;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.waitlist_join(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waitlist_join(text, text, text, text, text)
  TO service_role;

COMMIT;

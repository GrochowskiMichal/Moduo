-- Landing waitlist: lock public.waitlist down and route every signup through
-- the `waitlist-join` Edge Function → public.waitlist_join() (service_role only).
--
-- Before: RLS on + a wide-open `waitlist_anon_insert` policy, and anon /
-- authenticated held ALL table privileges (incl. TRUNCATE, which RLS does not
-- gate). The table had 0 rows, so dropping the raw `ip_address` column is
-- lossless; only a keyed hash of the IP is stored from now on.
--
-- Vocabularies mirror @contracts WAITLIST_SOURCES / WAITLIST_STATUSES.

BEGIN;

-- 1. Close direct access -------------------------------------------------------
DROP POLICY IF EXISTS waitlist_anon_insert ON public.waitlist;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.waitlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.waitlist TO service_role;

-- 2. Shape -------------------------------------------------------------------
ALTER TABLE public.waitlist DROP COLUMN IF EXISTS ip_address;
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS ip_hash text;

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_source_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_source_check
  CHECK (source IS NULL OR source IN ('nav','hero','close'));

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_status_check
  CHECK (status IN ('pending','confirmed','cancelled'));

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_email_normalized_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_email_normalized_check
  CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254);

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_meta_len_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_meta_len_check
  CHECK (
    (user_agent IS NULL OR char_length(user_agent) <= 512)
    AND (referrer IS NULL OR char_length(referrer) <= 512)
    AND (ip_hash IS NULL OR char_length(ip_hash) <= 128)
  );

-- 3. Rate-limit ledger (every attempt, incl. duplicates) ------------------------
CREATE TABLE IF NOT EXISTS public.waitlist_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL CHECK (char_length(ip_hash) <= 128),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_attempts_ip_created_idx
  ON public.waitlist_attempts (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS waitlist_attempts_created_idx
  ON public.waitlist_attempts (created_at);
ALTER TABLE public.waitlist_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.waitlist_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.waitlist_attempts TO service_role;

-- 4. Atomic join: validate → rate-limit → insert (idempotent on email) ---------
-- Returns 'ok' | 'rate_limited'. Raises 22023 on invalid input. Duplicate
-- emails also return 'ok' so the endpoint never reveals who is on the list.
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
  IF p_source IS NULL OR p_source NOT IN ('nav','hero','close') THEN
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

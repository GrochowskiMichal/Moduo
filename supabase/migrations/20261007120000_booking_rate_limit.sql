-- Public booking: rate-limit booking-public's `book` action.
--
-- booking-public is unauthenticated, and every booking makes Moduo email the
-- guest (Resend) and Google invite up to 10 more addresses. Without a cap
-- anyone could loop book → cancel → book and use our senders to mail any
-- address. Same shape as waitlist_join (20261001160000): a server-only ledger
-- of HMAC'd client IPs, counted under advisory locks.
--
-- Limits: 10 bookings per IP per hour, then 30 per host (the link owner) per
-- hour. There is deliberately no platform-wide cap: one would let a handful of
-- IPs switch booking off for every host. The per-host cap is the backstop when
-- IPs rotate, and it only ever throttles that one host's links. booking-public
-- calls this only for a valid booking of an offered slot, right before it
-- creates anything, so junk requests don't count. Rows are pruned after
-- 2 days and cascade with the host's account.

BEGIN;

CREATE TABLE IF NOT EXISTS public.booking_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL CHECK (char_length(ip_hash) <= 128),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_attempts_ip_created_idx
  ON public.booking_attempts (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_attempts_owner_created_idx
  ON public.booking_attempts (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS booking_attempts_created_idx
  ON public.booking_attempts (created_at);
ALTER TABLE public.booking_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.booking_attempts TO service_role;
-- The identity sequence gets Supabase's default grants on its own.
REVOKE ALL ON SEQUENCE public.booking_attempts_id_seq FROM PUBLIC, anon, authenticated;

-- Returns 'ok' (attempt recorded) | 'rate_limited' (this IP) | 'host_busy'
-- (this host); limited attempts are not recorded. Raises 22023 on bad input.
CREATE OR REPLACE FUNCTION public.booking_rate_check(p_ip_hash text, p_owner_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ip_hits int;
  v_owner_hits int;
BEGIN
  IF p_ip_hash IS NULL OR char_length(p_ip_hash) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'invalid_ip_hash' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'invalid_owner' USING ERRCODE = '22023';
  END IF;

  -- Serialise per IP and per host so parallel bursts can't slip past either
  -- count. Always IP first, then host, so two calls can't deadlock.
  PERFORM pg_advisory_xact_lock(hashtext('booking_rate_check:ip:' || p_ip_hash));
  PERFORM pg_advisory_xact_lock(hashtext('booking_rate_check:owner:' || p_owner_id::text));

  SELECT count(*) INTO v_ip_hits
    FROM public.booking_attempts
   WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour';
  IF v_ip_hits >= 10 THEN
    RETURN 'rate_limited';
  END IF;

  SELECT count(*) INTO v_owner_hits
    FROM public.booking_attempts
   WHERE owner_id = p_owner_id AND created_at > now() - interval '1 hour';
  IF v_owner_hits >= 30 THEN
    RETURN 'host_busy';
  END IF;

  INSERT INTO public.booking_attempts (ip_hash, owner_id) VALUES (p_ip_hash, p_owner_id);
  DELETE FROM public.booking_attempts WHERE created_at < now() - interval '2 days';

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.booking_rate_check(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_rate_check(text, uuid) TO service_role;

COMMIT;

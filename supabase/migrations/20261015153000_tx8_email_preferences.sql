-- Transactional email: Settings → Preferences → Email (specs/transactional-email.md
-- TX-8, T18, T21; AC40–AC42).
--
--   email_preferences          one row per person: the Bookings and the Trial and
--                              billing switches (default on). Its own table, not a
--                              key in user_preferences (T18): that blob syncs
--                              last-write-wins and Zod drops unknown keys, so an
--                              older build would turn an "off" back on.
--   email_prefs()              the caller's three switches, in one row.
--   email_prefs_set(b, t)      changes one or both switches; NULL leaves a switch as
--                              it is, so a device that only knows one of them can
--                              never reset the other.
--   email_build_updates_set(on) Build updates is a subscription, not a preference
--                              (T21): on subscribes the caller's own, verified
--                              address at once (no confirmation email, AC42), off
--                              unsubscribes. Works on TX-4's email_subscriptions.
--   email_outbox__claim        the worker's claim now also sets aside due rows the
--                              recipient switched off, as 'skipped_pref' (AC41).
--                              Kinds without a switch always send.
--
-- Which kinds each switch stops is EMAIL_KINDS_BY_SWITCH in @contracts;
-- drift-gates.test.ts checks the IN-lists in the claim below against it.
--
-- Account deletion (AC43) needs nothing here: email_preferences goes with the
-- auth user (FK cascade), and delete-account erases the address's rows in
-- email_outbox, email_suppressions and email_subscriptions with the service role.
--
-- Access: the table is service role only; people read and write it through the
-- three functions (SECURITY DEFINER, empty search_path, signed-in users only, never
-- an API key). The claim stays service role only.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  bookings boolean NOT NULL DEFAULT true,
  trial_billing boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_preferences IS
  'Email switches (specs/transactional-email.md T18): bookings stops C3/C4, trial_billing stops D2/D3/D5. No row = both on. Written only by email_prefs_set(); deleted with the account.';

ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_preferences TO service_role;

-- ---------------------------------------------------------------------------
-- The caller's switches
-- ---------------------------------------------------------------------------

-- Build updates reads as on only when the address is subscribed: a 'pending'
-- request from the waitlist is off until it is confirmed (TX-10) or turned on here.
CREATE OR REPLACE FUNCTION public.email_prefs()
RETURNS TABLE (bookings boolean, trial_billing boolean, build_updates boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
BEGIN
  IF v_user IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Sign in to see your email settings.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(coalesce(u.email, ''))) INTO v_email FROM auth.users u WHERE u.id = v_user;

  RETURN QUERY
  SELECT coalesce(p.bookings, true),
         coalesce(p.trial_billing, true),
         EXISTS (SELECT 1 FROM public.email_subscriptions s
                  WHERE s.email = v_email AND s.topic = 'build_updates' AND s.status = 'subscribed')
    FROM (SELECT 1) AS one
    LEFT JOIN public.email_preferences p ON p.user_id = v_user;
END;
$$;

COMMENT ON FUNCTION public.email_prefs() IS
  'TX-8: the signed-in caller''s email switches (Bookings, Trial and billing, Build updates).';

CREATE OR REPLACE FUNCTION public.email_prefs_set(
  p_bookings boolean DEFAULT NULL,
  p_trial_billing boolean DEFAULT NULL
) RETURNS TABLE (bookings boolean, trial_billing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Sign in to change your email settings.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.email_preferences AS p (user_id, bookings, trial_billing)
  VALUES (v_user, coalesce(p_bookings, true), coalesce(p_trial_billing, true))
  ON CONFLICT (user_id) DO UPDATE
     SET bookings = coalesce(p_bookings, p.bookings),
         trial_billing = coalesce(p_trial_billing, p.trial_billing),
         updated_at = now();

  RETURN QUERY
  SELECT p.bookings, p.trial_billing FROM public.email_preferences p WHERE p.user_id = v_user;
END;
$$;

COMMENT ON FUNCTION public.email_prefs_set(boolean, boolean) IS
  'TX-8: changes the caller''s Bookings and/or Trial and billing switch; NULL leaves that switch as it is.';

-- On: the caller's own address, which Auth has verified (sign-in is by code), so
-- it is subscribed at once with no confirmation email (AC42). An existing row
-- (a pending waitlist request, a TX-10 landing sign-up, an earlier unsubscribe)
-- is switched over, keeping where it first came from. Off: unsubscribed; with no
-- row there is nothing to stop.
CREATE OR REPLACE FUNCTION public.email_build_updates_set(p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
BEGIN
  IF v_user IS NULL OR public.module_api_key_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Sign in to change your email settings.' USING ERRCODE = '42501';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Build updates are on or off.' USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(coalesce(u.email, ''))), u.email_confirmed_at
    INTO v_email, v_confirmed
    FROM auth.users u WHERE u.id = v_user;

  IF p_on THEN
    IF v_confirmed IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Confirm your email address before turning on build updates.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.email_subscriptions AS s
      (email, topic, status, user_id, source, requested_at, confirmed_at, unsubscribed_at)
    VALUES (v_email, 'build_updates', 'subscribed', v_user, 'settings', now(), now(), NULL)
    ON CONFLICT (email) DO UPDATE
       SET status = 'subscribed',
           user_id = v_user,
           confirmed_at = CASE WHEN s.status = 'subscribed' THEN s.confirmed_at ELSE now() END,
           unsubscribed_at = NULL;
  ELSE
    UPDATE public.email_subscriptions s
       SET status = 'unsubscribed',
           unsubscribed_at = now()
     WHERE s.email = v_email
       AND s.status <> 'unsubscribed';
  END IF;
  RETURN p_on;
END;
$$;

COMMENT ON FUNCTION public.email_build_updates_set(boolean) IS
  'TX-8: Settings → Email → Build updates. On subscribes the caller''s verified address at once; off unsubscribes it.';

-- ---------------------------------------------------------------------------
-- The worker's claim, with the preference filter (AC41)
-- ---------------------------------------------------------------------------

-- Same as 20261008233000's, plus one step after the suppression step: a due row
-- whose kind has a switch, sent to an account that turned that switch off, is
-- 'skipped_pref'. Rows without an account (to_user_id NULL) and accounts with no
-- email_preferences row send: both switches default to on.
CREATE OR REPLACE FUNCTION public.email_outbox__claim(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
) RETURNS TABLE (
  id uuid,
  kind text,
  stream text,
  to_email text,
  to_user_id uuid,
  payload jsonb,
  dedupe_key text,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  -- A lost lease means the run died mid-row, and the send may well have gone
  -- out. It gets one extra claim beyond the 5 attempts, sent with the same
  -- Idempotency-Key, so never a second copy; only a row lost after that is
  -- given up on.
  UPDATE public.email_outbox o
     SET status = 'failed',
         locked_until = NULL,
         last_error = coalesce(o.last_error, 'worker_lost')
   WHERE o.status = 'sending'
     AND o.locked_until < now()
     AND o.attempts >= 6;

  -- Due rows to a suppressed address are never sent (sign-in codes aside).
  UPDATE public.email_outbox o
     SET status = 'suppressed',
         locked_until = NULL
   WHERE o.kind <> 'auth_code'
     AND ((o.status = 'queued' AND o.send_after <= now())
          OR (o.status = 'sending' AND o.locked_until < now()))
     AND EXISTS (SELECT 1 FROM public.email_suppressions s WHERE s.email = o.to_email);

  -- Due rows the recipient switched off in Settings → Email (TX-8).
  UPDATE public.email_outbox o
     SET status = 'skipped_pref',
         locked_until = NULL
   WHERE ((o.status = 'queued' AND o.send_after <= now())
          OR (o.status = 'sending' AND o.locked_until < now()))
     AND o.to_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.email_preferences p
        WHERE p.user_id = o.to_user_id
          AND ((NOT p.bookings AND o.kind IN ('booking_host_new','booking_host_guest_cancelled'))
               OR (NOT p.trial_billing AND o.kind IN ('trial_ending','trial_ended','founder_access_ending')))
     );

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
      FROM public.email_outbox o
     WHERE (o.status = 'queued' AND o.send_after <= now())
        OR (o.status = 'sending' AND o.locked_until < now())
     ORDER BY o.send_after, o.created_at, o.id
     LIMIT greatest(1, least(coalesce(p_limit, 10), 50))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_outbox o
     SET status = 'sending',
         attempts = o.attempts + 1,
         locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 900))),
         last_attempt_at = now()
    FROM picked
   WHERE o.id = picked.id
  RETURNING o.id, o.kind, o.stream, o.to_email, o.to_user_id, o.payload, o.dedupe_key, o.attempts;
END;
$$;

COMMENT ON FUNCTION public.email_outbox__claim(integer, integer) IS
  'email-worker only: sets aside suppressed and switched-off rows, then marks up to p_limit (max 50) due rows sending with a lease and returns them (FOR UPDATE SKIP LOCKED, so two runs never share a row).';

-- ---------------------------------------------------------------------------
-- Grants (REVOKE FROM PUBLIC alone leaves anon its EXECUTE on Supabase)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.email_prefs()',
    'public.email_prefs_set(boolean, boolean)',
    'public.email_build_updates_set(boolean)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
  REVOKE ALL ON FUNCTION public.email_outbox__claim(integer, integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.email_outbox__claim(integer, integer) TO service_role;
END
$$;

COMMIT;

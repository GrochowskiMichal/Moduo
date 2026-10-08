-- Transactional email: the outbox becomes a queue (specs/transactional-email.md
-- TX-3, T10, T12, T13, T14, T19).
--
-- TX-2 created public.email_outbox as a log of sign-in emails. This adds the
-- queue around it:
--
--   email_enqueue(kind, to_email, to_user_id, payload, dedupe_key, send_after)
--       queues one email; a second call with the same dedupe_key is a no-op.
--   email_cancel(dedupe_key_prefix)
--       cancels the queued emails whose key starts with the prefix.
--   email-worker (Edge Function) claims due rows (email_outbox__claim), sends
--       them through Resend with Idempotency-Key = dedupe_key, and records the
--       outcome (email_outbox__finish): sent, retry later, or failed.
--
-- The worker is kicked two ways: an AFTER INSERT trigger posts to it with
-- pg_net when a row is due now (once per transaction; pg_net sends only after
-- commit), and a pg_cron job every minute posts when anything is due
-- (scheduled rows, retries, a lease a crashed run left behind).
--
-- The kick carries x-email-worker-secret, a random value this migration puts in
-- Vault. The worker hands it back to email_outbox__authorize, which compares it
-- with the Vault copy, so the secret lives in one place and nobody ever types or
-- pastes it. (Amends T12, which had a second copy as a function secret.)
--
-- Only one worker run at a time holds the run lease (email_outbox_runner); a
-- kick that arrives during a run exits, and the running loop or the next
-- minute picks its rows up. A claimed row is 'sending' with a 5-minute lease. A worker that dies mid-send
-- leaves it there until the lease ends; the next run claims it again and sends
-- it with the same Idempotency-Key, which Resend answers with the first send
-- (keys live 24 h), so a crash never sends twice. Temporary failures go back to
-- 'queued' with a growing delay (1, 5, 15, 60 minutes); the 5th failed attempt,
-- or any permanent failure, marks the row 'failed'.
--
-- email_suppressions holds addresses Resend reported as a hard bounce or a spam
-- complaint (resend-webhook). A due row to a suppressed address becomes
-- 'suppressed' instead of being sent, for every kind except auth_code: sign-in
-- codes never pass through the queue, and must never be blocked by it.
--
-- Jobs: email-outbox-worker (every minute, kicks the worker when something is
-- due), email-outbox-health (every 5 minutes, queues one ops_alert to hello@
-- when a sign-in code failed or 3+ emails failed in 10 minutes, at most one per
-- 30 minutes), email-outbox-purge (daily, rescheduled to email_outbox__purge:
-- finished rows 30 days after they were sent, queued rows never, and rows of
-- deleted accounts after an hour).
--
-- Access: every function here is SECURITY DEFINER with an empty search_path and
-- executable by service_role only (REVOKE FROM PUBLIC does not cover anon, so
-- anon and authenticated are named). Features call email_enqueue/email_cancel
-- from their own definer functions, which run as the owner.
--
-- Closed vocabularies: EMAIL_SUPPRESSION_REASONS in @contracts; drift-gates.test.ts
-- checks the IN-list below.

BEGIN;

-- ---------------------------------------------------------------------------
-- Queue columns
-- ---------------------------------------------------------------------------

-- When a 'sending' row's lease ends (a crashed run's rows are claimed again).
ALTER TABLE public.email_outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
-- When the worker last tried to send the row; failures are counted from here.
ALTER TABLE public.email_outbox ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- The claim reads due queued rows and expired leases; the webhook finds a row by
-- Resend's id; the health check counts recent failures.
CREATE INDEX IF NOT EXISTS email_outbox_queued_idx ON public.email_outbox (send_after)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS email_outbox_sending_idx ON public.email_outbox (locked_until)
  WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS email_outbox_provider_idx ON public.email_outbox (provider_id)
  WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_outbox_failed_at_idx
  ON public.email_outbox ((coalesce(last_attempt_at, created_at)))
  WHERE last_error IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Suppressions (T13)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL,
  provider_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_suppressions_email_check CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320
  ),
  CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('bounce','complaint','manual')),
  CONSTRAINT email_suppressions_event_length CHECK (
    provider_event_id IS NULL OR char_length(provider_event_id) <= 200
  )
);

COMMENT ON TABLE public.email_suppressions IS
  'Addresses that get no more email except sign-in codes: hard bounces and complaints from Resend (specs/transactional-email.md T13). Kept until the address is erased. Service role only.';

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_suppressions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_suppressions TO service_role;

-- ---------------------------------------------------------------------------
-- One worker run at a time. Every transaction that queues a due email kicks
-- the worker; without this, a burst of kicks would start parallel runs whose
-- sends add up past Resend's per-team rate limit, which sign-in codes share.
-- A run takes the lease (email_outbox__run_start) or exits; the lease outlives
-- the longest possible run, so a crashed run frees it on its own.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_outbox_runner (
  id boolean PRIMARY KEY DEFAULT true,
  token uuid NOT NULL,
  locked_until timestamptz NOT NULL,
  CONSTRAINT email_outbox_runner_one_row CHECK (id)
);

COMMENT ON TABLE public.email_outbox_runner IS
  'The email-worker run lease: one row, held by at most one run (TX-3). Service role only.';

ALTER TABLE public.email_outbox_runner ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_outbox_runner FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_outbox_runner TO service_role;

-- ---------------------------------------------------------------------------
-- The worker's secret, generated in the database and kept in Vault only.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_worker_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'email_worker_secret',
      'Authorizes the pg_net kicks of the email-worker Edge Function (TX-3). Read only by email_outbox__kick and email_outbox__authorize.'
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_enqueue(
  p_kind text,
  p_to_email text,
  p_to_user_id uuid,
  p_payload jsonb,
  p_dedupe_key text,
  p_send_after timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_to text := lower(btrim(coalesce(p_to_email, '')));
  v_key text := btrim(coalesce(p_dedupe_key, ''));
  v_id uuid;
BEGIN
  IF p_kind = 'auth_code' THEN
    -- Sign-in codes are sent by auth-email-hook inside Auth's 5 seconds and only
    -- logged here; a queued one would arrive too late to use.
    RAISE EXCEPTION 'email_enqueue: auth_code is never queued' USING ERRCODE = '22023';
  END IF;
  IF v_to !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email_enqueue: invalid address' USING ERRCODE = '22023';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'email_enqueue: dedupe_key is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_outbox (kind, stream, to_email, to_user_id, payload, dedupe_key, send_after)
  VALUES (
    p_kind,
    CASE WHEN p_kind = 'build_update' THEN 'updates' ELSE 'account' END,
    v_to,
    p_to_user_id,
    coalesce(p_payload, '{}'::jsonb),
    v_key,
    coalesce(p_send_after, now())
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT o.id INTO v_id FROM public.email_outbox o WHERE o.dedupe_key = v_key;
  END IF;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.email_enqueue(text, text, uuid, jsonb, text, timestamptz) IS
  'Queues one email (TX-3). Same dedupe_key twice = one row; returns its id. payload is template data, never secrets.';

CREATE OR REPLACE FUNCTION public.email_cancel(p_dedupe_key_prefix text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  -- A short prefix would cancel far more than its caller meant.
  IF char_length(coalesce(p_dedupe_key_prefix, '')) < 3 THEN
    RAISE EXCEPTION 'email_cancel: prefix too short' USING ERRCODE = '22023';
  END IF;
  UPDATE public.email_outbox o
     SET status = 'cancelled', locked_until = NULL
   WHERE o.status = 'queued'
     AND starts_with(o.dedupe_key, p_dedupe_key_prefix);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.email_cancel(text) IS
  'Cancels queued emails whose dedupe_key starts with the prefix (TX-3). Rows already sending are not recalled. Returns how many.';

-- ---------------------------------------------------------------------------
-- Kicking the worker
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_outbox__kick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT s.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets s
   WHERE s.name = 'email_worker_secret';
  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;
  -- pg_net queues the request and sends it after this transaction commits, so
  -- the worker sees every row the transaction wrote.
  RETURN net.http_post(
    url := 'https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/email-worker',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-worker-secret', v_secret),
    timeout_milliseconds := 10000
  );
END;
$$;

-- One kick per transaction, however many due rows it inserts.
CREATE OR REPLACE FUNCTION public.email_outbox__after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('email_outbox.kicked', true), '') = 'yes' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('email_outbox.kicked', 'yes', true);
  BEGIN
    PERFORM public.email_outbox__kick();
  EXCEPTION WHEN OTHERS THEN
    -- Never fail the write that queued the email: the minute job picks it up.
    RAISE WARNING 'email_outbox__kick failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS email_outbox_kick_worker ON public.email_outbox;
CREATE TRIGGER email_outbox_kick_worker
  AFTER INSERT ON public.email_outbox
  FOR EACH ROW
  WHEN (NEW.status = 'queued' AND NEW.send_after <= now())
  EXECUTE FUNCTION public.email_outbox__after_insert();

-- The minute job: kick only when something is due, so an idle queue costs nothing.
CREATE OR REPLACE FUNCTION public.email_outbox__tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.status = 'queued' AND o.send_after <= now())
     OR EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.status = 'sending' AND o.locked_until < now()) THEN
    RETURN public.email_outbox__kick();
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- The worker's side (called by email-worker as service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.email_outbox__authorize(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  IF char_length(coalesce(p_secret, '')) < 32 THEN
    RETURN false;
  END IF;
  SELECT s.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets s
   WHERE s.name = 'email_worker_secret';
  IF v_secret IS NULL THEN
    RETURN false;
  END IF;
  -- Comparing digests keeps the comparison's timing independent of the secret.
  RETURN sha256(convert_to(p_secret, 'UTF8')) = sha256(convert_to(v_secret, 'UTF8'));
END;
$$;

-- Returns a token when this run holds the lease, NULL when another run does.
CREATE OR REPLACE FUNCTION public.email_outbox__run_start(p_lease_seconds integer DEFAULT 180)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token uuid;
BEGIN
  INSERT INTO public.email_outbox_runner AS r (id, token, locked_until)
  VALUES (true, gen_random_uuid(), now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 600))))
  ON CONFLICT (id) DO UPDATE
     SET token = EXCLUDED.token, locked_until = EXCLUDED.locked_until
   WHERE r.locked_until < now()
  RETURNING r.token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_outbox__run_stop(p_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.email_outbox_runner r
     SET locked_until = now() - interval '1 second'
   WHERE r.token = p_token;
END;
$$;

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
  -- A lost lease means the run died between sending and recording, so the
  -- send may well have gone out. It gets one extra claim beyond the 5 attempts
  -- (the same Idempotency-Key makes Resend answer with the first send); only a
  -- row lost after that is given up on.
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
  'email-worker only: marks up to p_limit (max 50) due rows sending with a lease and returns them (FOR UPDATE SKIP LOCKED, so two runs never share a row).';

-- p_outcome: 'sent', 'retry' (temporary failure; back to queued at p_retry_at
-- while attempts < 5) or 'failed'. Returns the row's new status, or NULL when
-- the row wasn't sending (already finished by another run).
CREATE OR REPLACE FUNCTION public.email_outbox__finish(
  p_id uuid,
  p_outcome text,
  p_provider_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'retry', 'failed') THEN
    RAISE EXCEPTION 'email_outbox__finish: unknown outcome %', p_outcome USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_outbox o
     SET status = CASE
           WHEN p_outcome = 'sent' THEN 'sent'
           WHEN p_outcome = 'retry' AND o.attempts < 5 THEN 'queued'
           ELSE 'failed'
         END,
         provider_id = CASE WHEN p_outcome = 'sent' THEN left(p_provider_id, 200) ELSE o.provider_id END,
         sent_at = CASE WHEN p_outcome = 'sent' THEN now() ELSE o.sent_at END,
         last_error = CASE
           WHEN p_outcome = 'sent' THEN NULL
           ELSE left(coalesce(nullif(p_error, ''), 'unknown_error'), 1000)
         END,
         send_after = CASE
           WHEN p_outcome = 'retry' AND o.attempts < 5
             THEN greatest(coalesce(p_retry_at, now() + interval '1 minute'), now())
           ELSE o.send_after
         END,
         locked_until = NULL
   WHERE o.id = p_id
     AND o.status = 'sending'
  RETURNING o.status INTO v_status;
  RETURN v_status;
END;
$$;

-- Resend's webhook (resend-webhook): suppress an address.
CREATE OR REPLACE FUNCTION public.email_suppression__add(
  p_email text,
  p_reason text,
  p_provider_event_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_added boolean;
BEGIN
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'email_suppression__add: invalid address' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.email_suppressions (email, reason, provider_event_id)
  VALUES (v_email, p_reason, left(p_provider_event_id, 200))
  ON CONFLICT (email) DO NOTHING
  RETURNING true INTO v_added;
  RETURN coalesce(v_added, false);
END;
$$;

-- Resend's webhook: an email reached the recipient's server.
CREATE OR REPLACE FUNCTION public.email_outbox__delivered(p_provider_id text, p_at timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF coalesce(p_provider_id, '') = '' THEN
    RETURN 0;
  END IF;
  UPDATE public.email_outbox o
     SET delivered_at = coalesce(o.delivered_at, coalesce(p_at, now()))
   WHERE o.provider_id = p_provider_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

-- T19: one ops_alert to hello@ when any sign-in code failed, or 3+ emails
-- failed, in the last 10 minutes; at most one alert per 30 minutes. "Failed"
-- includes emails still being retried after failing twice, so an outage alerts
-- within minutes rather than after the 5th attempt (~80 minutes); a single
-- blip that the 1-minute retry fixes doesn't. Failed alerts don't count (if
-- Resend is down the alert fails too; its status page is the backstop).
-- Returns the alert's id, or NULL when nothing was queued.
CREATE OR REPLACE FUNCTION public.email_outbox__health()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since timestamptz := now() - interval '10 minutes';
  v_auth integer;
  v_other integer;
  v_errors jsonb;
BEGIN
  -- Two runs at once must not both decide to alert.
  PERFORM pg_advisory_xact_lock(hashtext('public.email_outbox__health'));

  SELECT count(*) FILTER (WHERE o.kind = 'auth_code'),
         count(*) FILTER (WHERE o.kind <> 'auth_code')
    INTO v_auth, v_other
    FROM public.email_outbox o
   WHERE o.last_error IS NOT NULL
     AND (o.status = 'failed' OR (o.status = 'queued' AND o.attempts >= 2))
     AND o.kind <> 'ops_alert'
     AND coalesce(o.last_attempt_at, o.created_at) >= v_since;

  IF v_auth = 0 AND v_auth + v_other < 3 THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.email_outbox a
     WHERE a.kind = 'ops_alert'
       AND a.payload ->> 'reason' = 'failures'
       AND a.created_at > now() - interval '30 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  -- The commonest errors, with any address in them blanked: the alert is about
  -- what broke, not who it was for.
  SELECT coalesce(jsonb_agg(jsonb_build_object('error', e.error, 'count', e.n) ORDER BY e.n DESC, e.error), '[]'::jsonb)
    INTO v_errors
    FROM (
      SELECT left(regexp_replace(coalesce(o.last_error, 'unknown_error'), '[^[:space:]<>"'',;:()]+@[^[:space:]<>"'',;:()]+', '[address]', 'g'), 200) AS error,
             count(*) AS n
        FROM public.email_outbox o
       WHERE o.last_error IS NOT NULL
         AND (o.status = 'failed' OR (o.status = 'queued' AND o.attempts >= 2))
         AND o.kind <> 'ops_alert'
         AND coalesce(o.last_attempt_at, o.created_at) >= v_since
       GROUP BY 1
       ORDER BY count(*) DESC, 1
       LIMIT 3
    ) e;

  RETURN public.email_enqueue(
    'ops_alert',
    'hello@moduo.app',
    NULL,
    jsonb_build_object(
      'reason', 'failures',
      'window_minutes', 10,
      'auth_code_failed', v_auth,
      'other_failed', v_other,
      'errors', v_errors,
      'detected_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'ops_alert:failures:' || floor(extract(epoch FROM now()) / 1800)::bigint,
    now()
  );
END;
$$;

-- T14 / AC18: the 30-day record. A row is kept 30 days after it was sent (or
-- last tried); rows still waiting to go out are never deleted (a reminder can be
-- queued months ahead). Rows of a deleted account go after an hour's grace,
-- whatever their state (TX-2: the hook may log a new user's row before Auth
-- commits that user).
CREATE OR REPLACE FUNCTION public.email_outbox__purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.email_outbox o
   WHERE (o.status NOT IN ('queued', 'sending')
          AND coalesce(o.sent_at, o.last_attempt_at, o.created_at) < now() - interval '30 days')
      OR (o.to_user_id IS NOT NULL
          AND o.created_at < now() - interval '1 hour'
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.to_user_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only, for every function above.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.email_enqueue(text, text, uuid, jsonb, text, timestamptz)',
    'public.email_cancel(text)',
    'public.email_outbox__kick()',
    'public.email_outbox__after_insert()',
    'public.email_outbox__tick()',
    'public.email_outbox__authorize(text)',
    'public.email_outbox__run_start(integer)',
    'public.email_outbox__run_stop(uuid)',
    'public.email_outbox__claim(integer, integer)',
    'public.email_outbox__finish(uuid, text, text, text, timestamptz)',
    'public.email_suppression__add(text, text, text)',
    'public.email_outbox__delivered(text, timestamptz)',
    'public.email_outbox__health()',
    'public.email_outbox__purge()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- pg_cron (cron.schedule with an existing job name replaces that job)
-- ---------------------------------------------------------------------------

SELECT cron.schedule('email-outbox-worker', '* * * * *', $job$SELECT public.email_outbox__tick()$job$);
SELECT cron.schedule('email-outbox-health', '*/5 * * * *', $job$SELECT public.email_outbox__health()$job$);
SELECT cron.schedule('email-outbox-purge', '17 3 * * *', $job$SELECT public.email_outbox__purge()$job$);

COMMIT;

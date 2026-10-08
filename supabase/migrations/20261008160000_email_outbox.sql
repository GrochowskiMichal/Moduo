-- Transactional email: the outbox, in its log role (specs/transactional-email.md
-- TX-2, T10/T11).
--
-- One table is both the queue (TX-3 adds the worker, enqueue/cancel and the
-- retry states) and the log of every email Moduo sends. TX-2 writes one row per
-- sign-in email the auth-email-hook function sends, after the send, with the
-- outcome. A row never holds a sign-in code or its hash: `payload` is template
-- data only, and the hook logs the auth action, not the email_data.
--
-- Access: RLS on with no policies, nothing granted to anon/authenticated
-- (REVOKE FROM PUBLIC does not cover anon). Only the service role (Edge
-- Functions) and SECURITY DEFINER helpers read or write it.
--
-- to_user_id has deliberately NO foreign key to auth.users. Auth calls the
-- Send Email Hook inside the transaction that creates a new user (a dashboard
-- invite now, every first sign-in once TX-4 opens sign-ups), and the hook logs
-- over another connection, which can't see that uncommitted row: a foreign key
-- would refuse exactly those log rows.
--
-- Retention and erasure: a daily pg_cron job deletes rows older than 30 days
-- (the privacy policy's promise) and rows whose account no longer exists, so a
-- deleted account's log is gone within a day. Rows for addresses that never had
-- an account (waitlist invites, from TX-4) are erased by address in
-- delete-account (TX-8, T25). TX-3 adds its other purge jobs next to this one.
--
-- Closed vocabularies live in @contracts (EMAIL_KINDS, EMAIL_STREAMS,
-- EMAIL_OUTBOX_STATUSES); drift-gates.test.ts checks these IN-lists.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  stream text NOT NULL DEFAULT 'account',
  to_email text NOT NULL,
  to_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  send_after timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  provider_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_dedupe_key_key UNIQUE (dedupe_key),
  CONSTRAINT email_outbox_kind_check CHECK (kind IN ('auth_code','account_deleted','waitlist_invite','updates_confirm','workspace_invite','workspace_owner','workspace_removed','booking_guest_confirmed','booking_guest_added','booking_host_new','booking_host_guest_cancelled','booking_guest_cancelled','booking_guest_host_cancelled','booking_guest_reminder','welcome','trial_ending','trial_ended','founder_access','founder_access_ending','announcement','build_update','ops_alert')),
  CONSTRAINT email_outbox_stream_check CHECK (stream IN ('account','updates')),
  CONSTRAINT email_outbox_status_check CHECK (status IN ('queued','sending','sent','failed','cancelled','suppressed','skipped_pref')),
  -- Stored lower-cased and trimmed, so lookups by address are exact matches.
  CONSTRAINT email_outbox_to_email_check CHECK (
    to_email = lower(btrim(to_email)) AND char_length(to_email) BETWEEN 3 AND 320
  ),
  CONSTRAINT email_outbox_dedupe_key_length CHECK (char_length(dedupe_key) BETWEEN 1 AND 512),
  CONSTRAINT email_outbox_attempts_check CHECK (attempts >= 0),
  CONSTRAINT email_outbox_last_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  CONSTRAINT email_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE public.email_outbox IS
  'Every email Moduo sends: queue + 30-day log (specs/transactional-email.md T10). Never holds sign-in codes. Service role only.';

CREATE INDEX IF NOT EXISTS email_outbox_created_idx ON public.email_outbox (created_at);
CREATE INDEX IF NOT EXISTS email_outbox_to_email_idx ON public.email_outbox (to_email);
CREATE INDEX IF NOT EXISTS email_outbox_to_user_idx ON public.email_outbox (to_user_id)
  WHERE to_user_id IS NOT NULL;
-- The ops alert (TX-3, T19) counts recent failures.
CREATE INDEX IF NOT EXISTS email_outbox_failed_idx ON public.email_outbox (created_at)
  WHERE status = 'failed';

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_outbox TO service_role;

-- 30-day retention + the log of deleted accounts. cron.schedule with a job
-- name replaces an existing job of that name, so re-running this is safe.
SELECT cron.schedule(
  'email-outbox-purge',
  '17 3 * * *',
  $job$DELETE FROM public.email_outbox o WHERE o.created_at < now() - interval '30 days' OR (o.to_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.to_user_id))$job$
);

COMMIT;

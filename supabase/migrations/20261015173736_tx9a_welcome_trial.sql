-- TX-9a · Welcome and trial emails (specs/transactional-email.md T23, AC44–AC46).
--
-- 1. D1 `welcome`: when someone creates the first workspace they own, one email
--    about 5 minutes later (dedupe key `D1:<user>`). "Once ever" is kept by
--    `profiles.welcome_email_at`, not by the dedupe key alone: the outbox purge
--    deletes sent rows after 30 days, so a key can't remember for longer. A
--    workspace that isn't the owner's only one (any state, trashed included)
--    sends nothing, so people who had workspaces before this shipped never get
--    a welcome for their next one.
-- 2. The trial reaches `profiles` from the Stripe mirror a minute or more after
--    sign-in, often after onboarding made the workspace. While D1 waits and has
--    never been tried, a profile change refreshes its name and trial date
--    (after a first attempt the body must stay what Resend already has).
-- 3. D2 `trial_ending`: an hourly sweep queues one email per trial for no-card
--    trials ending within 72 hours with no plan chosen (dedupe key
--    `D2:<user>:<trial end, UTC date>`). A trial with a card on file turns into
--    a paid plan at its end, so it gets no "you move to Free" warning.
-- 4. D3 `trial_ended`: when `profiles.subscription_status` goes trialing →
--    canceled on Free, one email (dedupe key `D3:<user>:<trial end, UTC date>`),
--    unless one of the person's Stripe subscriptions was canceled with the
--    comment "Moduo account deleted" (account-erasure.ts): a trial ended by
--    deleting the account sends nothing. `inactive` (no subscription left at
--    all) never sends either. Leaving the trial any way cancels a D2 still
--    waiting.
--
-- "Trial and billing" off (TX-8's email_preferences) mutes D2/D3 when the
-- worker claims them, through `to_user_id`; D1 always sends.
--
-- Every payload carries the dates it prints and the recipient's zone
-- (`user_preferences.time_zone`, UTC when unset), so a retry renders the same
-- body (TX-3). Kinds welcome / trial_ending / trial_ended are already in
-- email_outbox's CHECK (TX-1/TX-2). Deploy `email-worker` with their templates
-- before applying this (docs/email-runbook.md §TX-9a).
--
-- Verified on the local stack by supabase/tests/trial_emails.test.sql.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Shared
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS welcome_email_at timestamptz;
COMMENT ON COLUMN public.profiles.welcome_email_at IS
  'When D1 (welcome) was queued for this person (TX-9a). Set once by the first-workspace trigger; never by clients.';

-- Clients write only the columns 20261006120000 granted, so the new column is
-- server-only. Re-asserted here (a no-op on prod) because the local snapshot
-- grants anon and authenticated the whole table (docs/gotchas/supabase.md).
REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT INSERT (id, display_name, avatar_url, local_user_id, recovery_seed_hash, cloud_linked)
  ON public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_url, local_user_id, recovery_seed_hash, cloud_linked, updated_at)
  ON public.profiles TO authenticated;

-- An ISO time as the templates read it (UTC, seconds). The same as TX-7's
-- workspace__email_time, kept separate so this file doesn't need TX-7 applied.
CREATE OR REPLACE FUNCTION public.email__iso_time(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- The zone a person's emails write dates in.
CREATE OR REPLACE FUNCTION public.email__user_zone(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT nullif(btrim(up.time_zone), '') FROM public.user_preferences up WHERE up.user_id = p_user),
    'UTC'
  )
$$;

-- The parts of D1's payload that come from the profile: the name to greet and
-- the trial's end (none for a founder, or before the trial is mirrored).
CREATE OR REPLACE FUNCTION public.email__welcome_profile(p public.profiles)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'name', coalesce(btrim(p.display_name), ''),
    'trial_ends_at', CASE
      WHEN p.plan_tier::text <> 'founder' AND p.subscription_status = 'trialing' AND p.current_period_end IS NOT NULL
        THEN public.email__iso_time(p.current_period_end)
    END,
    'zone', public.email__user_zone(p.id)
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. D1 on the first workspace
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workspaces__enqueue_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles;
  v_email text;
BEGIN
  IF NEW.owner_id IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces w WHERE w.owner_id = NEW.owner_id AND w.id <> NEW.id) THEN
    RETURN NULL;
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = NEW.owner_id;
  IF coalesce(v_email, '') = '' THEN RETURN NULL; END IF;

  -- The row lock makes two first workspaces made at once queue one welcome.
  UPDATE public.profiles p
     SET welcome_email_at = now()
   WHERE p.id = NEW.owner_id AND p.welcome_email_at IS NULL
  RETURNING * INTO v_profile;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM public.email_enqueue(
    'welcome',
    v_email,
    NEW.owner_id,
    jsonb_build_object(
      'user_id', NEW.owner_id,
      'workspace_id', NEW.id,
      'workspace_name', coalesce(btrim(NEW.name), '')
    ) || public.email__welcome_profile(v_profile),
    'D1:' || NEW.owner_id::text,
    now() + interval '5 minutes'
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A welcome email must never stop someone from making a workspace.
  RAISE WARNING 'welcome email for workspace % not queued: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_enqueue_welcome ON public.workspaces;
CREATE TRIGGER workspaces_enqueue_welcome
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces__enqueue_welcome();

-- ---------------------------------------------------------------------------
-- 2 + 4. Profile changes: refresh a waiting D1, queue D3, drop a stale D2
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profiles__trial_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_end timestamptz;
BEGIN
  UPDATE public.email_outbox o
     SET payload = o.payload || public.email__welcome_profile(NEW)
   WHERE o.dedupe_key = 'D1:' || NEW.id::text
     AND o.status = 'queued'
     AND o.attempts = 0;

  IF OLD.subscription_status = 'trialing' AND NEW.subscription_status IS DISTINCT FROM 'trialing' THEN
    PERFORM public.email_cancel('D2:' || NEW.id::text || ':');
  END IF;

  IF OLD.subscription_status = 'trialing'
     AND NEW.subscription_status = 'canceled'
     AND NEW.plan_tier::text = 'free'
     AND NOT EXISTS (
       SELECT 1 FROM stripe.subscriptions s
        WHERE (s.id = OLD.stripe_subscription_id
               OR s.customer = coalesce(NEW.stripe_customer_id, OLD.stripe_customer_id)
               OR s.metadata ->> 'supabase_user_id' = NEW.id::text)
          AND s._raw_data -> 'cancellation_details' ->> 'comment' = 'Moduo account deleted'
     ) THEN
    SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = NEW.id;
    IF coalesce(v_email, '') <> '' THEN
      v_end := coalesce(OLD.current_period_end, now());
      PERFORM public.email_enqueue(
        'trial_ended',
        v_email,
        NEW.id,
        jsonb_build_object(
          'user_id', NEW.id,
          'ended_at', public.email__iso_time(v_end),
          'zone', public.email__user_zone(NEW.id)
        ),
        'D3:' || NEW.id::text || ':' || to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
        NULL
      );
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Entitlements are written from the Stripe sync's own trigger; an email
  -- problem must never undo a plan change.
  RAISE WARNING 'trial emails for profile % not queued: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_trial_emails ON public.profiles;
CREATE TRIGGER profiles_trial_emails
  AFTER UPDATE OF display_name, plan_tier, subscription_status, current_period_end ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles__trial_emails();

-- ---------------------------------------------------------------------------
-- 3. D2, the hourly sweep
-- ---------------------------------------------------------------------------

-- Queues D2 for every no-card trial ending within 72 hours of p_now that has
-- no plan chosen and no D2 yet. Returns how many it queued.
CREATE OR REPLACE FUNCTION public.email__trial_ending_sweep(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  -- Trials live in Stripe; a database without the Stripe mirror has none.
  IF to_regclass('stripe.subscriptions') IS NULL OR to_regclass('stripe.payment_methods') IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT p.id,
           p.current_period_end,
           lower(btrim(u.email)) AS email,
           'D2:' || p.id::text || ':' || to_char(p.current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS dedupe_key
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE p.subscription_status = 'trialing'
       AND p.plan_tier::text <> 'founder'
       AND p.current_period_end > p_now
       AND p.current_period_end <= p_now + interval '72 hours'
       AND coalesce(btrim(u.email), '') <> ''
       -- No card anywhere: the trial's own, the customer's default, or any saved.
       AND NOT EXISTS (
         SELECT 1 FROM stripe.subscriptions s
          WHERE s.id = p.stripe_subscription_id
            AND (s.default_payment_method IS NOT NULL OR s.default_source IS NOT NULL)
       )
       AND NOT EXISTS (
         SELECT 1 FROM stripe.customers c
          WHERE c.id = p.stripe_customer_id
            AND coalesce(c.invoice_settings ->> 'default_payment_method', '') <> ''
       )
       AND NOT EXISTS (SELECT 1 FROM stripe.payment_methods pm WHERE pm.customer = p.stripe_customer_id)
       -- No plan chosen alongside the trial.
       AND NOT EXISTS (
         SELECT 1 FROM stripe.subscriptions s
          WHERE s.customer = p.stripe_customer_id
            AND s.status IN ('active', 'past_due')
       )
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.dedupe_key = r.dedupe_key);
    PERFORM public.email_enqueue(
      'trial_ending',
      r.email,
      r.id,
      jsonb_build_object(
        'user_id', r.id,
        'ends_at', public.email__iso_time(r.current_period_end),
        'zone', public.email__user_zone(r.id)
      ),
      r.dedupe_key,
      NULL
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

SELECT cron.schedule(
  'email-trial-ending',
  '41 * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.email__trial_ending_sweep(now());$cron$
);

-- ---------------------------------------------------------------------------
-- Grants. All of these are internal: REVOKE FROM PUBLIC doesn't cover anon or
-- authenticated on Supabase, so name them.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.email__iso_time(timestamptz)',
    'public.email__user_zone(uuid)',
    'public.email__welcome_profile(public.profiles)',
    'public.workspaces__enqueue_welcome()',
    'public.profiles__trial_emails()',
    'public.email__trial_ending_sweep(timestamptz)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$$;

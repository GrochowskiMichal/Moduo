-- Invite-only gate + waitlist invites (specs/transactional-email.md TX-4, T9,
-- T14, T21; AC20–AC24).
--
-- Moduo stays invite-only once "Allow new users to sign up" is switched on:
-- Supabase Auth calls public.hook_before_user_created (a Postgres auth hook,
-- switched on in the dashboard, docs/email-runbook.md §TX-4) before it creates
-- any user, and the hook lets an address in only when one source names it:
--
--   * a waitlist row with status 'invited';
--   * a pending, unexpired workspace invite for that address;
--   * founder_emails.
--
-- (Founder access grants, plan_grants, join this list in TX-9b, which creates
-- that table. A branch reading it here would fail every sign-up until then.)
--
-- Anything else gets {"error":{"http_code":403,"message":"invite_only"}}; no
-- user is created and no email is sent. The hook reads the sources directly,
-- so revoking an invite or deleting an account takes access away with nothing
-- to keep in step. Existing users never pass through it: it runs only when
-- Auth is about to create a user.
--
-- Inviting from the waitlist (flow 2): set a row's status to 'invited' in the
-- Table Editor, or call one of the helpers below from the SQL editor. Every
-- change into 'invited' stamps invited_at and queues B1 (kind waitlist_invite)
-- through email_enqueue, once per invite (dedupe key B1:<row>:<invited_at>).
--
--   waitlist_invite_next(n)       the n oldest pending rows (at most 50)
--   waitlist_invite_email(addr)   someone not on the list (source 'manual')
--   waitlist_resend_invite(addr)  B1 again, with a new dedupe key
--
-- When the account is created, handle_new_user deletes the waitlist row (the
-- privacy policy keeps it only "until you join"); a build-updates request on it
-- moves to email_subscriptions first, as a 'pending' request (AC22). That table
-- is T21's, created here so the request has somewhere to go; TX-8 and TX-10 add
-- confirming, Settings and unsubscribing on top. Invited rows nobody used are
-- deleted 12 months after invited_at (pg_cron waitlist-purge, daily).
--
-- Closed vocabularies: WAITLIST_STATUSES, WAITLIST_ROW_SOURCES and the
-- EMAIL_SUBSCRIPTION_* lists in @contracts; drift-gates.test.ts checks the
-- IN-lists below.
--
-- Order on prod: deploy email-worker with the waitlist_invite template first
-- (a queued kind the worker can't render retries, then fails), then this
-- migration, then the dashboard steps. Nothing is queued until someone invites.

BEGIN;

-- ---------------------------------------------------------------------------
-- Waitlist: invited status, invited_at, manual source
-- ---------------------------------------------------------------------------

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS invited_at timestamptz;

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_status_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_status_check
  CHECK (status IN ('pending','confirmed','cancelled','invited'));

ALTER TABLE public.waitlist DROP CONSTRAINT IF EXISTS waitlist_source_check;
ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_source_check
  CHECK (source IS NULL OR source IN ('nav','hero','close','footer','manual'));

-- The purge reads invited rows by invited_at; the hook reads by email (unique).
CREATE INDEX IF NOT EXISTS waitlist_invited_at_idx ON public.waitlist (invited_at)
  WHERE status = 'invited';
-- invite_next takes the oldest pending rows first.
CREATE INDEX IF NOT EXISTS waitlist_pending_created_idx ON public.waitlist (created_at)
  WHERE status = 'pending';

COMMENT ON COLUMN public.waitlist.invited_at IS
  'When the row last became invited (TX-4). Set by trigger; the 12-month purge counts from here.';

-- ---------------------------------------------------------------------------
-- Build-updates subscriptions (T21). Service role only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_subscriptions (
  email text PRIMARY KEY,
  topic text NOT NULL DEFAULT 'build_updates',
  status text NOT NULL DEFAULT 'pending',
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  source text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  CONSTRAINT email_subscriptions_email_check CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320
  ),
  CONSTRAINT email_subscriptions_topic_check CHECK (topic IN ('build_updates')),
  CONSTRAINT email_subscriptions_status_check CHECK (status IN ('pending','subscribed','unsubscribed')),
  CONSTRAINT email_subscriptions_source_check CHECK (source IN ('waitlist','settings'))
);

COMMENT ON TABLE public.email_subscriptions IS
  'Build-updates subscriptions (specs/transactional-email.md T21). TX-4 moves a waitlist request here at sign-up, as pending; nothing is sent to a pending row until it is confirmed (TX-10). Deleted with the account. Service role only.';

ALTER TABLE public.email_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.email_subscriptions TO service_role;

CREATE INDEX IF NOT EXISTS email_subscriptions_user_idx ON public.email_subscriptions (user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- invited_at follows the status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.waitlist__stamp_invited()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'invited' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'invited' THEN
      NEW.invited_at := clock_timestamp();
    END IF;
  ELSE
    NEW.invited_at := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waitlist_stamp_invited ON public.waitlist;
CREATE TRIGGER waitlist_stamp_invited
  BEFORE INSERT OR UPDATE OF status ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.waitlist__stamp_invited();

-- ---------------------------------------------------------------------------
-- B1: one email per invite
-- ---------------------------------------------------------------------------

-- The template renders from this payload alone (TX-3: a retry must build the
-- same email), so the join date travels with it.
CREATE OR REPLACE FUNCTION public.waitlist__queue_invite(
  p_id uuid,
  p_email text,
  p_source text,
  p_joined_at timestamptz,
  p_dedupe_key text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.email_enqueue(
    'waitlist_invite',
    p_email,
    NULL,
    jsonb_build_object(
      'email', p_email,
      'joined_at', to_char(p_joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'manual', coalesce(p_source = 'manual', false)
    ),
    p_dedupe_key,
    NULL
  );
END;
$$;

-- Why an address shouldn't get B1 now, or NULL when it should.
CREATE OR REPLACE FUNCTION public.waitlist__invite_blocker(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.email_suppressions s WHERE s.email = p_email) THEN 'suppressed'
    WHEN EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = p_email) THEN 'already_a_user'
  END;
$$;

CREATE OR REPLACE FUNCTION public.waitlist__enqueue_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_blocker text;
BEGIN
  IF NEW.status = 'invited' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'invited') THEN
    -- A Table Editor flip gets the same checks as the helpers: no B1 to an
    -- address that bounced or complained, or to someone who already has an
    -- account (the row stays invited; the hook lets the address in either way).
    v_blocker := public.waitlist__invite_blocker(NEW.email);
    IF v_blocker IS NOT NULL THEN
      RAISE NOTICE 'waitlist: no invite email to % (%)', NEW.email, v_blocker;
      RETURN NULL;
    END IF;
    PERFORM public.waitlist__queue_invite(
      NEW.id,
      NEW.email,
      NEW.source,
      NEW.created_at,
      'B1:' || NEW.id::text || ':' || floor(extract(epoch FROM NEW.invited_at) * 1000)::bigint::text
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS waitlist_enqueue_invite ON public.waitlist;
CREATE TRIGGER waitlist_enqueue_invite
  AFTER INSERT OR UPDATE OF status ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.waitlist__enqueue_invite();

-- ---------------------------------------------------------------------------
-- Dashboard helpers (SQL editor). Each returns what it did per address.
-- ---------------------------------------------------------------------------

-- The n oldest pending rows become invited (at most 50 per call). Addresses
-- that bounced or complained, and people who already have an account, are
-- skipped and stay pending.
CREATE OR REPLACE FUNCTION public.waitlist_invite_next(p_count integer DEFAULT 20)
RETURNS TABLE (address text, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'waitlist_invite_next: invite at least 1' USING ERRCODE = '22023';
  END IF;
  v_limit := least(p_count, 50);
  IF p_count > 50 THEN
    RAISE NOTICE 'waitlist_invite_next: at most 50 per call, inviting 50';
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT w.id
      FROM public.waitlist w
     WHERE w.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE s.email = w.email)
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = w.email)
     ORDER BY w.created_at, w.id
     LIMIT v_limit
     FOR UPDATE OF w SKIP LOCKED
  )
  UPDATE public.waitlist w
     SET status = 'invited'
    FROM picked
   WHERE w.id = picked.id
  RETURNING w.email, 'invited'::text;
END;
$$;

-- Invites an address, adding it to the list (source 'manual') when it isn't
-- there. Returns invited | already_invited | suppressed | already_a_user.
CREATE OR REPLACE FUNCTION public.waitlist_invite_email(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_blocker text;
  v_status text;
BEGIN
  IF char_length(v_email) NOT BETWEEN 3 AND 254
     OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'waitlist_invite_email: invalid address' USING ERRCODE = '22023';
  END IF;

  v_blocker := public.waitlist__invite_blocker(v_email);
  IF v_blocker IS NOT NULL THEN
    RAISE NOTICE 'waitlist_invite_email: not invited (%)', v_blocker;
    RETURN v_blocker;
  END IF;

  SELECT w.status INTO v_status FROM public.waitlist w WHERE w.email = v_email FOR UPDATE;
  IF v_status = 'invited' THEN
    RAISE NOTICE 'waitlist_invite_email: already invited; waitlist_resend_invite sends the email again';
    RETURN 'already_invited';
  ELSIF v_status IS NOT NULL THEN
    IF v_status <> 'pending' THEN
      RAISE NOTICE 'waitlist_invite_email: the row was %, inviting anyway', v_status;
    END IF;
    UPDATE public.waitlist w SET status = 'invited' WHERE w.email = v_email;
  ELSE
    INSERT INTO public.waitlist AS w (email, source, status)
    VALUES (v_email, 'manual', 'invited')
    ON CONFLICT (email) DO UPDATE SET status = 'invited'
      WHERE w.status <> 'invited';
  END IF;
  RETURN 'invited';
END;
$$;

-- Sends B1 again to an invited address. Returns queued | not_invited |
-- already_queued | suppressed | already_a_user.
CREATE OR REPLACE FUNCTION public.waitlist_resend_invite(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.waitlist%ROWTYPE;
  v_blocker text;
BEGIN
  SELECT * INTO v_row FROM public.waitlist w WHERE w.email = v_email AND w.status = 'invited' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE NOTICE 'waitlist_resend_invite: % is not invited; waitlist_invite_email invites it', v_email;
    RETURN 'not_invited';
  END IF;

  v_blocker := public.waitlist__invite_blocker(v_email);
  IF v_blocker IS NOT NULL THEN
    RAISE NOTICE 'waitlist_resend_invite: not sent (%)', v_blocker;
    RETURN v_blocker;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.email_outbox o
     WHERE starts_with(o.dedupe_key, 'B1:' || v_row.id::text || ':')
       AND o.status IN ('queued', 'sending')
  ) THEN
    RAISE NOTICE 'waitlist_resend_invite: an invite to % is already on its way', v_email;
    RETURN 'already_queued';
  END IF;

  PERFORM public.waitlist__queue_invite(
    v_row.id,
    v_row.email,
    v_row.source,
    v_row.created_at,
    'B1:' || v_row.id::text || ':resend:' || floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text
  );
  RETURN 'queued';
END;
$$;

-- ---------------------------------------------------------------------------
-- The gate: Supabase Auth's before-user-created hook (T9)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hook_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
BEGIN
  IF v_email <> '' AND (
       EXISTS (SELECT 1 FROM public.waitlist w WHERE w.email = v_email AND w.status = 'invited')
    OR EXISTS (
         SELECT 1 FROM public.workspace_invites i
          WHERE lower(btrim(i.email)) = v_email
            AND i.status = 'pending'
            AND i.expires_at > now()
       )
    OR EXISTS (SELECT 1 FROM public.founder_emails f WHERE f.email = v_email)
  ) THEN
    RETURN '{}'::jsonb;
  END IF;
  -- The client maps the message `invite_only` to the invite-only copy.
  RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'invite_only'));
END;
$$;

COMMENT ON FUNCTION public.hook_before_user_created(jsonb) IS
  'Supabase Auth before-user-created hook (TX-4, T9): lets an address sign up only when it is invited from the waitlist, has a pending workspace invite, or is a founder. Called by supabase_auth_admin only.';

-- ---------------------------------------------------------------------------
-- Sign-up: the waitlist row goes, a build-updates request stays (AC22)
-- ---------------------------------------------------------------------------

-- Same signature as 20261006120000's, so the prod-only on_auth_user_created
-- trigger keeps calling it. Runs inside Auth's create transaction: if Auth
-- rolls the user back (a failed code email), the delete rolls back too.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  insert into public.profiles (id, display_name, created_at, updated_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''), now(), now())
  on conflict (id) do nothing;
  perform public.recompute_entitlement(new.id);

  if v_email <> '' then
    insert into public.email_subscriptions (email, topic, status, user_id, source, requested_at)
    select w.email, 'build_updates', 'pending', new.id, 'waitlist', coalesce(w.updates_requested_at, w.created_at)
      from public.waitlist w
     where w.email = v_email and w.updates_requested
    on conflict (email) do nothing;
    delete from public.waitlist w where w.email = v_email;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12-month purge of unused invites (T14, AC23)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.waitlist__purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.waitlist w
   WHERE w.status = 'invited'
     AND w.invited_at < now() - interval '12 months';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. REVOKE FROM PUBLIC doesn't cover anon on Supabase, so name them.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.waitlist__stamp_invited()',
    'public.waitlist__queue_invite(uuid, text, text, timestamptz, text)',
    'public.waitlist__enqueue_invite()',
    'public.waitlist__invite_blocker(text)',
    'public.waitlist_invite_next(integer)',
    'public.waitlist_invite_email(text)',
    'public.waitlist_resend_invite(text)',
    'public.waitlist__purge()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END
$$;

-- Only Auth calls the hook.
REVOKE ALL ON FUNCTION public.hook_before_user_created(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hook_before_user_created(jsonb) TO supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- pg_cron (cron.schedule with an existing job name replaces that job)
-- ---------------------------------------------------------------------------

SELECT cron.schedule('waitlist-purge', '29 3 * * *', $job$SELECT public.waitlist__purge()$job$);

COMMIT;

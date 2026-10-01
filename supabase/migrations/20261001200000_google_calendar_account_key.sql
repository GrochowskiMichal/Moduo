-- One Google login per row. The old unique (user_id, provider) kept a single
-- google_calendar token, so connecting a second account replaced the first.
-- account_key is the Google email. Zoom and Meet stay one row (empty key).

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS account_key text NOT NULL DEFAULT '';

ALTER TABLE public.user_integrations
  DROP CONSTRAINT IF EXISTS user_integrations_user_id_provider_key;

ALTER TABLE public.user_integrations
  DROP CONSTRAINT IF EXISTS user_integrations_user_provider_account_key;

ALTER TABLE public.user_integrations
  ADD CONSTRAINT user_integrations_user_provider_account_key
  UNIQUE (user_id, provider, account_key);

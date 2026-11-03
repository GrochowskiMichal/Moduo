-- Outlook Calendar on the web: calendar-microsoft-web stores the person's
-- Microsoft refresh token on user_integrations (provider microsoft_calendar,
-- one row per Microsoft login in account_key), as booking-google-connect does
-- for Google.

ALTER TABLE public.user_integrations
  DROP CONSTRAINT IF EXISTS user_integrations_provider_check;

ALTER TABLE public.user_integrations
  ADD CONSTRAINT user_integrations_provider_check
  CHECK (provider = ANY (ARRAY[
    'zoom'::text,
    'google_meet'::text,
    'google_calendar'::text,
    'microsoft_calendar'::text
  ]));

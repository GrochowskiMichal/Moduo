-- Booking stores the host's Google refresh token on user_integrations.
-- The original check only allowed zoom and google_meet, so the connect
-- callback inserted nothing and returned save_failed.

ALTER TABLE public.user_integrations
  DROP CONSTRAINT user_integrations_provider_check;

ALTER TABLE public.user_integrations
  ADD CONSTRAINT user_integrations_provider_check
  CHECK (provider = ANY (ARRAY['zoom'::text, 'google_meet'::text, 'google_calendar'::text]));

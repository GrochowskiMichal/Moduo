-- Chat v2 · CV-23 the minimum desktop build (specs/chat-v2.md AC12.9;
-- §Assumptions #4). After …_chat_v2_contract, which retired the v1 signatures.
--
-- Apply it only once the web app and the desktop build that check the minimum
-- per platform are live (the web app is never held back; only a desktop build
-- is). A web bundle from before that check compares its own version and would
-- go read-only.
--
-- 1.0.21 is the first production desktop build that sends only v2 signatures
-- (release run #21, 2026-10-16, built from prod-app with Chat v2). Builds up to
-- 1.0.20 are told to update and run read-only; every build from the VERSION
-- file on (1.1.0 and up, staging -rc) passes.
--
-- It only ever raises the setting: a higher minimum already stored stays. It
-- runs again cleanly over itself.

INSERT INTO public.app_settings AS s (key, value, updated_at)
VALUES ('min_build', '"1.0.21"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
WHERE NOT ((s.value #>> '{}') ~ '^v?\d+\.\d+\.\d+')
   OR string_to_array(substring(s.value #>> '{}' FROM '^v?(\d+\.\d+\.\d+)'), '.')::int[] < ARRAY[1, 0, 21];

DO $$
BEGIN
  IF (SELECT string_to_array(substring(value #>> '{}' FROM '^v?(\d+\.\d+\.\d+)'), '.')::int[]
        FROM public.app_settings WHERE key = 'min_build') < ARRAY[1, 0, 21] THEN
    RAISE EXCEPTION 'CV-23: min_build is below 1.0.21';
  END IF;
END;
$$;

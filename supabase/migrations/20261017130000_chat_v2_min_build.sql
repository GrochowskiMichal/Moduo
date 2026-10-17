-- Chat v2 · CV-23 the minimum desktop build (specs/chat-v2.md AC12.9;
-- §Assumptions #4). The stamp must stay after …_chat_v2_agents (CV-21) and
-- before …_chat_v2_contract, which retires the v1 signatures.
--
-- Both CV-23 migrations wait for the per-platform minimum-build check to be
-- live on prod (PLAT-8: only a desktop build can be held back, the web app
-- never is; app.moduo.app reports 1.1.0). This one applies before the drops,
-- so a desktop build from before Chat v2 is read-only and shows "Update Moduo"
-- before the signatures it would call go.
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
WHERE NOT (coalesce(s.value #>> '{}', '') ~ '^v?\d+\.\d+\.\d+')
   OR string_to_array(substring(s.value #>> '{}' FROM '^v?(\d+\.\d+\.\d+)'), '.')::int[] < ARRAY[1, 0, 21];

DO $$
DECLARE
  v text := (SELECT value #>> '{}' FROM public.app_settings WHERE key = 'min_build');
BEGIN
  IF v IS NULL OR v !~ '^v?\d+\.\d+\.\d+'
     OR string_to_array(substring(v FROM '^v?(\d+\.\d+\.\d+)'), '.')::int[] < ARRAY[1, 0, 21] THEN
    RAISE EXCEPTION 'CV-23: min_build is not a version at or above 1.0.21 (%)', coalesce(v, 'missing');
  END IF;
END;
$$;

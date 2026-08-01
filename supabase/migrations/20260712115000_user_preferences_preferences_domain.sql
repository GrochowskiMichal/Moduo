-- DF-19f: a fifth per-user preference domain — general "preferences". Mirrors
-- appearance / focus / calendar / email exactly: an opaque jsonb payload + its own
-- client-set updated_at so it reconciles independently (per-domain last-write-wins,
-- prefs-sync.ts). ONE domain holds every day-to-day preference group (default
-- landing view, startup/behaviour, sounds & motion; notifications joins later once
-- DF-9 lands — no migration needed, the payload is opaque jsonb). User-scoped: these
-- follow the person across their devices, never the workspace. The existing FOR-ALL
-- "own row" RLS policy already covers the new columns (no policy change needed).

alter table public.user_preferences
  add column if not exists preferences            jsonb       not null default '{}'::jsonb,
  add column if not exists preferences_updated_at timestamptz not null default now();

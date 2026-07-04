-- CAL-6b: a third per-user preference domain — calendar. Mirrors appearance /
-- focus exactly: an opaque jsonb payload + its own client-set updated_at so it
-- reconciles independently (per-domain last-write-wins, prefs-sync.ts). Carries
-- the syncable calendar prefs (working-hours bound, week start, weekends,
-- per-account visibility + colors); view state + panel widths stay per-device
-- in localStorage. The existing FOR-ALL "own row" RLS policy already covers the
-- new columns (no policy change needed).

alter table public.user_preferences
  add column if not exists calendar            jsonb       not null default '{}'::jsonb,
  add column if not exists calendar_updated_at timestamptz not null default now();

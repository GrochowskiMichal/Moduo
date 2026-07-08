-- EM-10: a fourth per-user preference domain — email. Mirrors appearance / focus /
-- calendar exactly: an opaque jsonb payload + its own client-set updated_at so it
-- reconciles independently (per-domain last-write-wins, prefs-sync.ts). Carries the
-- smart-inbox per-sender section overrides (user-scoped, not workspace — nobody
-- else's inbox is affected). The existing FOR-ALL "own row" RLS policy already
-- covers the new columns (no policy change needed).

alter table public.user_preferences
  add column if not exists email            jsonb       not null default '{}'::jsonb,
  add column if not exists email_updated_at timestamptz not null default now();

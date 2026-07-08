-- Cross-device sync for per-user UI / workflow settings.
--
-- One row per user. Two JSONB domains, each with its own updated_at so the two
-- reconcile independently (per-domain last-write-wins) — an appearance change on
-- one device never clobbers a Focus change made offline on another.
--
-- Mirrors the existing per-user UI-state convention (panel_layouts /
-- dashboard_layouts): jsonb payload + client-set updated_at (no trigger), a
-- single FOR ALL "own row" RLS policy, user_id -> profiles(id). Per CLAUDE.md
-- this is cloud-first via Supabase; redb is intentionally not involved.
--
-- What syncs lives in the client: appearance carries theme/shade/accent/radius/
-- font (density/textSize/tabs stay per-device, localStorage-only); focus carries
-- the full Pomodoro pref set. The columns are opaque jsonb so new toggles need no
-- migration.

create table if not exists public.user_preferences (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  appearance            jsonb not null default '{}'::jsonb,
  appearance_updated_at timestamptz not null default now(),
  focus                 jsonb not null default '{}'::jsonb,
  focus_updated_at      timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_own on public.user_preferences;
create policy user_preferences_own on public.user_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- DB-7: Habits (dashboard). Preference-class, user-scoped: one row PER habit
-- (name/emoji/position/checks), with DIRECT RLS upserts — no intent ops,
-- activity, or registry entries (same rationale as user_preferences /
-- dashboard_layouts). Multiple Habits widgets share these rows; a habit outlives
-- any widget instance, and streaks are computed client-side from `checks`.

create table if not exists public.habits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null,
  emoji         text not null default '',
  position      text not null default '',
  -- array of local-date strings ('YYYY-MM-DD') the habit was checked
  checks        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists habits_user_workspace_idx
  on public.habits (user_id, workspace_id, position);

alter table public.habits enable row level security;

-- Owner-only, like dashboard_layouts: a habit is personal (user-scoped), scoped
-- to a workspace by column but never shared with other members.
drop policy if exists habits_owner_all on public.habits;
create policy habits_owner_all on public.habits
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.habits to authenticated;

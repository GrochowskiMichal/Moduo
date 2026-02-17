alter table public.notes
  add column if not exists is_pinned boolean not null default false;

create index if not exists notes_owner_pinned_updated_active_idx
  on public.notes (owner_id, is_pinned, updated_at desc)
  where deleted_at is null and is_archived = false;

drop function if exists public.notes_bootstrap(timestamptz, int);

create or replace function public.notes_bootstrap(
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  owner_id text,
  parent_id uuid,
  title text,
  icon text,
  kind text,
  is_pinned boolean,
  "position" text,
  is_archived boolean,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    n.id,
    n.owner_id,
    n.parent_id,
    n.title,
    n.icon,
    n.kind,
    n.is_pinned,
    n.position,
    n.is_archived,
    n.created_at,
    n.updated_at,
    n.deleted_at
  from public.notes n
  where n.owner_id = (select auth.jwt() ->> 'sub')
    and (p_after_updated_at is null or n.updated_at > p_after_updated_at)
  order by n.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.notes_bootstrap(timestamptz, int) from public;
grant execute on function public.notes_bootstrap(timestamptz, int) to authenticated;

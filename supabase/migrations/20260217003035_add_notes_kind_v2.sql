alter table public.notes
  add column if not exists kind text not null default 'note';

alter table public.notes
  drop constraint if exists notes_kind_check;

alter table public.notes
  add constraint notes_kind_check check (kind in ('category', 'folder', 'note'));

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

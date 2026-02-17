begin;

alter table public.notes
  add column if not exists tags text[] not null default '{}'::text[];

alter table public.tasks
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists notes_tags_gin_idx on public.notes using gin(tags);
create index if not exists tasks_tags_gin_idx on public.tasks using gin(tags);

drop function if exists public.tasks_bootstrap(uuid, timestamptz, int);
create function public.tasks_bootstrap(
  p_workspace_id uuid,
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  workspace_id uuid,
  owner_id text,
  project_id uuid,
  parent_task_id uuid,
  state_id uuid,
  assignee_id text,
  title text,
  description text,
  tags text[],
  priority smallint,
  due_date date,
  "position" text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    t.id,
    t.workspace_id,
    t.owner_id,
    t.project_id,
    t.parent_task_id,
    t.state_id,
    t.assignee_id,
    t.title,
    t.description,
    coalesce(t.tags, '{}'::text[]) as tags,
    t.priority,
    t.due_date,
    t.position,
    t.created_at,
    t.updated_at,
    t.deleted_at
  from public.tasks t
  where t.workspace_id = p_workspace_id
    and (p_after_updated_at is null or t.updated_at > p_after_updated_at)
  order by t.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

drop function if exists public.notes_bootstrap(uuid, timestamptz, int);
create function public.notes_bootstrap(
  p_workspace_id uuid,
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  workspace_id uuid,
  owner_id text,
  parent_id uuid,
  title text,
  icon text,
  kind text,
  tags text[],
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
    n.workspace_id,
    n.owner_id,
    n.parent_id,
    n.title,
    n.icon,
    n.kind,
    coalesce(n.tags, '{}'::text[]) as tags,
    n.is_pinned,
    n.position,
    n.is_archived,
    n.created_at,
    n.updated_at,
    n.deleted_at
  from public.notes n
  where n.workspace_id = p_workspace_id
    and (p_after_updated_at is null or n.updated_at > p_after_updated_at)
  order by n.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

commit;

create table if not exists public.task_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  description text not null default '',
  position text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.task_workflow_states (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  project_id uuid not null references public.task_projects(id) on delete cascade,
  name text not null,
  kind text not null default 'custom' check (kind in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'custom')),
  color text,
  position text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, project_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  project_id uuid not null references public.task_projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  state_id uuid not null,
  title text not null default 'Untitled',
  description text not null default '',
  priority smallint not null default 2 check (priority between 0 and 4),
  due_date date,
  position text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tasks_state_project_fkey
    foreign key (state_id, project_id)
    references public.task_workflow_states (id, project_id)
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists task_projects_owner_updated_active_idx
  on public.task_projects (owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists task_projects_owner_position_active_idx
  on public.task_projects (owner_id, position)
  where deleted_at is null;

create index if not exists task_workflow_states_owner_project_position_active_idx
  on public.task_workflow_states (owner_id, project_id, position)
  where deleted_at is null;

create index if not exists tasks_owner_project_parent_position_active_idx
  on public.tasks (owner_id, project_id, parent_task_id, position)
  where deleted_at is null;

create index if not exists tasks_owner_project_state_position_active_idx
  on public.tasks (owner_id, project_id, state_id, position)
  where deleted_at is null;

create index if not exists tasks_owner_updated_active_idx
  on public.tasks (owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists task_comments_owner_task_created_active_idx
  on public.task_comments (owner_id, task_id, created_at desc)
  where deleted_at is null;

create or replace function public.prevent_tasks_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_cycle boolean;
  v_parent public.tasks;
begin
  if new.parent_task_id is null then
    return new;
  end if;

  if new.parent_task_id = new.id then
    raise exception 'A task cannot be its own parent';
  end if;

  select *
  into v_parent
  from public.tasks t
  where t.id = new.parent_task_id;

  if v_parent.id is null then
    raise exception 'Parent task not found';
  end if;

  if v_parent.deleted_at is not null then
    raise exception 'Parent task is deleted';
  end if;

  if v_parent.owner_id <> new.owner_id then
    raise exception 'Parent task owner mismatch';
  end if;

  if v_parent.project_id <> new.project_id then
    raise exception 'Parent task must belong to same project';
  end if;

  with recursive parent_chain as (
    select t.id, t.parent_task_id
    from public.tasks t
    where t.id = new.parent_task_id
    union all
    select t.id, t.parent_task_id
    from public.tasks t
    join parent_chain p on p.parent_task_id = t.id
  )
  select exists(select 1 from parent_chain where id = new.id)
  into v_has_cycle;

  if v_has_cycle then
    raise exception 'Cycle detected in tasks tree';
  end if;

  return new;
end;
$$;

create or replace function public.seed_default_task_workflow_states(
  p_project_id uuid,
  p_owner_id text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_project_id is null or p_owner_id is null then
    raise exception 'p_project_id and p_owner_id are required';
  end if;

  insert into public.task_workflow_states (owner_id, project_id, name, kind, color, position)
  select
    p_owner_id,
    p_project_id,
    d.name,
    d.kind,
    d.color,
    d.position
  from (
    values
      ('Backlog', 'backlog', '#6b7280', 'a0'),
      ('Todo', 'todo', '#60a5fa', 'b0'),
      ('In Progress', 'in_progress', '#a78bfa', 'c0'),
      ('In Review', 'in_review', '#f59e0b', 'd0'),
      ('Done', 'done', '#34d399', 'e0'),
      ('Canceled', 'canceled', '#f87171', 'f0')
  ) as d(name, kind, color, position)
  where not exists (
    select 1
    from public.task_workflow_states s
    where s.project_id = p_project_id
      and s.kind = d.kind
      and s.deleted_at is null
  );
end;
$$;

create or replace function public.trg_seed_task_workflow_states()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.seed_default_task_workflow_states(new.id, new.owner_id);
  return new;
end;
$$;

drop trigger if exists trg_task_projects_updated_at on public.task_projects;
create trigger trg_task_projects_updated_at
before update on public.task_projects
for each row
execute function public.set_updated_at();

drop trigger if exists trg_task_workflow_states_updated_at on public.task_workflow_states;
create trigger trg_task_workflow_states_updated_at
before update on public.task_workflow_states
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

drop trigger if exists trg_task_comments_updated_at on public.task_comments;
create trigger trg_task_comments_updated_at
before update on public.task_comments
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tasks_prevent_cycle on public.tasks;
create trigger trg_tasks_prevent_cycle
before insert or update of parent_task_id, project_id, owner_id on public.tasks
for each row
execute function public.prevent_tasks_cycle();

drop trigger if exists trg_task_projects_seed_defaults on public.task_projects;
create trigger trg_task_projects_seed_defaults
after insert on public.task_projects
for each row
execute function public.trg_seed_task_workflow_states();

do $$
declare
  v_project record;
begin
  for v_project in
    select p.id, p.owner_id
    from public.task_projects p
    where p.deleted_at is null
  loop
    perform public.seed_default_task_workflow_states(v_project.id, v_project.owner_id);
  end loop;
end
$$;

alter table public.task_projects enable row level security;
alter table public.task_projects force row level security;
alter table public.task_workflow_states enable row level security;
alter table public.task_workflow_states force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.task_comments enable row level security;
alter table public.task_comments force row level security;

drop policy if exists task_projects_select_own on public.task_projects;
create policy task_projects_select_own on public.task_projects
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_projects_insert_own on public.task_projects;
create policy task_projects_insert_own on public.task_projects
for insert to authenticated
with check (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_projects_update_own on public.task_projects;
create policy task_projects_update_own on public.task_projects
for update to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'))
with check (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_projects_delete_own on public.task_projects;
create policy task_projects_delete_own on public.task_projects
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_workflow_states_select_own on public.task_workflow_states;
create policy task_workflow_states_select_own on public.task_workflow_states
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_workflow_states_insert_own on public.task_workflow_states;
create policy task_workflow_states_insert_own on public.task_workflow_states
for insert to authenticated
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.owner_id = owner_id
  )
);

drop policy if exists task_workflow_states_update_own on public.task_workflow_states;
create policy task_workflow_states_update_own on public.task_workflow_states
for update to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'))
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.owner_id = owner_id
  )
);

drop policy if exists task_workflow_states_delete_own on public.task_workflow_states;
create policy task_workflow_states_delete_own on public.task_workflow_states
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists tasks_insert_own on public.tasks;
create policy tasks_insert_own on public.tasks
for insert to authenticated
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.owner_id = owner_id
  )
  and exists (
    select 1
    from public.task_workflow_states s
    where s.id = state_id
      and s.project_id = project_id
      and s.owner_id = owner_id
  )
  and (
    parent_task_id is null
    or exists (
      select 1
      from public.tasks t
      where t.id = parent_task_id
        and t.project_id = project_id
        and t.owner_id = owner_id
    )
  )
);

drop policy if exists tasks_update_own on public.tasks;
create policy tasks_update_own on public.tasks
for update to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'))
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.owner_id = owner_id
  )
  and exists (
    select 1
    from public.task_workflow_states s
    where s.id = state_id
      and s.project_id = project_id
      and s.owner_id = owner_id
  )
  and (
    parent_task_id is null
    or exists (
      select 1
      from public.tasks t
      where t.id = parent_task_id
        and t.project_id = project_id
        and t.owner_id = owner_id
    )
  )
);

drop policy if exists tasks_delete_own on public.tasks;
create policy tasks_delete_own on public.tasks
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_comments_select_own on public.task_comments;
create policy task_comments_select_own on public.task_comments
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists task_comments_insert_own on public.task_comments;
create policy task_comments_insert_own on public.task_comments
for insert to authenticated
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.owner_id = owner_id
  )
);

drop policy if exists task_comments_update_own on public.task_comments;
create policy task_comments_update_own on public.task_comments
for update to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'))
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.owner_id = owner_id
  )
);

drop policy if exists task_comments_delete_own on public.task_comments;
create policy task_comments_delete_own on public.task_comments
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

create or replace function public.task_projects_bootstrap(
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  owner_id text,
  name text,
  description text,
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
    p.id,
    p.owner_id,
    p.name,
    p.description,
    p.position,
    p.created_at,
    p.updated_at,
    p.deleted_at
  from public.task_projects p
  where p.owner_id = (select auth.jwt() ->> 'sub')
    and (p_after_updated_at is null or p.updated_at > p_after_updated_at)
  order by p.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.task_workflow_states_bootstrap(
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  owner_id text,
  project_id uuid,
  name text,
  kind text,
  color text,
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
    s.id,
    s.owner_id,
    s.project_id,
    s.name,
    s.kind,
    s.color,
    s.position,
    s.created_at,
    s.updated_at,
    s.deleted_at
  from public.task_workflow_states s
  where s.owner_id = (select auth.jwt() ->> 'sub')
    and (p_after_updated_at is null or s.updated_at > p_after_updated_at)
  order by s.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.tasks_bootstrap(
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  owner_id text,
  project_id uuid,
  parent_task_id uuid,
  state_id uuid,
  title text,
  description text,
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
    t.owner_id,
    t.project_id,
    t.parent_task_id,
    t.state_id,
    t.title,
    t.description,
    t.priority,
    t.due_date,
    t.position,
    t.created_at,
    t.updated_at,
    t.deleted_at
  from public.tasks t
  where t.owner_id = (select auth.jwt() ->> 'sub')
    and (p_after_updated_at is null or t.updated_at > p_after_updated_at)
  order by t.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.task_comments_bootstrap(
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  owner_id text,
  task_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    c.id,
    c.owner_id,
    c.task_id,
    c.body,
    c.created_at,
    c.updated_at,
    c.deleted_at
  from public.task_comments c
  where c.owner_id = (select auth.jwt() ->> 'sub')
    and (p_after_updated_at is null or c.updated_at > p_after_updated_at)
  order by c.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.tasks_move(
  p_task_id uuid,
  p_new_parent_task_id uuid,
  p_new_state_id uuid,
  p_new_position text
)
returns public.tasks
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner text;
  v_task public.tasks;
  v_state public.task_workflow_states;
  v_parent public.tasks;
  v_has_cycle boolean := false;
begin
  v_owner := (select auth.jwt() ->> 'sub');

  if v_owner is null then
    raise exception 'Unauthenticated';
  end if;

  if p_new_position is null or length(trim(p_new_position)) = 0 then
    raise exception 'p_new_position is required';
  end if;

  select *
  into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.owner_id = v_owner
    and t.deleted_at is null;

  if v_task.id is null then
    raise exception 'Task not found';
  end if;

  select *
  into v_state
  from public.task_workflow_states s
  where s.id = p_new_state_id
    and s.owner_id = v_owner
    and s.deleted_at is null;

  if v_state.id is null then
    raise exception 'Workflow state not found';
  end if;

  if v_state.project_id <> v_task.project_id then
    raise exception 'Workflow state must belong to same project';
  end if;

  if p_new_parent_task_id is not null then
    if p_new_parent_task_id = p_task_id then
      raise exception 'A task cannot be its own parent';
    end if;

    select *
    into v_parent
    from public.tasks p
    where p.id = p_new_parent_task_id
      and p.owner_id = v_owner
      and p.deleted_at is null;

    if v_parent.id is null then
      raise exception 'Parent task not found';
    end if;

    if v_parent.project_id <> v_task.project_id then
      raise exception 'Parent task must belong to same project';
    end if;

    with recursive parent_chain as (
      select p.id, p.parent_task_id
      from public.tasks p
      where p.id = p_new_parent_task_id
      union all
      select p.id, p.parent_task_id
      from public.tasks p
      join parent_chain c on c.parent_task_id = p.id
    )
    select exists(select 1 from parent_chain where id = p_task_id)
    into v_has_cycle;

    if v_has_cycle then
      raise exception 'Cycle detected in tasks tree';
    end if;
  end if;

  update public.tasks t
  set
    parent_task_id = p_new_parent_task_id,
    state_id = p_new_state_id,
    position = p_new_position,
    updated_at = now()
  where t.id = p_task_id
    and t.owner_id = v_owner
  returning t.* into v_task;

  return v_task;
end;
$$;

revoke all on function public.prevent_tasks_cycle() from public;
revoke all on function public.seed_default_task_workflow_states(uuid, text) from public;
revoke all on function public.trg_seed_task_workflow_states() from public;
revoke all on function public.task_projects_bootstrap(timestamptz, int) from public;
revoke all on function public.task_workflow_states_bootstrap(timestamptz, int) from public;
revoke all on function public.tasks_bootstrap(timestamptz, int) from public;
revoke all on function public.task_comments_bootstrap(timestamptz, int) from public;
revoke all on function public.tasks_move(uuid, uuid, uuid, text) from public;

grant execute on function public.task_projects_bootstrap(timestamptz, int) to authenticated;
grant execute on function public.task_workflow_states_bootstrap(timestamptz, int) to authenticated;
grant execute on function public.tasks_bootstrap(timestamptz, int) to authenticated;
grant execute on function public.task_comments_bootstrap(timestamptz, int) to authenticated;
grant execute on function public.tasks_move(uuid, uuid, uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_projects'
    ) then
      execute 'alter publication supabase_realtime add table public.task_projects';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_workflow_states'
    ) then
      execute 'alter publication supabase_realtime add table public.task_workflow_states';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
    ) then
      execute 'alter publication supabase_realtime add table public.tasks';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
    ) then
      execute 'alter publication supabase_realtime add table public.task_comments';
    end if;
  end if;
end
$$;

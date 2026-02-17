begin;

alter table public.notes
  alter column workspace_id set not null;

alter table public.note_documents
  alter column workspace_id set not null;

alter table public.note_updates
  alter column workspace_id set not null;

alter table public.task_projects
  alter column workspace_id set not null;

alter table public.task_workflow_states
  alter column workspace_id set not null;

alter table public.tasks
  alter column workspace_id set not null;

alter table public.task_comments
  alter column workspace_id set not null;

alter table public.notes
  add constraint notes_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.note_documents
  add constraint note_documents_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.note_updates
  add constraint note_updates_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.task_projects
  add constraint task_projects_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.task_workflow_states
  add constraint task_workflow_states_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.tasks
  add constraint tasks_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

alter table public.task_comments
  add constraint task_comments_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete cascade;

create or replace function public.workspace_item_permission(
  p_workspace_id uuid,
  p_module public.module_key,
  p_resource_type public.resource_type,
  p_resource_id uuid,
  p_required_permission public.permission_level
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_required_rank int;
  v_deny boolean := false;
  v_allow boolean := false;
begin
  v_member_id := public.workspace_member_id(p_workspace_id);
  if v_member_id is null then
    return false;
  end if;

  if p_resource_id is null then
    return true;
  end if;

  v_required_rank := public.permission_level_rank(p_required_permission);

  if p_resource_type = 'note' then
    with recursive chain as (
      select n.id, n.parent_id
      from public.notes n
      where n.id = p_resource_id
        and n.workspace_id = p_workspace_id
      union all
      select p.id, p.parent_id
      from public.notes p
      join chain c on c.parent_id = p.id
      where p.workspace_id = p_workspace_id
    )
    select
      coalesce(bool_or(a.effect = 'deny' and public.permission_level_rank(a.permission) <= v_required_rank), false),
      coalesce(bool_or(a.effect = 'allow' and public.permission_level_rank(a.permission) >= v_required_rank), false)
    into v_deny, v_allow
    from public.workspace_item_acl a
    join chain c on c.id = a.resource_id
    where a.workspace_id = p_workspace_id
      and a.member_id = v_member_id
      and a.module = p_module
      and a.resource_type = 'note';
  elsif p_resource_type = 'task' then
    with recursive chain as (
      select t.id, t.parent_task_id
      from public.tasks t
      where t.id = p_resource_id
        and t.workspace_id = p_workspace_id
      union all
      select p.id, p.parent_task_id
      from public.tasks p
      join chain c on c.parent_task_id = p.id
      where p.workspace_id = p_workspace_id
    )
    select
      coalesce(bool_or(a.effect = 'deny' and public.permission_level_rank(a.permission) <= v_required_rank), false),
      coalesce(bool_or(a.effect = 'allow' and public.permission_level_rank(a.permission) >= v_required_rank), false)
    into v_deny, v_allow
    from public.workspace_item_acl a
    join chain c on c.id = a.resource_id
    where a.workspace_id = p_workspace_id
      and a.member_id = v_member_id
      and a.module = p_module
      and a.resource_type = 'task';
  else
    select
      coalesce(bool_or(a.effect = 'deny' and public.permission_level_rank(a.permission) <= v_required_rank), false),
      coalesce(bool_or(a.effect = 'allow' and public.permission_level_rank(a.permission) >= v_required_rank), false)
    into v_deny, v_allow
    from public.workspace_item_acl a
    where a.workspace_id = p_workspace_id
      and a.member_id = v_member_id
      and a.module = p_module
      and a.resource_type = p_resource_type
      and a.resource_id = p_resource_id;
  end if;

  if v_deny then
    return false;
  end if;

  if v_allow then
    return true;
  end if;

  return true;
end;
$$;

create or replace function public.workspace_emit_mentions(
  p_workspace_id uuid,
  p_module public.module_key,
  p_resource_type public.resource_type,
  p_resource_id uuid,
  p_mentioned_user_ids text[],
  p_payload jsonb default '{}'::jsonb,
  p_dedupe_seed text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_filtered text[];
  v_notification_id uuid;
begin
  v_actor := public.auth_user_id();

  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  if not public.workspace_can_module(p_workspace_id, p_module, 'edit') then
    raise exception 'Forbidden';
  end if;

  if not public.workspace_item_permission(p_workspace_id, p_module, p_resource_type, p_resource_id, 'edit') then
    raise exception 'Forbidden';
  end if;

  select coalesce(array_agg(distinct wm.user_id), array[]::text[])
  into v_filtered
  from unnest(coalesce(p_mentioned_user_ids, array[]::text[])) as target(user_id)
  join public.workspace_members wm
    on wm.workspace_id = p_workspace_id
   and wm.user_id = target.user_id
   and wm.is_active = true
   and wm.removed_at is null
  left join public.workspace_member_module_permissions mp
    on mp.member_id = wm.id
   and mp.module = p_module
  where target.user_id <> v_actor
    and public.permission_level_rank(coalesce(mp.permission, public.default_module_permission_for_role(wm.role)))
      >= public.permission_level_rank('view')
    and (
      p_resource_id is null
      or not exists (
        select 1
        from public.workspace_item_acl a
        where a.workspace_id = p_workspace_id
          and a.member_id = wm.id
          and a.module = p_module
          and a.resource_type = p_resource_type
          and a.resource_id = p_resource_id
          and a.effect = 'deny'
          and public.permission_level_rank(a.permission) <= public.permission_level_rank('view')
      )
    );

  v_notification_id := public.workspace_emit_notification(
    p_workspace_id,
    'workspace.mention',
    v_actor,
    jsonb_build_object('module', p_module, 'resource_type', p_resource_type, 'resource_id', p_resource_id) || coalesce(p_payload, '{}'::jsonb),
    v_filtered,
    case
      when p_dedupe_seed is null then null
      else concat('workspace.mention:', p_workspace_id::text, ':', p_dedupe_seed)
    end,
    p_module,
    p_resource_type,
    p_resource_id
  );

  return v_notification_id;
end;
$$;

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

  if v_parent.workspace_id <> new.workspace_id then
    raise exception 'Parent task workspace mismatch';
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
  p_owner_id text,
  p_workspace_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_project_id is null or p_owner_id is null or p_workspace_id is null then
    raise exception 'p_project_id, p_owner_id and p_workspace_id are required';
  end if;

  insert into public.task_workflow_states (workspace_id, owner_id, project_id, name, kind, color, position)
  select
    p_workspace_id,
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
  perform public.seed_default_task_workflow_states(new.id, new.owner_id, new.workspace_id);
  return new;
end;
$$;

drop trigger if exists trg_tasks_prevent_cycle on public.tasks;
create trigger trg_tasks_prevent_cycle
before insert or update of parent_task_id, project_id, workspace_id on public.tasks
for each row
execute function public.prevent_tasks_cycle();

create or replace function public.task_projects_bootstrap(
  p_workspace_id uuid,
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  workspace_id uuid,
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
    p.workspace_id,
    p.owner_id,
    p.name,
    p.description,
    p.position,
    p.created_at,
    p.updated_at,
    p.deleted_at
  from public.task_projects p
  where p.workspace_id = p_workspace_id
    and (p_after_updated_at is null or p.updated_at > p_after_updated_at)
  order by p.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.task_workflow_states_bootstrap(
  p_workspace_id uuid,
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  workspace_id uuid,
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
    s.workspace_id,
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
  where s.workspace_id = p_workspace_id
    and (p_after_updated_at is null or s.updated_at > p_after_updated_at)
  order by s.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.tasks_bootstrap(
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

create or replace function public.task_comments_bootstrap(
  p_workspace_id uuid,
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  workspace_id uuid,
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
    c.workspace_id,
    c.owner_id,
    c.task_id,
    c.body,
    c.created_at,
    c.updated_at,
    c.deleted_at
  from public.task_comments c
  where c.workspace_id = p_workspace_id
    and (p_after_updated_at is null or c.updated_at > p_after_updated_at)
  order by c.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.tasks_move(
  p_workspace_id uuid,
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
  v_task public.tasks;
  v_state public.task_workflow_states;
  v_parent public.tasks;
  v_has_cycle boolean := false;
begin
  if p_new_position is null or length(trim(p_new_position)) = 0 then
    raise exception 'p_new_position is required';
  end if;

  if not public.workspace_can_module(p_workspace_id, 'tasks', 'edit') then
    raise exception 'Forbidden';
  end if;

  select *
  into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.workspace_id = p_workspace_id
    and t.deleted_at is null;

  if v_task.id is null then
    raise exception 'Task not found';
  end if;

  if not public.workspace_item_permission(p_workspace_id, 'tasks', 'task', v_task.id, 'edit') then
    raise exception 'Forbidden';
  end if;

  select *
  into v_state
  from public.task_workflow_states s
  where s.id = p_new_state_id
    and s.workspace_id = p_workspace_id
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
      and p.workspace_id = p_workspace_id
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
    and t.workspace_id = p_workspace_id
  returning t.* into v_task;

  return v_task;
end;
$$;

create or replace function public.notes_bootstrap(
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

create or replace function public.note_pull_updates(
  p_workspace_id uuid,
  p_note_id uuid,
  p_after_id bigint default 0,
  p_limit int default 500
)
returns table (
  id bigint,
  workspace_id uuid,
  note_id uuid,
  client_id text,
  client_seq bigint,
  update_b64 text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    u.id,
    u.workspace_id,
    u.note_id,
    u.client_id,
    u.client_seq,
    u.update_b64,
    u.created_at
  from public.note_updates u
  where u.workspace_id = p_workspace_id
    and u.note_id = p_note_id
    and u.id > coalesce(p_after_id, 0)
  order by u.id asc
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
$$;

create or replace function public.note_push_updates(
  p_workspace_id uuid,
  p_note_id uuid,
  p_client_id text,
  p_updates jsonb
)
returns table (
  inserted_count int,
  last_update_id bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor text;
  v_inserted int := 0;
  v_last_id bigint := 0;
begin
  v_actor := public.auth_user_id();

  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'p_client_id is required';
  end if;

  if not public.workspace_can_module(p_workspace_id, 'notes', 'edit') then
    raise exception 'Forbidden';
  end if;

  perform 1
  from public.notes n
  where n.id = p_note_id
    and n.workspace_id = p_workspace_id;

  if not found then
    raise exception 'Note not found';
  end if;

  if not public.workspace_item_permission(p_workspace_id, 'notes', 'note', p_note_id, 'edit') then
    raise exception 'Forbidden';
  end if;

  insert into public.note_updates (workspace_id, note_id, owner_id, client_id, client_seq, update_b64)
  select
    p_workspace_id,
    p_note_id,
    v_actor,
    p_client_id,
    x.client_seq,
    x.update_b64
  from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as x(client_seq bigint, update_b64 text)
  where x.client_seq is not null
    and x.update_b64 is not null
    and length(x.update_b64) > 0
  on conflict (note_id, client_id, client_seq) do nothing;

  get diagnostics v_inserted = row_count;

  select coalesce(max(u.id), 0)
  into v_last_id
  from public.note_updates u
  where u.workspace_id = p_workspace_id
    and u.note_id = p_note_id;

  return query select v_inserted, v_last_id;
end;
$$;

create or replace function public.notes_move(
  p_workspace_id uuid,
  p_note_id uuid,
  p_new_parent_id uuid,
  p_new_position text
)
returns public.notes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_cycle boolean := false;
  v_result public.notes;
begin
  if p_new_position is null or length(trim(p_new_position)) = 0 then
    raise exception 'p_new_position is required';
  end if;

  if not public.workspace_can_module(p_workspace_id, 'notes', 'edit') then
    raise exception 'Forbidden';
  end if;

  if p_new_parent_id = p_note_id then
    raise exception 'A note cannot be its own parent';
  end if;

  if not public.workspace_item_permission(p_workspace_id, 'notes', 'note', p_note_id, 'edit') then
    raise exception 'Forbidden';
  end if;

  if p_new_parent_id is not null then
    perform 1
    from public.notes n
    where n.id = p_new_parent_id
      and n.workspace_id = p_workspace_id
      and n.deleted_at is null;

    if not found then
      raise exception 'Parent note not found';
    end if;

    if not public.workspace_item_permission(p_workspace_id, 'notes', 'note', p_new_parent_id, 'edit') then
      raise exception 'Forbidden';
    end if;

    with recursive parent_chain as (
      select n.id, n.parent_id
      from public.notes n
      where n.id = p_new_parent_id
      union all
      select n.id, n.parent_id
      from public.notes n
      join parent_chain p on p.parent_id = n.id
    )
    select exists(select 1 from parent_chain where id = p_note_id)
    into v_has_cycle;

    if v_has_cycle then
      raise exception 'Cycle detected in notes tree';
    end if;
  end if;

  update public.notes n
  set
    parent_id = p_new_parent_id,
    position = p_new_position,
    updated_at = now()
  where n.id = p_note_id
    and n.workspace_id = p_workspace_id
  returning n.* into v_result;

  if v_result.id is null then
    raise exception 'Note not found';
  end if;

  return v_result;
end;
$$;

alter table public.notes enable row level security;
alter table public.notes force row level security;
alter table public.note_documents enable row level security;
alter table public.note_documents force row level security;
alter table public.note_updates enable row level security;
alter table public.note_updates force row level security;
alter table public.task_projects enable row level security;
alter table public.task_projects force row level security;
alter table public.task_workflow_states enable row level security;
alter table public.task_workflow_states force row level security;
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.task_comments enable row level security;
alter table public.task_comments force row level security;

drop policy if exists notes_select_own on public.notes;
drop policy if exists notes_insert_own on public.notes;
drop policy if exists notes_update_own on public.notes;
drop policy if exists notes_delete_own on public.notes;

create policy notes_select_workspace on public.notes
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'view')
  and public.workspace_item_permission(workspace_id, 'notes', 'note', id, 'view')
);

create policy notes_insert_workspace on public.notes
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and (
    parent_id is null
    or public.workspace_item_permission(workspace_id, 'notes', 'note', parent_id, 'edit')
  )
);

create policy notes_update_workspace on public.notes
for update to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and public.workspace_item_permission(workspace_id, 'notes', 'note', id, 'edit')
)
with check (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and (
    parent_id is null
    or public.workspace_item_permission(workspace_id, 'notes', 'note', parent_id, 'edit')
  )
);

create policy notes_delete_workspace on public.notes
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and public.workspace_item_permission(workspace_id, 'notes', 'note', id, 'edit')
);

drop policy if exists note_documents_select_own on public.note_documents;
drop policy if exists note_documents_insert_own on public.note_documents;
drop policy if exists note_documents_update_own on public.note_documents;
drop policy if exists note_documents_delete_own on public.note_documents;

create policy note_documents_select_workspace on public.note_documents
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'view')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_documents.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'view')
  )
);

create policy note_documents_insert_workspace on public.note_documents
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_documents.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'edit')
  )
);

create policy note_documents_update_workspace on public.note_documents
for update to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_documents.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'edit')
  )
)
with check (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_documents.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'edit')
  )
);

create policy note_documents_delete_workspace on public.note_documents
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_documents.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'edit')
  )
);

drop policy if exists note_updates_select_own on public.note_updates;
drop policy if exists note_updates_insert_own on public.note_updates;
drop policy if exists note_updates_delete_own on public.note_updates;

create policy note_updates_select_workspace on public.note_updates
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'view')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_updates.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'view')
  )
);

create policy note_updates_insert_workspace on public.note_updates
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_updates.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'edit')
  )
);

create policy note_updates_delete_workspace on public.note_updates
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'notes', 'edit')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id
      and n.workspace_id = note_updates.workspace_id
      and public.workspace_item_permission(n.workspace_id, 'notes', 'note', n.id, 'edit')
  )
);

drop policy if exists task_projects_select_own on public.task_projects;
drop policy if exists task_projects_insert_own on public.task_projects;
drop policy if exists task_projects_update_own on public.task_projects;
drop policy if exists task_projects_delete_own on public.task_projects;

create policy task_projects_select_workspace on public.task_projects
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'view')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task_project', id, 'view')
);

create policy task_projects_insert_workspace on public.task_projects
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
);

create policy task_projects_update_workspace on public.task_projects
for update to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task_project', id, 'edit')
)
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task_project', id, 'edit')
);

create policy task_projects_delete_workspace on public.task_projects
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task_project', id, 'edit')
);

drop policy if exists task_workflow_states_select_own on public.task_workflow_states;
drop policy if exists task_workflow_states_insert_own on public.task_workflow_states;
drop policy if exists task_workflow_states_update_own on public.task_workflow_states;
drop policy if exists task_workflow_states_delete_own on public.task_workflow_states;

create policy task_workflow_states_select_workspace on public.task_workflow_states
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'view')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = task_workflow_states.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'view')
  )
);

create policy task_workflow_states_insert_workspace on public.task_workflow_states
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = task_workflow_states.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'edit')
  )
);

create policy task_workflow_states_update_workspace on public.task_workflow_states
for update to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = task_workflow_states.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'edit')
  )
)
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = task_workflow_states.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'edit')
  )
);

create policy task_workflow_states_delete_workspace on public.task_workflow_states
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = task_workflow_states.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'edit')
  )
);

drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;

create policy tasks_select_workspace on public.tasks
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'view')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task', id, 'view')
);

create policy tasks_insert_workspace on public.tasks
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = tasks.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'edit')
  )
  and exists (
    select 1
    from public.task_workflow_states s
    where s.id = state_id
      and s.project_id = project_id
      and s.workspace_id = tasks.workspace_id
  )
  and (
    parent_task_id is null
    or public.workspace_item_permission(workspace_id, 'tasks', 'task', parent_task_id, 'edit')
  )
);

create policy tasks_update_workspace on public.tasks
for update to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task', id, 'edit')
)
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.task_projects p
    where p.id = project_id
      and p.workspace_id = tasks.workspace_id
      and public.workspace_item_permission(p.workspace_id, 'tasks', 'task_project', p.id, 'edit')
  )
  and exists (
    select 1
    from public.task_workflow_states s
    where s.id = state_id
      and s.project_id = project_id
      and s.workspace_id = tasks.workspace_id
  )
  and (
    parent_task_id is null
    or public.workspace_item_permission(workspace_id, 'tasks', 'task', parent_task_id, 'edit')
  )
);

create policy tasks_delete_workspace on public.tasks
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and public.workspace_item_permission(workspace_id, 'tasks', 'task', id, 'edit')
);

drop policy if exists task_comments_select_own on public.task_comments;
drop policy if exists task_comments_insert_own on public.task_comments;
drop policy if exists task_comments_update_own on public.task_comments;
drop policy if exists task_comments_delete_own on public.task_comments;

create policy task_comments_select_workspace on public.task_comments
for select to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'view')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.workspace_id = task_comments.workspace_id
      and public.workspace_item_permission(t.workspace_id, 'tasks', 'task', t.id, 'view')
  )
);

create policy task_comments_insert_workspace on public.task_comments
for insert to authenticated
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.workspace_id = task_comments.workspace_id
      and public.workspace_item_permission(t.workspace_id, 'tasks', 'task', t.id, 'edit')
  )
);

create policy task_comments_update_workspace on public.task_comments
for update to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.workspace_id = task_comments.workspace_id
      and public.workspace_item_permission(t.workspace_id, 'tasks', 'task', t.id, 'edit')
  )
)
with check (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.workspace_id = task_comments.workspace_id
      and public.workspace_item_permission(t.workspace_id, 'tasks', 'task', t.id, 'edit')
  )
);

create policy task_comments_delete_workspace on public.task_comments
for delete to authenticated
using (
  public.workspace_can_module(workspace_id, 'tasks', 'edit')
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and t.workspace_id = task_comments.workspace_id
      and public.workspace_item_permission(t.workspace_id, 'tasks', 'task', t.id, 'edit')
  )
);

create or replace function public.trg_tasks_assignment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    perform public.workspace_emit_notification(
      new.workspace_id,
      'tasks.assigned',
      public.auth_user_id(),
      jsonb_build_object(
        'task_id', new.id,
        'project_id', new.project_id,
        'assignee_id', new.assignee_id,
        'title', new.title
      ),
      array[new.assignee_id],
      concat('tasks.assigned:', new.workspace_id::text, ':', new.id::text, ':', new.assignee_id),
      'tasks',
      'task',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_assignment_notify on public.tasks;
create trigger trg_tasks_assignment_notify
after insert or update of assignee_id on public.tasks
for each row
execute function public.trg_tasks_assignment_notify();

revoke all on function public.seed_default_task_workflow_states(uuid, text, uuid) from public;
revoke all on function public.task_projects_bootstrap(uuid, timestamptz, int) from public;
revoke all on function public.task_workflow_states_bootstrap(uuid, timestamptz, int) from public;
revoke all on function public.tasks_bootstrap(uuid, timestamptz, int) from public;
revoke all on function public.task_comments_bootstrap(uuid, timestamptz, int) from public;
revoke all on function public.tasks_move(uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.notes_bootstrap(uuid, timestamptz, int) from public;
revoke all on function public.note_pull_updates(uuid, uuid, bigint, int) from public;
revoke all on function public.note_push_updates(uuid, uuid, text, jsonb) from public;
revoke all on function public.notes_move(uuid, uuid, uuid, text) from public;

grant execute on function public.seed_default_task_workflow_states(uuid, text, uuid) to authenticated;
grant execute on function public.task_projects_bootstrap(uuid, timestamptz, int) to authenticated;
grant execute on function public.task_workflow_states_bootstrap(uuid, timestamptz, int) to authenticated;
grant execute on function public.tasks_bootstrap(uuid, timestamptz, int) to authenticated;
grant execute on function public.task_comments_bootstrap(uuid, timestamptz, int) to authenticated;
grant execute on function public.tasks_move(uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.notes_bootstrap(uuid, timestamptz, int) to authenticated;
grant execute on function public.note_pull_updates(uuid, uuid, bigint, int) to authenticated;
grant execute on function public.note_push_updates(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.notes_move(uuid, uuid, uuid, text) to authenticated;

commit;

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  id text primary key,
  email text,
  first_name text,
  last_name text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_unique_idx
  on public.users (lower(email))
  where email is not null;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_type where typname = 'workspace_role') then
    create type public.workspace_role as enum ('owner', 'admin', 'editor', 'viewer');
  end if;
  if not exists (select 1 from pg_type where typname = 'module_key') then
    create type public.module_key as enum ('notes', 'tasks');
  end if;
  if not exists (select 1 from pg_type where typname = 'permission_level') then
    create type public.permission_level as enum ('none', 'view', 'edit', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'acl_effect') then
    create type public.acl_effect as enum ('allow', 'deny');
  end if;
  if not exists (select 1 from pg_type where typname = 'resource_type') then
    create type public.resource_type as enum ('note', 'task_project', 'task');
  end if;
end
$$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) between 1 and 120)
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id text not null,
  role public.workspace_role not null default 'viewer',
  invited_by text,
  joined_at timestamptz not null default now(),
  is_active boolean not null default true,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_member_module_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.workspace_members(id) on delete cascade,
  module public.module_key not null,
  permission public.permission_level not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, module)
);

create table if not exists public.workspace_item_acl (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  member_id uuid not null references public.workspace_members(id) on delete cascade,
  module public.module_key not null,
  resource_type public.resource_type not null,
  resource_id uuid not null,
  effect public.acl_effect not null default 'allow',
  permission public.permission_level not null default 'view',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, module, resource_type, resource_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role public.workspace_role not null default 'viewer',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by text not null,
  accepted_by text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_invite_module_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invite_id uuid not null references public.workspace_invites(id) on delete cascade,
  module public.module_key not null,
  permission public.permission_level not null,
  created_at timestamptz not null default now(),
  unique (invite_id, module)
);

create table if not exists public.workspace_invite_item_acl (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invite_id uuid not null references public.workspace_invites(id) on delete cascade,
  module public.module_key not null,
  resource_type public.resource_type not null,
  resource_id uuid not null,
  effect public.acl_effect not null default 'allow',
  permission public.permission_level not null default 'view',
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  event_type text not null,
  actor_user_id text,
  source_module public.module_key,
  source_resource_type public.resource_type,
  source_resource_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_user_id text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (notification_id, recipient_user_id)
);

create unique index if not exists notifications_dedupe_key_unique_idx
  on public.notifications (dedupe_key);

create index if not exists workspaces_created_by_idx on public.workspaces (created_by);
create index if not exists workspace_members_workspace_user_idx on public.workspace_members (workspace_id, user_id);
create index if not exists workspace_members_user_active_idx on public.workspace_members (user_id, is_active);
create index if not exists workspace_member_module_permissions_lookup_idx
  on public.workspace_member_module_permissions (workspace_id, member_id, module);
create index if not exists workspace_item_acl_lookup_idx
  on public.workspace_item_acl (workspace_id, member_id, resource_type, resource_id);
create index if not exists workspace_invites_lookup_idx
  on public.workspace_invites (workspace_id, lower(email), status);
create index if not exists workspace_invite_module_permissions_lookup_idx
  on public.workspace_invite_module_permissions (workspace_id, invite_id, module);
create index if not exists workspace_invite_item_acl_lookup_idx
  on public.workspace_invite_item_acl (workspace_id, invite_id, resource_type, resource_id);
create index if not exists notifications_workspace_created_idx
  on public.notifications (workspace_id, created_at desc);
create index if not exists notification_recipients_user_read_created_idx
  on public.notification_recipients (recipient_user_id, read_at, created_at desc);

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at
before update on public.workspaces
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workspace_members_updated_at on public.workspace_members;
create trigger trg_workspace_members_updated_at
before update on public.workspace_members
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workspace_member_module_permissions_updated_at on public.workspace_member_module_permissions;
create trigger trg_workspace_member_module_permissions_updated_at
before update on public.workspace_member_module_permissions
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workspace_item_acl_updated_at on public.workspace_item_acl;
create trigger trg_workspace_item_acl_updated_at
before update on public.workspace_item_acl
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workspace_invites_updated_at on public.workspace_invites;
create trigger trg_workspace_invites_updated_at
before update on public.workspace_invites
for each row
execute function public.set_updated_at();

create or replace function public.auth_user_id()
returns text
language sql
stable
set search_path = public
as $$
  select auth.jwt() ->> 'sub';
$$;

create or replace function public.auth_user_email()
returns text
language sql
stable
set search_path = public
as $$
  select lower(auth.jwt() ->> 'email');
$$;

create or replace function public.workspace_role_level(p_role public.workspace_role)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'owner' then 400
    when 'admin' then 300
    when 'editor' then 200
    else 100
  end;
$$;

create or replace function public.permission_level_rank(p_permission public.permission_level)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_permission
    when 'none' then 0
    when 'view' then 100
    when 'edit' then 200
    else 300
  end;
$$;

create or replace function public.default_module_permission_for_role(p_role public.workspace_role)
returns public.permission_level
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'owner' then 'admin'::public.permission_level
    when 'admin' then 'admin'::public.permission_level
    when 'editor' then 'edit'::public.permission_level
    else 'view'::public.permission_level
  end;
$$;

create or replace function public.workspace_member_id(p_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select wm.id
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = public.auth_user_id()
    and wm.is_active = true
    and wm.removed_at is null
  limit 1;
$$;

create or replace function public.workspace_actor_role(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = public.auth_user_id()
    and wm.is_active = true
    and wm.removed_at is null
  limit 1;
$$;

create or replace function public.workspace_is_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_actor_role(p_workspace_id) = 'owner', false);
$$;

create or replace function public.workspace_can_manage(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_actor_role(p_workspace_id) in ('owner', 'admin'), false);
$$;

create or replace function public.workspace_module_permission(
  p_workspace_id uuid,
  p_module public.module_key
)
returns public.permission_level
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_role public.workspace_role;
  v_permission public.permission_level;
begin
  v_member_id := public.workspace_member_id(p_workspace_id);
  if v_member_id is null then
    return 'none';
  end if;

  select mp.permission
  into v_permission
  from public.workspace_member_module_permissions mp
  where mp.workspace_id = p_workspace_id
    and mp.member_id = v_member_id
    and mp.module = p_module
  limit 1;

  if v_permission is not null then
    return v_permission;
  end if;

  select wm.role
  into v_role
  from public.workspace_members wm
  where wm.id = v_member_id;

  return public.default_module_permission_for_role(coalesce(v_role, 'viewer'));
end;
$$;

create or replace function public.workspace_can_module(
  p_workspace_id uuid,
  p_module public.module_key,
  p_required_permission public.permission_level
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.permission_level_rank(public.workspace_module_permission(p_workspace_id, p_module))
    >= public.permission_level_rank(p_required_permission);
$$;

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

  if v_deny then
    return false;
  end if;

  if v_allow then
    return true;
  end if;

  return true;
end;
$$;

create or replace function public.workspace_emit_notification(
  p_workspace_id uuid,
  p_event_type text,
  p_actor_user_id text,
  p_payload jsonb default '{}'::jsonb,
  p_recipients text[] default array[]::text[],
  p_dedupe_key text default null,
  p_source_module public.module_key default null,
  p_source_resource_type public.resource_type default null,
  p_source_resource_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id uuid;
begin
  if p_dedupe_key is not null then
    insert into public.notifications (
      workspace_id,
      event_type,
      actor_user_id,
      source_module,
      source_resource_type,
      source_resource_id,
      payload,
      dedupe_key
    )
    values (
      p_workspace_id,
      p_event_type,
      p_actor_user_id,
      p_source_module,
      p_source_resource_type,
      p_source_resource_id,
      coalesce(p_payload, '{}'::jsonb),
      p_dedupe_key
    )
    on conflict (dedupe_key) do update
      set payload = excluded.payload
    returning id into v_notification_id;
  else
    insert into public.notifications (
      workspace_id,
      event_type,
      actor_user_id,
      source_module,
      source_resource_type,
      source_resource_id,
      payload
    )
    values (
      p_workspace_id,
      p_event_type,
      p_actor_user_id,
      p_source_module,
      p_source_resource_type,
      p_source_resource_id,
      coalesce(p_payload, '{}'::jsonb)
    )
    returning id into v_notification_id;
  end if;

  if cardinality(coalesce(p_recipients, array[]::text[])) > 0 then
    insert into public.notification_recipients (notification_id, recipient_user_id)
    select v_notification_id, r
    from unnest(p_recipients) as r
    where r is not null
      and length(trim(r)) > 0
      and r <> p_actor_user_id
    on conflict (notification_id, recipient_user_id) do nothing;
  end if;

  return v_notification_id;
end;
$$;

create or replace function public.workspace_create(
  p_name text
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_workspace public.workspaces;
  v_member public.workspace_members;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Workspace name is required';
  end if;

  insert into public.workspaces (name, created_by)
  values (trim(p_name), v_actor)
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (v_workspace.id, v_actor, 'owner', v_actor)
  returning * into v_member;

  insert into public.workspace_member_module_permissions (workspace_id, member_id, module, permission, updated_by)
  values
    (v_workspace.id, v_member.id, 'notes', 'admin', v_actor),
    (v_workspace.id, v_member.id, 'tasks', 'admin', v_actor)
  on conflict (member_id, module) do update
    set permission = excluded.permission,
        updated_by = excluded.updated_by,
        updated_at = now();

  return v_workspace;
end;
$$;

create or replace function public.workspace_list_for_current_user()
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_role public.workspace_role,
  notes_permission public.permission_level,
  tasks_permission public.permission_level,
  is_deleted boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    w.id as workspace_id,
    w.name as workspace_name,
    wm.role as workspace_role,
    public.workspace_module_permission(w.id, 'notes') as notes_permission,
    public.workspace_module_permission(w.id, 'tasks') as tasks_permission,
    w.is_deleted,
    w.created_at,
    w.updated_at
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = public.auth_user_id()
    and wm.is_active = true
    and wm.removed_at is null
    and w.is_deleted = false
  order by w.updated_at desc, w.created_at desc;
$$;

create or replace function public.workspace_send_invite(
  p_workspace_id uuid,
  p_email text,
  p_role public.workspace_role,
  p_module_permissions jsonb default '[]'::jsonb,
  p_item_acl_templates jsonb default '[]'::jsonb
)
returns public.workspace_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_email text;
  v_invite public.workspace_invites;
  v_recipients text[];
  v_default_permission public.permission_level;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  if not public.workspace_can_manage(p_workspace_id) then
    raise exception 'Forbidden';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'Invite email is required';
  end if;

  insert into public.workspace_invites (workspace_id, email, role, status, invited_by)
  values (p_workspace_id, v_email, coalesce(p_role, 'viewer'), 'pending', v_actor)
  returning * into v_invite;

  v_default_permission := public.default_module_permission_for_role(coalesce(p_role, 'viewer'));

  if jsonb_typeof(p_module_permissions) = 'array' and jsonb_array_length(p_module_permissions) > 0 then
    insert into public.workspace_invite_module_permissions (workspace_id, invite_id, module, permission)
    select
      p_workspace_id,
      v_invite.id,
      (x.module)::public.module_key,
      (x.permission)::public.permission_level
    from jsonb_to_recordset(p_module_permissions) as x(module text, permission text)
    where x.module in ('notes', 'tasks')
      and x.permission in ('none', 'view', 'edit', 'admin')
    on conflict (invite_id, module) do update
      set permission = excluded.permission;
  else
    insert into public.workspace_invite_module_permissions (workspace_id, invite_id, module, permission)
    values
      (p_workspace_id, v_invite.id, 'notes', v_default_permission),
      (p_workspace_id, v_invite.id, 'tasks', v_default_permission)
    on conflict (invite_id, module) do update
      set permission = excluded.permission;
  end if;

  if jsonb_typeof(p_item_acl_templates) = 'array' and jsonb_array_length(p_item_acl_templates) > 0 then
    insert into public.workspace_invite_item_acl (
      workspace_id,
      invite_id,
      module,
      resource_type,
      resource_id,
      effect,
      permission
    )
    select
      p_workspace_id,
      v_invite.id,
      (x.module)::public.module_key,
      (x.resource_type)::public.resource_type,
      x.resource_id,
      (x.effect)::public.acl_effect,
      (x.permission)::public.permission_level
    from jsonb_to_recordset(p_item_acl_templates) as x(
      module text,
      resource_type text,
      resource_id uuid,
      effect text,
      permission text
    )
    where x.module in ('notes', 'tasks')
      and x.resource_type in ('note', 'task_project', 'task')
      and x.resource_id is not null
      and x.effect in ('allow', 'deny')
      and x.permission in ('none', 'view', 'edit', 'admin');
  end if;

  select coalesce(array_agg(u.id), array[]::text[])
  into v_recipients
  from public.users u
  where lower(u.email) = v_email;

  perform public.workspace_emit_notification(
    p_workspace_id,
    'workspace.invite.created',
    v_actor,
    jsonb_build_object('invite_id', v_invite.id, 'email', v_email),
    v_recipients,
    concat('workspace.invite.created:', v_invite.id::text)
  );

  return v_invite;
end;
$$;

create or replace function public.workspace_update_invite(
  p_invite_id uuid,
  p_role public.workspace_role,
  p_module_permissions jsonb default '[]'::jsonb,
  p_item_acl_templates jsonb default '[]'::jsonb
)
returns public.workspace_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_invite public.workspace_invites;
  v_default_permission public.permission_level;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  select *
  into v_invite
  from public.workspace_invites wi
  where wi.id = p_invite_id
    and wi.status = 'pending';

  if v_invite.id is null then
    raise exception 'Invite not found';
  end if;

  if not public.workspace_can_manage(v_invite.workspace_id) then
    raise exception 'Forbidden';
  end if;

  update public.workspace_invites wi
  set role = coalesce(p_role, wi.role)
  where wi.id = p_invite_id
  returning * into v_invite;

  delete from public.workspace_invite_module_permissions wimp
  where wimp.invite_id = p_invite_id;

  v_default_permission := public.default_module_permission_for_role(v_invite.role);

  if jsonb_typeof(p_module_permissions) = 'array' and jsonb_array_length(p_module_permissions) > 0 then
    insert into public.workspace_invite_module_permissions (workspace_id, invite_id, module, permission)
    select
      v_invite.workspace_id,
      v_invite.id,
      (x.module)::public.module_key,
      (x.permission)::public.permission_level
    from jsonb_to_recordset(p_module_permissions) as x(module text, permission text)
    where x.module in ('notes', 'tasks')
      and x.permission in ('none', 'view', 'edit', 'admin')
    on conflict (invite_id, module) do update
      set permission = excluded.permission;
  else
    insert into public.workspace_invite_module_permissions (workspace_id, invite_id, module, permission)
    values
      (v_invite.workspace_id, v_invite.id, 'notes', v_default_permission),
      (v_invite.workspace_id, v_invite.id, 'tasks', v_default_permission)
    on conflict (invite_id, module) do update
      set permission = excluded.permission;
  end if;

  delete from public.workspace_invite_item_acl wiia
  where wiia.invite_id = p_invite_id;

  if jsonb_typeof(p_item_acl_templates) = 'array' and jsonb_array_length(p_item_acl_templates) > 0 then
    insert into public.workspace_invite_item_acl (
      workspace_id,
      invite_id,
      module,
      resource_type,
      resource_id,
      effect,
      permission
    )
    select
      v_invite.workspace_id,
      v_invite.id,
      (x.module)::public.module_key,
      (x.resource_type)::public.resource_type,
      x.resource_id,
      (x.effect)::public.acl_effect,
      (x.permission)::public.permission_level
    from jsonb_to_recordset(p_item_acl_templates) as x(
      module text,
      resource_type text,
      resource_id uuid,
      effect text,
      permission text
    )
    where x.module in ('notes', 'tasks')
      and x.resource_type in ('note', 'task_project', 'task')
      and x.resource_id is not null
      and x.effect in ('allow', 'deny')
      and x.permission in ('none', 'view', 'edit', 'admin');
  end if;

  return v_invite;
end;
$$;

create or replace function public.workspace_revoke_invite(
  p_invite_id uuid
)
returns public.workspace_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_invite public.workspace_invites;
  v_recipients text[];
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  select *
  into v_invite
  from public.workspace_invites wi
  where wi.id = p_invite_id
    and wi.status = 'pending';

  if v_invite.id is null then
    raise exception 'Invite not found';
  end if;

  if not public.workspace_can_manage(v_invite.workspace_id) then
    raise exception 'Forbidden';
  end if;

  update public.workspace_invites wi
  set status = 'revoked', revoked_at = now()
  where wi.id = p_invite_id
  returning * into v_invite;

  select coalesce(array_agg(u.id), array[]::text[])
  into v_recipients
  from public.users u
  where lower(u.email) = lower(v_invite.email);

  perform public.workspace_emit_notification(
    v_invite.workspace_id,
    'workspace.invite.revoked',
    v_actor,
    jsonb_build_object('invite_id', v_invite.id, 'email', v_invite.email),
    v_recipients,
    concat('workspace.invite.revoked:', v_invite.id::text)
  );

  return v_invite;
end;
$$;

create or replace function public.workspace_claim_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_email text;
  v_invite record;
  v_member_id uuid;
  v_claimed int := 0;
  v_admin_recipients text[];
begin
  v_actor := public.auth_user_id();
  v_email := public.auth_user_email();

  if v_actor is null or v_email is null then
    return 0;
  end if;

  for v_invite in
    select wi.*
    from public.workspace_invites wi
    join public.workspaces w on w.id = wi.workspace_id
    where wi.status = 'pending'
      and lower(wi.email) = v_email
      and (wi.expires_at is null or wi.expires_at > now())
      and w.is_deleted = false
  loop
    insert into public.workspace_members (workspace_id, user_id, role, invited_by, joined_at, is_active, removed_at)
    values (v_invite.workspace_id, v_actor, v_invite.role, v_invite.invited_by, now(), true, null)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role,
          invited_by = excluded.invited_by,
          joined_at = now(),
          is_active = true,
          removed_at = null,
          updated_at = now()
    returning id into v_member_id;

    delete from public.workspace_member_module_permissions mp
    where mp.member_id = v_member_id;

    insert into public.workspace_member_module_permissions (workspace_id, member_id, module, permission, updated_by)
    select
      v_invite.workspace_id,
      v_member_id,
      imp.module,
      imp.permission,
      v_invite.invited_by
    from public.workspace_invite_module_permissions imp
    where imp.invite_id = v_invite.id
    on conflict (member_id, module) do update
      set permission = excluded.permission,
          updated_by = excluded.updated_by,
          updated_at = now();

    insert into public.workspace_item_acl (
      workspace_id,
      member_id,
      module,
      resource_type,
      resource_id,
      effect,
      permission,
      created_by
    )
    select
      v_invite.workspace_id,
      v_member_id,
      iac.module,
      iac.resource_type,
      iac.resource_id,
      iac.effect,
      iac.permission,
      v_invite.invited_by
    from public.workspace_invite_item_acl iac
    where iac.invite_id = v_invite.id
    on conflict (member_id, module, resource_type, resource_id) do update
      set effect = excluded.effect,
          permission = excluded.permission,
          created_by = excluded.created_by,
          updated_at = now();

    update public.workspace_invites wi
    set status = 'accepted',
        accepted_by = v_actor,
        accepted_at = now()
    where wi.id = v_invite.id;

    select coalesce(array_agg(wm.user_id), array[]::text[])
    into v_admin_recipients
    from public.workspace_members wm
    where wm.workspace_id = v_invite.workspace_id
      and wm.is_active = true
      and wm.removed_at is null
      and wm.role in ('owner', 'admin');

    perform public.workspace_emit_notification(
      v_invite.workspace_id,
      'workspace.invite.accepted',
      v_actor,
      jsonb_build_object('invite_id', v_invite.id, 'email', v_invite.email),
      v_admin_recipients,
      concat('workspace.invite.accepted:', v_invite.id::text)
    );

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

create or replace function public.workspace_update_member_permissions(
  p_member_id uuid,
  p_role public.workspace_role,
  p_module_permissions jsonb default '[]'::jsonb,
  p_item_acl jsonb default '[]'::jsonb
)
returns public.workspace_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_member public.workspace_members;
  v_default_permission public.permission_level;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  select *
  into v_member
  from public.workspace_members wm
  where wm.id = p_member_id
    and wm.is_active = true
    and wm.removed_at is null;

  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  if not public.workspace_can_manage(v_member.workspace_id) then
    raise exception 'Forbidden';
  end if;

  update public.workspace_members wm
  set role = coalesce(p_role, wm.role)
  where wm.id = p_member_id
  returning * into v_member;

  delete from public.workspace_member_module_permissions mp
  where mp.member_id = p_member_id;

  v_default_permission := public.default_module_permission_for_role(v_member.role);

  if jsonb_typeof(p_module_permissions) = 'array' and jsonb_array_length(p_module_permissions) > 0 then
    insert into public.workspace_member_module_permissions (workspace_id, member_id, module, permission, updated_by)
    select
      v_member.workspace_id,
      v_member.id,
      (x.module)::public.module_key,
      (x.permission)::public.permission_level,
      v_actor
    from jsonb_to_recordset(p_module_permissions) as x(module text, permission text)
    where x.module in ('notes', 'tasks')
      and x.permission in ('none', 'view', 'edit', 'admin')
    on conflict (member_id, module) do update
      set permission = excluded.permission,
          updated_by = excluded.updated_by,
          updated_at = now();
  else
    insert into public.workspace_member_module_permissions (workspace_id, member_id, module, permission, updated_by)
    values
      (v_member.workspace_id, v_member.id, 'notes', v_default_permission, v_actor),
      (v_member.workspace_id, v_member.id, 'tasks', v_default_permission, v_actor)
    on conflict (member_id, module) do update
      set permission = excluded.permission,
          updated_by = excluded.updated_by,
          updated_at = now();
  end if;

  delete from public.workspace_item_acl a
  where a.member_id = p_member_id;

  if jsonb_typeof(p_item_acl) = 'array' and jsonb_array_length(p_item_acl) > 0 then
    insert into public.workspace_item_acl (
      workspace_id,
      member_id,
      module,
      resource_type,
      resource_id,
      effect,
      permission,
      created_by
    )
    select
      v_member.workspace_id,
      v_member.id,
      (x.module)::public.module_key,
      (x.resource_type)::public.resource_type,
      x.resource_id,
      (x.effect)::public.acl_effect,
      (x.permission)::public.permission_level,
      v_actor
    from jsonb_to_recordset(p_item_acl) as x(
      module text,
      resource_type text,
      resource_id uuid,
      effect text,
      permission text
    )
    where x.module in ('notes', 'tasks')
      and x.resource_type in ('note', 'task_project', 'task')
      and x.resource_id is not null
      and x.effect in ('allow', 'deny')
      and x.permission in ('none', 'view', 'edit', 'admin')
    on conflict (member_id, module, resource_type, resource_id) do update
      set effect = excluded.effect,
          permission = excluded.permission,
          created_by = excluded.created_by,
          updated_at = now();
  end if;

  perform public.workspace_emit_notification(
    v_member.workspace_id,
    'workspace.member.permissions.changed',
    v_actor,
    jsonb_build_object('member_id', v_member.id, 'role', v_member.role),
    array[v_member.user_id],
    concat('workspace.member.permissions.changed:', v_member.id::text, ':', extract(epoch from now())::bigint::text)
  );

  return v_member;
end;
$$;

create or replace function public.workspace_leave(
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_member public.workspace_members;
  v_owner_count int;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  select *
  into v_member
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = v_actor
    and wm.is_active = true
    and wm.removed_at is null
  limit 1;

  if v_member.id is null then
    raise exception 'Workspace member not found';
  end if;

  if v_member.role = 'owner' then
    select count(*)::int
    into v_owner_count
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.is_active = true
      and wm.removed_at is null
      and wm.role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'Cannot leave as the last owner';
    end if;
  end if;

  update public.workspace_members wm
  set is_active = false,
      removed_at = now()
  where wm.id = v_member.id;
end;
$$;

create or replace function public.workspace_soft_delete(
  p_workspace_id uuid
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_workspace public.workspaces;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  if not public.workspace_is_owner(p_workspace_id) then
    raise exception 'Only owner can delete workspace';
  end if;

  update public.workspaces w
  set is_deleted = true,
      deleted_at = now()
  where w.id = p_workspace_id
  returning * into v_workspace;

  if v_workspace.id is null then
    raise exception 'Workspace not found';
  end if;

  return v_workspace;
end;
$$;

create or replace function public.workspace_list_notifications(
  p_scope text default 'workspace',
  p_workspace_id uuid default null,
  p_limit int default 100
)
returns table (
  id uuid,
  workspace_id uuid,
  event_type text,
  actor_user_id text,
  source_module public.module_key,
  source_resource_type public.resource_type,
  source_resource_id uuid,
  payload jsonb,
  created_at timestamptz,
  read_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    n.id,
    n.workspace_id,
    n.event_type,
    n.actor_user_id,
    n.source_module,
    n.source_resource_type,
    n.source_resource_id,
    n.payload,
    n.created_at,
    nr.read_at
  from public.notification_recipients nr
  join public.notifications n on n.id = nr.notification_id
  where nr.recipient_user_id = public.auth_user_id()
    and (
      (coalesce(lower(p_scope), 'workspace') = 'workspace' and n.workspace_id = p_workspace_id)
      or (coalesce(lower(p_scope), 'workspace') = 'global')
    )
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function public.workspace_mark_notification_read(
  p_notification_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_recipients nr
  set read_at = coalesce(nr.read_at, now())
  where nr.notification_id = p_notification_id
    and nr.recipient_user_id = public.auth_user_id();
$$;

create or replace function public.workspace_mark_all_notifications_read(
  p_scope text default 'workspace',
  p_workspace_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.notification_recipients nr
  set read_at = coalesce(nr.read_at, now())
  where nr.recipient_user_id = public.auth_user_id()
    and nr.read_at is null
    and exists (
      select 1
      from public.notifications n
      where n.id = nr.notification_id
        and (
          (coalesce(lower(p_scope), 'workspace') = 'workspace' and n.workspace_id = p_workspace_id)
          or (coalesce(lower(p_scope), 'workspace') = 'global')
        )
    );

  get diagnostics v_count = row_count;
  return v_count;
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
  where target.user_id <> v_actor
    and public.workspace_can_module(p_workspace_id, p_module, 'view')
    and public.workspace_item_permission(p_workspace_id, p_module, p_resource_type, p_resource_id, 'view');

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

create or replace function public.enforce_workspace_owner_safety()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_count int;
  v_actor_role public.workspace_role;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' then
    select count(*)::int
    into v_owner_count
    from public.workspace_members wm
    where wm.workspace_id = old.workspace_id
      and wm.role = 'owner'
      and wm.is_active = true
      and wm.removed_at is null
      and wm.id <> old.id;

    if v_owner_count = 0 then
      raise exception 'Cannot remove or demote the last owner';
    end if;

    v_actor_role := public.workspace_actor_role(old.workspace_id);
    if coalesce(v_actor_role, 'viewer') <> 'owner' then
      raise exception 'Only an owner can modify owner membership';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_workspace_members_owner_safety on public.workspace_members;
create trigger trg_workspace_members_owner_safety
before update or delete on public.workspace_members
for each row
when (old.role = 'owner')
execute function public.enforce_workspace_owner_safety();

create or replace function public.trg_workspace_member_permissions_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_member_id uuid;
  v_workspace_id uuid;
  v_recipient text;
  v_payload jsonb;
begin
  v_target_member_id := coalesce(new.member_id, old.member_id);
  v_workspace_id := coalesce(new.workspace_id, old.workspace_id);

  select wm.user_id into v_recipient
  from public.workspace_members wm
  where wm.id = v_target_member_id;

  if v_recipient is null then
    return coalesce(new, old);
  end if;

  v_payload := jsonb_build_object(
    'member_id', v_target_member_id,
    'module', coalesce(new.module, old.module),
    'permission', coalesce(new.permission, old.permission),
    'operation', tg_op
  );

  perform public.workspace_emit_notification(
    v_workspace_id,
    'workspace.member.module_permission.changed',
    public.auth_user_id(),
    v_payload,
    array[v_recipient],
    concat('workspace.member.module_permission.changed:', v_workspace_id::text, ':', v_target_member_id::text, ':', coalesce(new.module, old.module)::text, ':', tg_op, ':', extract(epoch from now())::bigint::text)
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_workspace_member_permissions_notify on public.workspace_member_module_permissions;
create trigger trg_workspace_member_permissions_notify
after insert or update or delete on public.workspace_member_module_permissions
for each row
execute function public.trg_workspace_member_permissions_notify();

create or replace function public.trg_workspace_item_acl_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_member_id uuid;
  v_workspace_id uuid;
  v_recipient text;
  v_payload jsonb;
begin
  v_target_member_id := coalesce(new.member_id, old.member_id);
  v_workspace_id := coalesce(new.workspace_id, old.workspace_id);

  select wm.user_id into v_recipient
  from public.workspace_members wm
  where wm.id = v_target_member_id;

  if v_recipient is null then
    return coalesce(new, old);
  end if;

  v_payload := jsonb_build_object(
    'member_id', v_target_member_id,
    'module', coalesce(new.module, old.module),
    'resource_type', coalesce(new.resource_type, old.resource_type),
    'resource_id', coalesce(new.resource_id, old.resource_id),
    'effect', coalesce(new.effect, old.effect),
    'permission', coalesce(new.permission, old.permission),
    'operation', tg_op
  );

  perform public.workspace_emit_notification(
    v_workspace_id,
    'workspace.member.item_acl.changed',
    public.auth_user_id(),
    v_payload,
    array[v_recipient],
    concat('workspace.member.item_acl.changed:', v_workspace_id::text, ':', v_target_member_id::text, ':', coalesce(new.resource_id, old.resource_id)::text, ':', tg_op, ':', extract(epoch from now())::bigint::text)
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_workspace_item_acl_notify on public.workspace_item_acl;
create trigger trg_workspace_item_acl_notify
after insert or update or delete on public.workspace_item_acl
for each row
execute function public.trg_workspace_item_acl_notify();

create or replace function public.trg_workspace_member_join_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.workspace_emit_notification(
      new.workspace_id,
      'workspace.member.joined',
      new.user_id,
      jsonb_build_object('member_id', new.id, 'user_id', new.user_id, 'role', new.role),
      array[new.user_id],
      concat('workspace.member.joined:', new.workspace_id::text, ':', new.user_id)
    );
  elsif tg_op = 'UPDATE' and (new.role is distinct from old.role) then
    perform public.workspace_emit_notification(
      new.workspace_id,
      'workspace.member.role.changed',
      public.auth_user_id(),
      jsonb_build_object('member_id', new.id, 'user_id', new.user_id, 'role', new.role, 'previous_role', old.role),
      array[new.user_id],
      concat('workspace.member.role.changed:', new.workspace_id::text, ':', new.user_id, ':', new.role::text)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_workspace_member_join_notify on public.workspace_members;
create trigger trg_workspace_member_join_notify
after insert or update of role on public.workspace_members
for each row
execute function public.trg_workspace_member_join_notify();

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;
alter table public.workspace_member_module_permissions enable row level security;
alter table public.workspace_member_module_permissions force row level security;
alter table public.workspace_item_acl enable row level security;
alter table public.workspace_item_acl force row level security;
alter table public.workspace_invites enable row level security;
alter table public.workspace_invites force row level security;
alter table public.workspace_invite_module_permissions enable row level security;
alter table public.workspace_invite_module_permissions force row level security;
alter table public.workspace_invite_item_acl enable row level security;
alter table public.workspace_invite_item_acl force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.notification_recipients enable row level security;
alter table public.notification_recipients force row level security;

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces
for select to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = public.auth_user_id()
      and wm.is_active = true
      and wm.removed_at is null
  )
);

drop policy if exists workspaces_insert_creator on public.workspaces;
create policy workspaces_insert_creator on public.workspaces
for insert to authenticated
with check (created_by = public.auth_user_id());

drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner on public.workspaces
for update to authenticated
using (public.workspace_is_owner(id))
with check (public.workspace_is_owner(id));

drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member on public.workspace_members
for select to authenticated
using (
  public.workspace_member_id(workspace_id) is not null
);

drop policy if exists workspace_members_manage on public.workspace_members;
create policy workspace_members_manage on public.workspace_members
for all to authenticated
using (public.workspace_can_manage(workspace_id))
with check (public.workspace_can_manage(workspace_id));

drop policy if exists workspace_member_module_permissions_select_member on public.workspace_member_module_permissions;
create policy workspace_member_module_permissions_select_member on public.workspace_member_module_permissions
for select to authenticated
using (public.workspace_member_id(workspace_id) is not null);

drop policy if exists workspace_member_module_permissions_manage on public.workspace_member_module_permissions;
create policy workspace_member_module_permissions_manage on public.workspace_member_module_permissions
for all to authenticated
using (public.workspace_can_manage(workspace_id))
with check (public.workspace_can_manage(workspace_id));

drop policy if exists workspace_item_acl_select_member on public.workspace_item_acl;
create policy workspace_item_acl_select_member on public.workspace_item_acl
for select to authenticated
using (public.workspace_member_id(workspace_id) is not null);

drop policy if exists workspace_item_acl_manage on public.workspace_item_acl;
create policy workspace_item_acl_manage on public.workspace_item_acl
for all to authenticated
using (public.workspace_can_manage(workspace_id))
with check (public.workspace_can_manage(workspace_id));

drop policy if exists workspace_invites_select_member on public.workspace_invites;
create policy workspace_invites_select_member on public.workspace_invites
for select to authenticated
using (public.workspace_member_id(workspace_id) is not null);

drop policy if exists workspace_invites_manage on public.workspace_invites;
create policy workspace_invites_manage on public.workspace_invites
for all to authenticated
using (public.workspace_can_manage(workspace_id))
with check (public.workspace_can_manage(workspace_id));

drop policy if exists workspace_invite_module_permissions_select_member on public.workspace_invite_module_permissions;
create policy workspace_invite_module_permissions_select_member on public.workspace_invite_module_permissions
for select to authenticated
using (public.workspace_member_id(workspace_id) is not null);

drop policy if exists workspace_invite_module_permissions_manage on public.workspace_invite_module_permissions;
create policy workspace_invite_module_permissions_manage on public.workspace_invite_module_permissions
for all to authenticated
using (public.workspace_can_manage(workspace_id))
with check (public.workspace_can_manage(workspace_id));

drop policy if exists workspace_invite_item_acl_select_member on public.workspace_invite_item_acl;
create policy workspace_invite_item_acl_select_member on public.workspace_invite_item_acl
for select to authenticated
using (public.workspace_member_id(workspace_id) is not null);

drop policy if exists workspace_invite_item_acl_manage on public.workspace_invite_item_acl;
create policy workspace_invite_item_acl_manage on public.workspace_invite_item_acl
for all to authenticated
using (public.workspace_can_manage(workspace_id))
with check (public.workspace_can_manage(workspace_id));

drop policy if exists notifications_select_recipient on public.notifications;
create policy notifications_select_recipient on public.notifications
for select to authenticated
using (
  exists (
    select 1
    from public.notification_recipients nr
    where nr.notification_id = notifications.id
      and nr.recipient_user_id = public.auth_user_id()
  )
);

drop policy if exists notification_recipients_select_own on public.notification_recipients;
create policy notification_recipients_select_own on public.notification_recipients
for select to authenticated
using (recipient_user_id = public.auth_user_id());

drop policy if exists notification_recipients_update_own on public.notification_recipients;
create policy notification_recipients_update_own on public.notification_recipients
for update to authenticated
using (recipient_user_id = public.auth_user_id())
with check (recipient_user_id = public.auth_user_id());

revoke all on function public.auth_user_id() from public;
revoke all on function public.auth_user_email() from public;
revoke all on function public.workspace_role_level(public.workspace_role) from public;
revoke all on function public.permission_level_rank(public.permission_level) from public;
revoke all on function public.default_module_permission_for_role(public.workspace_role) from public;
revoke all on function public.workspace_member_id(uuid) from public;
revoke all on function public.workspace_actor_role(uuid) from public;
revoke all on function public.workspace_is_owner(uuid) from public;
revoke all on function public.workspace_can_manage(uuid) from public;
revoke all on function public.workspace_module_permission(uuid, public.module_key) from public;
revoke all on function public.workspace_can_module(uuid, public.module_key, public.permission_level) from public;
revoke all on function public.workspace_item_permission(uuid, public.module_key, public.resource_type, uuid, public.permission_level) from public;
revoke all on function public.workspace_emit_notification(uuid, text, text, jsonb, text[], text, public.module_key, public.resource_type, uuid) from public;
revoke all on function public.workspace_create(text) from public;
revoke all on function public.workspace_list_for_current_user() from public;
revoke all on function public.workspace_send_invite(uuid, text, public.workspace_role, jsonb, jsonb) from public;
revoke all on function public.workspace_update_invite(uuid, public.workspace_role, jsonb, jsonb) from public;
revoke all on function public.workspace_revoke_invite(uuid) from public;
revoke all on function public.workspace_claim_invites() from public;
revoke all on function public.workspace_update_member_permissions(uuid, public.workspace_role, jsonb, jsonb) from public;
revoke all on function public.workspace_leave(uuid) from public;
revoke all on function public.workspace_soft_delete(uuid) from public;
revoke all on function public.workspace_list_notifications(text, uuid, int) from public;
revoke all on function public.workspace_mark_notification_read(uuid) from public;
revoke all on function public.workspace_mark_all_notifications_read(text, uuid) from public;
revoke all on function public.workspace_emit_mentions(uuid, public.module_key, public.resource_type, uuid, text[], jsonb, text) from public;

grant execute on function public.auth_user_id() to authenticated;
grant execute on function public.auth_user_email() to authenticated;
grant execute on function public.workspace_role_level(public.workspace_role) to authenticated;
grant execute on function public.permission_level_rank(public.permission_level) to authenticated;
grant execute on function public.default_module_permission_for_role(public.workspace_role) to authenticated;
grant execute on function public.workspace_member_id(uuid) to authenticated;
grant execute on function public.workspace_actor_role(uuid) to authenticated;
grant execute on function public.workspace_is_owner(uuid) to authenticated;
grant execute on function public.workspace_can_manage(uuid) to authenticated;
grant execute on function public.workspace_module_permission(uuid, public.module_key) to authenticated;
grant execute on function public.workspace_can_module(uuid, public.module_key, public.permission_level) to authenticated;
grant execute on function public.workspace_item_permission(uuid, public.module_key, public.resource_type, uuid, public.permission_level) to authenticated;
grant execute on function public.workspace_emit_notification(uuid, text, text, jsonb, text[], text, public.module_key, public.resource_type, uuid) to authenticated;
grant execute on function public.workspace_create(text) to authenticated;
grant execute on function public.workspace_list_for_current_user() to authenticated;
grant execute on function public.workspace_send_invite(uuid, text, public.workspace_role, jsonb, jsonb) to authenticated;
grant execute on function public.workspace_update_invite(uuid, public.workspace_role, jsonb, jsonb) to authenticated;
grant execute on function public.workspace_revoke_invite(uuid) to authenticated;
grant execute on function public.workspace_claim_invites() to authenticated;
grant execute on function public.workspace_update_member_permissions(uuid, public.workspace_role, jsonb, jsonb) to authenticated;
grant execute on function public.workspace_leave(uuid) to authenticated;
grant execute on function public.workspace_soft_delete(uuid) to authenticated;
grant execute on function public.workspace_list_notifications(text, uuid, int) to authenticated;
grant execute on function public.workspace_mark_notification_read(uuid) to authenticated;
grant execute on function public.workspace_mark_all_notifications_read(text, uuid) to authenticated;
grant execute on function public.workspace_emit_mentions(uuid, public.module_key, public.resource_type, uuid, text[], jsonb, text) to authenticated;

commit;

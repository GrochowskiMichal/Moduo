begin;

create extension if not exists pgcrypto;

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id text not null,
  name text not null,
  description text not null default '',
  schema jsonb not null default '{"fields":[]}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  submissions_count bigint not null default 0,
  last_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (length(trim(name)) between 1 and 160),
  check (jsonb_typeof(schema) = 'object')
);

create table if not exists public.form_share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  slug text not null,
  is_active boolean not null default true,
  require_access_code boolean not null default false,
  access_code_hash text,
  expires_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id),
  unique (slug),
  check (slug ~ '^[a-z0-9][a-z0-9-]{5,127}$'),
  check (not require_access_code or access_code_hash is not null)
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  share_link_id uuid references public.form_share_links(id) on delete set null,
  respondent_user_id text,
  answers jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  check (jsonb_typeof(answers) in ('object', 'array')),
  check (jsonb_typeof(meta) = 'object')
);

create index if not exists forms_workspace_updated_idx
  on public.forms (workspace_id, updated_at desc)
  where deleted_at is null;

create index if not exists forms_workspace_status_idx
  on public.forms (workspace_id, status)
  where deleted_at is null;

create index if not exists form_share_links_slug_active_idx
  on public.form_share_links (slug)
  where is_active = true;

create index if not exists form_submissions_form_submitted_idx
  on public.form_submissions (form_id, submitted_at desc);

create index if not exists form_submissions_workspace_submitted_idx
  on public.form_submissions (workspace_id, submitted_at desc);

create or replace function public.workspace_can_edit_forms(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_actor_role(p_workspace_id) in ('owner', 'admin', 'editor'), false);
$$;

create or replace function public.generate_form_slug()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_attempt int := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_slug := encode(extensions.gen_random_bytes(6), 'hex');
    exit when not exists (select 1 from public.form_share_links where slug = v_slug);
    if v_attempt > 20 then
      raise exception 'Unable to generate unique form slug';
    end if;
  end loop;
  return v_slug;
end;
$$;

create or replace function public.forms_set_share_link(
  p_form_id uuid,
  p_require_access_code boolean default false,
  p_access_code text default null,
  p_regenerate_slug boolean default false,
  p_is_active boolean default true,
  p_expires_at timestamptz default null
)
returns public.form_share_links
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.forms;
  v_link public.form_share_links;
  v_actor text;
  v_slug text;
  v_hash text;
begin
  v_actor := public.auth_user_id();
  if v_actor is null then
    raise exception 'Unauthenticated';
  end if;

  select *
  into v_form
  from public.forms f
  where f.id = p_form_id
    and f.deleted_at is null;

  if v_form.id is null then
    raise exception 'Form not found';
  end if;

  if not public.workspace_can_edit_forms(v_form.workspace_id) then
    raise exception 'Forbidden';
  end if;

  select * into v_link from public.form_share_links where form_id = p_form_id;

  v_slug := case
    when p_regenerate_slug or v_link.id is null then public.generate_form_slug()
    else v_link.slug
  end;

  if p_require_access_code then
    if coalesce(trim(p_access_code), '') <> '' then
      v_hash := extensions.crypt(p_access_code, extensions.gen_salt('bf'));
    elsif v_link.id is not null and v_link.access_code_hash is not null then
      v_hash := v_link.access_code_hash;
    else
      raise exception 'Access code required';
    end if;
  else
    v_hash := null;
  end if;

  insert into public.form_share_links (
    workspace_id,
    form_id,
    slug,
    is_active,
    require_access_code,
    access_code_hash,
    expires_at,
    created_by
  )
  values (
    v_form.workspace_id,
    v_form.id,
    v_slug,
    p_is_active,
    p_require_access_code,
    v_hash,
    p_expires_at,
    v_actor
  )
  on conflict (form_id) do update
    set slug = excluded.slug,
        is_active = excluded.is_active,
        require_access_code = excluded.require_access_code,
        access_code_hash = excluded.access_code_hash,
        expires_at = excluded.expires_at,
        updated_at = now()
  returning * into v_link;

  return v_link;
end;
$$;

create or replace function public.forms_public_get_by_slug(
  p_slug text,
  p_access_code text default null
)
returns table (
  form_id uuid,
  form_name text,
  form_description text,
  form_schema jsonb,
  is_locked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with candidate as (
    select
      f.id,
      f.name,
      f.description,
      f.schema,
      (
        l.require_access_code
        and (
          l.access_code_hash is null
          or coalesce(p_access_code, '') = ''
          or extensions.crypt(p_access_code, l.access_code_hash) <> l.access_code_hash
        )
      ) as locked
    from public.form_share_links l
    join public.forms f on f.id = l.form_id
    where l.slug = p_slug
      and l.is_active = true
      and (l.expires_at is null or l.expires_at > now())
      and f.deleted_at is null
      and f.status = 'published'
    limit 1
  )
  select
    c.id,
    c.name,
    c.description,
    case when c.locked then null else c.schema end,
    c.locked
  from candidate c;
$$;

create or replace function public.forms_public_submit(
  p_slug text,
  p_answers jsonb,
  p_meta jsonb default '{}'::jsonb,
  p_access_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.form_share_links;
  v_form public.forms;
  v_submission_id uuid;
  v_locked boolean;
begin
  select *
  into v_link
  from public.form_share_links l
  where l.slug = p_slug
    and l.is_active = true
    and (l.expires_at is null or l.expires_at > now())
  limit 1;

  if v_link.id is null then
    raise exception 'Form link not found';
  end if;

  select *
  into v_form
  from public.forms f
  where f.id = v_link.form_id
    and f.deleted_at is null
    and f.status = 'published'
  limit 1;

  if v_form.id is null then
    raise exception 'Form unavailable';
  end if;

  v_locked := v_link.require_access_code and (
    v_link.access_code_hash is null
    or coalesce(p_access_code, '') = ''
    or extensions.crypt(p_access_code, v_link.access_code_hash) <> v_link.access_code_hash
  );

  if v_locked then
    raise exception 'Invalid access code';
  end if;

  insert into public.form_submissions (
    workspace_id,
    form_id,
    share_link_id,
    respondent_user_id,
    answers,
    meta
  )
  values (
    v_form.workspace_id,
    v_form.id,
    v_link.id,
    public.auth_user_id(),
    coalesce(p_answers, '{}'::jsonb),
    coalesce(p_meta, '{}'::jsonb)
  )
  returning id into v_submission_id;

  return v_submission_id;
end;
$$;

create or replace function public.trg_forms_submission_counter()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.forms f
  set submissions_count = f.submissions_count + 1,
      last_submitted_at = greatest(coalesce(f.last_submitted_at, to_timestamp(0)), new.submitted_at),
      updated_at = now()
  where f.id = new.form_id;

  return new;
end;
$$;

drop trigger if exists trg_forms_updated_at on public.forms;
create trigger trg_forms_updated_at
before update on public.forms
for each row
execute function public.set_updated_at();

drop trigger if exists trg_form_share_links_updated_at on public.form_share_links;
create trigger trg_form_share_links_updated_at
before update on public.form_share_links
for each row
execute function public.set_updated_at();

drop trigger if exists trg_form_submissions_counter on public.form_submissions;
create trigger trg_form_submissions_counter
after insert on public.form_submissions
for each row
execute function public.trg_forms_submission_counter();

alter table public.forms enable row level security;
alter table public.forms force row level security;
alter table public.form_share_links enable row level security;
alter table public.form_share_links force row level security;
alter table public.form_submissions enable row level security;
alter table public.form_submissions force row level security;

drop policy if exists forms_select_workspace on public.forms;
create policy forms_select_workspace on public.forms
for select
using ((select public.workspace_member_id(workspace_id)) is not null and deleted_at is null);

drop policy if exists forms_insert_workspace on public.forms;
create policy forms_insert_workspace on public.forms
for insert
with check ((select public.workspace_can_edit_forms(workspace_id)));

drop policy if exists forms_update_workspace on public.forms;
create policy forms_update_workspace on public.forms
for update
using ((select public.workspace_can_edit_forms(workspace_id)) and deleted_at is null)
with check ((select public.workspace_can_edit_forms(workspace_id)));

drop policy if exists forms_delete_workspace on public.forms;
create policy forms_delete_workspace on public.forms
for delete
using ((select public.workspace_can_edit_forms(workspace_id)));

drop policy if exists form_share_links_select_workspace on public.form_share_links;
create policy form_share_links_select_workspace on public.form_share_links
for select
using ((select public.workspace_member_id(workspace_id)) is not null);

drop policy if exists form_share_links_insert_workspace on public.form_share_links;
create policy form_share_links_insert_workspace on public.form_share_links
for insert
with check ((select public.workspace_can_edit_forms(workspace_id)));

drop policy if exists form_share_links_update_workspace on public.form_share_links;
create policy form_share_links_update_workspace on public.form_share_links
for update
using ((select public.workspace_can_edit_forms(workspace_id)))
with check ((select public.workspace_can_edit_forms(workspace_id)));

drop policy if exists form_share_links_delete_workspace on public.form_share_links;
create policy form_share_links_delete_workspace on public.form_share_links
for delete
using ((select public.workspace_can_edit_forms(workspace_id)));

drop policy if exists form_submissions_select_workspace on public.form_submissions;
create policy form_submissions_select_workspace on public.form_submissions
for select
using ((select public.workspace_member_id(workspace_id)) is not null);

revoke all on function public.workspace_can_edit_forms(uuid) from public;
revoke all on function public.generate_form_slug() from public;
revoke all on function public.forms_set_share_link(uuid, boolean, text, boolean, boolean, timestamptz) from public;
revoke all on function public.forms_public_get_by_slug(text, text) from public;
revoke all on function public.forms_public_submit(text, jsonb, jsonb, text) from public;

grant execute on function public.workspace_can_edit_forms(uuid) to authenticated;
grant execute on function public.generate_form_slug() to authenticated;
grant execute on function public.forms_set_share_link(uuid, boolean, text, boolean, boolean, timestamptz) to authenticated;
grant execute on function public.forms_public_get_by_slug(text, text) to anon, authenticated;
grant execute on function public.forms_public_submit(text, jsonb, jsonb, text) to anon, authenticated;

commit;

begin;

create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'outlook', 'apple', 'custom')),
  auth_mode text not null check (auth_mode in ('oauth', 'app_password', 'smtp_imap', 'smtp_pop3')),
  email_address text not null,
  display_name text,
  status text not null default 'active' check (status in ('active', 'reauth_required', 'error', 'disabled')),
  smtp_host text,
  smtp_port int,
  smtp_secure boolean,
  smtp_username text,
  imap_host text,
  imap_port int,
  imap_secure boolean,
  imap_username text,
  pop3_host text,
  pop3_port int,
  pop3_secure boolean,
  pop3_username text,
  oauth_scopes text[] not null default '{}'::text[],
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(email_address)) > 2)
);

create unique index if not exists email_accounts_user_workspace_email_unique_idx
  on public.email_accounts (user_id, workspace_id, email_address);
create index if not exists email_accounts_user_workspace_email_lower_idx
  on public.email_accounts (user_id, workspace_id, lower(email_address));
create index if not exists email_accounts_user_workspace_idx
  on public.email_accounts (user_id, workspace_id);
create index if not exists email_accounts_status_idx
  on public.email_accounts (status);

create table if not exists public.email_account_secrets (
  account_id uuid primary key references public.email_accounts(id) on delete cascade,
  oauth_access_token_enc text,
  oauth_refresh_token_enc text,
  oauth_expires_at timestamptz,
  smtp_password_enc text,
  imap_password_enc text,
  pop3_password_enc text,
  updated_at timestamptz not null default now()
);

create table if not exists public.email_folders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  remote_id text not null,
  name text not null,
  kind text not null default 'custom' check (kind in ('inbox', 'sent', 'drafts', 'trash', 'custom')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, remote_id)
);

create index if not exists email_folders_account_kind_idx
  on public.email_folders (account_id, kind);

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  folder_id uuid not null references public.email_folders(id) on delete cascade,
  remote_id text not null,
  subject text,
  snippet text,
  from_name text,
  from_email text,
  last_message_at timestamptz,
  is_unread boolean not null default true,
  message_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, remote_id)
);

create index if not exists email_threads_account_folder_last_message_idx
  on public.email_threads (account_id, folder_id, last_message_at desc nulls last);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  remote_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_json jsonb not null default '{}'::jsonb,
  to_json jsonb not null default '[]'::jsonb,
  cc_json jsonb not null default '[]'::jsonb,
  bcc_json jsonb not null default '[]'::jsonb,
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, remote_id)
);

create index if not exists email_messages_thread_sent_at_idx
  on public.email_messages (thread_id, sent_at desc nulls last);

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_outbox_status_created_at_idx
  on public.email_outbox (status, created_at);

create table if not exists public.email_sync_state (
  account_id uuid primary key references public.email_accounts(id) on delete cascade,
  history_id text,
  delta_token text,
  imap_uid_validity text,
  pop3_last_uidl text,
  updated_at timestamptz not null default now()
);

create or replace function public.email_account_accessible(p_account_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.email_accounts ea
    where ea.id = p_account_id
      and ea.user_id = public.auth_user_id()
      and public.workspace_member_id(ea.workspace_id) is not null
  );
$$;

create or replace function public.email_record_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.email_accounts enable row level security;
alter table public.email_account_secrets enable row level security;
alter table public.email_folders enable row level security;
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_outbox enable row level security;
alter table public.email_sync_state enable row level security;

create policy email_accounts_select_own on public.email_accounts
for select
using (user_id = public.auth_user_id() and public.workspace_member_id(workspace_id) is not null);

create policy email_accounts_insert_own on public.email_accounts
for insert
with check (user_id = public.auth_user_id() and public.workspace_member_id(workspace_id) is not null);

create policy email_accounts_update_own on public.email_accounts
for update
using (user_id = public.auth_user_id() and public.workspace_member_id(workspace_id) is not null)
with check (user_id = public.auth_user_id() and public.workspace_member_id(workspace_id) is not null);

create policy email_accounts_delete_own on public.email_accounts
for delete
using (user_id = public.auth_user_id() and public.workspace_member_id(workspace_id) is not null);

create policy email_folders_select_own on public.email_folders
for select
using (public.email_account_accessible(account_id));

create policy email_folders_insert_own on public.email_folders
for insert
with check (public.email_account_accessible(account_id));

create policy email_folders_update_own on public.email_folders
for update
using (public.email_account_accessible(account_id))
with check (public.email_account_accessible(account_id));

create policy email_folders_delete_own on public.email_folders
for delete
using (public.email_account_accessible(account_id));

create policy email_threads_select_own on public.email_threads
for select
using (public.email_account_accessible(account_id));

create policy email_threads_insert_own on public.email_threads
for insert
with check (public.email_account_accessible(account_id));

create policy email_threads_update_own on public.email_threads
for update
using (public.email_account_accessible(account_id))
with check (public.email_account_accessible(account_id));

create policy email_threads_delete_own on public.email_threads
for delete
using (public.email_account_accessible(account_id));

create policy email_messages_select_own on public.email_messages
for select
using (public.email_account_accessible(account_id));

create policy email_messages_insert_own on public.email_messages
for insert
with check (public.email_account_accessible(account_id));

create policy email_messages_update_own on public.email_messages
for update
using (public.email_account_accessible(account_id))
with check (public.email_account_accessible(account_id));

create policy email_messages_delete_own on public.email_messages
for delete
using (public.email_account_accessible(account_id));

create policy email_outbox_select_own on public.email_outbox
for select
using (public.email_account_accessible(account_id));

create policy email_outbox_insert_own on public.email_outbox
for insert
with check (public.email_account_accessible(account_id));

create policy email_outbox_update_own on public.email_outbox
for update
using (public.email_account_accessible(account_id))
with check (public.email_account_accessible(account_id));

create policy email_outbox_delete_own on public.email_outbox
for delete
using (public.email_account_accessible(account_id));

create policy email_sync_state_select_own on public.email_sync_state
for select
using (public.email_account_accessible(account_id));

create policy email_sync_state_insert_own on public.email_sync_state
for insert
with check (public.email_account_accessible(account_id));

create policy email_sync_state_update_own on public.email_sync_state
for update
using (public.email_account_accessible(account_id))
with check (public.email_account_accessible(account_id));

create policy email_sync_state_delete_own on public.email_sync_state
for delete
using (public.email_account_accessible(account_id));

create policy email_account_secrets_none on public.email_account_secrets
for all
using (false)
with check (false);

drop trigger if exists trg_email_accounts_updated_at on public.email_accounts;
create trigger trg_email_accounts_updated_at
before update on public.email_accounts
for each row
execute function public.email_record_updated_at();

drop trigger if exists trg_email_folders_updated_at on public.email_folders;
create trigger trg_email_folders_updated_at
before update on public.email_folders
for each row
execute function public.email_record_updated_at();

drop trigger if exists trg_email_threads_updated_at on public.email_threads;
create trigger trg_email_threads_updated_at
before update on public.email_threads
for each row
execute function public.email_record_updated_at();

drop trigger if exists trg_email_messages_updated_at on public.email_messages;
create trigger trg_email_messages_updated_at
before update on public.email_messages
for each row
execute function public.email_record_updated_at();

drop trigger if exists trg_email_outbox_updated_at on public.email_outbox;
create trigger trg_email_outbox_updated_at
before update on public.email_outbox
for each row
execute function public.email_record_updated_at();

drop trigger if exists trg_email_sync_state_updated_at on public.email_sync_state;
create trigger trg_email_sync_state_updated_at
before update on public.email_sync_state
for each row
execute function public.email_record_updated_at();

drop trigger if exists trg_email_account_secrets_updated_at on public.email_account_secrets;
create trigger trg_email_account_secrets_updated_at
before update on public.email_account_secrets
for each row
execute function public.email_record_updated_at();

revoke all on function public.email_account_accessible(uuid) from public;
revoke all on function public.email_record_updated_at() from public;
grant execute on function public.email_account_accessible(uuid) to authenticated;
grant execute on function public.email_record_updated_at() to authenticated;

revoke all on table public.email_account_secrets from anon, authenticated;

grant select, insert, update, delete on table public.email_accounts to authenticated;
grant select, insert, update, delete on table public.email_folders to authenticated;
grant select, insert, update, delete on table public.email_threads to authenticated;
grant select, insert, update, delete on table public.email_messages to authenticated;
grant select, insert, update, delete on table public.email_outbox to authenticated;
grant select, insert, update, delete on table public.email_sync_state to authenticated;

commit;

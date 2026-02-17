begin;

alter table public.notes
  add column if not exists workspace_id uuid;

alter table public.note_documents
  add column if not exists workspace_id uuid;

alter table public.note_updates
  add column if not exists workspace_id uuid;

alter table public.task_projects
  add column if not exists workspace_id uuid;

alter table public.task_workflow_states
  add column if not exists workspace_id uuid;

alter table public.tasks
  add column if not exists workspace_id uuid,
  add column if not exists assignee_id text;

alter table public.task_comments
  add column if not exists workspace_id uuid;

create index if not exists notes_workspace_parent_position_active_idx
  on public.notes (workspace_id, parent_id, position)
  where deleted_at is null;

create index if not exists notes_workspace_updated_active_idx
  on public.notes (workspace_id, updated_at desc)
  where deleted_at is null;

create index if not exists notes_workspace_pinned_updated_active_idx
  on public.notes (workspace_id, is_pinned, updated_at desc)
  where deleted_at is null and is_archived = false;

create index if not exists note_documents_workspace_updated_idx
  on public.note_documents (workspace_id, updated_at desc);

create index if not exists note_updates_workspace_id_id_idx
  on public.note_updates (workspace_id, id);

create index if not exists note_updates_workspace_note_id_id_idx
  on public.note_updates (workspace_id, note_id, id);

create index if not exists task_projects_workspace_updated_active_idx
  on public.task_projects (workspace_id, updated_at desc)
  where deleted_at is null;

create index if not exists task_projects_workspace_position_active_idx
  on public.task_projects (workspace_id, position)
  where deleted_at is null;

create index if not exists task_workflow_states_workspace_project_position_active_idx
  on public.task_workflow_states (workspace_id, project_id, position)
  where deleted_at is null;

create index if not exists tasks_workspace_project_parent_position_active_idx
  on public.tasks (workspace_id, project_id, parent_task_id, position)
  where deleted_at is null;

create index if not exists tasks_workspace_project_state_position_active_idx
  on public.tasks (workspace_id, project_id, state_id, position)
  where deleted_at is null;

create index if not exists tasks_workspace_updated_active_idx
  on public.tasks (workspace_id, updated_at desc)
  where deleted_at is null;

create index if not exists tasks_workspace_assignee_active_idx
  on public.tasks (workspace_id, assignee_id, updated_at desc)
  where deleted_at is null and assignee_id is not null;

create index if not exists task_comments_workspace_task_created_active_idx
  on public.task_comments (workspace_id, task_id, created_at desc)
  where deleted_at is null;

commit;

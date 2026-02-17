create index if not exists task_workflow_states_project_id_idx
  on public.task_workflow_states (project_id);

create index if not exists tasks_project_id_idx
  on public.tasks (project_id);

create index if not exists tasks_parent_task_id_idx
  on public.tasks (parent_task_id);

create index if not exists tasks_state_id_project_id_idx
  on public.tasks (state_id, project_id);

create index if not exists task_comments_task_id_idx
  on public.task_comments (task_id);

begin;

create temp table _workspace_user_ids on commit drop as
select distinct id as user_id
from public.users
where id is not null
union
select distinct owner_id as user_id from public.notes where owner_id is not null
union
select distinct owner_id as user_id from public.note_documents where owner_id is not null
union
select distinct owner_id as user_id from public.note_updates where owner_id is not null
union
select distinct owner_id as user_id from public.task_projects where owner_id is not null
union
select distinct owner_id as user_id from public.task_workflow_states where owner_id is not null
union
select distinct owner_id as user_id from public.tasks where owner_id is not null
union
select distinct owner_id as user_id from public.task_comments where owner_id is not null;

create temp table _workspace_map (
  user_id text primary key,
  workspace_id uuid not null
) on commit drop;

do $$
declare
  v_user text;
  v_workspace_id uuid;
  v_member_id uuid;
begin
  for v_user in
    select user_id from _workspace_user_ids
  loop
    select wm.workspace_id
    into v_workspace_id
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = v_user
      and wm.role = 'owner'
      and wm.is_active = true
      and wm.removed_at is null
      and w.is_deleted = false
    order by wm.created_at asc
    limit 1;

    if v_workspace_id is null then
      insert into public.workspaces (name, created_by)
      values ('Personal', v_user)
      returning id into v_workspace_id;

      insert into public.workspace_members (workspace_id, user_id, role, invited_by)
      values (v_workspace_id, v_user, 'owner', v_user)
      returning id into v_member_id;

      insert into public.workspace_member_module_permissions (workspace_id, member_id, module, permission, updated_by)
      values
        (v_workspace_id, v_member_id, 'notes', 'admin', v_user),
        (v_workspace_id, v_member_id, 'tasks', 'admin', v_user)
      on conflict (member_id, module) do update
        set permission = excluded.permission,
            updated_by = excluded.updated_by,
            updated_at = now();
    end if;

    insert into _workspace_map (user_id, workspace_id)
    values (v_user, v_workspace_id)
    on conflict (user_id) do update
      set workspace_id = excluded.workspace_id;
  end loop;
end
$$;

update public.notes n
set workspace_id = m.workspace_id
from _workspace_map m
where n.workspace_id is null
  and n.owner_id = m.user_id;

update public.note_documents d
set workspace_id = m.workspace_id
from _workspace_map m
where d.workspace_id is null
  and d.owner_id = m.user_id;

update public.note_updates u
set workspace_id = m.workspace_id
from _workspace_map m
where u.workspace_id is null
  and u.owner_id = m.user_id;

update public.task_projects p
set workspace_id = m.workspace_id
from _workspace_map m
where p.workspace_id is null
  and p.owner_id = m.user_id;

update public.task_workflow_states s
set workspace_id = m.workspace_id
from _workspace_map m
where s.workspace_id is null
  and s.owner_id = m.user_id;

update public.tasks t
set workspace_id = m.workspace_id
from _workspace_map m
where t.workspace_id is null
  and t.owner_id = m.user_id;

update public.task_comments c
set workspace_id = m.workspace_id
from _workspace_map m
where c.workspace_id is null
  and c.owner_id = m.user_id;

update public.note_documents d
set workspace_id = n.workspace_id
from public.notes n
where d.workspace_id is null
  and d.note_id = n.id;

update public.note_updates u
set workspace_id = n.workspace_id
from public.notes n
where u.workspace_id is null
  and u.note_id = n.id;

update public.task_workflow_states s
set workspace_id = p.workspace_id
from public.task_projects p
where s.workspace_id is null
  and s.project_id = p.id;

update public.tasks t
set workspace_id = p.workspace_id
from public.task_projects p
where t.workspace_id is null
  and t.project_id = p.id;

update public.task_comments c
set workspace_id = t.workspace_id
from public.tasks t
where c.workspace_id is null
  and c.task_id = t.id;

commit;

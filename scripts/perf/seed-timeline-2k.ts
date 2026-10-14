#!/usr/bin/env bun
// `bun scripts/perf/seed-timeline-2k.ts` — the Timeline's fixture (Tasks v3
// TV-TL1, AC9.9) on the LOCAL stack only: a workspace of its own, "Timeline
// 2k", for the perf person (perf@moduo.local, made by the 10k fixture's
// helpers), shaped like the prototype's roadmap: two areas, four projects
// with start and target dates, ranged sections and end-date sections, and
// 2,000 open tasks due across a year around today (a tenth with only a work
// session), plus a few done ones. `tests/perf/tasks-timeline-2k.spec.ts`
// scrolls a quarter both ways over it; it's also a good place to look at the
// Timeline by eye.
//
// Idempotent: a workspace that already holds exactly the fixture's tasks is
// left alone (its dates are relative to the day it was seeded; `--force`
// seeds them again around today).

import { ensurePerfUser, PERF_USER, psql, stack } from "./seed-tasks-10k";

export const TIMELINE_WORKSPACE = "Timeline 2k";
export const TIMELINE_TASKS = 2_000;
/** The project the perf spec opens: it holds most of the tasks. */
export const TIMELINE_PROJECT = "Roadmap";

function fixtureSql(userId: string, workspaceId: string): string {
  return `
begin;
set local statement_timeout = 0;

delete from public.task_sessions where workspace_id = '${workspaceId}';
update public.tasks set parent_id = null where workspace_id = '${workspaceId}' and parent_id is not null;
delete from public.tasks where workspace_id = '${workspaceId}';
delete from public.sections where workspace_id = '${workspaceId}';
delete from public.buckets where workspace_id = '${workspaceId}' and not is_system;
delete from public.areas where workspace_id = '${workspaceId}';
delete from public.entities where workspace_id = '${workspaceId}' and entity_type = 'task';

insert into public.buckets (workspace_id, owner_id, name, is_system, position)
select '${workspaceId}', '${userId}', 'Inbox', true, 'a'
where not exists (
  select 1 from public.buckets
  where workspace_id = '${workspaceId}' and owner_id = '${userId}' and is_system and deleted_at is null
);

insert into public.areas (workspace_id, name, position, shared, created_by) values
  ('${workspaceId}', 'Clients', 1, true, '${userId}'),
  ('${workspaceId}', 'Product', 2, true, '${userId}');

insert into public.buckets (workspace_id, owner_id, name, position, color, starts_on, target_on, area_id)
select '${workspaceId}', '${userId}', p.name, p.pos, p.color,
  current_date + p.starts, current_date + p.target,
  (select id from public.areas where workspace_id = '${workspaceId}' and name = p.area)
from (values
  ('${TIMELINE_PROJECT}', 'p1', 'violet', -120, 200, 'Product'),
  ('Acme rebrand', 'p2', 'teal', -20, 40, 'Clients'),
  ('Northwind app', 'p3', 'green', null::int, null::int, 'Clients'),
  ('Studio videos', 'p4', 'blue', 10, 30, 'Product')
) as p(name, pos, color, starts, target, area);

-- Sections: a phase every six weeks on the roadmap (ranges), and a milestone.
insert into public.sections (workspace_id, project_id, name, position, starts_on, ends_on)
select '${workspaceId}', b.id, 'Phase ' || g, g,
  current_date - 120 + (g - 1) * 42, current_date - 120 + (g - 1) * 42 + 34
from public.buckets b, generate_series(1, 7) g
where b.workspace_id = '${workspaceId}' and b.name = '${TIMELINE_PROJECT}';
insert into public.sections (workspace_id, project_id, name, position, starts_on, ends_on)
select '${workspaceId}', b.id, s.name, s.pos, current_date + s.starts, current_date + s.ends
from public.buckets b, (values
  ('Discovery', 1, -20, -10), ('Design', 2, -5, 12), ('Build', 3, null::int, 40)
) as s(name, pos, starts, ends)
where b.workspace_id = '${workspaceId}' and b.name = 'Acme rebrand';

create temp table tl_projects on commit drop as
select row_number() over (order by position) as idx, id, name
from public.buckets where workspace_id = '${workspaceId}' and not is_system and deleted_at is null;

-- 2,000 open tasks: 1,700 on the roadmap, 100 on each other project.
create temp table tl_rows on commit drop as
select g as i, gen_random_uuid() as id,
  case when g <= 1700 then 1 else 2 + (g - 1701) / 100 end as pidx,
  case when g % 10 = 0 then null else current_date + ((g * 7) % 360) - 150 end as due
from generate_series(1, ${TIMELINE_TASKS}) g;

insert into public.tasks (
  id, workspace_id, owner_id, assignee_id, bucket_id, section_id, title, status,
  due_on, scheduled_at, duration_minutes, position
)
select r.id, '${workspaceId}', '${userId}', '${userId}', p.id,
  -- The section whose dates hold the task's due date, if one does.
  (select s.id from public.sections s
    where s.project_id = p.id and s.deleted_at is null and r.due is not null
      and coalesce(s.starts_on, s.ends_on - 20) <= r.due and r.due <= s.ends_on
    order by s.position limit 1),
  initcap((array['plan','ship','draft','review','test','design','write','fix'])[1 + r.i % 8]) || ' ' ||
    (array['the pricing page','release notes','the API docs','onboarding','the dashboard',
           'billing','search','the mobile nav'])[1 + (r.i / 8) % 8] || ' #' || r.i,
  case when r.i % 6 = 0 then 'in_progress' else 'todo' end,
  r.due,
  case when r.i % 10 = 0 then date_trunc('day', now()) + make_interval(days => (r.i % 40) - 10, hours => 10) else null end,
  case when r.i % 10 = 0 then 60 else null end,
  'm' || lpad(r.i::text, 6, '0')
from tl_rows r join tl_projects p on p.idx = r.pidx;

select count(*) from public.tasks where workspace_id = '${workspaceId}' and deleted_at is null;
commit;
`;
}

export async function seedTimelineFixture(opts: { force?: boolean } = {}): Promise<{
  userId: string;
  workspaceId: string;
  seeded: boolean;
}> {
  const s = stack();
  const userId = await ensurePerfUser(s);
  let workspaceId = psql(
    s.DB_URL,
    `select id from public.workspaces where owner_id = '${userId}' and name = '${TIMELINE_WORKSPACE}' and deleted_at is null order by created_at limit 1;`,
  );
  if (!workspaceId) {
    workspaceId = psql(
      s.DB_URL,
      `insert into public.workspaces (owner_id, name) values ('${userId}', '${TIMELINE_WORKSPACE}') returning id;`,
    )
      .split("\n")
      .filter(Boolean)
      .pop() as string;
  }
  const count = Number(
    psql(
      s.DB_URL,
      `select count(*) from public.tasks where workspace_id = '${workspaceId}' and deleted_at is null;`,
    ),
  );
  if (count === TIMELINE_TASKS && !opts.force) return { userId, workspaceId, seeded: false };
  const out = psql(s.DB_URL, fixtureSql(userId, workspaceId));
  const made = Number(out.split("\n").filter(Boolean).pop());
  if (made !== TIMELINE_TASKS) throw new Error(`Seeded ${made} tasks, expected ${TIMELINE_TASKS}.`);
  return { userId, workspaceId, seeded: true };
}

if (import.meta.main) {
  const res = await seedTimelineFixture({ force: process.argv.includes("--force") });
  console.log(
    `${res.seeded ? "Timeline fixture ready" : "Timeline fixture already in place"}: workspace ${res.workspaceId} (${PERF_USER.email}).`,
  );
}

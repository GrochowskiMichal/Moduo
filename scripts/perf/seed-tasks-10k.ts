#!/usr/bin/env bun
// `bun run perf:seed` — the 10,000-task fixture (Tasks v3 TV-D11b, spec
// §Assumptions #8) on the LOCAL stack only (`bun run local:up`). It makes a
// person of its own, perf@moduo.local, with one workspace shaped like a
// 3–5-person team's year or two of Tasks: 20 projects plus the Inbox, about
// 1,900 open tasks (To do, In progress), 200 in Backlog, 7,600 done and 300
// Won't do; HTML descriptions on a third, one-level subtasks, due and
// scheduled dates, tags, blockers and a queue. Every 500th task carries the
// word "quokka" (20 tasks, half in a description): the perf spec searches it.
//
// Idempotent: a workspace that already holds exactly the fixture is left
// alone; anything else in it is wiped and seeded again. `--force` reseeds.
// Rows go in through psql as the database owner with no signed-in person,
// which the write checks treat as system work; every trigger still runs
// (handles, the search registry, statuses), as for real rows.
//
//   bun run perf:seed            seed (or keep) the fixture
//   bun run perf:seed --force    seed it again from scratch

import { execFileSync, spawnSync } from "node:child_process";

export const PERF_USER = { email: "perf@moduo.local", password: "localperf-10k" };
export const PERF_WORKSPACE = "Perf 10k";
export const PERF_TASKS = 10_000;
/** The word only the fixture's every 500th task carries. */
export const PERF_SEARCH_WORD = "quokka";

type Status = { API_URL: string; DB_URL: string; SERVICE_ROLE_KEY?: string; SECRET_KEY?: string };

function stack(): Status {
  const status = JSON.parse(
    execFileSync("supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ) as Status;
  if (!status.API_URL?.includes("127.0.0.1") || !status.DB_URL?.includes("127.0.0.1")) {
    throw new Error("The perf fixture is for the local stack only (bun run local:up).");
  }
  return status;
}

function psql(dbUrl: string, sql: string): string {
  const run = spawnSync("psql", [dbUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) throw new Error(`psql couldn't run (${run.error.message}). brew install libpq.`);
  if (run.status !== 0) throw new Error(`psql failed:\n${run.stderr}`);
  return run.stdout.trim();
}

/** The perf person (made once through the Auth admin API), password set after. */
async function ensurePerfUser(s: Status): Promise<string> {
  const service = s.SERVICE_ROLE_KEY ?? s.SECRET_KEY ?? "";
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${s.API_URL}/auth/v1/admin/users?per_page=500`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === PERF_USER.email);
  if (!user) {
    const created = await fetch(`${s.API_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: PERF_USER.email,
        email_confirm: true,
        user_metadata: { full_name: "Perf Person", display_name: "Perf Person" },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  // The stack blanks passwords on insert (prod signs in by code); set one after.
  await fetch(`${s.API_URL}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: admin,
    body: JSON.stringify({ password: PERF_USER.password }),
  });
  return user.id;
}

/** The fixture as one SQL script: wipe the workspace's Tasks rows, seed again. */
function fixtureSql(userId: string, workspaceId: string): string {
  return `
begin;
set local statement_timeout = 0;

-- Wipe (a partial or older fixture).
delete from public.task_queue where workspace_id = '${workspaceId}';
delete from public.task_relations where workspace_id = '${workspaceId}';
delete from public.tag_links where workspace_id = '${workspaceId}';
delete from public.tags where workspace_id = '${workspaceId}';
delete from public.comments where workspace_id = '${workspaceId}';
delete from public.task_completions where workspace_id = '${workspaceId}';
update public.tasks set parent_id = null where workspace_id = '${workspaceId}' and parent_id is not null;
delete from public.tasks where workspace_id = '${workspaceId}';
delete from public.buckets where workspace_id = '${workspaceId}' and not is_system;
delete from public.entities where workspace_id = '${workspaceId}' and entity_type = 'task';

-- The Inbox and 20 projects.
insert into public.buckets (workspace_id, owner_id, name, is_system, position)
select '${workspaceId}', '${userId}', 'Inbox', true, 'a'
where not exists (
  select 1 from public.buckets
  where workspace_id = '${workspaceId}' and owner_id = '${userId}' and is_system and deleted_at is null
);
insert into public.buckets (workspace_id, owner_id, name, position)
select '${workspaceId}', '${userId}',
  (array['Website','Mobile app','Onboarding','Billing','Search','Design system','Docs',
         'Infra','Analytics','Support','Hiring','Marketing','Launch','Security','Payments',
         'Integrations','Research','Q3 planning','Office','Partners'])[g],
  'p' || lpad(g::text, 3, '0')
from generate_series(1, 20) g;

create temp table perf_buckets on commit drop as
select row_number() over (order by is_system desc, position) - 1 as idx, id
from public.buckets where workspace_id = '${workspaceId}' and deleted_at is null;

-- 10,000 tasks in blocks of 25 per project; ~19% open, 2% Backlog, 76% done, 3% Won't do.
create temp table perf_rows on commit drop as
select g as i,
  gen_random_uuid() as id,
  (select id from perf_buckets b where b.idx = ((g - 1) / 25) % 21) as bucket_id,
  case
    when g % 100 < 15 then 'todo'
    when g % 100 < 19 then 'in_progress'
    when g % 100 < 21 then 'backlog'
    when g % 100 < 24 then 'archived'
    else 'done'
  end as state
from generate_series(1, ${PERF_TASKS}) g;

insert into public.tasks (
  id, workspace_id, owner_id, assignee_id, bucket_id, title, description, status,
  priority, energy_level, due_on, scheduled_at, duration_minutes, position, created_at
)
select r.id, '${workspaceId}', '${userId}',
  case when r.i % 5 < 3 then '${userId}'::uuid else null end,
  r.bucket_id,
  initcap((array['review','ship','draft','fix','plan','write','test','design','migrate','audit',
                 'update','clean up','prepare','sync','measure'])[1 + r.i % 15]) || ' ' ||
    (array['the pricing page','login flow','release notes','invoice export','search index',
           'onboarding email','dashboard widget','API keys','mobile nav','quarterly report',
           'sign-up form','error states','docs sidebar','cache layer','team settings',
           'billing webhook','empty states','calendar sync'])[1 + (r.i / 15) % 18] ||
    case when r.i % 500 = 0 and r.i % 1000 <> 0 then ' ${PERF_SEARCH_WORD}' else '' end ||
    ' #' || r.i,
  case
    when r.i % 500 = 0 and r.i % 1000 = 0 then
      '<p dir="ltr"><span style="white-space: pre-wrap;">Spotted a ${PERF_SEARCH_WORD} near the release notes.</span></p>'
    when r.i % 3 = 0 then
      '<p dir="ltr"><span style="white-space: pre-wrap;">Context for task ' || r.i ||
      ': agree the scope with the team, check the edge cases and write down what changed.</span></p>'
    else ''
  end,
  case when r.state = 'backlog' then 'todo' else r.state end,
  (array[null,'low','medium','high'])[1 + r.i % 4],
  case when r.i % 7 = 0 then (array['low','medium','high'])[1 + r.i % 3] else null end,
  case when r.state in ('todo','in_progress') and r.i % 4 = 0
       then current_date + ((r.i % 60) - 15) else null end,
  case when r.state in ('todo','in_progress') and r.i % 9 = 0
       then date_trunc('day', now()) + make_interval(days => r.i % 14, hours => 9 + r.i % 8)
       else null end,
  case when r.state in ('todo','in_progress') and r.i % 9 = 0 then 30 + (r.i % 4) * 15 else null end,
  'm' || lpad(r.i::text, 6, '0'),
  now() - make_interval(days => (${PERF_TASKS} - r.i) / 18)
from perf_rows r;

-- Backlog: the project's (or the workspace default's) first backlog status.
update public.tasks t
set status_id = coalesce(
  (select s.id from public.project_statuses s
    where s.project_id = t.bucket_id and s.category = 'backlog' and s.deleted_at is null
    order by s.position limit 1),
  (select s.id from public.project_statuses s
    where s.project_id is null and s.workspace_id = t.workspace_id and s.category = 'backlog'
      and s.deleted_at is null
    order by s.position limit 1))
from perf_rows r
where r.id = t.id and r.state = 'backlog';

-- One-level subtasks: in each block of 25, rows 2–4 are subtasks of row 1.
update public.tasks t
set parent_id = p.id
from perf_rows r
join perf_rows p on p.i = r.i - ((r.i - 1) % 25)
where t.id = r.id and (r.i - 1) % 25 between 1 and 3;

-- Tags on ~15% of tasks.
insert into public.tags (workspace_id, owner_id, name, color)
select '${workspaceId}', '${userId}', n, c
from unnest(array['bug','frontend','backend','design','urgent','customer','tech-debt','docs'],
            array['red','blue','green','purple','orange','teal','gray','yellow']) as x(n, c);
insert into public.tag_links (workspace_id, tag_id, entity_type, entity_id)
select '${workspaceId}', tg.id, 'task', r.id
from perf_rows r
join lateral (
  select id from public.tags
  where workspace_id = '${workspaceId}'
  order by name offset (r.i % 8) limit 1 + (r.i % 2)
) tg on true
where r.i % 7 = 3;

-- Blockers among open tasks (a task blocks the one 100 rows on: same state).
insert into public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
select '${workspaceId}', a.id, b.id
from perf_rows a
join perf_rows b on b.i = a.i + 100
where a.i % 100 in (3, 7, 11);

-- My queue: 30 open top-level tasks.
insert into public.task_queue (workspace_id, user_id, task_id, position)
select '${workspaceId}', '${userId}', r.id, 'q' || lpad(row_number() over (order by r.i)::text, 4, '0')
from perf_rows r
where r.state in ('todo','in_progress') and (r.i - 1) % 25 not between 1 and 3
order by r.i
limit 30;

-- Comments on ~1 task in 6 (counts).
insert into public.comments (workspace_id, entity_type, entity_id, body, created_by)
select '${workspaceId}', 'task', r.id, 'Looks good — one note on the edge case.', '${userId}'
from perf_rows r
where r.i % 6 = 0;

commit;
select count(*) from public.tasks where workspace_id = '${workspaceId}' and deleted_at is null;
`;
}

export async function seedPerfFixture(opts: { force?: boolean } = {}): Promise<{
  userId: string;
  workspaceId: string;
  seeded: boolean;
}> {
  const s = stack();
  const userId = await ensurePerfUser(s);
  let workspaceId = psql(
    s.DB_URL,
    `select id from public.workspaces where owner_id = '${userId}' and name = '${PERF_WORKSPACE}' and deleted_at is null order by created_at limit 1;`,
  );
  if (!workspaceId) {
    workspaceId = psql(
      s.DB_URL,
      `insert into public.workspaces (owner_id, name) values ('${userId}', '${PERF_WORKSPACE}') returning id;`,
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
  if (count === PERF_TASKS && !opts.force) return { userId, workspaceId, seeded: false };
  const started = Date.now();
  const out = psql(s.DB_URL, fixtureSql(userId, workspaceId));
  const made = Number(out.split("\n").filter(Boolean).pop());
  if (made !== PERF_TASKS) throw new Error(`Seeded ${made} tasks, expected ${PERF_TASKS}.`);
  console.log(`Seeded ${made} tasks in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  return { userId, workspaceId, seeded: true };
}

if (import.meta.main) {
  const force = process.argv.includes("--force");
  const res = await seedPerfFixture({ force });
  console.log(
    res.seeded
      ? `Perf fixture ready: workspace ${res.workspaceId} (${PERF_USER.email}).`
      : `Perf fixture already in place: workspace ${res.workspaceId} (${PERF_USER.email}).`,
  );
}

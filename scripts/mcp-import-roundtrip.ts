#!/usr/bin/env bun
/**
 * The "import through your AI" round-trip, end to end on the LOCAL stack
 * (Tasks v3 TV-D16; specs/tasks-v3.md §12, AC2.6, AC3.4, AC3.6). It does what
 * an AI with Todoist's connector would do through the Moduo connector, over
 * HTTP, with a real API key:
 *
 *   1. begins an import run, makes a project and two sections, imports a
 *      Todoist-shaped project (dated tasks, labels, a repeat, a subtask, a
 *      reminder), each with its Todoist id as "imported from";
 *   2. runs the same import again: every task updates by its key, nothing new;
 *   3. a person edits one task; "Undo this import" on the first run then
 *      removes the rest and keeps the edited one, its section and project;
 *   4. an agent posts its session status (private; the trail says "via"),
 *      finishes a parent (its open subtask finishes too) and searches by key.
 *
 * It makes its own disposable person, workspace and key (psql, as the local
 * admin), and removes them at the end, so nothing lands in your own data.
 *
 *   bun run local:functions      # in another terminal (serves moduo-mcp)
 *   bun scripts/mcp-import-roundtrip.ts
 *
 * Local only: it refuses any connector URL that isn't on this machine. The
 * real check with Claude and Todoist's own connector is a release step
 * (docs/testing/t-maciej-tv-d16-mcp.md).
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const URL_ = process.env.MODUO_MCP_URL ?? "http://127.0.0.1:54321/functions/v1/moduo-mcp";
const DB_URL =
  process.env.MODUO_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";
if (
  !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(URL_) ||
  !/@(127\.0\.0\.1|localhost):/.test(DB_URL)
) {
  console.error("This round-trip runs against the local stack only.");
  process.exit(2);
}

type Json = Record<string, any>;

function sql(text: string): string {
  const run = spawnSync("psql", [DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", text], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`psql: ${run.stderr || run.stdout}`);
  return run.stdout.trim();
}
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

// ── A disposable person, workspace and key ──────────────────────────────────
const person = randomUUID();
const workspace = randomUUID();
const keyId = randomUUID();
const secret = `moduo_sk_${randomBytes(24).toString("hex")}`;
const keyHash = createHash("sha256").update(secret).digest("hex");
sql(`
  INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', ${lit(person)}, 'authenticated', 'authenticated',
          ${lit(`mcp-import-${person.slice(0, 8)}@example.com`)}, '{"display_name": "Alex"}'::jsonb, now(), now());
  INSERT INTO public.profiles (id, display_name) VALUES (${lit(person)}, 'Alex')
  ON CONFLICT (id) DO UPDATE SET display_name = 'Alex';
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (${lit(workspace)}, ${lit(person)}, 'MCP import round-trip');
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (${lit(keyId)}, ${lit(workspace)}, 'Claude Desktop', ${lit(secret.slice(0, 12))}, ${lit(keyHash)},
          '{"tasks": "edit", "links": "edit"}'::jsonb, ${lit(person)});
`);

function teardown() {
  try {
    sql(`
      SELECT set_config('share.bypass', '1', false);
      DELETE FROM public.tasks WHERE workspace_id = ${lit(workspace)};
      DELETE FROM public.workspaces WHERE id = ${lit(workspace)};
      DELETE FROM auth.users WHERE id = ${lit(person)};
    `);
  } catch (err) {
    console.warn(
      `Couldn't remove the round-trip's workspace ${workspace}: ${(err as Error).message}`,
    );
  }
}

let nextId = 1;
async function rpc(method: string, params: Json = {}): Promise<Json> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as Json;
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function call(name: string, args: Json = {}): Promise<any> {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";
  if (result?.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

const results: Array<{ check: string; ok: boolean; detail: string }> = [];
function expectThat(check: string, ok: boolean, detail = "") {
  results.push({ check, ok, detail });
}

// A Todoist project, as its connector hands it over.
const TODOIST = {
  project: { id: "2203306141", name: "Biology 101" },
  sections: [
    { id: "s-1", name: "Week 1" },
    { id: "s-2", name: "Week 2" },
  ],
  tasks: [
    {
      id: "7001",
      content: "Read chapter 1",
      section: "s-1",
      due: "2030-01-07",
      labels: ["reading"],
    },
    {
      id: "7002",
      content: "Lab report",
      section: "s-1",
      due: "2030-01-09",
      labels: ["lab", "graded"],
    },
    {
      id: "7003",
      content: "Weekly quiz",
      section: "s-2",
      due: "2030-01-14",
      recurring: "FREQ=WEEKLY;BYDAY=TU",
    },
    {
      id: "7004",
      content: "Essay draft",
      section: "s-2",
      due: "2030-01-16",
      reminder: "2030-01-15T09:00:00Z",
    },
    { id: "7005", content: "Find three sources", parent: "7004" },
  ],
};

async function importRun(label: string, titleSuffix = "") {
  const run = await call("imports_begin", { source: "todoist", label });
  const projects = await call("projects_list");
  let project = projects.find((p: Json) => p.name === TODOIST.project.name);
  if (!project)
    project = await call("projects_create", { name: TODOIST.project.name, import_id: run.id });
  const sections: Record<string, string> = {};
  const existing = await call("sections_list", { project_id: project.id });
  for (const s of TODOIST.sections) {
    const found = existing.find((e: Json) => e.name === s.name);
    sections[s.id] =
      found?.id ??
      (await call("sections_create", { project_id: project.id, name: s.name, import_id: run.id }))
        .section_id;
  }
  const ids: Record<string, string> = {};
  const actions: string[] = [];
  for (const t of TODOIST.tasks) {
    const parentTask = t.parent ? ids[t.parent] : undefined;
    const made = await call("tasks_create", {
      title: `${t.content}${titleSuffix}`,
      project_id: project.id,
      ...(t.section ? { section_id: sections[t.section] } : {}),
      ...(parentTask ? { parent_id: parentTask } : {}),
      ...(t.due ? { due_on: t.due } : {}),
      ...(t.labels ? { tags: t.labels } : {}),
      ...(t.recurring ? { repeat: t.recurring } : {}),
      ...(t.reminder ? { reminders: [{ kind: "at", at: t.reminder }] } : {}),
      imported_from: { source: "todoist", key: t.id },
      import_id: run.id,
    });
    ids[t.id] = made.id;
    actions.push(made.action);
  }
  const summary = await call("imports_finish", { import_id: run.id });
  return { run, project, ids, actions, summary };
}

let exitCode = 0;
try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-import-roundtrip", version: "1" },
  });
  const tools: string[] = ((await rpc("tools/list")).tools ?? []).map((t: Json) => t.name);
  expectThat(
    "the key lists the v3 tools",
    [
      "imports_begin",
      "imports_undo",
      "projects_create",
      "sections_create",
      "tasks_session_status",
    ].every((n) => tools.includes(n)),
    `${tools.length} tools; ${String(init.instructions ?? "").slice(0, 60)}…`,
  );

  // 1 · the first run
  const first = await importRun("Biology syllabus");
  expectThat(
    "first run: every task created, in its project and sections",
    first.actions.every((a) => a === "created") &&
      first.summary.tasks_created === 5 &&
      first.summary.projects_created === 1 &&
      first.summary.sections_created === 2,
    JSON.stringify(first.summary),
  );
  const quiz = await call("tasks_get", { task_id: first.ids["7003"] });
  expectThat(
    "a repeat imports",
    quiz.recurrence?.rrule === "FREQ=WEEKLY;BYDAY=TU",
    JSON.stringify(quiz.recurrence),
  );
  const lab = await call("tasks_get", { task_id: first.ids["7002"] });
  expectThat(
    "labels import as tags, the due date as a date",
    JSON.stringify([...(lab.tags ?? [])].sort()) === JSON.stringify(["graded", "lab"]) &&
      lab.due_on === "2030-01-09",
    JSON.stringify({ tags: lab.tags, due_on: lab.due_on }),
  );
  const essay = await call("tasks_get", { task_id: first.ids["7004"] });
  expectThat(
    "its reminder is the key person's",
    essay.my_reminders?.length === 1,
    JSON.stringify(essay.my_reminders),
  );
  expectThat(
    "the trail says 'Alex · via Claude Desktop'",
    (essay.activity ?? []).some((a: Json) => a.actor_label === "Alex · via Claude Desktop"),
    JSON.stringify((essay.activity ?? []).map((a: Json) => a.actor_label)),
  );
  const byKey = await call("tasks_search", { q: "7002" });
  expectThat(
    "the Todoist id finds its task",
    byKey[0]?.id === first.ids["7002"],
    JSON.stringify(byKey.map((t: Json) => t.id)),
  );
  const byHandle = await call("tasks_get", { task_id: lab.handle });
  expectThat("a handle works as a task id", byHandle.id === lab.id, String(lab.handle));

  // 2 · the same import again
  const second = await importRun("Biology syllabus, again", " (v2)");
  const listed = await call("tasks_list", {
    project_id: first.project.id,
    category: "open",
    limit: 200,
  });
  expectThat(
    "second run: every task updated by its key, nothing new",
    second.actions.every((a) => a === "updated") &&
      listed.length === 5 &&
      listed.every((t: Json) => String(t.title).endsWith(" (v2)")),
    JSON.stringify({ actions: second.actions, count: listed.length }),
  );

  // 3 · a person edits one task, then the first run is undone
  sql(`
    SELECT set_config('request.jwt.claims', json_build_object('sub', ${lit(person)}, 'role', 'authenticated')::text, false);
    SELECT public.comments_op_add(${lit(workspace)}, 'task', ${lit(first.ids["7001"]!)}, 'Read it on the train');
  `);
  // The second run updated every task after the first run wrote it, so all
  // of them count as touched: undoing the first run keeps them all. (A run
  // undone before anyone touched its rows removes them; supabase/tests/import.)
  const undo1 = await call("imports_undo", { import_id: first.run.id });
  expectThat(
    "Undo keeps every row edited since (here: all of them)",
    undo1.tasks_removed === 0 && undo1.tasks_kept === 5 && undo1.projects_removed === 0,
    JSON.stringify(undo1),
  );
  const fresh = await call("imports_begin", { source: "todoist", label: "One-off" });
  const loose = await call("tasks_create", {
    title: "A task nobody touched",
    project_id: first.project.id,
    imported_from: { source: "todoist", key: "9999" },
    import_id: fresh.id,
  });
  await call("imports_finish", { import_id: fresh.id });
  const undo2 = await call("imports_undo", { import_id: fresh.id });
  const gone = await call("tasks_get", { task_id: loose.id }).then(
    () => false,
    () => true,
  );
  expectThat(
    "Undo removes what nobody touched since",
    undo2.tasks_removed === 1 && gone,
    JSON.stringify(undo2),
  );

  // 4 · the agent at work
  const status = await call("tasks_session_status", {
    task_id: first.ids["7004"],
    state: "working",
    note: "Drafting the outline",
    step: 1,
    steps: 3,
    links: [{ url: "https://example.com/doc/42", label: "Draft" }],
  });
  expectThat(
    "a session status posts",
    status.state === "working" && status.step === 1,
    JSON.stringify(status),
  );
  const ready = await call("tasks_session_status", {
    task_id: first.ids["7004"],
    state: "ready",
    summary: "Outline done.",
  });
  const notices = Number(
    sql(
      `SELECT count(*) FROM public.notice_deliveries WHERE user_id = ${lit(person)} AND kind = 'agent'`,
    ),
  );
  expectThat(
    "ready for review notifies its person once",
    ready.state === "ready" && notices === 1,
    `${notices} notices`,
  );
  const done = await call("tasks_set_status", { task_id: first.ids["7004"], status: "done" });
  expectThat(
    "finishing the parent finishes its open subtask",
    done.also_finished === 1,
    JSON.stringify(done),
  );
  const statuses = await call("statuses_list", { project_id: first.project.id });
  expectThat(
    "statuses list by category",
    statuses.some((s: Json) => s.category === "done"),
    String(statuses.length),
  );
} catch (err) {
  expectThat("round-trip ran to the end", false, (err as Error).message);
} finally {
  teardown();
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.check}${r.detail ? `  — ${r.detail}` : ""}`);
  if (!r.ok) exitCode = 1;
}
console.log(
  exitCode ? "\nThe import round-trip failed." : `\nAll ${results.length} checks passed.`,
);
process.exit(exitCode);

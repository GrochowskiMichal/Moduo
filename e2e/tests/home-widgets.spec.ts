import { expect, test } from "@playwright/test";

import {
  rest,
  rpc,
  runTag,
  type Session,
  setLocalPassword,
  signIn,
  signInPage,
  stackKeys,
} from "./support/local-stack";

/**
 * Tasks v3 TV-H1 · "team load" (AC4.5; decision 12; Chat's CH70), on the real
 * app against the local stack: Home's one Team widget lists one row per
 * person with their Focus size and its estimates, in progress, waiting and
 * due this week, and nothing about runs or time per person; a task the
 * reader can't see counts for nothing. The same page shows your own tracked
 * time this week (the time widget) and your coming days (Upcoming).
 *   bun run local:up
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8141
 *     (with PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY from `supabase status`)
 *   E2E_BASE_URL=http://127.0.0.1:8141 bunx playwright test --project=e2e tests/home-widgets.spec.ts
 * It uses two people of its own (home-lead@ and home-mate@moduo.local) in a
 * workspace it makes and removes, so nobody's Home or data changes.
 */

test.use({ locale: "en-US", viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const LEAD = { email: "home-lead@moduo.local", password: "localhomelead", name: "Hana Lead" };
const MATE = { email: "home-mate@moduo.local", password: "localhomemate", name: "Milo Mate" };

let lead: Session;
let mate: Session;
let ws: string;
let tag: string;

/** A throwaway person, created once (the stack blanks passwords on insert). */
async function ensurePerson(who: typeof LEAD): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === who.email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: who.email,
        email_confirm: true,
        user_metadata: { full_name: who.name, display_name: who.name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  // Auth refuses password writes; set it in SQL (supabase/seed.sql does the same).
  setLocalPassword(user.id, who.password);
  await rest("service", `profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: { display_name: who.name },
  });
  return signIn(who);
}

const day = (ahead: number) => {
  const d = new Date();
  d.setDate(d.getDate() + ahead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function createTask(as: Session, task: Record<string, unknown>): Promise<string> {
  const rows = await rpc<Array<{ id: string }> | { id: string }>(as, "tasks_op_create", {
    p_workspace_id: ws,
    p_task: task,
  });
  return Array.isArray(rows) ? (rows[0]?.id ?? "") : rows.id;
}

test.beforeAll(async () => {
  lead = await ensurePerson(LEAD);
  mate = await ensurePerson(MATE);
  tag = runTag();
  // A run that stopped half-way leaves its workspace; the plan allows one.
  await rest("service", `workspaces?owner_id=eq.${lead.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  const [created] = await rest<Array<{ id: string }>>(lead, "workspaces", {
    method: "POST",
    body: { name: `Home widgets ${tag}`, owner_id: lead.user.id },
  });
  ws = created.id;
  await rest("service", "workspace_members", {
    method: "POST",
    body: { workspace_id: ws, user_id: mate.user.id, role: "member" },
  });
});

test.afterAll(async () => {
  if (!ws) return;
  await rest("service", `dashboard_layouts?workspace_id=eq.${ws}`, { method: "DELETE" });
  await rest("service", `workspaces?id=eq.${ws}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
});

test("the Team widget shows each person's load, and nothing hidden or per-person time", async ({
  page,
}) => {
  const project = await rpc<{ id: string }>(lead, "projects_op_create", {
    p_workspace_id: ws,
    p_project: { name: `Launch ${tag}` },
  });
  const inProject = (title: string, extra: Record<string, unknown> = {}) =>
    createTask(lead, { title: `${title} ${tag}`, bucket_id: project.id, ...extra });

  // Milo: two lined up (~1h 30m), one of them in progress, one waiting, one due today.
  const q1 = await inProject("Hero copy", { assignee_id: mate.user.id, estimate_minutes: 60 });
  const q2 = await inProject("Pricing table", { assignee_id: mate.user.id, estimate_minutes: 30 });
  const waiting = await inProject("Legal check", { assignee_id: mate.user.id });
  await inProject("Press kit", { assignee_id: mate.user.id, due_on: day(0) });
  for (const id of [q1, q2]) {
    await rpc(mate, "tasks_op_queue_add", { p_workspace_id: ws, p_task_id: id, p_at: "end" });
  }
  await rpc(lead, "tasks_op_set_status", {
    p_workspace_id: ws,
    p_task_id: q2,
    p_status: "in_progress",
    p_recurrence: null,
    p_position: null,
  });
  await rpc(lead, "tasks_op_waiting_add", {
    p_workspace_id: ws,
    p_task_id: waiting,
    p_entry: { kind: "text", label: "Lawyer's reply" },
  });

  // Milo's own Inbox task, lined up too: Hana can't see it, so it counts for nothing.
  const [inbox] = await rest<Array<{ id: string }>>("service", "buckets", {
    method: "POST",
    body: { workspace_id: ws, owner_id: mate.user.id, is_system: true, name: "Inbox" },
  });
  const hidden = await createTask(mate, { title: `Private errand ${tag}`, bucket_id: inbox.id });
  await rpc(mate, "tasks_op_queue_add", { p_workspace_id: ws, p_task_id: hidden, p_at: "end" });

  // Hana: one lined up (~45m) with 30m tracked today, one due today.
  const mine = await inProject("Board deck", { assignee_id: lead.user.id, estimate_minutes: 45 });
  await rpc(lead, "tasks_op_queue_add", { p_workspace_id: ws, p_task_id: mine, p_at: "end" });
  await rpc(lead, "tasks_op_track_time", {
    p_workspace_id: ws,
    p_task_id: mine,
    p_action: "add",
    p_seconds: 1800,
    p_on: day(0),
    p_note: null,
  });
  await inProject("Prep slides", { assignee_id: lead.user.id, due_on: day(0) });

  // Hana's Home: Team (L) on the left, Upcoming and Time on the right.
  await rest("service", "dashboard_layouts?on_conflict=user_id,workspace_id,layout_key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: lead.user.id,
      workspace_id: ws,
      layout_key: "home",
      updated_at: new Date().toISOString(),
      layout_data: {
        version: 1,
        pages: [
          {
            id: "home",
            widgets: [
              { id: "w-team", type: "team", size: "L", x: 0, y: 0, config: {} },
              { id: "w-upcoming", type: "upcoming", size: "M", x: 4, y: 0, config: {} },
              { id: "w-time", type: "timetracking", size: "M", x: 4, y: 2, config: {} },
            ],
          },
        ],
      },
    },
  });

  await signInPage(page, lead, ws);
  await page.goto("/");

  const milo = page.locator(`li[data-person="${mate.user.id}"]`);
  const hana = page.locator(`li[data-person="${lead.user.id}"]`);
  await expect(milo).toContainText(MATE.name, { timeout: 30_000 });
  // Decision 12: ownership — Focus and its estimates, in progress, waiting, due.
  await expect(milo.locator("[data-team-load]")).toHaveText(
    "Focus 2 · ~1h 30m · 1 in progress · 1 waiting · 1 due this week",
  );
  await expect(hana.locator("[data-team-load]")).toHaveText("Focus 1 · ~45m · 1 due this week");
  // You first, as your name plus "(you)" (MOD-137); and no tracked time per
  // person (Hana's 30m today is only hers, in Time).
  const people = page.locator("li[data-person]");
  await expect(people.first()).toHaveAttribute("data-person", lead.user.id);
  await expect(hana).toContainText("(you)");
  await expect(milo).not.toContainText("(you)");
  await expect(hana).not.toContainText("30m");

  // The time widget: your own tracked time this week.
  await expect(page.getByText("this week · 30m today")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Board deck ${tag}`) })).toBeVisible();
  // Upcoming: your coming days.
  await expect(page.getByRole("button", { name: new RegExp(`Prep slides ${tag}`) })).toBeVisible();
  await expect(page.getByText(`Private errand ${tag}`)).toHaveCount(0);
});

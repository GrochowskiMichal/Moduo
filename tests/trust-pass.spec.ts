import { expect, type Page, type Request, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  ensureTeammate,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 AC1 — the trust pass (TV-P0), item by item, against the local
 * stack. Run it with the stack up and a dev server pointed at it:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/trust-pass.spec.ts
 * MCP paging past 1,000 (AC1.13) and "a blocks link blocks" (AC1.14) are
 * TV-D8's and join this file with it.
 */

type TaskRow = { id: string; title: string; status: string; bucket_id: string };

let dev: Session;
let mate: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  mate = await ensureTeammate(ws.id);
  tag = runTag();
});

async function createTask(
  as: Session,
  fields: { title: string; bucketId: string; parentId?: string; status?: string },
): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>(as, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: fields.bucketId,
      title: fields.title,
      parent_id: fields.parentId ?? null,
      status: fields.status ?? "todo",
      owner_id: as.user.id,
      assignee_id: as.user.id,
      position: `z${tag}${fields.title}`,
    },
  });
  return row;
}

async function createProject(as: Session, name: string): Promise<{ id: string }> {
  const [row] = await rest<Array<{ id: string }>>(as, "buckets", {
    method: "POST",
    body: { workspace_id: ws.id, owner_id: as.user.id, name, position: `z${tag}` },
  });
  return row;
}

/** A project only its owner sees: new projects are shared with the workspace
 *  (a workspace grant); taking that grant away makes it private. */
async function createPrivateProject(as: Session, name: string): Promise<{ id: string }> {
  const project = await createProject(as, name);
  await rest(
    "service",
    `resource_grants?resource_type=eq.bucket&resource_id=eq.${project.id}&subject_type=eq.workspace`,
    { method: "DELETE" },
  );
  return project;
}

const taskById = async (id: string) =>
  (await rest<TaskRow[]>("service", `tasks?id=eq.${id}&select=id,title,status,bucket_id`))[0];

async function openTasks(page: Page, taskId?: string) {
  await signInPage(page, dev);
  await page.goto(taskId ? `/tasks?id=${taskId}` : "/tasks");
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 20_000 });
}

/** Writes the page sends for a task: field saves and intent ops. */
function trackWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (req: Request) => {
    const url = req.url();
    if (req.method() === "GET") return;
    const m = /rest\/v1\/(rpc\/tasks_op_[a-z_]+|tasks)\b/.exec(url);
    if (m) writes.push(`${req.method()} ${m[1]}`);
  });
  return writes;
}

const panel = (page: Page) => page.locator("aside, [data-panel]").last();

test("AC1.4 — a Won't do task stays reachable and reopens", async ({ page }) => {
  const t = await createTask(dev, { title: `Won't do me ${tag}`, bucketId: ws.inboxId });
  await openTasks(page, t.id);
  // Chosen in Inbox, marked Won't do in All: it stays in view with Reopen.
  await page.getByRole("button", { name: /^All ,/ }).click();
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(t.title);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Won’t do" }).click();
  await expect(page.getByRole("button", { name: "Status: Won’t do" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  await expect.poll(async () => (await taskById(t.id)).status).toBe("archived");

  // A deep link straight to the Won't do task opens it, with Reopen.
  await page.goto(`/tasks?id=${t.id}`);
  await expect(page.getByRole("button", { name: "Status: Won’t do" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Status: To do" })).toBeVisible();
  await expect.poll(async () => (await taskById(t.id)).status).toBe("todo");
});

test("AC1.5 — a skeleton while loading, never “Nothing here yet”", async ({ page }) => {
  await signInPage(page, dev);
  // Hold the task list back so the first paint is the loading state.
  await page.route("**/rest/v1/tasks?*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/tasks");
  await expect(page.getByRole("status", { name: "Loading tasks" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Nothing here yet")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading tasks" })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.getByText("Nothing here yet")).toHaveCount(0);
});

test("AC1.6 — Focus time is saved while you're on Notes", async ({ page }) => {
  const t = await createTask(dev, { title: `Focus on me ${tag}`, bucketId: ws.inboxId });
  await rpc(dev, "tasks_op_queue_add", { p_workspace_id: ws.id, p_task_id: t.id, p_at: "top" });
  await openTasks(page, t.id);
  await page.getByRole("radio", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Track time" }).click();
  // Leave Tasks: the save must not wait for it.
  await page.getByRole("button", { name: /^Notes/ }).click();
  await expect(page).toHaveURL(/\/notes/);
  await page.waitForTimeout(3000);
  const saved = page.waitForRequest((r) => r.url().includes("rpc/tasks_op_track_time"));
  await page.getByRole("button", { name: "Pause Focus" }).click();
  await saved;
  await expect
    .poll(async () => {
      const rows = await rest<Array<{ seconds: number }>>(
        "service",
        `task_time_entries?task_id=eq.${t.id}&select=seconds`,
      );
      return rows.reduce((n, r) => n + r.seconds, 0);
    })
    .toBeGreaterThanOrEqual(2);
});

test("AC1.8 — moving a parent moves its subtasks", async ({ page }) => {
  const project = await createProject(dev, `Move here ${tag}`);
  const parent = await createTask(dev, { title: `Parent ${tag}`, bucketId: ws.inboxId });
  const a = await createTask(dev, {
    title: `Sub A ${tag}`,
    bucketId: ws.inboxId,
    parentId: parent.id,
  });
  const b = await createTask(dev, {
    title: `Sub B ${tag}`,
    bucketId: ws.inboxId,
    parentId: parent.id,
  });
  await openTasks(page, parent.id);
  await page.getByRole("button", { name: /^Bucket: .*Move to another bucket$/ }).click();
  await page.getByRole("menuitemradio", { name: `Move here ${tag}` }).click();
  await expect.poll(async () => (await taskById(a.id)).bucket_id).toBe(project.id);
  await expect.poll(async () => (await taskById(b.id)).bucket_id).toBe(project.id);
  expect((await taskById(parent.id)).bucket_id).toBe(project.id);
});

test("AC1.9 — New in Focus lands in Up next", async ({ page }) => {
  const anchor = await createTask(dev, { title: `Now ${tag}`, bucketId: ws.inboxId });
  await rpc(dev, "tasks_op_queue_add", {
    p_workspace_id: ws.id,
    p_task_id: anchor.id,
    p_at: "top",
  });
  await openTasks(page, anchor.id);
  await page.getByRole("radio", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Create new (⌘N)" }).click();
  const title = `Captured in Focus ${tag}`;
  await page.getByRole("textbox").first().fill(title);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const [row] = await rest<Array<{ id: string }>>(
        "service",
        `tasks?title=eq.${encodeURIComponent(title)}&select=id`,
      );
      if (!row) return 0;
      const queued = await rest<unknown[]>(
        "service",
        `task_queue?task_id=eq.${row.id}&user_id=eq.${dev.user.id}&select=id`,
      );
      return queued.length;
    })
    .toBe(1);
});

test("AC1.10 + AC1.7 — a task in a project you can't see: “Private project”, its link opens, its notice names it", async ({
  page,
}) => {
  // The owner files a task in their own project and gives it to a teammate,
  // who can see the task but not the project.
  const secret = await createPrivateProject(dev, `Owner only ${tag}`);
  const t = await createTask(dev, { title: `Assigned to teammate ${tag}`, bucketId: secret.id });
  await rpc(dev, "tasks_op_assign", {
    p_workspace_id: ws.id,
    p_task_id: t.id,
    p_assignee_id: mate.user.id,
  });
  await signInPage(page, mate, ws.id);
  await page.goto(`/tasks?id=${t.id}`);
  // The deep link opens THIS task (not another one, not Inbox).
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(t.title, {
    timeout: 20_000,
  });
  await expect(
    page.getByRole("button", { name: "Bucket: Private project. Move to another bucket" }),
  ).toBeVisible();
  await expect(page.getByText(`Owner only ${tag}`)).toHaveCount(0);

  // The bell's card names the task.
  await page
    .getByRole("button", { name: /notifications/i })
    .first()
    .click();
  await expect(page.getByText(`assigned “${t.title}” to you`)).toBeVisible({ timeout: 15_000 });
});

test("AC1.10 — a link to a task you can't open says “Private item”", async ({ page }) => {
  const secret = await createPrivateProject(dev, `Owner hidden ${tag}`);
  const hidden = await createTask(dev, { title: `Not yours ${tag}`, bucketId: secret.id });
  await signInPage(page, mate, ws.id);
  await page.goto("/tasks");
  await expect(
    page.getByRole("navigation", { name: "Location" }).or(page.getByText("No tasks in")).first(),
  ).toBeVisible({ timeout: 20_000 });
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: "task", id } }));
  }, hidden.id);
  await expect(page.getByText("Private item")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Not yours ${tag}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Back to your tasks" }).click();
  await expect(page.getByText("Private item")).toHaveCount(0);
});

test("AC1.11 — no “Rescheduled N×”", async ({ page }) => {
  const t = await createTask(dev, { title: `Slipped ${tag}`, bucketId: ws.inboxId });
  await rest("service", `tasks?id=eq.${t.id}`, { method: "PATCH", body: { reschedule_count: 4 } });
  await openTasks(page, t.id);
  await expect(page.getByText(/Created/).last()).toBeVisible();
  await expect(page.getByText(/Rescheduled \d+×/)).toHaveCount(0);
});

test("AC1.12 — a date popover writes once, and scheduling is in the trail", async ({ page }) => {
  const t = await createTask(dev, { title: `Schedule me ${tag}`, bucketId: ws.inboxId });
  await openTasks(page, t.id);
  const writes = trackWrites(page);
  // The selected row's schedule popover ("s").
  await page.getByRole("grid").focus();
  await page.keyboard.press("s");
  const picker = page.locator('[data-slot="popover-content"]');
  await expect(picker.getByText("Scheduled time")).toBeVisible();
  await picker.getByRole("button", { name: "Tomorrow" }).click();
  const time = picker.getByLabel("Time");
  await time.fill("10:30");
  await time.fill("11:45");
  expect(writes).toEqual([]);
  await time.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual(["POST rpc/tasks_op_reschedule"]);
  await expect(page.getByText(/rescheduled this to Tomorrow/)).toBeVisible();
});

test("AC1.3 — ⌘A selects the text in capture", async ({ page }) => {
  await openTasks(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  const input = page.getByRole("textbox").first();
  await input.fill("Send March report");
  await input.press("ControlOrMeta+a");
  const selection = await input.evaluate((el: HTMLInputElement) => [
    el.selectionStart,
    el.selectionEnd,
    el.value.length,
  ]);
  expect(selection).toEqual([0, 17, 17]);
  await page.keyboard.press("Escape");
});

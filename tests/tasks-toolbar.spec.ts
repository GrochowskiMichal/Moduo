import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  ensureTeammate,
  rest,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 TV-U2 — the toolbar's Display on the real app, against the local
 * stack: one Date grouping (AC11.3, call 83), My tasks by status (call 84)
 * and Rows: Standard · Detailed (AC11.2, the part TV-U2 builds). Filter →
 * Status → Won't do (AC1.4) is in trust-pass.spec.ts. Run it like that file:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/tasks-toolbar.spec.ts
 */

test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial" });

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  // My tasks shows once the workspace has two members.
  await ensureTeammate(ws.id);
  tag = runTag();
});

/** Projects this run made; soft-deleted at the end so the shared dev
 *  workspace's project menus don't grow with every run. */
const created: string[] = [];

test.afterAll(async () => {
  if (created.length === 0) return;
  const ids = created.join(",");
  const at = new Date().toISOString();
  await rest("service", `tasks?bucket_id=in.(${ids})`, {
    method: "PATCH",
    body: { deleted_at: at },
  });
  await rest("service", `buckets?id=in.(${ids})`, { method: "PATCH", body: { deleted_at: at } });
});

/** Local noon `offset` days from today (the row's date is a day). */
const dayAt = (offset: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12).toISOString();
};

async function createTask(fields: {
  title: string;
  bucketId: string;
  status?: string;
  dueDate?: string | null;
}): Promise<{ id: string; title: string }> {
  const [row] = await rest<Array<{ id: string; title: string }>>(dev, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: fields.bucketId,
      title: fields.title,
      status: fields.status ?? "todo",
      due_date: fields.dueDate ?? null,
      owner_id: dev.user.id,
      assignee_id: dev.user.id,
      position: `z${tag}${fields.title}`,
    },
  });
  return row;
}

async function createProject(name: string): Promise<{ id: string }> {
  const [row] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: { workspace_id: ws.id, owner_id: dev.user.id, name, position: `z${tag}${name}` },
  });
  created.push(row.id);
  return row;
}

async function openTasks(page: Page, taskId: string) {
  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${taskId}`);
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 20_000 });
}

/** Picks Display → Group by → `label`; answers the choices the menu offered. */
async function setGroupBy(page: Page, label: string): Promise<string[]> {
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("combobox", { name: "Group by" }).click();
  const offered = await page.getByRole("option").allTextContents();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Display options" })).toHaveCount(0);
  return offered;
}

/** The List's group headers, in order, without their counts. */
async function groupHeaders(page: Page): Promise<string[]> {
  const grid = page.getByRole("grid");
  // DS-6's GroupHeader: the label sits in its own slot, apart from the count.
  const texts = await grid.locator('[data-slot="group-header-label"]').allTextContents();
  return texts.map((t) => t.trim());
}

test("AC11.3 — one Date grouping: Earlier · Today · Tomorrow · five day names · Later · No date", async ({
  page,
}) => {
  const project = await createProject(`Dates ${tag}`);
  const first = await createTask({
    title: `Late ${tag}`,
    bucketId: project.id,
    dueDate: dayAt(-2),
  });
  await createTask({ title: `Now ${tag}`, bucketId: project.id, dueDate: dayAt(0) });
  await createTask({ title: `Next ${tag}`, bucketId: project.id, dueDate: dayAt(1) });
  await createTask({ title: `Soon ${tag}`, bucketId: project.id, dueDate: dayAt(3) });
  await createTask({ title: `Far ${tag}`, bucketId: project.id, dueDate: dayAt(10) });
  await createTask({ title: `Someday ${tag}`, bucketId: project.id });
  await openTasks(page, first.id);
  // Group by never offers Tag or Energy; Project only across projects.
  expect(await setGroupBy(page, "Date")).toEqual([
    "Status",
    "Priority",
    "Assignee",
    "Date",
    "None",
  ]);

  const inThree = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(dayAt(3)));
  await expect
    .poll(() => groupHeaders(page))
    .toEqual(["Earlier", "Today", "Tomorrow", inThree, "Later", "No date"]);
  await expect(page.getByText("This week")).toHaveCount(0);
});

test("AC11.3 / call 84 — My tasks groups by status, In progress first", async ({ page }) => {
  const project = await createProject(`Mine ${tag}`);
  const doing = await createTask({
    title: `Doing ${tag}`,
    bucketId: project.id,
    status: "in_progress",
  });
  await createTask({ title: `To start ${tag}`, bucketId: project.id });
  await openTasks(page, doing.id);
  await page.getByRole("button", { name: /^My tasks/ }).click();
  await expect
    .poll(async () => (await groupHeaders(page)).slice(0, 2))
    .toEqual(["In progress", "To do"]);
});

test("a link into a filtered project lands on its task and keeps both projects' filters", async ({
  page,
}) => {
  const here = await createProject(`Here ${tag}`);
  const there = await createProject(`There ${tag}`);
  const start = await createTask({ title: `Start ${tag}`, bucketId: here.id });
  const target = await createTask({ title: `Linked ${tag}`, bucketId: there.id });
  // Each project has a saved filter; the one in "There" hides the linked task.
  const saved = (scope: string, values: string[]) => [
    `moduo:tasks:view:${ws.id}:${scope}`,
    JSON.stringify({ filters: [{ dimension: "status", operator: "is", values }] }),
  ];
  const prefs = [saved(here.id, ["todo"]), saved(there.id, ["done"])];
  await page.addInitScript((pairs) => {
    for (const [key, value] of pairs) window.localStorage.setItem(key, value);
  }, prefs);
  await openTasks(page, start.id);
  await expect(page.getByRole("group", { name: "Status is To do" })).toBeVisible();

  // A notification or chip opens the task in the other project.
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: "task", id } }));
  }, target.id);
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(target.title);
  await expect(page.locator(`[role="row"][data-task-id="${target.id}"]`)).toBeVisible();
  await expect(page.getByRole("group", { name: "Status is Done" })).toBeVisible();
  // It stays selected (the URL keeps it), and the first project's filter is untouched.
  await page.waitForTimeout(600);
  expect(new URL(page.url()).searchParams.get("id")).toBe(target.id);
  await page.getByRole("button", { name: `Here ${tag} , 1 open`, exact: true }).click();
  await expect(page.getByRole("group", { name: "Status is To do" })).toBeVisible();
});

test("AC11.2 — Rows: Detailed adds the status name, remembered per view", async ({ page }) => {
  const project = await createProject(`Rows ${tag}`);
  const t = await createTask({ title: `Detailed ${tag}`, bucketId: project.id });
  await openTasks(page, t.id);
  const row = page.locator(`[role="row"][data-task-id="${t.id}"]`);
  await expect(row.locator('[data-col="status"]')).toHaveCount(0);

  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("radio", { name: "Detailed" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Display options" })).toHaveCount(0);
  await expect(row.locator('[data-col="status"]')).toHaveText("To do");

  // Another scope keeps its own preset; coming back restores Detailed.
  await page.getByRole("button", { name: /^All ,/ }).click();
  await expect(page.getByRole("heading", { name: "All", exact: true })).toBeVisible();
  await expect(page.locator('[data-col="status"]')).toHaveCount(0);
  await page.getByRole("button", { name: `Rows ${tag} , 1 open` }).click();
  await expect(row.locator('[data-col="status"]')).toHaveText("To do");
});

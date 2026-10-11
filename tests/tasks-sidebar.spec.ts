import { expect, type Page, test } from "@playwright/test";

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
 * Tasks v3 TV-U6 — the sidebar's project flows on the real app, against the
 * local stack (REPLAN 78 + 98; AC5.5, AC11.1, AC11.10): deleting a project
 * hands its open work to its assignees' Inboxes with one notice each and Undo
 * brings it all back; Recently deleted and Archived projects open from the
 * hairline's ⋯; archiving asks about open work; Pin and Customize sidebar.
 * Run it like trust-pass.spec.ts:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8136
 *   E2E_BASE_URL=http://127.0.0.1:8136 bunx playwright test --project=e2e tests/tasks-sidebar.spec.ts
 */

test.use({ locale: "en-US" });
// A busy dev workspace re-renders slowly (see BACK): give each flow room.
test.describe.configure({ mode: "serial", timeout: 60_000 });

let dev: Session;
let mate: Session;
let ws: { id: string; inboxId: string };
let tag: string;
const created: string[] = [];
/** The dev's preferences before this run, put back after it. */
let savedPrefs: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  mate = await ensureTeammate(ws.id);
  tag = runTag();
  const [row] = await rest<Array<{ preferences: Record<string, unknown> }>>(
    "service",
    `user_preferences?user_id=eq.${dev.user.id}&select=preferences`,
  );
  savedPrefs = row?.preferences ?? null;
});

test.afterAll(async () => {
  if (created.length === 0) return;
  const ids = created.join(",");
  const at = new Date().toISOString();
  await rest("service", `tasks?bucket_id=in.(${ids})`, {
    method: "PATCH",
    body: { deleted_at: at },
  });
  await rest("service", `buckets?id=in.(${ids})`, {
    method: "PATCH",
    body: { deleted_at: at, archived_at: null },
  });
  // Leave the dev's sidebar as it was.
  if (savedPrefs) {
    await rest("service", `user_preferences?user_id=eq.${dev.user.id}`, {
      method: "PATCH",
      body: { preferences: savedPrefs },
    });
  }
});

async function project(name: string): Promise<string> {
  const row = await rpc<{ id: string }>(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: { name },
  });
  created.push(row.id);
  return row.id;
}

async function task(projectId: string, title: string, extra: Record<string, unknown> = {}) {
  const rows = await rpc<Array<{ id: string }> | { id: string }>(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { title, bucket_id: projectId, ...extra },
  });
  return Array.isArray(rows) ? rows[0]!.id : rows.id;
}

async function bucketOf(taskId: string): Promise<string | null> {
  const [row] = await rest<Array<{ bucket_id: string; deleted_at: string | null }>>(
    "service",
    `tasks?id=eq.${taskId}&select=bucket_id,deleted_at`,
  );
  return row?.deleted_at ? null : (row?.bucket_id ?? null);
}

async function inboxOf(userId: string): Promise<string> {
  const [row] = await rest<Array<{ id: string }>>(
    "service",
    `buckets?workspace_id=eq.${ws.id}&owner_id=eq.${userId}&is_system=eq.true&deleted_at=is.null&select=id`,
  );
  return row!.id;
}

async function openTasks(page: Page, taskId?: string) {
  await signInPage(page, dev, ws.id);
  await page.goto(taskId ? `/tasks?id=${taskId}` : "/tasks");
  await expect(page.getByRole("navigation", { name: "Tasks" })).toBeVisible({ timeout: 20_000 });
  // The workspace's projects are in: the bundle answered.
  await expect(
    page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name: /^All\s*,/ }),
  ).toBeVisible({ timeout: 20_000 });
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Tasks" });
/**
 * A project coming back (Undo, Restore) shows once the store has read it: on
 * the dev server a busy workspace re-renders for seconds when its project list
 * changes (React's dev-only render tracking), so these waits are longer.
 */
const BACK = { timeout: 15_000 };
/** A sidebar row's name: its label, then ", n open" (Chromium spaces them). */
const rowName = (label: string) => new RegExp(`^${label}(\\s*,|$)`);

async function projectMenu(page: Page, name: string, item: string) {
  const row = sidebar(page)
    .getByRole("button", { name: rowName(name) })
    .first();
  await row.scrollIntoViewIfNeeded();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: item }).click();
}

async function sidebarMenu(page: Page, item: string | RegExp) {
  await sidebar(page).locator('[data-slot="sidebar-hairline"]').hover();
  await page.getByRole("button", { name: "Sidebar options" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("AC5.5 — deleting a project hands open work to its assignees, one notice each; Undo brings it back", async ({
  page,
}) => {
  const name = `Del ${tag}`;
  const p = await project(name);
  const mine = await task(p, `Mine ${tag}`);
  const theirs = await task(p, `Theirs ${tag}`, { assignee_id: mate.user.id });
  const done = await task(p, `Done ${tag}`);
  await rpc(dev, "tasks_op_set_status", {
    p_workspace_id: ws.id,
    p_task_id: done,
    p_status: "done",
  });
  await openTasks(page, mine);

  await projectMenu(page, name, "Delete project…");
  const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
  await expect(dialog).toContainText(
    "Its 2 open tasks go to their assignees’ Inboxes (1 task to yours).",
  );
  await expect(dialog).toContainText("Its finished task goes with it to Recently deleted.");
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Delete project" }).click();

  await expect(sidebar(page).getByRole("button", { name: rowName(name) })).toHaveCount(0);
  await expect.poll(() => bucketOf(mine)).toBe(await inboxOf(dev.user.id));
  expect(await bucketOf(theirs)).toBe(await inboxOf(mate.user.id));
  expect(await bucketOf(done)).toBeNull();
  const notices = await rest<unknown[]>(
    "service",
    `module_activity?workspace_id=eq.${ws.id}&op=eq.tasks.project_deleted&payload->mentioned_user_ids=cs.["${mate.user.id}"]&payload->>title=eq.${encodeURIComponent(name)}&select=id`,
  );
  expect(notices).toHaveLength(1);

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: `“${name}” deleted` });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(sidebar(page).getByRole("button", { name: rowName(name) })).toBeVisible(BACK);
  await expect.poll(() => bucketOf(theirs)).toBe(p);
  expect(await bucketOf(mine)).toBe(p);
  expect(await bucketOf(done)).toBe(p);
});

test("AC11.10 — Recently deleted opens from the ⋯ and restores a project", async ({ page }) => {
  const name = `Trash ${tag}`;
  const p = await project(name);
  const open = await task(p, `Open ${tag}`);
  await rpc(dev, "projects_op_delete", { p_workspace_id: ws.id, p_project_id: p });
  await openTasks(page);
  await expect(sidebar(page).getByRole("button", { name: /Recently deleted/ })).toHaveCount(0);

  await sidebarMenu(page, /^Recently deleted/);
  const row = page
    .getByRole("list", { name: "Recently deleted" })
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(row).toContainText("Project · 1 task sent to Inboxes");
  await row.hover();
  await row.getByRole("button", { name: `Restore ${name}` }).click();
  await expect(sidebar(page).getByRole("button", { name: rowName(name) })).toBeVisible(BACK);
  await expect.poll(() => bucketOf(open)).toBe(p);
});

test("archiving asks about open work; Archived projects opens from the ⋯; Unarchive", async ({
  page,
}) => {
  const name = `Arch ${tag}`;
  const p = await project(name);
  const open = await task(p, `Still open ${tag}`);
  await openTasks(page, open);

  await projectMenu(page, name, "Archive…");
  const dialog = page.getByRole("dialog", { name: `Archive “${name}”?` });
  await expect(dialog).toContainText("1 open task — Won’t do · Move · Keep");
  await dialog.getByRole("button", { name: "Keep" }).click();
  await expect(sidebar(page).getByRole("button", { name: rowName(name) })).toHaveCount(0);

  await sidebarMenu(page, /^Archived projects/);
  const row = page
    .getByRole("list", { name: "Archived projects" })
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(row).toContainText("1 open task");
  await row.hover();
  await row.getByRole("button", { name: `Unarchive ${name}` }).click();
  await expect(sidebar(page).getByRole("button", { name: rowName(name) })).toBeVisible(BACK);
  await expect
    .poll(async () => {
      const [bucket] = await rest<Array<{ archived_at: string | null }>>(
        "service",
        `buckets?id=eq.${p}&select=archived_at`,
      );
      return bucket?.archived_at;
    })
    .toBeNull();
});

test("AC11.1 — Pin adds Pinned; Customize sidebar hides Upcoming; both follow the person", async ({
  page,
}) => {
  const name = `Pin ${tag}`;
  await project(name);
  await openTasks(page);
  await expect(sidebar(page).getByText("Pinned", { exact: true })).toHaveCount(0);
  await projectMenu(page, name, "Pin to sidebar");
  await expect(sidebar(page).getByText("Pinned", { exact: true })).toBeVisible();

  await sidebar(page).locator('[data-slot="sidebar-hairline"]').hover();
  await page.getByRole("button", { name: "Sidebar options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Upcoming" }).click();
  await page.keyboard.press("Escape");
  await expect(sidebar(page).getByRole("button", { name: /^Upcoming/ })).toHaveCount(0);

  // Stored with the person's preferences (synced), not on this device only.
  await expect
    .poll(async () => {
      const [row] = await rest<Array<{ preferences: Record<string, unknown> }>>(
        "service",
        `user_preferences?user_id=eq.${dev.user.id}&select=preferences`,
      );
      return row?.preferences?.tasksSidebar;
    })
    .toMatchObject({ hidden: ["upcoming"] });
});

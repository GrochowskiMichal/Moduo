import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  removeRun,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * DF-1 — the place open in Tasks lives in the address bar (`?place=`),
 * against the local stack: a `?place=` link opens that place and survives a
 * refresh; a deep link to a task opens the task's project even while another
 * project is remembered as where you left Tasks; and picking places never
 * adds history entries, so Back leaves Tasks as it always has.
 *   scripts/agent/e2e.sh tests/tasks-place.spec.ts
 */

test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial", timeout: 90_000 });

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
const created: string[] = [];

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

test.afterAll(async () => {
  await removeRun(ws.id, tag, created);
});

async function project(name: string): Promise<string> {
  const row = await rpc<{ id: string }>(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: { name },
  });
  created.push(row.id);
  return row.id;
}

async function task(projectId: string, title: string): Promise<string> {
  const rows = await rpc<Array<{ id: string }> | { id: string }>(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { title, bucket_id: projectId },
  });
  return Array.isArray(rows) ? rows[0]!.id : rows.id;
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Tasks" });
/** A sidebar row's name: its label, then ", n open" (Chromium spaces them). */
const rowName = (label: string) => new RegExp(`^${label}(\\s*,|$)`);
const LOAD = { timeout: 30_000 };

async function pick(page: Page, label: string) {
  const row = sidebar(page)
    .getByRole("button", { name: rowName(label) })
    .first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
}

test("?place=upcoming opens Upcoming, keeps it in the address bar, and a refresh stays there", async ({
  page,
}) => {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks?place=upcoming");
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toBeVisible(LOAD);
  await expect(page).toHaveURL(/[?&]place=upcoming/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toBeVisible(LOAD);
  await expect(page).toHaveURL(/[?&]place=upcoming/);
});

test("a deep link opens its task's project while another project is remembered", async ({
  page,
}) => {
  const linked = `Linked ${tag}`;
  const remembered = `Remembered ${tag}`;
  const linkedId = await project(linked);
  const rememberedId = await project(remembered);
  const target = await task(linkedId, `Target ${tag}`);
  await task(rememberedId, `Other ${tag}`);

  await signInPage(page, dev, ws.id);
  // Leave Tasks on the other project, so it's where Tasks would reopen.
  await page.goto(`/tasks?place=${rememberedId}`);
  await expect(page.getByRole("heading", { name: remembered })).toBeVisible(LOAD);

  // A notification, a chip or a widget row: `/tasks?id=` alone.
  await page.goto(`/tasks?id=${target}`);
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(
    `Target ${tag}`,
    LOAD,
  );
  await expect(page.getByRole("heading", { name: linked })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]place=${linkedId}`));
  // The address bar still ends with the task (MOD-28).
  await expect(page).toHaveURL(/[?&]id=[^&]+$/);
});

test("picking places adds no history: Back leaves Tasks, Forward comes back where you were", async ({
  page,
}) => {
  const first = `First ${tag}`;
  const second = `Second ${tag}`;
  const firstId = await project(first);
  const secondId = await project(second);
  await task(firstId, `One ${tag}`);
  await task(secondId, `Two ${tag}`);

  await signInPage(page, dev, ws.id);
  await page.goto("/notes");
  await page.goto(`/tasks?place=${firstId}`);
  await expect(page.getByRole("heading", { name: first })).toBeVisible(LOAD);

  await pick(page, second);
  await expect(page.getByRole("heading", { name: second })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]place=${secondId}`));
  await pick(page, "Upcoming");
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]place=upcoming/);

  await page.goBack();
  await expect(page).toHaveURL(/\/notes/);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Upcoming", exact: true })).toBeVisible(LOAD);
});

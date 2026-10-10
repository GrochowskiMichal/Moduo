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
 * Tasks v3 RF-1 — References (AC10.6, AC10.7) against the local stack:
 * a reference in a task's description opens in the right panel as "← item"
 * and the back arrow returns to Details; a reference to a task the reader
 * can't open reads "Private item" with its title nowhere on the page; a handle
 * deep link (`?id=MOD-142`) opens its task. Run it with the stack up and a dev
 * server pointed at it:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8139
 *   E2E_BASE_URL=http://127.0.0.1:8139 bunx playwright test --project=e2e tests/references.spec.ts
 */

type TaskRow = { id: string; title: string; number: number | null };

let dev: Session;
let mate: Session;
let ws: { id: string; inboxId: string };
let taskKey: string;
let tag: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  mate = await ensureTeammate(ws.id);
  tag = runTag();
  const [row] = await rest<Array<{ task_key: string }>>(
    "service",
    `workspaces?id=eq.${ws.id}&select=task_key`,
  );
  taskKey = row.task_key;
});

async function createTask(
  as: Session,
  fields: { title: string; bucketId: string; description?: string },
): Promise<TaskRow> {
  const [row] = await rest<Array<{ id: string }>>(as, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: fields.bucketId,
      title: fields.title,
      description: fields.description ?? "",
      status: "todo",
      owner_id: as.user.id,
      assignee_id: as.user.id,
      position: `z${tag}${fields.title}`,
    },
  });
  // The number comes from the server's trigger (TV-D8).
  const [full] = await rest<TaskRow[]>("service", `tasks?id=eq.${row.id}&select=id,title,number`);
  return full;
}

async function createProject(as: Session, name: string): Promise<{ id: string }> {
  const [row] = await rest<Array<{ id: string }>>(as, "buckets", {
    method: "POST",
    body: { workspace_id: ws.id, owner_id: as.user.id, name, position: `z${tag}` },
  });
  return row;
}

/** A project only its owner sees (new projects are shared through a workspace grant). */
async function createPrivateProject(as: Session, name: string): Promise<{ id: string }> {
  const project = await createProject(as, name);
  await rest(
    "service",
    `resource_grants?resource_type=eq.bucket&resource_id=eq.${project.id}&subject_type=eq.workspace`,
    { method: "DELETE" },
  );
  return project;
}

/** The HTML a description stores for a reference: the address only, never a title. */
const referenceHtml = (taskId: string, before: string, after: string) =>
  `<p>${before} <span data-lexical-entity-ref="true" data-entity-type="task" data-entity-id="${taskId}" data-ref-v="2">task</span> ${after}</p>`;

async function openTask(page: Page, as: Session, id: string) {
  await signInPage(page, as, ws.id);
  await page.goto(`/tasks?id=${id}`);
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 20_000 });
}

const panel = (page: Page) => page.locator('[data-panel-module="tasks"]');

test("AC10.7 — clicking a reference opens it in the panel as ← item; back returns to Details", async ({
  page,
}) => {
  const target = await createTask(dev, { title: `Collect assets ${tag}`, bucketId: ws.inboxId });
  const host = await createTask(dev, {
    title: `Weekly sync ${tag}`,
    bucketId: ws.inboxId,
    description: referenceHtml(target.id, "Chase", "before Friday."),
  });
  await openTask(page, dev, host.id);
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(host.title, {
    timeout: 20_000,
  });

  const chip = panel(page).getByRole("button", { name: new RegExp(`Task: ${target.title}`) });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.click();

  // "← Collect assets …": the item's name with a back arrow to Details.
  const back = panel(page).getByRole("button", { name: "Back to Details" });
  await expect(back).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: target.title })).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Task title" })).toHaveValue(target.title);

  await back.click();
  await expect(panel(page).getByRole("heading", { name: "Details" })).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Task title" })).toHaveValue(host.title);
});

test("AC10.6 — a reference the reader can't open reads 'Private item', its title nowhere", async ({
  page,
}) => {
  const secret = await createPrivateProject(dev, `Board only ${tag}`);
  const hidden = await createTask(dev, { title: `Acquire Northwind ${tag}`, bucketId: secret.id });
  const shared = await createProject(dev, `Launch ${tag}`);
  const host = await createTask(dev, {
    title: `Launch checklist ${tag}`,
    bucketId: shared.id,
    description: referenceHtml(hidden.id, "Depends on", "landing first."),
  });

  // The author sees it normally.
  await openTask(page, dev, host.id);
  await expect(
    panel(page).getByRole("button", { name: new RegExp(`Task: ${hidden.title}`) }),
  ).toBeVisible({ timeout: 20_000 });

  // A teammate who can open the host task but not the referenced one.
  const other = await page.context().browser()?.newPage();
  if (!other) throw new Error("no browser");
  await openTask(other, mate, host.id);
  await expect(other.getByRole("textbox", { name: "Task title" })).toHaveValue(host.title, {
    timeout: 20_000,
  });
  await expect(panel(other).getByText("Private item")).toBeVisible({ timeout: 15_000 });
  expect(await other.content()).not.toContain(hidden.title);
  await other.close();
});

test("a handle deep link (?id=MOD-142) opens its task", async ({ page }) => {
  const t = await createTask(dev, { title: `Handle target ${tag}`, bucketId: ws.inboxId });
  expect(t.number).not.toBeNull();
  await openTask(page, dev, `${taskKey}-${t.number}`);
  await expect(page.getByRole("textbox", { name: "Task title" })).toHaveValue(t.title, {
    timeout: 20_000,
  });
  await expect(page).toHaveURL(new RegExp(`id=${t.id}`));
});

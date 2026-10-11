import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  rest,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 TV-U4 — drag and drop on the real app, against the local stack:
 * manual order inside one project with Undo on every drop, a sorted project
 * asking to switch back (AC11.4, default m), a view across projects never
 * writing a position, the Inbox row taking no drop, project moves bringing
 * their subtasks, and the `>` / `<` / ⌥⇧ keys. Run it like trust-pass.spec.ts:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8114
 *   E2E_BASE_URL=http://127.0.0.1:8114 bunx playwright test --project=e2e tests/tasks-dnd.spec.ts
 */

test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial" });

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

/** Projects this run made; soft-deleted at the end. */
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

type Row = { id: string; title: string; position: string; bucket_id: string; status: string };

async function createProject(name: string): Promise<{ id: string }> {
  const [row] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: { workspace_id: ws.id, owner_id: dev.user.id, name, position: `z${tag}${name}` },
  });
  created.push(row.id);
  return row;
}

async function createTask(fields: {
  title: string;
  bucketId: string;
  position: string;
  parentId?: string;
  status?: string;
  dueDate?: string;
}): Promise<Row> {
  const [row] = await rest<Row[]>(dev, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: fields.bucketId,
      parent_id: fields.parentId ?? null,
      title: fields.title,
      status: fields.status ?? "todo",
      due_date: fields.dueDate ?? null,
      owner_id: dev.user.id,
      assignee_id: dev.user.id,
      position: fields.position,
    },
  });
  return row;
}

const read = async (id: string): Promise<Row & { parent_id: string | null }> =>
  (
    await rest<Array<Row & { parent_id: string | null }>>(
      "service",
      `tasks?id=eq.${id}&select=id,title,position,bucket_id,status,parent_id`,
    )
  )[0];

async function openTasks(page: Page, taskId: string) {
  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${taskId}`);
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 20_000 });
}

const row = (page: Page, id: string) => page.locator(`[role="row"][data-task-id="${id}"]`);

/** The List's top-level titles, in order. */
async function titles(page: Page): Promise<string[]> {
  return page
    .getByRole("grid")
    .locator("[data-list-block]")
    .evaluateAll((blocks) =>
      blocks.map((b) =>
        (b.querySelector('[role="row"] [data-row-title]')?.textContent ?? "").trim(),
      ),
    );
}

/** A real pointer drag (dnd-kit's PointerSensor needs moves past 6 px). */
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = await from.boundingBox();
  if (!box) throw new Error("no source box");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 4, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.move(to.x, to.y + 1);
  await page.waitForTimeout(120);
  await page.mouse.up();
}

/** Just inside a row's top edge, left of the subtask indent: "before it". */
async function beforeRow(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("no target box");
  return { x: box.x + 16, y: box.y + 3 };
}

const toast = (page: Page, text: string) =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

test("AC11.4 — a reorder inside a project lands, and Undo puts it back", async ({ page }) => {
  const project = await createProject(`Order ${tag}`);
  const a = await createTask({
    title: `Alpha ${tag}`,
    bucketId: project.id,
    position: "0000000a10",
  });
  await createTask({ title: `Bravo ${tag}`, bucketId: project.id, position: "0000000a20" });
  const c = await createTask({
    title: `Charlie ${tag}`,
    bucketId: project.id,
    position: "0000000a30",
  });
  await openTasks(page, a.id);
  await expect.poll(() => titles(page)).toEqual([`Alpha ${tag}`, `Bravo ${tag}`, `Charlie ${tag}`]);

  await drag(page, row(page, c.id), await beforeRow(row(page, a.id)));
  await expect.poll(() => titles(page)).toEqual([`Charlie ${tag}`, `Alpha ${tag}`, `Bravo ${tag}`]);
  await expect(toast(page, "Moved")).toBeVisible();
  await expect.poll(async () => (await read(c.id)).position < a.position).toBe(true);

  await toast(page, "Moved").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => titles(page)).toEqual([`Alpha ${tag}`, `Bravo ${tag}`, `Charlie ${tag}`]);
  await expect.poll(async () => (await read(c.id)).position).toBe(c.position);
});

test("AC11.4 — a sorted project says so; dragging asks to switch back and writes nothing", async ({
  page,
}) => {
  const project = await createProject(`Sorted ${tag}`);
  const later = await createTask({
    title: `Later ${tag}`,
    bucketId: project.id,
    position: "0000000b10",
    dueDate: new Date(Date.now() + 9 * 86_400_000).toISOString(),
  });
  const sooner = await createTask({
    title: `Sooner ${tag}`,
    bucketId: project.id,
    position: "0000000b20",
    dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`moduo:tasks:view:${ws.id}:${project.id}`, JSON.stringify({ order: "due" })],
  );
  await openTasks(page, later.id);
  await expect.poll(() => titles(page)).toEqual([`Sooner ${tag}`, `Later ${tag}`]);
  const line = page.getByText("Sorted by due date", { exact: true });
  await expect(line).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to manual order" })).toBeVisible();

  // Dragging Later above Sooner: the sorted note shows, the drop asks.
  await drag(page, row(page, later.id), await beforeRow(row(page, sooner.id)));
  await expect(toast(page, "Sorted by due date")).toBeVisible();
  await expect(
    toast(page, "Sorted by due date").getByRole("button", { name: "Back to manual order" }),
  ).toBeVisible();
  expect((await read(later.id)).position).toBe(later.position);
  expect((await read(sooner.id)).position).toBe(sooner.position);

  // Back to manual order: the order kept underneath comes back.
  await page.getByRole("button", { name: "Back to manual order" }).first().click();
  await expect.poll(() => titles(page)).toEqual([`Later ${tag}`, `Sooner ${tag}`]);
  await expect(line).toHaveCount(0);
});

test("a view across projects never writes positions; another status group changes the status", async ({
  page,
}) => {
  const one = await createProject(`Across one ${tag}`);
  const two = await createProject(`Across two ${tag}`);
  const x = await createTask({ title: `X ${tag}`, bucketId: one.id, position: "0000000c10" });
  const y = await createTask({ title: `Y ${tag}`, bucketId: two.id, position: "0000000c20" });
  const doing = await createTask({
    title: `Doing ${tag}`,
    bucketId: two.id,
    position: "0000000c30",
    status: "in_progress",
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`moduo:tasks:view:${ws.id}:all`, JSON.stringify({ group: "status" })],
  );
  await openTasks(page, x.id);
  await page.getByRole("button", { name: /^All/ }).first().click();
  // Only this run's tasks (the shared dev workspace has many).
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search tasks" }).fill(tag);
  await expect(row(page, y.id)).toBeVisible();
  await expect(row(page, doing.id)).toBeVisible();

  // Within To do: no line, no write.
  await drag(page, row(page, y.id), await beforeRow(row(page, x.id)));
  await page.waitForTimeout(400);
  expect((await read(y.id)).position).toBe(y.position);
  await expect(toast(page, "Moved")).toHaveCount(0);

  // Into In progress: the status changes, the position doesn't.
  await drag(page, row(page, x.id), await beforeRow(row(page, doing.id)));
  await expect(toast(page, "Moved to In progress")).toBeVisible();
  await expect.poll(async () => (await read(x.id)).status).toBe("in_progress");
  expect((await read(x.id)).position).toBe(x.position);
});

test("the Inbox row takes no drop; a project row moves the task and its subtasks, with Undo", async ({
  page,
}) => {
  const from = await createProject(`From ${tag}`);
  const to = await createProject(`To ${tag}`);
  const parent = await createTask({
    title: `Parent ${tag}`,
    bucketId: from.id,
    position: "0000000d10",
  });
  const child = await createTask({
    title: `Child ${tag}`,
    bucketId: from.id,
    parentId: parent.id,
    position: "0000000d20",
  });
  const wont = await createTask({
    title: `Wont ${tag}`,
    bucketId: from.id,
    parentId: parent.id,
    position: "0000000d30",
    status: "archived",
  });
  await openTasks(page, parent.id);
  await expect(row(page, parent.id)).toBeVisible();

  // Onto the Inbox row: nothing happens.
  const inboxRow = page.getByRole("button", { name: /^Inbox/ }).first();
  const inboxBox = await inboxRow.boundingBox();
  if (!inboxBox) throw new Error("no Inbox row");
  await drag(page, row(page, parent.id), {
    x: inboxBox.x + inboxBox.width / 2,
    y: inboxBox.y + inboxBox.height / 2,
  });
  await page.waitForTimeout(400);
  expect((await read(parent.id)).bucket_id).toBe(from.id);
  await expect(toast(page, "Moved to")).toHaveCount(0);

  // Onto the other project's row: it moves, its subtasks (Won't do too) follow.
  const toRow = page.getByRole("button", { name: new RegExp(`^To ${tag}`) }).first();
  await toRow.scrollIntoViewIfNeeded();
  const toBox = await toRow.boundingBox();
  if (!toBox) throw new Error("no project row");
  await drag(page, row(page, parent.id), {
    x: toBox.x + toBox.width / 2,
    y: toBox.y + toBox.height / 2,
  });
  await expect(toast(page, `Moved to To ${tag}`)).toBeVisible();
  await expect.poll(async () => (await read(parent.id)).bucket_id).toBe(to.id);
  await expect.poll(async () => (await read(child.id)).bucket_id).toBe(to.id);
  await expect.poll(async () => (await read(wont.id)).bucket_id).toBe(to.id);

  await toast(page, `Moved to To ${tag}`).getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await read(parent.id)).bucket_id).toBe(from.id);
  await expect.poll(async () => (await read(child.id)).bucket_id).toBe(from.id);
  await expect.poll(async () => (await read(wont.id)).bucket_id).toBe(from.id);
});

test("`>` nests under the row above, `<` brings it back; ⌥⇧↑ moves it up", async ({ page }) => {
  const project = await createProject(`Keys ${tag}`);
  const top = await createTask({
    title: `Top ${tag}`,
    bucketId: project.id,
    position: "0000000e10",
  });
  const next = await createTask({
    title: `Next ${tag}`,
    bucketId: project.id,
    position: "0000000e20",
  });
  await openTasks(page, next.id);
  await expect(row(page, next.id)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("grid").focus();

  await page.keyboard.press(">");
  await expect(toast(page, `Moved under “Top ${tag}”`)).toBeVisible();
  await expect.poll(async () => (await read(next.id)).parent_id).toBe(top.id);

  await page.keyboard.press("<");
  await expect(toast(page, `Moved out of “Top ${tag}”`)).toBeVisible();
  await expect.poll(async () => (await read(next.id)).parent_id).toBeNull();

  await page.keyboard.press("Alt+Shift+ArrowUp");
  await expect.poll(() => titles(page)).toEqual([`Next ${tag}`, `Top ${tag}`]);
  await expect(toast(page, "Moved up")).toBeVisible();
});

test("Board: a card dropped on another status column changes it, and Undo puts it back", async ({
  page,
}) => {
  const project = await createProject(`Board ${tag}`);
  const card = await createTask({
    title: `Card ${tag}`,
    bucketId: project.id,
    position: "0000000g10",
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`moduo:tasks:view:${ws.id}:${project.id}`, JSON.stringify({ layout: "board" })],
  );
  await openTasks(page, card.id);
  const source = page.locator(`[role="button"][data-task-id="${card.id}"]`);
  await expect(source).toBeVisible();
  const column = page.locator("section").filter({ hasText: "In progress" }).first();
  const box = await column.boundingBox();
  if (!box) throw new Error("no In progress column");
  await drag(page, source, { x: box.x + box.width / 2, y: box.y + 80 });
  await expect(toast(page, "Moved to In progress")).toBeVisible();
  await expect.poll(async () => (await read(card.id)).status).toBe("in_progress");

  await toast(page, "Moved to In progress").getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await read(card.id)).status).toBe("todo");
});

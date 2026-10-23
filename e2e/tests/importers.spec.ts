import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

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
 * Tasks v3 TV-U18 — native importers (spec §15, REPLAN 35; AC4.7, AC3.6,
 * AC2.6), against the local stack: a Trello board comes in through the
 * sidebar's ⋯ → "Import tasks…" with a preview ("7 tasks, 1 project, 2
 * skipped"), lists become statuses, and "Undo this import" takes it back; a
 * Linear export's issue ids are found by search afterwards.
 *   bun run local:up
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8143
 *   E2E_BASE_URL=http://127.0.0.1:8143 bunx playwright test --project=e2e tests/importers.spec.ts
 * The engine's re-run and Undo rules are proven in SQL
 * (supabase/tests/import.test.sql, import_native.test.sql); the mapping in
 * src/features/tasks/importers/*.test.ts.
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.describe.configure({ mode: "serial" });

let startedAt: string;

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  startedAt = new Date().toISOString();
});

/** The tag names the fixtures bring (a run makes the ones missing here). */
const FIXTURE_TAGS = [
  "Design",
  "Urgent",
  "yellow",
  "Bug",
  "urgent",
  "Frontend",
  "Billing",
  "Backend",
];

/**
 * Leave the shared database as it was: Undo keeps a run and sends its rows to
 * Recently deleted, and other suites read `import_rows` (ops_parity). Removes
 * this spec's runs, what they made, and the tags they made.
 */
test.afterAll(async () => {
  const runs = await rest<Array<{ id: string }>>(
    "service",
    `imports?workspace_id=eq.${ws.id}&user_id=eq.${dev.user.id}&label=like.*${tag}*&select=id`,
  );
  if (runs.length === 0) return;
  const runIds = runs.map((r) => r.id).join(",");
  const rows = await rest<Array<{ entity_type: string; entity_id: string }>>(
    "service",
    `import_rows?import_id=in.(${runIds})&select=entity_type,entity_id`,
  );
  const idsOf = (type: string) =>
    rows
      .filter((r) => r.entity_type === type)
      .map((r) => r.entity_id)
      .join(",");
  const all = rows.map((r) => r.entity_id).join(",");
  const del = (path: string) =>
    rest("service", path, { method: "DELETE", prefer: "return=minimal" });
  if (all) {
    await del(`comments?entity_type=eq.task&entity_id=in.(${all})`);
    await del(`tag_links?entity_type=eq.task&entity_id=in.(${all})`);
    const tasks = idsOf("task");
    if (tasks) {
      await del(`tasks?id=in.(${tasks})&parent_id=not.is.null`);
      await del(`tasks?id=in.(${tasks})`);
    }
    if (idsOf("section")) await del(`sections?id=in.(${idsOf("section")})`);
    if (idsOf("bucket")) await del(`buckets?id=in.(${idsOf("bucket")})`);
    await del(`module_activity?entity_id=in.(${all})`);
    await del(`entities?entity_id=in.(${all})`);
  }
  await del(`imports?id=in.(${runIds})`);
  // The fixtures' tags made during this spec, once nothing is tagged with them.
  const names = FIXTURE_TAGS.map((n) => `"${n}"`).join(",");
  const made = await rest<Array<{ id: string }>>(
    "service",
    `tags?workspace_id=eq.${ws.id}&created_at=gte.${encodeURIComponent(startedAt)}&name=in.(${encodeURIComponent(names)})&select=id`,
  );
  for (const t of made) {
    const used = await rest<unknown[]>(
      "service",
      `tag_links?tag_id=eq.${t.id}&select=tag_id&limit=1`,
    );
    if (used.length === 0) await del(`tags?id=eq.${t.id}`);
  }
});

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(HERE, "fixtures/importers", name), "utf8");

async function openImport(page: Page) {
  await page
    .getByRole("button", { name: "Sidebar options" })
    .click({ force: true, timeout: 30_000 });
  await page.getByRole("menuitem", { name: "Import tasks…" }).click();
  await expect(page.getByRole("heading", { name: "Import tasks" })).toBeVisible();
}

const liveTasks = (keyLike: string) =>
  rest<Array<{ id: string; title: string; bucket_id: string }>>(
    "service",
    `tasks?workspace_id=eq.${ws.id}&deleted_at=is.null&imported_from->>key=like.${encodeURIComponent(keyLike)}&select=id,title,bucket_id`,
  );

test("a Trello board comes in with a preview, its lists as statuses, and goes with Undo", async ({
  page,
}) => {
  // This run's own board: its own name and card links, so runs never meet.
  const board = fixture("trello-launch.json")
    .replaceAll('"shortLink": "', `"shortLink": "${tag}`)
    .replace('"name": "Website launch"', `"name": "Website launch ${tag}"`);

  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await openImport(page);
  await page.getByLabel("Export file").setInputFiles({
    name: "website-launch.json",
    mimeType: "application/json",
    buffer: Buffer.from(board),
  });

  const dialog = page.getByTestId("task-import-dialog");
  await expect(dialog.getByTestId("import-preview-line")).toHaveText(
    "7 tasks, 1 project, 2 skipped",
  );
  await expect(
    dialog.getByText("Each list becomes a status. Check where it belongs:"),
  ).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Category of Doing" })).toHaveText(
    "In progress",
  );
  await expect(dialog.getByText("Skipped: 2 archived in the source")).toBeVisible();

  await dialog.getByRole("button", { name: "Import 7 tasks" }).click();
  await expect(dialog.getByTestId("import-done")).toContainText(
    `Imported 7 tasks into “Website launch ${tag}”`,
    { timeout: 30_000 },
  );
  await expect(dialog.getByTestId("import-done")).toContainText("2 comments came along.");

  const made = await liveTasks(`${tag}%`);
  expect(made).toHaveLength(7);
  const [project] = await rest<Array<{ id: string }>>(
    "service",
    `buckets?workspace_id=eq.${ws.id}&name=eq.${encodeURIComponent(`Website launch ${tag}`)}&deleted_at=is.null&select=id`,
  );
  const statuses = await rest<Array<{ name: string; category: string }>>(
    "service",
    `project_statuses?project_id=eq.${project!.id}&deleted_at=is.null&select=name,category`,
  );
  expect(statuses).toContainEqual({ name: "Doing", category: "in_progress" });
  expect(statuses).toContainEqual({ name: "Ideas", category: "backlog" });

  // The new project shows in the sidebar (behind the dialog).
  await expect(page.locator("nav").getByText(`Website launch ${tag}`)).toBeVisible({
    timeout: 20_000,
  });

  await dialog.getByRole("button", { name: "Undo this import" }).click();
  await expect(dialog.getByText(/Moved 7 tasks to Recently deleted and 1 project/)).toBeVisible({
    timeout: 20_000,
  });
  expect(await liveTasks(`${tag}%`)).toHaveLength(0);
});

test("a Linear export keeps its issue ids, and search finds them", async ({ page }) => {
  const key = `E${tag.toUpperCase()}`;
  const csv = fixture("linear-eng.csv").replaceAll("ENG-", `${key}-`);

  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await openImport(page);
  await page.getByLabel("Export file").setInputFiles({
    name: `linear-${tag}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const dialog = page.getByTestId("task-import-dialog");
  await expect(dialog.getByTestId("import-preview-line")).toHaveText(
    "6 tasks, 2 projects, 0 skipped",
  );
  // The file's people are picked by hand; nobody here is maya@example.com.
  await expect(dialog.getByText("maya@example.com · 2 tasks")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Assignee for maya@example.com" })).toHaveText(
    "Unassigned",
  );
  // Leave the finished ones behind.
  await dialog.getByRole("checkbox", { name: "Include finished tasks" }).click();
  await expect(dialog.getByTestId("import-preview-line")).toHaveText(
    "4 tasks, 2 projects, 2 skipped",
  );
  await dialog.getByRole("button", { name: "Import 4 tasks" }).click();
  await expect(dialog.getByTestId("import-done")).toContainText("Imported 4 tasks", {
    timeout: 30_000,
  });
  await dialog.getByRole("button", { name: "Done" }).click();

  // Every project's tasks, searched by the Linear id.
  await page.locator("nav").getByText("All", { exact: true }).click();
  const field = page.getByLabel("Search tasks");
  if (!(await field.isVisible()))
    await page.getByRole("button", { name: "Search", exact: true }).click();
  await field.fill(`${key}-121`);
  await expect(page.getByRole("button", { name: "Plans table", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Billing page v2", exact: true })).toHaveCount(0);
  await field.fill("");

  // Clean up: the run goes with Undo from the dialog's list.
  await openImport(page);
  await page
    .getByRole("region", { name: "Your imports" })
    .getByRole("button", { name: "Undo this import" })
    .first()
    .click();
  await expect.poll(async () => (await liveTasks(`${key}-%`)).length, { timeout: 20_000 }).toBe(0);
});

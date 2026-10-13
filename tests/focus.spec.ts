import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  endFocusRuns,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 AC8.1–8.5 — the Focus screen (TV-F7) against the local stack:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/focus.spec.ts
 * The meeting divider, Arrange by project and the along-the-way offer
 * (AC8.6–8.8) are TV-F8's and join this file with it.
 */

type TaskRow = { id: string; title: string; status: string };

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

// No session left over from another test, and none left for the next one:
// the card starts from Up next.
test.beforeEach(() => endFocusRuns(dev.user.id));
test.afterAll(() => endFocusRuns(dev.user.id));

async function createTask(fields: {
  title: string;
  parentId?: string;
  description?: string;
}): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>(dev, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: ws.inboxId,
      title: fields.title,
      description: fields.description ?? "",
      parent_id: fields.parentId ?? null,
      status: "todo",
      owner_id: dev.user.id,
      assignee_id: dev.user.id,
      position: `z${tag}${fields.title}`,
    },
  });
  return row;
}

async function taskById(id: string): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>("service", `tasks?id=eq.${id}&select=id,title,status`);
  return row;
}

async function openFocus(page: Page) {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button", { name: /^Focus\b/ })
    .first()
    .click();
  await expect(page.locator('[data-slot="focus-view"]')).toBeVisible({ timeout: 20_000 });
}

test("AC8.1–8.3 — the sidebar's Focus, Start, one pill with Pause, Stop in ⋯ with Undo", async ({
  page,
}) => {
  const t = await createTask({ title: `Now card ${tag}` });
  await rpc(dev, "tasks_op_queue_add", { p_workspace_id: ws.id, p_task_id: t.id, p_at: "top" });
  await openFocus(page);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByRole("heading", { name: `Now card ${tag}` })).toBeVisible();
  // The old Plan · Focus switch is gone.
  await expect(page.getByRole("radio", { name: "Focus", exact: true })).toHaveCount(0);
  await now.getByRole("button", { name: /^Start/ }).click();
  // Per task or Pomodoro: one pill (on the card or in the header), Pause inside it.
  const pill = page.locator('[data-slot="focus-task-pill"], [data-slot="focus-pomodoro-pill"]');
  await expect(pill).toHaveCount(1);
  await expect(pill).toHaveAttribute("aria-label", /^Pause/);
  await page.getByRole("button", { name: "Focus options" }).click();
  await page.getByRole("menuitem", { name: "Stop" }).click();
  await expect(page.getByText("Focus stopped")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pill).toHaveCount(1);
});

test("AC8.5 — a subtask opens its own details in the panel; ⇧F makes it the focus; ⏎ finishes it", async ({
  page,
}) => {
  const parent = await createTask({ title: `Parent ${tag}` });
  const sub = await createTask({
    title: `Sub ${tag}`,
    parentId: parent.id,
    description: "Kerning at 16 px.",
  });
  await rpc(dev, "tasks_op_queue_add", {
    p_workspace_id: ws.id,
    p_task_id: parent.id,
    p_at: "top",
  });
  await openFocus(page);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByRole("heading", { name: `Parent ${tag}` })).toBeVisible();

  // Its own details on the right, with the parent as the breadcrumb.
  const row = now.getByRole("button", { name: `Sub ${tag}: open its details` });
  await row.click();
  const details = page.getByRole("region", { name: "Task details" }).last();
  await expect(details.getByText("Kerning at 16 px.")).toBeVisible();
  await expect(details.getByRole("button", { name: `Parent task: Parent ${tag}` })).toBeVisible();

  // ⇧F on it: the subtask becomes the Now card, its parent in the top line.
  await row.focus();
  await page.keyboard.press("Shift+F");
  await expect(now.getByRole("heading", { name: `Sub ${tag}` })).toBeVisible();
  await expect(now.getByText(`Parent ${tag}`)).toBeVisible();

  // ⏎ is Done for the focused task.
  await page.locator('[data-slot="focus-view"] h1').click();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await taskById(sub.id)).status).toBe("done");
});

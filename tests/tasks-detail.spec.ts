import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  removeRun,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 TV-U13 — the detail panel v3 and the full page (AC11.7, AC11.8,
 * AC3.7, AC1.16), against the local stack. Run it with the stack up and a dev
 * server pointed at it:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/tasks-detail.spec.ts
 */

type TaskRow = { id: string; title: string; number: number | null };

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
let project: { id: string };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  [project] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      owner_id: dev.user.id,
      name: `Detail ${tag}`,
      position: `z${tag}`,
    },
  });
});

/** The project is soft-deleted at the end (with its sections and tasks, and the
 *  Inbox ones tagged with this run) so the shared dev workspace stays under
 *  the app's 500-project first-load read. */
test.afterAll(async () => {
  await removeRun(ws.id, tag, [project.id]);
});

async function createTask(title: string, bucketId = project.id): Promise<TaskRow> {
  const id = crypto.randomUUID();
  await rpc(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { id, title, bucket_id: bucketId },
  });
  const [row] = await rest<TaskRow[]>("service", `tasks?id=eq.${id}&select=id,title,number`);
  return row;
}

async function openTask(page: Page, taskId: string) {
  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${taskId}`);
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 20_000 });
}

test("AC11.7 — Details ▾ lists Details · Project / In flight; the full page keeps the route and the panel shows Project", async ({
  page,
}) => {
  const task = await createTask(`Logo concepts ${tag}`);
  await openTask(page, task.id);
  await page.getByRole("button", { name: "Panel view: Details" }).click();
  await expect(page.getByRole("menuitemradio", { name: /Details/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /Project/ })).toBeVisible();
  // TV-F8: In flight, the alongside view, ⌥3 away from the Timeline.
  await expect(page.getByRole("menuitemradio", { name: /In flight/ })).toBeVisible();
  await page.keyboard.press("Escape");

  const url = page.url();
  await page.getByRole("button", { name: "Open full page" }).first().click();
  const full = page.locator('[data-slot="task-full-page"]');
  await expect(full).toBeVisible();
  await expect(full.getByRole("textbox", { name: "Task title" })).toHaveValue(task.title);
  expect(new URL(page.url()).pathname).toBe(new URL(url).pathname);
  await expect(page.getByRole("button", { name: "Panel view: Project" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(full).toHaveCount(0);

  // ⏎ on the selected row opens it full too (TV-U10, decision 22).
  await page.getByRole("grid").focus();
  await page.keyboard.press("Enter");
  await expect(full).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(full).toHaveCount(0);
});

test("AC3.7 — ⋯ copies the branch name", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const task = await createTask(`Logo concepts ${tag}`);
  await openTask(page, task.id);
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Copy branch name" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(new RegExp(`^[a-z]+-${task.number}-logo-concepts-${tag}$`));
});

test("AC11.8 — a comment edits, takes a reaction and deletes with Undo", async ({ page }) => {
  const task = await createTask(`Feedback ${tag}`);
  await openTask(page, task.id);
  const box = page.getByRole("textbox", { name: "Comment on this task" });
  await box.fill(`First pass ${tag}`);
  await box.press("ControlOrMeta+Enter");
  const card = page.locator("article", { hasText: `First pass ${tag}` });
  await expect(card).toBeVisible();

  await card.hover();
  await card.getByRole("button", { name: "React" }).click();
  await page.getByRole("button", { name: "Thumbs up" }).click();
  await expect(card.getByRole("button", { name: /Thumbs up: You/ })).toBeVisible();

  await card.getByRole("button", { name: "Comment actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Edit comment" });
  await editor.fill(`First pass ${tag}, ship it`);
  await editor.press("ControlOrMeta+Enter");
  const edited = page.locator("article", { hasText: `ship it` });
  await expect(edited.getByText("edited")).toBeVisible();

  await edited.hover();
  await edited.getByRole("button", { name: "Comment actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.locator("article", { hasText: "ship it" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("article", { hasText: "ship it" })).toBeVisible();
  // No notice for a reaction (REPLAN 88): nothing in the trail but the add and the edit.
  const ops = await rest<Array<{ op: string }>>(
    "service",
    `module_activity?entity_id=eq.${task.id}&module=eq.comments&select=op`,
  );
  expect(ops.map((o) => o.op).sort()).toEqual([
    "comments.add",
    "comments.delete",
    "comments.edit",
    "comments.restore",
  ]);
});

test("AC1.16 — at 280 and 320 px no value in the panel truncates; the label column narrows under 320", async ({
  page,
}) => {
  // A long section name: the breadcrumb must shorten it on one line (MOD-118).
  const sectionId = crypto.randomUUID();
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: project.id,
    p_section: { id: sectionId, name: `A section name long enough to shorten ${tag}` },
  });
  const taskId = crypto.randomUUID();
  await rpc(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: {
      id: taskId,
      title: `A long title that has to wrap in a narrow panel ${tag}`,
      bucket_id: project.id,
      section_id: sectionId,
    },
  });
  // A long estimate with tracked time and a due date: the widest values.
  await rpc(dev, "tasks_op_update", {
    p_workspace_id: ws.id,
    p_task_id: taskId,
    p_patch: { estimate_minutes: 2400, due_date: "2026-12-30T12:00:00Z" },
  });
  await rpc(dev, "tasks_op_track_time", {
    p_workspace_id: ws.id,
    p_task_id: taskId,
    p_action: "set_total",
    p_seconds: 45_000,
    p_ended_at: new Date().toISOString(),
    p_client_key: `u13-${tag}`,
    p_entry_id: null,
  });
  // An agent's line with a long note and long link labels (MOD-119). Only an
  // agent's key reports through `tasks_op_agent_report`, so the row goes in
  // directly, as the dev's own session.
  await rest("service", "agent_sessions", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      task_id: taskId,
      user_id: dev.user.id,
      agent: "Claude",
      state: "needs_you",
      note: `Prod desktop build published to the release channel, ${"waiting-for-sign-off-".repeat(6)}${tag}`,
      links: [1, 2, 3].map((n) => ({
        url: `https://example.com/pull/${n}`,
        label: `Pull request ${n}: ${"a-long-branch-name-".repeat(3)}`,
      })),
    },
  });
  await openTask(page, taskId);
  const panel = page.locator('[data-layout="panel"]').first();
  await expect(panel.getByRole("button", { name: /^Estimate: 12h 30m, of ~40h/ })).toBeVisible();
  await expect(panel.locator('[data-slot="agent-session-line"]')).toBeVisible();
  for (const width of [280, 320]) {
    await panel.evaluate((el, w) => {
      // The shell's floor is 280 px (call 89).
      (el.closest("[data-panel-module]") as HTMLElement).style.width = `${w}px`;
    }, width);
    const clipped = await panel.evaluate(
      (el) =>
        Array.from(el.querySelectorAll<HTMLElement>("[data-slot=property-value]")).filter(
          (v) =>
            v.scrollWidth > v.clientWidth + 1 ||
            v.getBoundingClientRect().right > el.getBoundingClientRect().right + 1,
        ).length,
    );
    expect(clipped, `clipped values at ${width} px`).toBe(0);
    const labelWidth = await panel
      .locator("[data-slot=property-row] > :first-child")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    if (width < 320) expect(labelWidth).toBeLessThan(80);
    else expect(labelWidth).toBeGreaterThan(90);
  }

  // At 280 px the two one-line exceptions hold, and nothing scrolls sideways.
  await panel.evaluate((el) => {
    (el.closest("[data-panel-module]") as HTMLElement).style.width = "280px";
  });
  // The "+" line: whole names, then "+n", inside its own width. It re-counts
  // on its ResizeObserver, a frame after the panel narrows, so wait for it.
  const namesLine = panel.locator("[data-slot=add-property-names]");
  await expect
    .poll(() => namesLine.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), {
      message: "the + line's names fit",
    })
    .toBe(true);
  await expect(namesLine).toHaveText(/\+\d/);
  // The breadcrumb: one control tall, however long the names.
  const crumbs = await panel.locator('nav[aria-label="Location"]').evaluate((el) => {
    const first = el.querySelector("button");
    return {
      nav: el.getBoundingClientRect().height,
      crumb: first ? first.getBoundingClientRect().height : 0,
    };
  });
  expect(crumbs.crumb).toBeGreaterThan(0);
  expect(crumbs.nav, "the breadcrumb is one line").toBeLessThanOrEqual(crumbs.crumb + 1);
  // The panel's scroll box, with the agent's long line in it. That line
  // reflows after the panel narrows too, so wait for it as well.
  await expect
    .poll(
      () =>
        panel.evaluate((el) => {
          const box = el.querySelector<HTMLElement>(".pane-scroll");
          return box ? box.scrollWidth <= box.clientWidth + 1 : false;
        }),
      { message: "the panel never scrolls sideways" },
    )
    .toBe(true);
});

test("TV-U10 — the panel's subtasks reorder by drag and by ⌥⇧↑/↓", async ({ page }) => {
  const parent = await createTask(`Launch kit ${tag}`);
  for (const title of [`Brief ${tag}`, `Draft ${tag}`, `Review ${tag}`]) {
    await rpc(dev, "tasks_op_create", {
      p_workspace_id: ws.id,
      p_task: { id: crypto.randomUUID(), title, bucket_id: project.id, parent_id: parent.id },
    });
  }
  const order = async () =>
    (
      await rest<Array<{ title: string }>>(
        "service",
        `tasks?parent_id=eq.${parent.id}&select=title,position&order=position.asc`,
      )
    ).map((t) => t.title.replace(` ${tag}`, ""));
  expect(await order()).toEqual(["Brief", "Draft", "Review"]);

  await openTask(page, parent.id);
  const row = (title: string) => page.locator("[data-subtask-row]", { hasText: `${title} ${tag}` });
  // Drag Review above Brief (the whole row drags). The panel settles first:
  // its sections above load in and move the rows down.
  await expect(row("Review")).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Mid-panel, so the drag doesn't scroll it on the way.
  await row("Draft").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const from = await row("Review").boundingBox();
  if (!from) throw new Error("subtask rows not laid out");
  const x = from.x + from.width - 40;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, from.y + from.height / 2 - 10, { steps: 4 });
  const to = await row("Brief").boundingBox();
  if (!to) throw new Error("subtask rows not laid out");
  await page.mouse.move(x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(order).toEqual(["Review", "Brief", "Draft"]);
  await expect(page.getByText("Moved up")).toBeVisible();

  // ⌥⇧↓ on Review moves it back down one place, and the focus stays on it.
  const review = page.getByRole("button", { name: `Open subtask: Review ${tag}` });
  await review.focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect.poll(order).toEqual(["Brief", "Review", "Draft"]);
  await expect(review).toBeFocused();
});

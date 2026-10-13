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
 * Tasks v3 TV-U15 · "triage keys 1 · 2 · 3 · H" (AC3.3), on the real app
 * against the local stack: Accept files the task and assigns it to you;
 * Decline hands someone else's back with a note (your own becomes Won't do);
 * Duplicate of… copies the comments over, then Won't do; Snooze hides it
 * until a day, and Undo brings it back. Run it like the other Tasks specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/inbox.spec.ts
 * The dev's Inbox holds hundreds of earlier runs' tasks, so each test opens
 * its task by deep link (it's selected and scrolled to; gotchas/ui.md).
 */

type TaskRow = {
  id: string;
  bucket_id: string;
  assignee_id: string | null;
  status: string;
};

let dev: Session;
let mate: Session;
let ws: { id: string; inboxId: string };
let tag: string;
let project: { id: string };
const made: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  mate = await ensureTeammate(ws.id);
  tag = runTag();
  [project] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      owner_id: dev.user.id,
      name: `Triage ${tag}`,
      position: `z${tag}`,
    },
  });
});

test.afterAll(async () => {
  const at = new Date().toISOString();
  if (made.length > 0) {
    await rest("service", `tasks?id=in.(${made.join(",")})`, {
      method: "PATCH",
      body: { deleted_at: at },
    });
  }
  await rest("service", `buckets?id=eq.${project.id}`, {
    method: "PATCH",
    body: { deleted_at: at },
  });
});

/** A task in the dev's Inbox (theirs, or someone else's made with the service role). */
async function inboxTask(title: string, from: Session = dev): Promise<string> {
  const id = crypto.randomUUID();
  if (from === dev) {
    await rpc(dev, "tasks_op_create", {
      p_workspace_id: ws.id,
      p_task: { id, title: `${title} ${tag}`, bucket_id: ws.inboxId },
    });
  } else {
    // Handed over unfiled (20a): in the dev's Inbox, made by the teammate.
    await rest("service", "tasks", {
      method: "POST",
      body: {
        id,
        workspace_id: ws.id,
        bucket_id: ws.inboxId,
        title: `${title} ${tag}`,
        status: "todo",
        owner_id: from.user.id,
        assignee_id: dev.user.id,
        position: `a${tag}`,
      },
    });
  }
  made.push(id);
  return id;
}

const rowOf = async (id: string) =>
  (await rest<TaskRow[]>("service", `tasks?id=eq.${id}&select=id,bucket_id,assignee_id,status`))[0];

/** Open the Inbox on one task (selected), with the list focused for its keys. */
async function openOn(page: Page, id: string, title: string) {
  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${id}`);
  const row = page.locator(`[data-task-id="${id}"]`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Only you see your Inbox.", { exact: false })).toBeVisible();
  await row.getByRole("button", { name: `${title} ${tag}`, exact: true }).click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

test("1 accepts: filed in a project, assigned to you", async ({ page }) => {
  const id = await inboxTask("Accept me");
  await openOn(page, id, "Accept me");
  // The bottom bar shows the triage row while a task is selected (82b).
  await expect(page.getByRole("toolbar", { name: "Triage" })).toBeVisible();
  await page.keyboard.press("1");
  await page.getByPlaceholder("File in…").fill(`Triage ${tag}`);
  await page.keyboard.press("Enter");
  await expect(page.getByText(`Filed in Triage ${tag}`)).toBeVisible();
  await expect.poll(async () => (await rowOf(id))?.bucket_id).toBe(project.id);
  expect((await rowOf(id))?.assignee_id).toBe(dev.user.id);
});

test("2 declines: your own becomes Won't do", async ({ page }) => {
  const id = await inboxTask("Decline mine");
  await openOn(page, id, "Decline mine");
  await page.keyboard.press("2");
  await expect.poll(async () => (await rowOf(id))?.status).toBe("archived");
});

test("2 declines: someone else's goes back to them with a note", async ({ page }) => {
  const id = await inboxTask("Decline theirs", mate);
  await openOn(page, id, "Decline theirs");
  await page.keyboard.press("2");
  await page.getByRole("textbox", { name: "Note" }).fill(`not mine ${tag}`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rowOf(id))?.assignee_id).toBe(mate.user.id);
  const comments = await rest<Array<{ body: string }>>(
    "service",
    `comments?entity_type=eq.task&entity_id=eq.${id}&select=body`,
  );
  expect(comments.map((c) => c.body)).toContainEqual(expect.stringContaining(`not mine ${tag}`));
});

test("3 marks a duplicate: its comments copied to the original, then Won't do", async ({
  page,
}) => {
  const originalId = crypto.randomUUID();
  await rpc(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { id: originalId, title: `The original ${tag}`, bucket_id: project.id },
  });
  made.push(originalId);
  const id = await inboxTask("Same thing");
  await rpc(dev, "comments_op_add", {
    p_workspace_id: ws.id,
    p_entity_type: "task",
    p_entity_id: id,
    p_body: `seen on Safari ${tag}`,
  });
  await openOn(page, id, "Same thing");
  await page.keyboard.press("3");
  await page.getByPlaceholder("Duplicate of…").fill(`The original ${tag}`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await rowOf(id))?.status).toBe("archived");
  const onOriginal = await rest<Array<{ body: string }>>(
    "service",
    `comments?entity_type=eq.task&entity_id=eq.${originalId}&select=body`,
  );
  const merged = onOriginal
    .map((c) => c.body)
    .find((b) => b.includes(`Merged “Same thing ${tag}”`));
  expect(merged).toContain(`seen on Safari ${tag}`);
});

test("H snoozes until a day; Undo brings it back", async ({ page }) => {
  const id = await inboxTask("Snooze me");
  await openOn(page, id, "Snooze me");
  await page.keyboard.press("h");
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(page.getByText("Snoozed until Tomorrow")).toBeVisible();
  const snoozed = () =>
    page.evaluate(
      ([wsId, taskId]) => {
        const prefs = JSON.parse(window.localStorage.getItem("moduo.preferences") ?? "{}");
        return !!prefs.tasksInbox?.snoozed?.[wsId]?.[taskId];
      },
      [ws.id, id],
    );
  await expect.poll(snoozed).toBe(true);
  // It left the list; the cursor moved on.
  await expect(page.locator(`[data-task-id="${id}"][aria-selected="true"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(snoozed).toBe(false);
});

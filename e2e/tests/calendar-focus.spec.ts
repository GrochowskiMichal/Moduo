import { expect, test } from "@playwright/test";

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
 * CALR-14 (AC23) — focus time holding a task, against the local stack: in Plan,
 * S lifts a task, F turns the lift into focus time, ↵ places it. The grid draws
 * it as the focus band holding the task; a teammate who sees all of the
 * calendar reads it as "Focus time", never the task, and the table (the live
 * channel) never hands them the row.
 *   scripts/agent/e2e.sh tests/calendar-focus.spec.ts
 */

test.use({ locale: "en-US", viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

let dev: Session;
let mate: Session;
let ws: { id: string; inboxId: string };
let tag: string;
let taskId: string;
let grantId: string | null = null;

type EventRow = {
  id: string;
  title: string;
  kind: string;
  focus_task_id: string | null;
  calendar_ref: string | null;
  start_time: string;
  end_time: string;
  deleted_at: string | null;
};

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  mate = await ensureTeammate(ws.id);
  tag = runTag();
  const [task] = await rest<Array<{ id: string }>>("service", "tasks?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      workspace_id: ws.id,
      bucket_id: ws.inboxId,
      owner_id: dev.user.id,
      title: `Investor deck ${tag}`,
      status: "todo",
      due_date: new Date().toISOString().slice(0, 10),
    },
  });
  taskId = task.id;
});

test.afterAll(async () => {
  if (grantId) await rest("service", `resource_grants?id=eq.${grantId}`, { method: "DELETE" });
  await rest("service", `calendar_events?workspace_id=eq.${ws.id}&title=like.*${tag}*`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  await rest("service", `tasks?id=eq.${taskId}`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
});

const focusRows = () =>
  rest<EventRow[]>(
    "service",
    `calendar_events?workspace_id=eq.${ws.id}&title=like.*${tag}*&deleted_at=is.null&select=id,title,kind,focus_task_id,calendar_ref,start_time,end_time,deleted_at`,
  );

test("S then F places focus time holding the task; teammates see Focus time", async ({ page }) => {
  await signInPage(page, dev, ws.id);
  await page.addInitScript(
    ({ userId, workspaceId }) => {
      const key = "moduo:layout:panels-v2";
      const map = JSON.parse(window.localStorage.getItem(key) ?? "{}");
      map.calendar = { left: true, right: true };
      window.localStorage.setItem(key, JSON.stringify(map));
      window.localStorage.setItem(
        `moduo:calendar:panel-variant:${userId}:${workspaceId}`,
        JSON.stringify("tasks"),
      );
    },
    { userId: dev.user.id, workspaceId: ws.id },
  );
  await page.goto("/calendar");
  await expect(page.locator("[data-calendar-grid]")).toBeVisible({ timeout: 20_000 });

  const row = page.locator(`[data-plan-task-id="${taskId}"]`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await page.keyboard.press("s");
  const draft = page.locator("[data-placement-draft]");
  await expect(draft).toBeVisible();
  await page.keyboard.press("f");
  await expect(draft).toHaveAttribute("data-kind", "focus");
  await expect(draft).toContainText(`Focus · Investor deck ${tag}`);
  await page.keyboard.press("Enter");

  await expect.poll(async () => (await focusRows()).length, { timeout: 15_000 }).toBe(1);
  const [focus] = await focusRows();
  expect(focus.kind).toBe("focus");
  expect(focus.focus_task_id).toBe(taskId);
  // Two hours: the task has no estimate.
  expect(Date.parse(focus.end_time) - Date.parse(focus.start_time)).toBe(120 * 60_000);

  const chip = page.locator('[data-chip="event"][data-kind="focus"]', { hasText: tag });
  await expect(chip.first()).toBeVisible({ timeout: 15_000 });
  await expect(chip.first().locator('[data-mark="task"]')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("focus-band.png") });

  // The teammate sees all of the calendar, and still reads "Focus time".
  const [grant] = await rest<Array<{ id: string }>>("service", "resource_grants?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      workspace_id: ws.id,
      resource_type: "calendar",
      resource_id: focus.calendar_ref,
      subject_type: "member",
      subject_id: mate.user.id,
      level: "view",
      created_by: dev.user.id,
    },
  });
  grantId = grant.id;
  const from = new Date(Date.parse(focus.start_time) - 86_400_000).toISOString();
  const to = new Date(Date.parse(focus.end_time) + 86_400_000).toISOString();
  const seen = await rpc<EventRow[]>(mate, "calendar_events_visible", {
    p_workspace_id: ws.id,
    p_from: from,
    p_to: to,
  });
  const theirs = seen.find((e) => e.id === focus.id);
  expect(theirs?.title).toBe("Focus time");
  expect(theirs?.focus_task_id).toBeNull();
  expect(seen.some((e) => e.title.includes(tag))).toBe(false);
  expect(await rest<unknown[]>(mate, `calendar_events?id=eq.${focus.id}&select=id`)).toEqual([]);
});

import { expect, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 AC2.4 — a reminder reaches you (TV-D12), against the local stack:
 * the sender delivers it to your bell (and to your devices' delivery feed),
 * and a browser that said no to notifications says so in Settings while the
 * bell still shows the reminder. Run it with the stack up and a dev server:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/reminders.spec.ts
 * The desktop app with its window closed and a real browser push can't run
 * here: they're on the block's "verify before release" list.
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

test("a reminder you set reaches your bell, and a browser that said no says so", async ({
  page,
}) => {
  const title = `Call Anna ${tag}`;
  const task = await rpc<{ id: string }>(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { title, bucket_id: ws.inboxId },
  });
  await rpc(dev, "tasks_op_reminder_add", {
    p_workspace_id: ws.id,
    p_task_id: task.id,
    p_kind: "at",
    p_at: new Date(Date.now() - 60_000).toISOString(),
  });
  // The minute job's work, run now.
  await rpc("service", "tasks__fire_reminders", { p_now: new Date().toISOString(), p_limit: 500 });
  const deliveries = await rest<{ title: string }[]>(
    dev,
    `notice_deliveries?task_id=eq.${task.id}&select=title`,
  );
  expect(deliveries.map((d) => d.title)).toEqual([title]);

  // This browser said no to notifications.
  await page.addInitScript(() => {
    if ("Notification" in window) {
      Object.defineProperty(Notification, "permission", { get: () => "denied" });
    }
  });
  await signInPage(page, dev, ws.id);
  await page.goto("/settings?section=preferences");
  await expect(page.getByText("Not allowed by the browser", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.press("Escape");

  await page.goto("/tasks");
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByText(`reminded you about “${title}”`)).toBeVisible({ timeout: 15_000 });
});

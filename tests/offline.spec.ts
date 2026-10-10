import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  rest,
  runTag,
  type Session,
  signIn,
  signInPage,
  stackKeys,
} from "./support/local-stack";

/**
 * Tasks v3 AC12.2 — the shared store offline (TV-D11a, default g), against
 * the local stack:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/offline.spec.ts
 * Opening with the server out of reach shows the device copy, read-only; a
 * capture and a check-off made offline wait ("2 waiting to sync") and are
 * sent in order once the network is back, without duplicates.
 */

type TaskRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

async function createTask(title: string): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>(dev, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: ws.inboxId,
      title,
      status: "todo",
      owner_id: dev.user.id,
      assignee_id: dev.user.id,
      position: `z${tag}${title}`,
    },
  });
  return row;
}

const tasksTitled = (title: string) =>
  rest<TaskRow[]>(
    "service",
    `tasks?title=eq.${encodeURIComponent(title)}&deleted_at=is.null&select=id,title,status,created_at,completed_at`,
  );

async function openInbox(page: Page) {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await expect(page.getByRole("navigation", { name: "Location" })).toBeVisible({ timeout: 20_000 });
}

/** The device copy is written a moment after the store settles. */
async function waitForDeviceCopy(page: Page, title: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          ([key, wanted]) =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open("moduo-sync");
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains("workspaces")) return resolve(false);
                const get = db.transaction("workspaces").objectStore("workspaces").get(key);
                get.onerror = () => resolve(false);
                get.onsuccess = () => {
                  const rows = (get.result?.tables?.tasks?.rows ?? []) as { title: string }[];
                  resolve(rows.some((r) => r.title === wanted));
                };
              };
            }),
          [`${dev.user.id}:${ws.id}`, title],
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

test("AC12.2 — with the server out of reach, Tasks opens from the device copy, read-only", async ({
  page,
}) => {
  const seeded = await createTask(`On this device ${tag}`);
  await openInbox(page);
  await expect(page.getByRole("button", { name: seeded.title })).toBeVisible({ timeout: 20_000 });
  await waitForDeviceCopy(page, seeded.title);

  // Every request to the stack fails as a lost connection; the app itself
  // still loads (the desktop app ships it; here the dev server serves it).
  const { url } = stackKeys();
  await page.route(`${url}/**`, (route) => route.abort("internetdisconnected"));
  await page.reload();
  await expect(page.getByRole("button", { name: seeded.title })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-slot="sync-status"]')).toContainText("Offline");

  // Read-only: an edit other than a capture or a check-off says "Offline".
  await page.getByRole("button", { name: seeded.title }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  await expect(page.getByText("Offline", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: seeded.title })).toBeVisible();
  await page.unroute(`${url}/**`);
});

test("AC12.2 — a capture and a check-off made offline wait, then sync in order without duplicates", async ({
  page,
  context,
}) => {
  const seeded = await createTask(`Check me off ${tag}`);
  const captured = `Captured offline ${tag}`;
  await openInbox(page);
  const row = page.getByRole("button", { name: seeded.title });
  await expect(row).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  const status = page.locator('[data-slot="sync-status"]');
  await expect(status).toContainText("Offline");

  // A capture (⌘⇧K): kept on the device, shown at once.
  await page.keyboard.press("ControlOrMeta+Shift+K");
  const line = page.getByRole("dialog").getByRole("textbox").first();
  await line.fill(captured);
  await line.press("Enter");
  await expect(page.getByText("Waiting to sync · Inbox")).toBeVisible();
  await expect(page.getByRole("button", { name: captured })).toBeVisible();

  // A check-off: shown done at once.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mark done" }).click();
  await expect(status).toContainText("Offline · 2 waiting to sync");
  expect(await tasksTitled(captured)).toHaveLength(0);

  // Back online: sent in order, once each.
  await context.setOffline(false);
  await expect(status).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => (await tasksTitled(captured)).length, { timeout: 15_000 }).toBe(1);
  await expect
    .poll(async () => (await tasksTitled(seeded.title))[0]?.status, { timeout: 15_000 })
    .toBe("done");
  const [created] = await tasksTitled(captured);
  const [done] = await tasksTitled(seeded.title);
  expect(Date.parse(created.created_at)).toBeLessThanOrEqual(Date.parse(done.completed_at ?? ""));

  // A reload (the store reads the server again) still has exactly one.
  await page.reload();
  await expect(page.getByRole("button", { name: captured })).toHaveCount(1, { timeout: 20_000 });
  expect(await tasksTitled(captured)).toHaveLength(1);
});

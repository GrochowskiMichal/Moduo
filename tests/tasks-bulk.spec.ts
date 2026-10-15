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
 * Tasks v3 TV-U12 — "bottom-bar row and Mixed panel" (AC11.9, AC4.6): four
 * selected tasks turn the bottom bar into Complete · Focus · Assign · Tag ·
 * Date · Delete · More with "4 selected · Esc", the panel reads "4 tasks"
 * with Mixed where they differ, and one change there is one Undo for all
 * four. (A read-only task named in "3 of 4 changed" is the module test's,
 * `use-tasks-module.bulk.test.tsx`.) Run it like the other Tasks specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/tasks-bulk.spec.ts
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
let project: { id: string };
const ids: string[] = [];

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  [project] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      owner_id: dev.user.id,
      name: `Bulk ${tag}`,
      position: `z${tag}`,
    },
  });
  // Two with a priority, two without: the panel's Priority reads Mixed.
  const priorities = ["low", null, "low", null];
  for (const [i, priority] of priorities.entries()) {
    const id = crypto.randomUUID();
    await rpc(dev, "tasks_op_create", {
      p_workspace_id: ws.id,
      p_task: {
        id,
        title: `Bulk ${i + 1} ${tag}`,
        bucket_id: project.id,
        position: `${i}`,
        ...(priority ? { priority } : {}),
      },
    });
    ids.push(id);
  }
});

test.afterAll(async () => {
  const at = new Date().toISOString();
  await rest("service", `tasks?bucket_id=eq.${project.id}`, {
    method: "PATCH",
    body: { deleted_at: at },
  });
  await rest("service", `buckets?id=eq.${project.id}`, {
    method: "PATCH",
    body: { deleted_at: at },
  });
});

test("bottom-bar row and Mixed panel: one Undo for the whole change", async ({ page }) => {
  const priorities = async () => {
    const rows = await rest<Array<{ id: string; priority: string | null }>>(
      "service",
      `tasks?id=in.(${ids.join(",")})&select=id,priority`,
    );
    return ids.map((id) => rows.find((r) => r.id === id)?.priority ?? null);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${ids[0]}`);
  const row = (i: number) => page.locator(`[role="row"][data-task-id="${ids[i]}"]`);
  await expect(row(0)).toBeVisible({ timeout: 20_000 });

  // ⇧-click selects the range, in the List's order.
  await row(0).click();
  await row(3).click({ modifiers: ["Shift"] });
  for (const i of [0, 1, 2, 3]) await expect(row(i)).toHaveAttribute("aria-selected", "true");

  // The bar's centre is the selection's row (82b): six with their keys, then More.
  const bar = page.getByRole("toolbar", { name: "4 tasks selected" });
  await expect(bar).toBeVisible();
  for (const label of ["Complete", "Focus", "Assign", "Tag", "Date", "Delete", "More"]) {
    await expect(bar.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  await expect(bar.getByText("4 selected · Esc")).toBeVisible();

  // The panel: "4 tasks", with Mixed where they differ.
  const expand = page.getByRole("button", { name: "Expand right panel" });
  if (await expand.isVisible()) await expand.click();
  const panel = page.getByTestId("bulk-panel");
  // "4 tasks ▾" is the panel's title row, its menu still the panel's views (MOD-109).
  await expect(page.getByRole("button", { name: "Panel view: 4 tasks" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "Selected tasks" })).toBeVisible();
  const priority = panel.locator('[data-slot="property-row"]', { hasText: "Priority" });
  await expect(priority.getByRole("button")).toHaveText("Mixed");

  // One change from the panel sets all four; one Undo puts all four back.
  await priority.getByRole("button").click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  await expect.poll(priorities).toEqual(["high", "high", "high", "high"]);
  await expect(priority.getByRole("button")).toHaveText("High");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(priorities).toEqual(["low", null, "low", null]);

  // Esc goes back to one task: the bar's own tools return.
  await row(1).click();
  await row(2).click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toBeHidden();
  await expect(page.getByRole("toolbar", { name: "2 tasks selected" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Global actions" })).toBeVisible();
});

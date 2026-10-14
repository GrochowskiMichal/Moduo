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
 * Tasks v3 TV-U8 — saved views on the real app, against the local stack
 * (AC11.1; REPLAN 29b–29e, 29d): Save as view… from All, the view in the
 * sidebar's Views group, a Display change shows "Unsaved changes" and Save
 * keeps it, the view reopens as saved, Pin puts it in Pinned, a `?view=` link
 * opens it, and Delete has Undo. Run as the teammate, so the dev's sidebar
 * stays as it was. Run it serially, like the other specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8136
 *   E2E_BASE_URL=http://127.0.0.1:8136 bunx playwright test --project=e2e tests/tasks-views.spec.ts
 */

test.use({ locale: "en-US" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

let mate: Session;
let ws: { id: string; inboxId: string };
let tag: string;
/** The teammate's preferences before this run, put back after it. */
let savedPrefs: Record<string, unknown> | null = null;

test.beforeAll(async () => {
  const dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  mate = await ensureTeammate(ws.id);
  tag = runTag();
  const [row] = await rest<Array<{ preferences: Record<string, unknown> }>>(
    "service",
    `user_preferences?user_id=eq.${mate.user.id}&select=preferences`,
  );
  savedPrefs = row?.preferences ?? null;
});

test.afterAll(async () => {
  await rest("service", `task_views?owner_id=eq.${mate.user.id}&name=like.*${tag}*`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
  if (savedPrefs) {
    await rest("service", `user_preferences?user_id=eq.${mate.user.id}`, {
      method: "PATCH",
      body: { preferences: savedPrefs, preferences_updated_at: new Date().toISOString() },
    });
  }
});

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Tasks" });
const viewRow = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name, exact: true });

async function openTasks(page: Page) {
  await signInPage(page, mate, ws.id);
  await page.goto("/tasks");
  await expect(sidebar(page).getByRole("button", { name: /^All/ })).toBeVisible({
    timeout: 30_000,
  });
}

async function rowMenu(page: Page, name: string) {
  // The Views group's row (a pinned copy comes first).
  await sidebar(page)
    .getByRole("button", { name: `${name} options` })
    .last()
    .click();
}

test("save All as a view, change its Display, save, reopen it as saved", async ({ page }) => {
  const name = `Board ${tag}`;
  await openTasks(page);
  await sidebar(page).getByRole("button", { name: /^All/ }).click();
  await expect(page.getByRole("heading", { name: "All" })).toBeVisible();

  // Save as view… in the toolbar's ⋯.
  await page.getByRole("button", { name: "More view options" }).click();
  await page.getByRole("menuitem", { name: "Save as view…" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as view" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "View name" }).fill(name);
  await dialog.getByRole("button", { name: "Save view" }).click();
  await expect(dialog).toBeHidden();

  // It opens, and sits in the Views group.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(sidebar(page).getByText("Views", { exact: true })).toBeVisible();
  await expect(viewRow(page, name)).toBeVisible();

  // A Display change is unsaved until Save.
  await page.getByRole("radio", { name: "Board view" }).click();
  const changes = page.getByTestId("view-changes");
  await expect(changes).toContainText("Unsaved changes");
  await changes.getByRole("button", { name: "Save", exact: true }).click();
  await expect(changes).toBeHidden();

  // Away and back: it opens as saved.
  await sidebar(page)
    .getByRole("button", { name: /^Inbox/ })
    .click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await viewRow(page, name).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Board view" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Revert puts back what it saved.
  await page.getByRole("radio", { name: "List view" }).click();
  await expect(changes).toBeVisible();
  await changes.getByRole("button", { name: "Revert" }).click();
  await expect(changes).toBeHidden();
  await expect(page.getByRole("radio", { name: "Board view" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("pin a view, open it by its link, delete it with Undo", async ({ page }) => {
  const name = `Board ${tag}`;
  const [saved] = await rest<Array<{ id: string }>>(
    "service",
    `task_views?owner_id=eq.${mate.user.id}&name=eq.${encodeURIComponent(name)}&select=id`,
  );
  expect(saved?.id).toBeTruthy();
  await openTasks(page);

  // Pin.
  await rowMenu(page, name);
  await page.getByRole("menuitem", { name: "Pin to sidebar" }).click();
  await expect(sidebar(page).getByText("Pinned", { exact: true })).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name, exact: true })).toHaveCount(2);

  // The link opens it, then leaves the URL.
  await page.goto(`/tasks?view=${saved!.id}`);
  await expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/view=/);

  // Delete, then Undo.
  await rowMenu(page, name);
  await page.getByRole("menuitem", { name: "Delete view" }).click();
  await expect(sidebar(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(sidebar(page).getByRole("button", { name, exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
});

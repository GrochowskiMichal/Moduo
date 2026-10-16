import { type Browser, expect, type Page, test } from "@playwright/test";

import { rest, runTag, type Session, signIn, signInPage, stackKeys } from "./support/local-stack";

/**
 * Tasks v3 TV-U17 · "role question and welcome once" (AC2–AC7 defaults,
 * AC11.1), on the real app against the local stack: a new person who owns an
 * empty workspace gets the role question, then Tasks' welcome with Learn more
 * / Explore on your own; the role sets the first view and the rows; their Inbox
 * holds three teaching tasks; the welcome shows once per person, not per
 * device, and reopens from the sidebar's ⋯ and from Help. A PM's answer adds
 * the Project kickoff starter. Run it like the other Tasks specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8139
 *   E2E_BASE_URL=http://127.0.0.1:8139 bunx playwright test --project=e2e tests/onboarding.spec.ts
 * It uses its own person (newbie@moduo.local), reset before each test.
 */

test.use({ locale: "en-US", viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const NEWBIE = { email: "newbie@moduo.local", password: "localnewbie", name: "Nova Newbie" };

let newbie: Session;

/** The throwaway person, created once; their preferences start empty. */
async function ensureNewbie(): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === NEWBIE.email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: NEWBIE.email,
        email_confirm: true,
        user_metadata: { full_name: NEWBIE.name, display_name: NEWBIE.name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  // The stack blanks passwords on insert (prod signs in by code); set one after.
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: admin,
    body: JSON.stringify({ password: NEWBIE.password }),
  });
  return signIn(NEWBIE);
}

/** A fresh, empty workspace of theirs (the earlier ones go), and no onboarding yet. */
async function freshStart(who: Session): Promise<string> {
  await rest("service", `workspaces?owner_id=eq.${who.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  // An empty domain is "never synced" (gotchas/supabase.md, Prefs sync).
  await rest("service", `user_preferences?user_id=eq.${who.user.id}`, {
    method: "PATCH",
    body: { preferences: {} },
  });
  const [ws] = await rest<Array<{ id: string }>>(who, "workspaces", {
    method: "POST",
    body: { name: `Newbie ${runTag()}`, owner_id: who.user.id },
  });
  return ws.id;
}

async function onboarding(who: Session): Promise<Record<string, unknown>> {
  const [row] = await rest<Array<{ preferences: { tasksOnboarding?: Record<string, unknown> } }>>(
    "service",
    `user_preferences?user_id=eq.${who.user.id}&select=preferences`,
  );
  return row?.preferences?.tasksOnboarding ?? {};
}

async function openTasks(page: Page, who: Session, workspaceId: string) {
  await signInPage(page, who, workspaceId, { welcome: true });
  await page.goto("/tasks");
}

async function newDevice(browser: Browser, who: Session, workspaceId: string): Promise<Page> {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await openTasks(page, who, workspaceId);
  return page;
}

const welcome = (page: Page) => page.locator('[data-slot="tasks-welcome"]');

test.beforeAll(async () => {
  newbie = await ensureNewbie();
});

test("a new person: the role question, the welcome once, teaching tasks, reopen", async ({
  page,
  browser,
}) => {
  const ws = await freshStart(newbie);
  await openTasks(page, newbie, ws);

  // ── The role question first, then the basics ─────────────────────────────
  await expect(page.getByRole("heading", { name: "What will you run in Moduo?" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /^Software/ }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Tasks" })).toBeVisible();
  await expect(welcome(page).getByRole("button", { name: "Explore on your own" })).toBeVisible();

  // ── Learn more: three steps, Back / Next, dots ───────────────────────────
  await welcome(page).getByRole("button", { name: "Learn more" }).click();
  await expect(page.getByRole("heading", { name: "Above the line is yours" })).toBeVisible();
  await expect(welcome(page).locator('[data-slot="welcome-clip"] img').first()).toBeAttached();
  await welcome(page).getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Line things up in Focus" })).toBeVisible();
  await welcome(page).getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Above the line is yours" })).toBeVisible();
  await welcome(page).getByRole("button", { name: "Next" }).click();
  await welcome(page).getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "@, # and / work everywhere" })).toBeVisible();
  await welcome(page).getByRole("button", { name: "Done" }).click();
  await expect(welcome(page)).toHaveCount(0);

  // ── The owner's empty workspace: three teaching tasks in the Inbox ───────
  const inbox = page.getByRole("main");
  await expect(inbox.getByText(/anywhere to capture a task/)).toBeVisible({ timeout: 15_000 });
  await expect(inbox.getByText(/in a task’s name to assign, tag or date it/)).toBeVisible();
  await expect(inbox.getByText(/to line it up in Focus/)).toBeVisible();

  // ── Synced: the role and "seen" follow the person ─────────────────────────
  await expect
    .poll(async () => (await onboarding(newbie)).role, { timeout: 15_000 })
    .toBe("developer");
  expect((await onboarding(newbie)).welcomeSeenAt).toBeTruthy();

  // ── Once per person: not on a reload, not on another device ──────────────
  await page.reload();
  await expect(inbox.getByText(/anywhere to capture a task/)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await expect(welcome(page)).toHaveCount(0);
  const other = await newDevice(browser, newbie, ws);
  await expect(other.getByRole("main").getByText(/anywhere to capture a task/)).toBeVisible({
    timeout: 30_000,
  });
  await other.waitForTimeout(1_500);
  await expect(welcome(other)).toHaveCount(0);
  await other.context().close();

  // ── Reopens from the sidebar's ⋯ and from Help, at the basics ────────────
  await page.getByRole("button", { name: "Sidebar options" }).click({ force: true });
  await page.getByRole("menuitem", { name: "What’s in Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Tasks" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(welcome(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "What’s in Tasks" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Tasks" })).toBeVisible();
  await welcome(page).getByRole("button", { name: "Explore on your own" }).click();
  await expect(welcome(page)).toHaveCount(0);
});

test("a PM's answer opens All (no project yet) and adds the Project kickoff starter", async ({
  page,
}) => {
  const ws = await freshStart(newbie);
  await openTasks(page, newbie, ws);
  await expect(page.getByRole("heading", { name: "What will you run in Moduo?" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /^Projects for a team/ }).click();
  await expect(page.getByText(/Project kickoff is in your templates/)).toBeVisible({
    timeout: 15_000,
  });
  const rows = await rest<Array<{ name: string; shared: boolean }>>(
    "service",
    `project_templates?workspace_id=eq.${ws}&owner_id=eq.${newbie.user.id}&select=name,shared`,
  );
  expect(rows).toEqual([{ name: "Project kickoff", shared: false }]);
  await welcome(page).getByRole("button", { name: "Explore on your own" }).click();
  // All, with no projects yet, says how to make one.
  await expect(page.getByText("No projects yet")).toBeVisible();
});

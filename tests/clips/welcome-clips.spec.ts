import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

import {
  endFocusRuns,
  markWelcomeSeen,
  rest,
  rpc,
  type Session,
  signIn,
  signInPage,
  stackKeys,
} from "../support/local-stack";

/**
 * Tasks' welcome clips (TV-U17, REPLAN 34: "recorded from the real app by
 * script, so they can be regenerated whenever the UI changes"). Each step of
 * the welcome loops a few frames of the whole window, bottom bar included,
 * taken here from the real app with a tidy sample workspace. It writes
 * public/welcome/tasks-<step>-<frame>.jpg (the names WELCOME_CLIPS lists in
 * src/features/tasks/ui/tasks-welcome-dialog.tsx). Run it on a Mac (it
 * shrinks the frames with `sips`) against the local stack:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8139
 *   MODUO_CLIPS=1 E2E_BASE_URL=http://127.0.0.1:8139 bunx playwright test --project=clips
 * It uses its own person (studio@moduo.local) and a fresh workspace each run.
 */

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/welcome");
const STUDIO = { email: "studio@moduo.local", password: "localstudio", name: "Sam Rivera" };

test.use({ locale: "en-US", viewport: { width: 1280, height: 720 }, colorScheme: "dark" });
test.describe.configure({ mode: "serial", timeout: 180_000 });

let me: Session;
let ws: string;
let inbox: string;

async function ensureStudio(): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === STUDIO.email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: STUDIO.email,
        email_confirm: true,
        user_metadata: { full_name: STUDIO.name, display_name: STUDIO.name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers: admin,
    body: JSON.stringify({ password: STUDIO.password }),
  });
  await rest("service", `profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: { display_name: STUDIO.name },
  });
  return signIn(STUDIO);
}

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

/** A tidy workspace: a few projects with dated work, an Inbox, a tag. */
async function sampleWorkspace(who: Session): Promise<{ ws: string; inbox: string }> {
  await rest("service", `workspaces?owner_id=eq.${who.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  const [row] = await rest<Array<{ id: string }>>(who, "workspaces", {
    method: "POST",
    body: { name: "Studio", owner_id: who.user.id },
  });
  const projects: Record<string, string> = {};
  for (const [name, color] of [
    ["Website relaunch", "blue"],
    ["Autumn launch", "green"],
    ["Hiring", "amber"],
  ] as const) {
    const id = crypto.randomUUID();
    await rpc(who, "projects_op_create", {
      p_workspace_id: row.id,
      p_project: { id, name, color },
    });
    projects[name] = id;
  }
  const task = (title: string, bucket: string | null, extra: Record<string, unknown> = {}) =>
    rpc(who, "tasks_op_create", {
      p_workspace_id: row.id,
      p_task: {
        id: crypto.randomUUID(),
        title,
        ...(bucket ? { bucket_id: bucket } : {}),
        ...extra,
      },
    });
  const site = projects["Website relaunch"];
  const launch = projects["Autumn launch"];
  const hiring = projects.Hiring;
  await task("Draft the homepage copy", site, { due_on: day(0) });
  await task("Review the pricing page", site, { due_on: day(1) });
  await task("Pick the hero photo", site, { due_on: day(3) });
  await task("Send the launch email", launch, { due_on: day(2) });
  await task("Record the demo video", launch, { due_on: day(4) });
  await task("Plan the launch-day posts", launch);
  await task("Interview: product designer", hiring, { due_on: day(1) });
  await task("Write the role description", hiring);
  for (const [name, color] of [
    ["launch", "green"],
    ["design", "blue"],
  ] as const) {
    await rest(who, "tags", {
      method: "POST",
      body: { workspace_id: row.id, owner_id: who.user.id, name, color },
    });
  }
  // The Inbox is made on the workspace's first open; these go in after it.
  return { ws: row.id, inbox: "" };
}

async function inboxOf(who: Session, workspaceId: string): Promise<string> {
  const [row] = await rest<Array<{ id: string }>>(
    "service",
    `buckets?workspace_id=eq.${workspaceId}&owner_id=eq.${who.user.id}&is_system=eq.true&select=id`,
  );
  return row?.id ?? "";
}

async function frame(page: Page, step: number, n: number) {
  mkdirSync(OUT, { recursive: true });
  // No hover states or tooltips; let fades settle: the app at rest.
  await page.mouse.move(2, 718);
  await page.waitForTimeout(600);
  const path = resolve(OUT, `tasks-${step}-${n}.jpg`);
  await page.screenshot({ path, type: "jpeg", quality: 82 });
  // 960 px wide is plenty for a 576 px dialog at 2× density, and small.
  execFileSync("sips", ["--resampleWidth", "960", "-s", "formatOptions", "70", path], {
    stdio: "ignore",
  });
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Tasks" });
/** A sidebar row by its label (Chromium puts a space before ", 3 open"). */
const row = (page: Page, label: string) =>
  nav(page).getByRole("button", { name: new RegExp(`^${label}\\s*(,|$)`) });
const main = (page: Page) => page.getByRole("main");

test.beforeAll(async () => {
  me = await ensureStudio();
  await endFocusRuns(me.user.id);
  ({ ws } = await sampleWorkspace(me));
  await markWelcomeSeen(me.user.id);
});

test.afterAll(async () => {
  await endFocusRuns(me.user.id);
});

test("records the welcome's three clips", async ({ page }) => {
  await signInPage(page, me, ws);
  await page.goto("/tasks");
  await expect(row(page, "Inbox")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => inboxOf(me, ws), { timeout: 15_000 }).not.toBe("");
  inbox = await inboxOf(me, ws);
  for (const title of ["Reply to Anna about the brief", "Book the photographer"]) {
    await rpc(me, "tasks_op_create", {
      p_workspace_id: ws,
      p_task: { id: crypto.randomUUID(), title, bucket_id: inbox },
    });
  }
  await page.reload();

  // ── 1 · Above the line is yours, below it is shared ─────────────────────
  await row(page, "Inbox").click();
  await expect(main(page).getByText("Reply to Anna about the brief")).toBeVisible({
    timeout: 30_000,
  });
  await frame(page, 1, 1);
  await row(page, "Upcoming").click();
  await expect(main(page).getByText("Draft the homepage copy")).toBeVisible();
  await frame(page, 1, 2);
  await row(page, "All").click();
  await expect(main(page).getByText("Write the role description")).toBeVisible();
  await frame(page, 1, 3);

  // ── 2 · Line things up in Focus and work through them ─────────────────────
  await row(page, "Website relaunch").click();
  const homepage = main(page).getByText("Draft the homepage copy");
  await homepage.click();
  await frame(page, 2, 1);
  await page.keyboard.press("q");
  await main(page).getByText("Review the pricing page").click();
  await page.keyboard.press("q");
  await row(page, "Focus").click();
  await expect(main(page).getByText("Draft the homepage copy").first()).toBeVisible();
  await frame(page, 2, 2);
  await main(page)
    .getByRole("button", { name: /^Start/ })
    .first()
    .click();
  await page.waitForTimeout(2_500);
  await frame(page, 2, 3);
  await endFocusRuns(me.user.id);

  // ── 3 · @ assigns, files and links · # tags · / runs commands ────────────
  await row(page, "Inbox").click();
  await page.keyboard.press("Meta+Shift+K");
  const capture = page.getByRole("dialog", { name: "Capture" });
  await expect(capture).toBeVisible();
  await capture.getByRole("textbox", { name: "Task title" }).click();
  await page.keyboard.type("Call Anna about the launch ", { delay: 20 });
  await frame(page, 3, 1);
  await page.keyboard.type("@Aut", { delay: 40 });
  await frame(page, 3, 2);
  await page.keyboard.press("Enter");
  await page.keyboard.type(" #lau", { delay: 40 });
  await frame(page, 3, 3);
  await page.keyboard.press("Enter");
  await page.keyboard.type(" /tom", { delay: 40 });
  await frame(page, 3, 4);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

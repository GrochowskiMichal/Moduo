import { expect, test } from "@playwright/test";

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
 * Tasks v3 TV-U16 — a project's overview (spec §3, REPLAN 16 and 78, AC6.6),
 * against the local stack: someone opening a prepared project sees its
 * description, "Done this month · 1 · 45m" and what's next; editing the
 * description saves it; marking it Done with open work asks "Won't do · Move ·
 * Keep" first.
 *   bun run local:up
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8141
 *   E2E_BASE_URL=http://127.0.0.1:8141 bunx playwright test --project=e2e tests/project-overview.spec.ts
 * Who may write the description, and archived team defaults, are proven in SQL
 * (supabase/tests/project_overview.test.sql).
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

/** The projects this run made, soft-deleted at the end (with their tasks and the
 *  Inbox ones tagged with this run) so the shared dev workspace stays under
 *  the app's 500-project first-load read. */
const created: string[] = [];

test.afterAll(async () => {
  await removeRun(ws.id, tag, created);
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const createTask = async (projectId: string, title: string) => {
  const rows = await rpc<Array<{ id: string }> | { id: string }>(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { title, bucket_id: projectId },
  });
  return Array.isArray(rows) ? rows[0]!.id : rows.id;
};

test("the overview orients a newcomer, edits the description, and asks before Done", async ({
  page,
}) => {
  const project = await rpc<{ id: string }>(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: {
      name: `Kit ${tag}`,
      description: "Build something with the API.\nJudging on Sunday.",
    },
  });
  created.push(project.id);
  const done = await createTask(project.id, `Read the docs ${tag}`);
  await createTask(project.id, `Pick a problem ${tag}`);
  await rpc(dev, "tasks_op_set_status", {
    p_workspace_id: ws.id,
    p_task_id: done,
    p_status: "done",
  });
  await rpc(dev, "tasks_op_track_time", {
    p_workspace_id: ws.id,
    p_task_id: done,
    p_action: "add",
    p_seconds: 2700,
    p_on: today(),
  });

  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${project.id}`);
  await page.getByRole("button", { name: /^Panel view:/ }).click({ timeout: 20_000 });
  await page.getByRole("menuitemradio", { name: /Project/ }).click();

  // What it is, how far it is (AC6.6) and what's next. The first line waits for
  // the store: until it has loaded the page is the Inbox's "Loading tasks"
  // skeleton and the panel says "No project here".
  const nextUp = page.getByRole("button", { name: `To do Pick a problem ${tag}`, exact: true });
  await expect(page.getByText("Judging on Sunday.", { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Done this month · 1 · 45m")).toBeVisible();
  await expect(nextUp).toBeVisible();

  // The description saves through the op.
  await page.getByRole("button", { name: "Edit description" }).click();
  const field = page.getByRole("textbox", { name: "Project description" });
  await field.press("End");
  await field.pressSequentially(" Bring a laptop.");
  await field.press("ControlOrMeta+Enter");
  await expect(page.getByText("Bring a laptop.", { exact: false })).toBeVisible();
  await expect
    .poll(async () => {
      const [row] = await rest<Array<{ description: string }>>(
        "service",
        `buckets?id=eq.${project.id}&select=description`,
      );
      return row?.description ?? "";
    })
    .toContain("Bring a laptop.");

  // Done with open work asks once (REPLAN 78); Keep marks it done.
  await page.getByRole("button", { name: "Status: Active" }).click();
  await page.getByRole("menuitemradio", { name: "Done" }).click();
  const ask = page.getByRole("dialog", { name: `Mark “Kit ${tag}” done?` });
  await expect(ask.getByText("1 open task — Won’t do · Move · Keep")).toBeVisible();
  await ask.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByRole("button", { name: "Status: Done" })).toBeVisible();
  await expect
    .poll(async () => {
      const [row] = await rest<Array<{ status: string }>>(
        "service",
        `buckets?id=eq.${project.id}&select=status`,
      );
      return row?.status;
    })
    .toBe("done");
  // Keep leaves the open task open (Done never hides or closes tasks).
  await expect(nextUp).toBeVisible();
});

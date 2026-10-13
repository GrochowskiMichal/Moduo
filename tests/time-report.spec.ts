import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 AC6.1–6.2 — "Add time…" and the time report (TV-D14), against the
 * local stack: time logged in the task's Time field lands in your entries,
 * and the project's report exports CSV and its print layout (the PDF).
 *   bun run local:up
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8141
 *     (with PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY from `supabase status`)
 *   E2E_BASE_URL=http://127.0.0.1:8141 bunx playwright test --project=e2e tests/time-report.spec.ts
 * Who sees whose time, and hidden tasks, are proven in SQL
 * (supabase/tests/time_report.test.sql). The desktop app's print dialog is on
 * the block's "verify before release" list.
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

const day = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("Add time logs an entry, and the report exports CSV and its print layout", async ({
  page,
}) => {
  const project = await rpc<{ id: string }>(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: { name: `Billable ${tag}` },
  });
  const rows = await rpc<Array<{ id: string }> | { id: string }>(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { title: `Homepage ${tag}`, bucket_id: project.id },
  });
  const taskId = Array.isArray(rows) ? rows[0]!.id : rows.id;
  await rpc(dev, "tasks_op_track_time", {
    p_workspace_id: ws.id,
    p_task_id: taskId,
    p_action: "add",
    p_seconds: 2700,
    p_on: day(2),
    p_note: "First pass",
  });

  // The PDF is the print layout: record what printing would put on paper.
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[] };
    w.__printed = [];
    window.print = () => {
      w.__printed.push(document.querySelector("[data-print-root]")?.textContent ?? "");
    };
  });
  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${taskId}`);

  // AC6.1: "Add time… 2h yesterday" is one dated entry.
  await page.getByRole("button", { name: /^Estimate:/ }).click({ timeout: 20_000 });
  const line = page.getByPlaceholder("2h yesterday · call with Anna");
  await line.fill("2h yesterday kickoff call");
  await expect(page.getByText("2h · Yesterday · kickoff call")).toBeVisible();
  await line.press("Enter");
  await expect(page.getByText("Your entries")).toBeVisible();
  await expect(page.getByText("kickoff call", { exact: false }).last()).toBeVisible();
  await page.keyboard.press("Escape");

  // AC6.2: the project's report, then its CSV and its print layout.
  await page.getByRole("button", { name: "Panel view: Details" }).click();
  await page.getByRole("menuitemradio", { name: /Project/ }).click();
  await page.getByRole("button", { name: "Time report" }).click();
  const sheet = page.getByRole("dialog", { name: "Time report" });
  await expect(sheet.getByText(`Homepage ${tag}`)).toBeVisible();
  await expect(sheet.getByText("Total 2h 45m")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    sheet.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  const file = readFileSync((await download.path()) as string, "utf8");
  // A byte-order mark first, so spreadsheets read it as UTF-8.
  expect(file.startsWith("﻿")).toBe(true);
  const csv = file.slice(1).split("\r\n");
  expect(csv[0]).toBe("Project,Task,Hours,Duration,Notes");
  expect(csv[1]).toBe(`Billable ${tag},Homepage ${tag},2.75,2h 45m,First pass; kickoff call`);
  expect(csv[2]).toBe("Total,,2.75,2h 45m,");

  await sheet.getByRole("button", { name: "Export PDF" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed))
    .toHaveLength(1);
  const printed = await page.evaluate(
    () => (window as unknown as { __printed: string[] }).__printed[0] ?? "",
  );
  expect(printed).toContain(`Billable ${tag}`);
  expect(printed).toContain(`Homepage ${tag}`);
  expect(printed).toContain("2h 45m");
  expect(printed).toContain("Made with Moduo");

  // On paper the layout is the only thing there, light whatever the app's theme.
  await page.emulateMedia({ media: "print" });
  const paper = page.locator("[data-print-root]");
  await expect(paper).toBeVisible();
  await expect(page.locator("#root")).toBeHidden();
  await expect(paper).toHaveAttribute("data-theme", "light");
  await expect(paper.getByText("Time report", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await expect(paper).toBeHidden();
});

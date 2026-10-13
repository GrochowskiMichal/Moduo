import { expect, type Page, test } from "@playwright/test";

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
 * Tasks v3 TV-TL1 — "rows follow scope; points and spans" (AC9.1–9.4, AC4.3,
 * AC2.3) on the real app, against the local stack:
 *   - All: one row per project (no task rows until one is expanded); a
 *     project with both dates is a solid bar, one without dates an outline
 *     worked out from its tasks;
 *   - inside a project: its sections on their own rows, a range as a band,
 *     an end date as a diamond, each task a point on its due day;
 *   - nothing on the canvas is rotated (46a).
 * Run it like the other Tasks specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/tasks-timeline.spec.ts
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
const dated = { id: crypto.randomUUID(), name: "" };
const undated = { id: crypto.randomUUID(), name: "" };
const design = crypto.randomUUID();
const build = crypto.randomUUID();
const ids = { logo: crypto.randomUUID(), guide: crypto.randomUUID(), loose: crypto.randomUUID() };

/** A date key `days` from today, in this machine's calendar. */
function dayKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  dated.name = `Rebrand ${tag}`;
  undated.name = `Northwind ${tag}`;
  await rpc(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: {
      id: dated.id,
      name: dated.name,
      position: `zz${tag}a`,
      starts_on: dayKey(-10),
      target_on: dayKey(30),
    },
  });
  await rpc(dev, "projects_op_create", {
    p_workspace_id: ws.id,
    p_project: { id: undated.id, name: undated.name, position: `zz${tag}b` },
  });
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: dated.id,
    p_section: { id: design, name: `Design ${tag}`, starts_on: dayKey(-2), ends_on: dayKey(10) },
  });
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: dated.id,
    p_section: { id: build, name: `Build ${tag}`, ends_on: dayKey(20) },
  });
  const make = (id: string, title: string, bucket: string, extra: object) =>
    rpc(dev, "tasks_op_create", {
      p_workspace_id: ws.id,
      p_task: { id, title, bucket_id: bucket, ...extra },
    });
  await make(ids.logo, `Logo concepts ${tag}`, dated.id, { section_id: design, due_on: dayKey(3) });
  await make(ids.guide, `Guidelines ${tag}`, dated.id, { section_id: build, due_on: dayKey(18) });
  await make(ids.loose, `API contract ${tag}`, undated.id, { due_on: dayKey(5) });
});

test.afterAll(async () => {
  const at = new Date().toISOString();
  for (const id of [dated.id, undated.id]) {
    await rest("service", `tasks?bucket_id=eq.${id}`, {
      method: "PATCH",
      body: { deleted_at: at },
    });
    await rest("service", `sections?project_id=eq.${id}`, {
      method: "PATCH",
      body: { deleted_at: at },
    });
    await rest("service", `buckets?id=eq.${id}`, { method: "PATCH", body: { deleted_at: at } });
  }
});

/** Open a sidebar place and switch it to the Timeline. */
async function openTimeline(page: Page, place: string) {
  await page.locator("nav").getByText(place, { exact: true }).first().click();
  const timeline = page.locator("[data-timeline]");
  if ((await timeline.count()) === 0) {
    await page.getByRole("radio", { name: "Timeline view" }).click();
  }
  await expect(timeline).toBeVisible({ timeout: 20_000 });
  return timeline;
}

const row = (page: Page, key: string) => page.locator(`[data-row-key="${key}"]`);

test("rows follow scope; points and spans", async ({ page }) => {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await expect(page.locator("nav").getByText(dated.name, { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  // ── All: one row per project, bars, no task rows (AC9.1, AC9.4, AC4.3) ──
  const all = await openTimeline(page, "All");
  // The shared workspace holds many projects: search lists only this run's
  // (All shows the projects with a match).
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search tasks").fill(tag);
  const datedRow = row(page, `project:${dated.id}`);
  const undatedRow = row(page, `project:${undated.id}`);
  await expect(datedRow).toBeVisible();
  await expect(undatedRow).toBeVisible();
  await expect(all.locator(`[data-row-key="task:${ids.logo}"]`)).toHaveCount(0);
  // Both dates set: a solid bar, its ranged section a segment on it.
  const solid = datedRow.locator('[data-timeline-mark="bar"]');
  await expect(solid).toHaveAttribute("data-solid", "true");
  await expect(solid.locator(`[data-section-id="${design}"]`)).toHaveCount(1);
  // No dates of its own: an outline worked out from its tasks.
  await expect(undatedRow.locator('[data-timeline-mark="bar"]')).not.toHaveAttribute(
    "data-solid",
    /.*/,
  );

  // ▸ expands a project into its sections and tasks.
  await datedRow.getByRole("button", { name: "Unfold" }).click();
  await expect(row(page, `section:${dated.id}:${design}`)).toBeVisible();
  await expect(row(page, `task:${ids.logo}`)).toBeVisible();

  // ── Inside the project: sections as bands and diamonds, tasks as points (AC9.2, AC9.3, AC2.3) ──
  await openTimeline(page, dated.name);
  const designRow = row(page, `section:${dated.id}:${design}`);
  const buildRow = row(page, `section:${dated.id}:${build}`);
  await expect(designRow).toContainText(`Design ${tag}`);
  await expect(designRow.locator('[data-timeline-mark="band"]')).toHaveCount(1);
  // An end date only: the diamond sits on the section's own row (68a).
  await expect(buildRow.locator('[data-timeline-mark="diamond"]')).toHaveCount(1);
  await expect(buildRow).toContainText(/by /);
  // A due-only task is a point on its day, with its section's band behind it.
  const logo = row(page, `task:${ids.logo}`);
  await expect(logo.locator('[data-timeline-mark="point"]')).toHaveCount(1);
  await expect(logo.locator('[data-timeline-mark="band"]')).toHaveCount(1);
  await logo.locator('[role="rowheader"]').click();
  await expect(page.getByLabel("Task title")).toHaveValue(`Logo concepts ${tag}`);

  // ── Nothing is rotated (46a) ──
  const rotated = await page.evaluate(() =>
    [...document.querySelectorAll("[data-timeline] *")].some((el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === "none") return false;
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (!m) return false;
      const [a, b] = m[1].split(",").map(Number);
      return Math.abs(Math.atan2(b, a)) > 0.01;
    }),
  );
  expect(rotated).toBe(false);
});

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
 * Tasks v3 TV-U10 — the List's section groups on the real app, against the
 * local stack: deleting a section leaves its tasks under No section, and Undo
 * brings the section back with its tasks in it. Run it like the other Tasks
 * specs:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/tasks-list.spec.ts
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
let project: { id: string };

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  [project] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      owner_id: dev.user.id,
      name: `Sections ${tag}`,
      position: `z${tag}`,
    },
  });
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

test("deleting a section keeps its tasks; Undo puts them back in it", async ({ page }) => {
  const sectionId = crypto.randomUUID();
  await rpc(dev, "sections_op_create", {
    p_workspace_id: ws.id,
    p_project_id: project.id,
    p_section: { id: sectionId, name: `Design ${tag}` },
  });
  const ids: string[] = [];
  for (const title of [`Moodboard ${tag}`, `Type scale ${tag}`]) {
    const id = crypto.randomUUID();
    await rpc(dev, "tasks_op_create", {
      p_workspace_id: ws.id,
      p_task: { id, title, bucket_id: project.id, section_id: sectionId },
    });
    ids.push(id);
  }
  const sectionsOf = async () =>
    (
      await rest<Array<{ section_id: string | null }>>(
        "service",
        `tasks?id=in.(${ids.join(",")})&select=section_id`,
      )
    ).map((t) => t.section_id);

  await signInPage(page, dev, ws.id);
  await page.goto(`/tasks?id=${ids[0]}`);
  const header = page.getByRole("button", { name: new RegExp(`^Design ${tag} \\d+ of`) });
  await expect(header).toBeVisible({ timeout: 20_000 });

  await header.hover();
  await page.getByRole("button", { name: `Design ${tag} options` }).click();
  await page.getByRole("menuitem", { name: "Delete section" }).click();
  await expect(page.getByText("Its 2 tasks stay in the project, under No section.")).toBeVisible();
  await expect.poll(sectionsOf).toEqual([null, null]);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(sectionsOf).toEqual([sectionId, sectionId]);
  await expect(header).toBeVisible();
  const [section] = await rest<Array<{ deleted_at: string | null }>>(
    "service",
    `sections?id=eq.${sectionId}&select=deleted_at`,
  );
  expect(section?.deleted_at).toBeNull();
});

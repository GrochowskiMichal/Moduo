import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  ensureTeammate,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 TV-U14 — Capture (AC10.1, AC10.2, AC10.8, AC5.1, AC5.4) against the
 * local stack: ⌘⇧K files to the Inbox from anywhere, ⌘N files where you are
 * (a project, a section), ⌘ + a module's number switches the capture's type
 * and never the page behind; a pasted list offers "Create n tasks?" with
 * subtasks and one Undo; an open note rides along as "From: …" and becomes a
 * link, unless removed; `@person` with no project shows the empty project
 * slot. (With only Task registered, ⌘2–7 doing nothing is a component test:
 * src/components/app/capture-shell.test.tsx.) Run it with the stack up and a
 * dev server pointed at it:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8143
 *   E2E_BASE_URL=http://127.0.0.1:8143 bunx playwright test --project=e2e tests/capture.spec.ts
 */

type TaskRow = {
  id: string;
  title: string;
  bucket_id: string;
  section_id: string | null;
  parent_id: string | null;
  assignee_id: string | null;
  deleted_at: string | null;
};

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
const made: { projects: string[]; notes: string[] } = { projects: [], notes: [] };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  await ensureTeammate(ws.id);
  tag = runTag();
});

test.afterAll(async () => {
  // Tidy the shared workspace: this run's tasks, projects and note (gotchas/ui.md).
  const now = new Date().toISOString();
  for (const id of made.notes) {
    await rest("service", `notes?id=eq.${id}`, { method: "PATCH", body: { deleted_at: now } });
  }
  await rest("service", `tasks?workspace_id=eq.${ws.id}&title=like.*${tag}*`, {
    method: "PATCH",
    body: { deleted_at: now },
  });
  for (const id of made.projects) {
    await rest("service", `buckets?id=eq.${id}`, { method: "PATCH", body: { deleted_at: now } });
  }
});

async function tasksTitled(fragment: string): Promise<TaskRow[]> {
  return rest<TaskRow[]>(
    "service",
    `tasks?workspace_id=eq.${ws.id}&title=like.*${encodeURIComponent(fragment)}*&select=id,title,bucket_id,section_id,parent_id,assignee_id,deleted_at&order=created_at.asc`,
  );
}

async function createProject(name: string): Promise<string> {
  const [row] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: { workspace_id: ws.id, owner_id: dev.user.id, name, position: `z${tag}` },
  });
  made.projects.push(row.id);
  return row.id;
}

/** One row of an op that may answer with a row or a list of them. */
const first = <T>(answer: T | T[]): T => (Array.isArray(answer) ? answer[0] : answer);

async function open(page: Page, path: string) {
  await signInPage(page, dev, ws.id);
  await page.goto(path);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible({
    timeout: 20_000,
  });
  // Let the page settle (its data and the global keys) before pressing keys.
  await page.waitForLoadState("networkidle");
}

const capture = (page: Page) => page.getByRole("dialog", { name: "Capture" });
const title = (page: Page) => capture(page).getByRole("textbox", { name: "Task title" });
const destination = (page: Page) => capture(page).getByRole("button", { name: /^Destination: / });

async function typeTitle(page: Page, words: string) {
  await title(page).click();
  await page.keyboard.type(words);
}

test("AC10.1 — ⌘⇧K files to the Inbox from Notes; ⌘N in a section files there; ⌘ + a number switches the type", async ({
  page,
}) => {
  // ⌘⇧K over Notes: Task · Inbox, never asking where.
  await open(page, "/notes");
  await page.keyboard.press("Meta+Shift+K");
  await expect(capture(page)).toBeVisible();
  await expect(capture(page).getByRole("button", { name: "Capture type: Task" })).toBeVisible();
  await expect(destination(page)).toHaveAccessibleName("Destination: Inbox");
  await typeTitle(page, `Water the ferns ${tag}`);
  await page.keyboard.press("Enter");
  await expect(capture(page)).toBeHidden();
  await expect.poll(async () => (await tasksTitled(`Water the ferns ${tag}`)).length).toBe(1);
  const [inboxTask] = await tasksTitled(`Water the ferns ${tag}`);
  expect(inboxTask.bucket_id).toBe(ws.inboxId);

  // ⌘N in a project, with a task of a section selected: that section.
  const projectId = await createProject(`Rebrand ${tag}`);
  const section = first(
    await rpc<{ id: string } | Array<{ id: string }>>(dev, "sections_op_create", {
      p_workspace_id: ws.id,
      p_project_id: projectId,
      p_section: { name: `Design ${tag}` },
    }),
  );
  await rpc(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { title: `Logo sketches ${tag}`, bucket_id: projectId, section_id: section.id },
  });
  await page.goto("/tasks");
  await page
    .getByRole("button", { name: new RegExp(`^Rebrand ${tag}`) })
    .first()
    .click();
  await page.getByText(`Logo sketches ${tag}`).first().click();
  await page.keyboard.press("Meta+N");
  await expect(capture(page)).toBeVisible();
  await expect(destination(page)).toHaveAccessibleName(
    `Destination: Rebrand ${tag} › Design ${tag}`,
  );

  // ⌘2 (Notes) switches the capture's type, not the page behind; ⌘1 (Home) does nothing.
  await title(page).click();
  await page.keyboard.press("Meta+1");
  await expect(capture(page).getByRole("button", { name: "Capture type: Task" })).toBeVisible();
  await page.keyboard.press("Meta+2");
  await expect(capture(page).getByRole("button", { name: "Capture type: Note" })).toBeVisible();
  await expect(page).toHaveURL(/\/tasks/);
  await page.keyboard.press("Meta+3");
  await expect(capture(page).getByRole("button", { name: "Capture type: Task" })).toBeVisible();

  await typeTitle(page, `Moodboard ${tag}`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await tasksTitled(`Moodboard ${tag}`)).length).toBe(1);
  const [filed] = await tasksTitled(`Moodboard ${tag}`);
  expect(filed.bucket_id).toBe(projectId);
  expect(filed.section_id).toBe(section.id);
});

test("AC10.8 — pasting a list offers Create n tasks?, indentation makes subtasks, one Undo removes them all", async ({
  page,
}) => {
  await open(page, "/tasks");
  await page.keyboard.press("Meta+Shift+K");
  await expect(capture(page)).toBeVisible();
  const lines = [
    `Trip ${tag} 1`,
    `  Passport ${tag} 1a`,
    `  Chargers ${tag} 1b`,
    ...Array.from({ length: 9 }, (_, i) => `- Item ${tag} ${i + 2}`),
  ];
  await title(page).click();
  await title(page).evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, lines.join("\n"));
  await expect(capture(page).getByText("Create 12 tasks?")).toBeVisible();
  await capture(page).getByRole("button", { name: "Create 12" }).click();

  // The toast shows once every task is saved; its Undo is the batch's.
  await expect(page.getByText("12 tasks created")).toBeVisible({ timeout: 20_000 });
  const rows = (await tasksTitled(tag)).filter((t) => /Trip|Passport|Chargers|Item/.test(t.title));
  expect(rows.filter((t) => !t.deleted_at)).toHaveLength(12);
  const trip = rows.find((t) => t.title === `Trip ${tag} 1`);
  const passport = rows.find((t) => t.title === `Passport ${tag} 1a`);
  expect(passport?.parent_id).toBe(trip?.id);
  expect(rows.find((t) => t.title === `Item ${tag} 2`)?.parent_id).toBeNull();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(
      async () =>
        (await tasksTitled(tag)).filter(
          (t) => /Trip|Passport|Chargers|Item/.test(t.title) && !t.deleted_at,
        ).length,
      { timeout: 20_000 },
    )
    .toBe(0);
});

test("AC5.4 / AC5.1 — an open note rides along as From: and links; removed, it links nothing; @person with no project shows the empty slot", async ({
  page,
}) => {
  const note = first(
    await rpc<{ id: string } | Array<{ id: string }>>(dev, "notes_op_create", {
      p_workspace_id: ws.id,
      p_id: null,
      p_parent_id: null,
      p_title: `Launch notes ${tag}`,
      p_position: "",
      p_icon: null,
    }),
  );
  made.notes.push(note.id);

  await open(page, `/notes?id=${note.id}`);
  await page.keyboard.press("Meta+Shift+K");
  await expect(capture(page)).toBeVisible();
  await expect(capture(page).getByText(/^From: /)).toBeVisible();
  await typeTitle(page, `Send the deck ${tag}`);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await tasksTitled(`Send the deck ${tag}`)).length).toBe(1);
  const [linked] = await tasksTitled(`Send the deck ${tag}`);
  expect(linked.bucket_id).toBe(ws.inboxId);
  await expect
    .poll(
      async () =>
        (
          await rest<unknown[]>(
            "service",
            `entity_links?source_id=eq.${linked.id}&target_id=eq.${note.id}&relation_kind=eq.spawned-from&deleted_at=is.null&select=id`,
          )
        ).length,
    )
    .toBe(1);

  // Removed before Create: no link.
  await page.keyboard.press("Meta+Shift+K");
  await expect(capture(page)).toBeVisible();
  await capture(page).getByRole("button", { name: "Don't link it" }).click();
  await expect(capture(page).getByText(/^From: /)).toBeHidden();
  // @person with no project: the empty project slot.
  await typeTitle(page, `Proofread ${tag} @Tess`);
  await expect(page.getByRole("option", { name: /Tess Mate/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Enter");
  await expect(destination(page)).toHaveAccessibleName("Destination: No project");
  await expect(capture(page).getByText("Unfiled · Tess Mate finds it in My tasks")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await tasksTitled(`Proofread ${tag}`)).length).toBe(1);
  const [unlinked] = await tasksTitled(`Proofread ${tag}`);
  expect(unlinked.title).toBe(`Proofread ${tag}`);
  expect(unlinked.assignee_id).not.toBe(dev.user.id);
  const links = await rest<unknown[]>(
    "service",
    `entity_links?source_id=eq.${unlinked.id}&deleted_at=is.null&select=id`,
  );
  expect(links).toHaveLength(0);
});

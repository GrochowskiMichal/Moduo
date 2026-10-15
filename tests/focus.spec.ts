import { expect, type Page, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  endFocusRuns,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Tasks v3 AC8.1–8.5 — the Focus screen (TV-F7) against the local stack:
 *   bun run local:up && bun run env:local
 *   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8131
 *   E2E_BASE_URL=http://127.0.0.1:8131 bunx playwright test --project=e2e tests/focus.spec.ts
 * AC8.6–8.8 (TV-F8: the meeting divider, Arrange by project, the
 * along-the-way offer) and Hand off → In flight run in a workspace of their
 * own per run, so the dev workspace's line-up never shifts their numbers.
 */

type TaskRow = { id: string; title: string; status: string };

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
});

// No session left over from another test, and none left for the next one:
// the card starts from Up next.
test.beforeEach(() => endFocusRuns(dev.user.id));
test.afterAll(() => endFocusRuns(dev.user.id));

async function createTask(fields: {
  title: string;
  parentId?: string;
  description?: string;
}): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>(dev, "tasks", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      bucket_id: ws.inboxId,
      title: fields.title,
      description: fields.description ?? "",
      parent_id: fields.parentId ?? null,
      status: "todo",
      owner_id: dev.user.id,
      assignee_id: dev.user.id,
      position: `z${tag}${fields.title}`,
    },
  });
  return row;
}

async function taskById(id: string): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>("service", `tasks?id=eq.${id}&select=id,title,status`);
  return row;
}

async function openFocus(page: Page) {
  await signInPage(page, dev, ws.id);
  await page.goto("/tasks");
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button", { name: /^Focus\b/ })
    .first()
    .click();
  await expect(page.locator('[data-slot="focus-view"]')).toBeVisible({ timeout: 20_000 });
}

test("AC8.1–8.3 — the sidebar's Focus, Start, one pill with Pause, Stop in ⋯ with Undo", async ({
  page,
}) => {
  const t = await createTask({ title: `Now card ${tag}` });
  await rpc(dev, "tasks_op_queue_add", { p_workspace_id: ws.id, p_task_id: t.id, p_at: "top" });
  await openFocus(page);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByRole("heading", { name: `Now card ${tag}` })).toBeVisible();
  // The old Plan · Focus switch is gone.
  await expect(page.getByRole("radio", { name: "Focus", exact: true })).toHaveCount(0);
  await now.getByRole("button", { name: /^Start/ }).click();
  // Per task or Pomodoro: one pill (on the card or in the header), Pause inside it.
  const pill = page.locator('[data-slot="focus-task-pill"], [data-slot="focus-pomodoro-pill"]');
  await expect(pill).toHaveCount(1);
  await expect(pill).toHaveAttribute("aria-label", /^Pause/);
  await page.getByRole("button", { name: "Focus options" }).click();
  await page.getByRole("menuitem", { name: "Stop" }).click();
  await expect(page.getByText("Focus stopped")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pill).toHaveCount(1);
});

test("AC8.5 — a subtask opens its own details in the panel; ⇧F makes it the focus; ⏎ finishes it", async ({
  page,
}) => {
  const parent = await createTask({ title: `Parent ${tag}` });
  const sub = await createTask({
    title: `Sub ${tag}`,
    parentId: parent.id,
    description: "Kerning at 16 px.",
  });
  await rpc(dev, "tasks_op_queue_add", {
    p_workspace_id: ws.id,
    p_task_id: parent.id,
    p_at: "top",
  });
  await openFocus(page);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByRole("heading", { name: `Parent ${tag}` })).toBeVisible();

  // Its own details on the right, with the parent as the breadcrumb.
  const row = now.getByRole("button", { name: `Sub ${tag}: open its details` });
  await row.click();
  const details = page.getByRole("region", { name: "Task details" }).last();
  await expect(details.getByText("Kerning at 16 px.")).toBeVisible();
  await expect(details.getByRole("button", { name: `Parent task: Parent ${tag}` })).toBeVisible();

  // ⇧F on it: the subtask becomes the Now card, its parent in the top line.
  await row.focus();
  await page.keyboard.press("Shift+F");
  await expect(now.getByRole("heading", { name: `Sub ${tag}` })).toBeVisible();
  await expect(now.getByText(`Parent ${tag}`)).toBeVisible();

  // ⏎ is Done for the focused task.
  await page.locator('[data-slot="focus-view"] h1').click();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await taskById(sub.id)).status).toBe("done");
});

// ── TV-F8: AC8.6–8.8 and In flight, in a workspace of their own ─────────────

type Place = { id: string; inboxId: string; acme: string; web: string };

/** A fresh workspace of the dev's with an Inbox and two projects, Acme and Web. */
async function freshPlace(name: string): Promise<Place> {
  const [w] = await rest<Array<{ id: string }>>("service", "workspaces", {
    method: "POST",
    body: { owner_id: dev.user.id, name },
  });
  const bucket = async (bucketName: string, isSystem: boolean) => {
    const [b] = await rest<Array<{ id: string }>>("service", "buckets", {
      method: "POST",
      body: { workspace_id: w.id, owner_id: dev.user.id, name: bucketName, is_system: isSystem },
    });
    return b.id;
  };
  return {
    id: w.id,
    inboxId: await bucket("Inbox", true),
    acme: await bucket(`Acme ${tag}`, false),
    web: await bucket(`Web ${tag}`, false),
  };
}

async function placeTask(
  place: Place,
  bucketId: string,
  title: string,
  estimate: number | null,
  queued: boolean,
): Promise<TaskRow> {
  const [row] = await rest<TaskRow[]>(dev, "tasks", {
    method: "POST",
    body: {
      workspace_id: place.id,
      bucket_id: bucketId,
      title,
      status: "todo",
      owner_id: dev.user.id,
      assignee_id: dev.user.id,
      estimate_minutes: estimate,
      position: `z${title}`,
    },
  });
  if (queued) {
    await rpc(dev, "tasks_op_queue_add", {
      p_workspace_id: place.id,
      p_task_id: row.id,
      p_at: "end",
    });
  }
  return row;
}

async function openFocusIn(page: Page, place: Place) {
  await signInPage(page, dev, place.id);
  await page.goto("/tasks");
  await page
    .getByRole("navigation", { name: "Tasks" })
    .getByRole("button", { name: /^Focus\b/ })
    .first()
    .click();
  await expect(page.locator('[data-slot="focus-view"]')).toBeVisible({ timeout: 20_000 });
}

/** Up next as the screen draws it: task titles and "@meeting". */
async function upNextOrder(page: Page): Promise<string[]> {
  const upNext = page.getByRole("region", { name: "Up next" });
  return upNext
    .locator('[data-slot="focus-meeting"], [data-focus-task]')
    .evaluateAll((els) =>
      els.map((el) =>
        el.getAttribute("data-slot") === "focus-meeting"
          ? "@meeting"
          : (el.querySelector("button span")?.textContent ?? "").split(" · ")[0].trim(),
      ),
    );
}

test("AC8.6 — a meeting within two hours shows as a divider where it falls in Up next", async ({
  page,
}) => {
  const place = await freshPlace(`Focus F8 meeting ${tag}`);
  await placeTask(place, place.acme, `Now ${tag}`, 30, true);
  await placeTask(place, place.acme, `Fits ${tag}`, 20, true);
  await placeTask(place, place.web, `After ${tag}`, 30, true);
  // 70 minutes away: Now's 30 and Fits' 20 come before it, After doesn't.
  const starts = Date.now() + 70 * 60_000;
  await rest("service", "calendar_events", {
    method: "POST",
    body: {
      workspace_id: place.id,
      owner_id: dev.user.id,
      title: `Acme call ${tag}`,
      description: "",
      start_time: new Date(starts).toISOString(),
      end_time: new Date(starts + 30 * 60_000).toISOString(),
      status: "confirmed",
    },
  });
  await openFocusIn(page, place);
  const divider = page.locator('[data-slot="focus-meeting"]');
  await expect(divider).toContainText(`Acme call ${tag}`);
  await expect.poll(() => upNextOrder(page)).toEqual([`Fits ${tag}`, "@meeting", `After ${tag}`]);
});

test("AC8.7 — Arrange by project shows when it saves two switches, arranges and undoes", async ({
  page,
}) => {
  const place = await freshPlace(`Focus F8 arrange ${tag}`);
  await placeTask(place, place.acme, `Now ${tag}`, null, true);
  await placeTask(place, place.web, `W1 ${tag}`, null, true);
  await placeTask(place, place.acme, `A2 ${tag}`, null, true);
  await placeTask(place, place.web, `W2 ${tag}`, null, true);
  await placeTask(place, place.acme, `A3 ${tag}`, null, true);
  await openFocusIn(page, place);
  const before = [`W1 ${tag}`, `A2 ${tag}`, `W2 ${tag}`, `A3 ${tag}`];
  await expect.poll(() => upNextOrder(page)).toEqual(before);
  await page.getByRole("button", { name: /Arrange by project\s*· 3 fewer switches/ }).click();
  await expect
    .poll(() => upNextOrder(page))
    .toEqual([`A2 ${tag}`, `A3 ${tag}`, `W1 ${tag}`, `W2 ${tag}`]);
  // Nothing more to save: the header's offer goes.
  await expect(page.getByRole("button", { name: /Arrange by project/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => upNextOrder(page)).toEqual(before);
});

test("AC8.8 — the along-the-way offer appears once, between projects, and Esc declines it", async ({
  page,
}) => {
  const place = await freshPlace(`Focus F8 along ${tag}`);
  await placeTask(place, place.acme, `Logo ${tag}`, 30, true);
  await placeTask(place, place.web, `Site ${tag}`, 30, true);
  await placeTask(place, place.web, `Nav ${tag}`, 15, true);
  await placeTask(place, place.acme, `Invoice ${tag}`, 5, false);
  await openFocusIn(page, place);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByRole("heading", { name: `Logo ${tag}` })).toBeVisible();
  await now.getByRole("button", { name: /^Done/ }).click();
  const offer = page.getByRole("region", { name: "Along the way" });
  await expect(offer).toContainText(`Invoice ${tag}`);
  await expect(offer).toContainText(`Acme ${tag}`);
  await page.keyboard.press("Escape");
  await expect(offer).toHaveCount(0);
  await expect(now.getByRole("heading", { name: `Site ${tag}` })).toBeVisible();
  // Web to Web is no project change: no offer.
  await now.getByRole("button", { name: /^Done/ }).click();
  await expect(now.getByRole("heading", { name: `Nav ${tag}` })).toBeVisible();
  await expect(offer).toHaveCount(0);
});

test("Hand off W — the task waits, leaves Up next, and shows in the panel's In flight", async ({
  page,
}) => {
  const place = await freshPlace(`Focus F8 hand-off ${tag}`);
  const first = await placeTask(place, place.acme, `Brief ${tag}`, null, true);
  await placeTask(place, place.acme, `Next ${tag}`, null, true);
  await openFocusIn(page, place);
  const now = page.getByRole("region", { name: "Now" });
  await expect(now.getByRole("heading", { name: `Brief ${tag}` })).toBeVisible();
  await page.locator('[data-slot="focus-view"] h1').click();
  await page.keyboard.press("w");
  await page.getByPlaceholder("Waiting on…").fill("the client’s logo files");
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "2h" }).click();
  await page
    .getByRole("button", { name: /^Hand off/ })
    .last()
    .click();
  await expect(now.getByRole("heading", { name: `Next ${tag}` })).toBeVisible();
  // The wait is saved on the task (TV-D10's Waiting on…), with my check-back.
  await expect
    .poll(async () =>
      (
        await rest<Array<{ label: string }>>(
          "service",
          `task_waiting?task_id=eq.${first.id}&deleted_at=is.null&select=label`,
        )
      ).map((w) => w.label),
    )
    .toEqual(["the client’s logo files"]);
  await expect
    .poll(
      async () =>
        (
          await rest<Array<{ id: string }>>(
            "service",
            `task_reminders?task_id=eq.${first.id}&deleted_at=is.null&select=id`,
          )
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", { name: /1 in flight/ }).click();
  const card = page.locator(`[data-slot="in-flight-card"][data-task-id="${first.id}"]`);
  await expect(card).toContainText("Waiting on the client’s logo files");
  await expect(card).toContainText(/check back/);
});

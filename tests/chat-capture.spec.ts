import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-10 · "Make a task and ⌘7" (AC9.5, AC9.6, AC2.4, AC1.13, AC4.1),
 * against the local stack:
 *   scripts/agent/e2e.sh tests/chat-capture.spec.ts
 * Its people (capture-owner@ and capture-member@moduo.local) work in a Duo
 * workspace the spec makes and removes.
 */

test.describe.configure({ mode: "serial", timeout: 150_000 });

const OWNER = {
  email: "capture-owner@moduo.local",
  password: "localcaptureowner",
  name: "Maja Nowak",
};
const MEMBER = {
  email: "capture-member@moduo.local",
  password: "localcapturemember",
  name: "Sofia Reyes",
};

let room: ChatRoom;
let tag: string;
let projectId: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Capture ${tag}`);
  const key = `C${
    tag
      .replace(/[^a-z]/gi, "")
      .slice(0, 3)
      .toUpperCase() || "AP"
  }`;
  await rest("service", `workspaces?id=eq.${room.ws}`, {
    method: "PATCH",
    body: { task_key: key },
  });
  projectId = crypto.randomUUID();
  await rest("service", "buckets", {
    method: "POST",
    body: {
      id: projectId,
      workspace_id: room.ws,
      owner_id: room.owner.user.id,
      name: `Launch ${tag}`,
      is_system: false,
      position: "0001",
    },
  });
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const composer = (page: Page) => page.locator('[data-chat-composer] [contenteditable="true"]');
const row = (page: Page, text: string) =>
  page.getByRole("article").filter({ hasText: text }).first();

async function openGeneral(page: Page): Promise<void> {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  await expect(page.getByTestId("message-stream")).toBeVisible({ timeout: 20_000 });
}

test("T makes a task with the From chip; the message shows Became a task; both ways", async ({
  page,
}) => {
  const words = `Get logo SVGs ${tag}`;
  const messageId = await sendAs(room.member, room.general, words);
  await openGeneral(page);
  await expect(row(page, words)).toBeVisible();

  // Select the message, then T.
  const stream = page.getByTestId("message-stream");
  await stream.focus();
  await page.keyboard.press("ArrowUp");
  for (let i = 0; i < 6; i++) {
    const text = (await page.locator("[data-selected]").textContent()) ?? "";
    if (text.includes(words)) break;
    await page.keyboard.press("ArrowUp");
  }
  await page.keyboard.press("t");
  const capture = page.getByRole("dialog", { name: "Capture" });
  await expect(capture).toBeVisible();
  await expect(capture).toContainText(words);
  await expect(capture).toContainText("From: Sofia Reyes's message in General");
  await page.keyboard.press("Enter");
  await expect(capture).toHaveCount(0);

  // The task links to the message (spawned-from), and the message says so, live.
  const link = async () =>
    (
      await rest<Array<{ source_id: string }>>(
        "service",
        `entity_links?target_type=eq.chat_message&target_id=eq.${messageId}&relation_kind=eq.spawned-from&deleted_at=is.null&select=source_id`,
      )
    )[0]?.source_id ?? null;
  await expect.poll(link, { timeout: 15_000 }).not.toBeNull();
  const taskId = (await link()) as string;
  const line = row(page, words).locator("[data-slot='made-from']");
  await expect(line).toContainText("Became a task");
  await expect(line).toContainText(words);

  // The message registered without a label.
  const [entity] = await rest<Array<{ label: string }>>(
    "service",
    `entities?entity_type=eq.chat_message&entity_id=eq.${messageId}&select=label`,
  );
  expect(entity?.label).toBe("");

  // The task's Linked shows the message.
  await page.goto(`/tasks?id=${taskId}`);
  await expect(page.getByText(`Sofia Reyes · ${words}`).first()).toBeVisible({ timeout: 20_000 });
});

test("a typed handle becomes a chip; Mentioned in shows on the task", async ({ page }) => {
  const rows = await rpc<Array<{ id: string }> | { id: string }>(room.owner, "tasks_op_create", {
    p_workspace_id: room.ws,
    p_task: { title: `Fix the header ${tag}`, bucket_id: projectId },
  });
  const taskId = (Array.isArray(rows) ? rows[0] : rows).id;
  const [task] = await rest<Array<{ number: number }>>(
    "service",
    `tasks?id=eq.${taskId}&select=number`,
  );
  const [ws] = await rest<Array<{ task_key: string }>>(
    "service",
    `workspaces?id=eq.${room.ws}&select=task_key`,
  );
  const handle = `${ws.task_key}-${task.number}`;

  await openGeneral(page);
  const box = composer(page);
  await box.pressSequentially(`bug ${handle} `);
  // It becomes a live chip; Esc right after puts the text back; typing it again links again.
  await expect(box.locator("[data-lexical-decorator]").first()).toBeVisible({ timeout: 10_000 });
  await box.press("Escape");
  await expect(box.locator("[data-lexical-decorator]")).toHaveCount(0);
  await expect(box).toContainText(handle);
  await box.press("End");
  await box.pressSequentially(`and ${handle} `);
  await expect(box.locator("[data-lexical-decorator]").first()).toBeVisible({ timeout: 10_000 });
  await box.pressSequentially(`anna takes it ${tag}`);
  await box.press("Enter");
  await expect(row(page, `anna takes it ${tag}`)).toBeVisible();

  // The stored form is the URI; the conversation leaves "Mentioned in" on the task.
  await expect
    .poll(async () => {
      const r = await rest<Array<{ body: string }>>(
        "service",
        `chat_messages?channel_id=eq.${room.general}&body=like.*${tag}*&select=body&order=created_at.desc&limit=1`,
      );
      return r[0]?.body ?? "";
    })
    .toContain(`moduo://task/${taskId}`);
  await page.goto(`/tasks?id=${taskId}`);
  await expect(page.locator("[data-slot='mentioned-in']")).toContainText("Mentioned in General", {
    timeout: 20_000,
  });
});

test("⌘7 Message needs a destination, starts a DM from a person, says Sent to · Open · Undo", async ({
  page,
}) => {
  await openGeneral(page);
  await page.keyboard.press("ControlOrMeta+Shift+K");
  const capture = page.getByRole("dialog", { name: "Capture" });
  await expect(capture).toBeVisible();
  // The type menu lists Message under Chat's number (⌘7 with the default tabs).
  await capture.getByRole("button", { name: "Capture type: Task" }).click();
  await page.getByRole("menuitemradio", { name: /Message/ }).click();
  await expect(capture.getByRole("button", { name: "Capture type: Message" })).toBeVisible();
  const picker = capture.getByRole("combobox", { name: "Send to" });
  await expect(picker).toBeFocused();

  // No default destination: the picker comes first; a person starts a direct message.
  await picker.pressSequentially("Sofia");
  await expect(capture.getByRole("option", { name: /Sofia Reyes/ })).toBeVisible();
  await picker.press("Enter");
  const line = capture.getByRole("textbox", { name: "Message" });
  await expect(line).toBeFocused();
  await line.pressSequentially(`Quick one ${tag}`);
  await line.press("Enter");
  await expect(capture).toHaveCount(0);
  await expect(page.getByText(/^Sent to Sofia Reyes$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();

  // A direct message with Sofia now holds it.
  const findIt = async () =>
    (
      await rest<Array<{ id: string; channel_id: string; deleted_at: string | null }>>(
        "service",
        `chat_messages?workspace_id=eq.${room.ws}&body=eq.Quick one ${tag}&select=id,channel_id,deleted_at`,
      )
    )[0] ?? null;
  await expect.poll(findIt).not.toBeNull();
  const sent = await findIt();
  const [dm] = await rest<Array<{ kind: string }>>(
    "service",
    `chat_channels?id=eq.${sent?.channel_id}&select=kind`,
  );
  expect(dm?.kind).toBe("dm");

  // Undo deletes it.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await findIt())?.deleted_at ?? null).not.toBeNull();
});

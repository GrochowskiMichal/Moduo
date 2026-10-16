import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-20 · Custom emoji (AC4.8), against the local stack:
 *   scripts/agent/e2e.sh tests/chat-emoji.spec.ts
 * A Duo room of its own (emoji-owner@ and emoji-member@moduo.local). The member
 * adds :shipit: (an animated GIF) in Settings → Chat; it shows first in the
 * picker, works as a reaction in chat and on a task comment, draws in text,
 * plays only on hover, and reads as text once removed.
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });

const OWNER = { email: "emoji-owner@moduo.local", password: "localemojiowner", name: "Ola Nowak" };
const MEMBER = {
  email: "emoji-member@moduo.local",
  password: "localemojimember",
  name: "Piotr Wis",
};

/** A 1 × 1 GIF with two frames (so it counts as animated). */
const FRAME = [
  0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
];
const ANIMATED_GIF = Buffer.from([
  ...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00],
  ...[0x00, 0x00, 0x00, 0xff, 0xff, 0xff],
  ...FRAME,
  ...FRAME,
  0x3b,
]);

let room: ChatRoom;
let tag: string;
let name: string;

test.beforeAll(async () => {
  tag = runTag();
  name = `shipit-${tag}`;
  room = await makeChatRoom(OWNER, MEMBER, `Emoji ${tag}`);
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const composer = (page: Page) => page.locator("[data-chat-composer]");
const box = (page: Page) => composer(page).getByRole("textbox");

test("custom emoji in the picker, reactions and comments", async ({ page }) => {
  // The member adds it in Settings → Chat → Custom emoji.
  await signInPage(page, room.member, room.ws);
  await page.goto("/settings?section=chat");
  const section = page.locator('[data-slot="custom-emoji"]');
  await expect(section).toBeVisible({ timeout: 20_000 });
  await section.getByRole("button", { name: "Add emoji" }).click();
  const dialog = page.locator('[data-slot="add-emoji"]');
  await dialog.locator('[data-slot="add-emoji-file"]').setInputFiles({
    name: "ship.gif",
    mimeType: "image/gif",
    buffer: ANIMATED_GIF,
  });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const row = section.getByRole("listitem").filter({ hasText: `:${name}:` });
  await expect(row).toContainText("Added by you");
  // A standard shortcode can't be taken.
  await section.getByRole("button", { name: "Add emoji" }).click();
  await dialog.locator('[data-slot="add-emoji-file"]').setInputFiles({
    name: "tada.gif",
    mimeType: "image/gif",
    buffer: ANIMATED_GIF,
  });
  await dialog.getByLabel("Name").fill("tada");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toContainText(":tada: is a standard emoji");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The picker lists the workspace's emoji first.
  await page.goto(`/chat?c=${room.general}`);
  await expect(box(page)).toBeVisible({ timeout: 20_000 });
  await composer(page).getByRole("button", { name: "Emoji" }).click();
  const custom = page.getByRole("button", { name: `:${name}:` }).first();
  await expect(custom).toBeVisible();
  const firstCell = page.locator("section button[title]").first();
  await expect(firstCell).toHaveAttribute("title", `:${name}:`);
  await custom.click();
  await expect(box(page)).toContainText(`:${name}:`);
  await box(page).press("Enter");

  // In text it draws; animated, it plays only on hover.
  const inline = page.locator(`[data-slot="message-body"] img[data-custom-emoji="${name}"]`).last();
  await expect(inline).toBeVisible({ timeout: 20_000 });
  await expect(inline).not.toHaveAttribute("data-playing", "");
  await inline.hover();
  await expect(inline).toHaveAttribute("data-playing", "");

  // As a reaction in chat.
  const messageId = await sendAs(room.owner, room.general, `ship it ${tag}`);
  await rpc(room.member, "chat_op_react", {
    p_message_id: messageId,
    p_key: `:${name}:`,
    p_on: true,
  });
  await expect(
    page.locator(`[data-slot="reactions"] img[data-custom-emoji="${name}"]`).first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  // On a task comment (the member's own task: a task is private to its maker
  // until shared).
  const taskId = randomUUID();
  await rpc(room.member, "tasks_op_create", {
    p_workspace_id: room.ws,
    p_task: { id: taskId, title: `Ship ${tag}` },
  });
  const comment = await rpc<{ id: string } | Array<{ id: string }>>(room.member, "comments_op_add", {
    p_workspace_id: room.ws,
    p_entity_type: "task",
    p_entity_id: taskId,
    p_body: `Done :${name}:`,
  });
  const commentId = Array.isArray(comment) ? comment[0]?.id : comment.id;
  await rpc(room.member, "comments_op_react", {
    p_comment_id: commentId,
    p_reaction: `:${name}:`,
    p_on: true,
  });
  await page.goto(`/tasks?id=${taskId}`);
  await expect(
    page.locator(`[data-slot="reactions"] img[data-custom-emoji="${name}"]`).first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  // Removed, it reads as text.
  await page.goto("/settings?section=chat");
  await row.getByRole("button", { name: `More for :${name}:` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(row).toBeHidden();
  await page.goto(`/chat?c=${room.general}`);
  await expect(page.locator(`img[data-custom-emoji="${name}"]`)).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(
    page
      .locator('[data-slot="message-body"]')
      .filter({ hasText: `:${name}:` })
      .first(),
  ).toBeVisible();
});

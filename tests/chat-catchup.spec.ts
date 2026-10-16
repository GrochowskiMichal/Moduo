import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-11 · Catch up on the real app (AC2.5, AC5.4, AC7.3, AC3.4),
 * against the local stack:
 *   scripts/agent/e2e.sh tests/chat-catchup.spec.ts
 * A Duo room of its own (catchup-owner@ and catchup-member@moduo.local). The
 * member writes to the owner: two @mentions in General, a reply chain, a
 * direct message and a busy channel the owner follows on Every message. The
 * owner's Catch up lists them grouped by conversation; the bottom bar is the
 * mode row; Space clears, H offers Later, T opens the capture, ⏎ opens the
 * message in context, R replies from the right; a chain is one item acting
 * on its newest reply; "Done all in this conversation" undoes; Remind me on a
 * message brings it back once.
 */

test.describe.configure({ mode: "serial", timeout: 150_000 });

const OWNER = {
  email: "catchup-owner@moduo.local",
  password: "localcatchupowner",
  name: "Alex Rivera",
};
const MEMBER = {
  email: "catchup-member@moduo.local",
  password: "localcatchupmember",
  name: "Sofia Ortiz",
};

let room: ChatRoom;
let tag: string;
let busy = "";
let dm = "";

const you = () => `moduo://person/${room.owner.user.id}`;
const list = (page: Page) => page.locator('[data-slot="catchup-list"]');
const item = (page: Page, text: string) =>
  list(page).locator("[data-catchup-item]").filter({ hasText: text });
const modeRow = (page: Page) => page.locator('[data-mode="chat:catchup"]');
const context = (page: Page) => page.locator('[data-slot="catchup-context"]');

/** The owner's item about a message, read as the service role. */
const ownerItem = async (messageId: string) =>
  (
    await rest<
      Array<{ id: string; done_at: string | null; later_until: string | null; reason: string }>
    >(
      "service",
      `chat_catchup?user_id=eq.${room.owner.user.id}&message_id=eq.${messageId}&select=id,done_at,later_until,reason`,
    )
  )[0];

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Catch up ${tag}`);
  const made = await rpc<{ id: string } | Array<{ id: string }>>(
    room.member,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `Busy ${tag}`,
      p_topic: "",
      p_is_private: false,
      p_member_ids: [room.owner.user.id],
    },
  );
  busy = (Array.isArray(made) ? made[0] : made)?.id ?? "";
  await rpc(room.owner, "chat_op_set_prefs", {
    p_channel_id: busy,
    p_notify_level: "all",
    p_starred: null,
  });
  const opened = await rpc<{ id: string } | Array<{ id: string }>>(room.member, "chat_op_open_dm", {
    p_workspace_id: room.ws,
    p_user_ids: [room.owner.user.id],
  });
  dm = (Array.isArray(opened) ? opened[0] : opened)?.id ?? "";
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

test("the mode row and keys", async ({ page }) => {
  const m1 = await sendAs(room.member, room.general, `${you()} can you check the logo ${tag}`);
  const m2 = await sendAs(room.member, room.general, `${you()} and the tagline ${tag}`);
  const root = await sendAs(room.owner, room.general, `Which fonts ${tag}?`);
  await sendAs(room.member, room.general, `Inter for body ${tag}`, root);
  const newest = await sendAs(room.member, room.general, `and Fraunces for titles ${tag}`, root);
  const d1 = await sendAs(room.member, dm, `Quick one about the tagline ${tag}`);
  for (const n of [1, 2, 3]) await sendAs(room.member, busy, `busy news ${n} ${tag}`);

  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  // The left panel's Catch up row opens the mode.
  await page.locator('[data-nav-id="catchup"]').click();
  await expect(page).toHaveURL(/view=catchup/);
  await expect(list(page)).toBeVisible({ timeout: 20_000 });

  // AC2.5: grouped by conversation; a chain is one item on its newest reply;
  // AC7.3: Every message is one line per conversation.
  await expect(item(page, `can you check the logo ${tag}`)).toBeVisible();
  await expect(item(page, `and Fraunces for titles ${tag}`)).toHaveCount(1);
  await expect(item(page, `Inter for body ${tag}`)).toHaveCount(0);
  await expect(item(page, `Busy ${tag} · 3 new`)).toHaveCount(1);
  await expect(item(page, `Quick one about the tagline ${tag}`)).toBeVisible();
  await expect(list(page).locator(`[data-catchup-group="${room.general}"]`)).toBeVisible();
  await expect(modeRow(page)).toContainText("5 left · Esc");

  // ⏎ opens the selected item as the message in context, with a reply box.
  await item(page, `and Fraunces for titles ${tag}`).click();
  await page.keyboard.press("Enter");
  await expect(context(page).locator(`[data-message-id="${newest}"][data-current]`)).toBeVisible();

  // R replies from the right; the chain's item closes (sending reads it).
  await page.keyboard.press("r");
  const box = context(page).locator('[data-slot="catchup-reply"] [contenteditable="true"]');
  await expect(box).toBeFocused();
  await page.keyboard.type(`Fraunces it is ${tag}`);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Replied")).toBeVisible();
  await expect(item(page, `and Fraunces for titles ${tag}`)).toHaveCount(0, { timeout: 15_000 });

  // Space clears (and Undo would bring it back).
  await item(page, `and the tagline ${tag}`).click();
  await page.keyboard.press(" ");
  await expect(item(page, `and the tagline ${tag}`)).toHaveCount(0);
  await expect.poll(async () => (await ownerItem(m2))?.done_at ?? null).not.toBeNull();

  // T opens the capture as Task with the message's words.
  await item(page, `can you check the logo ${tag}`).click();
  await page.keyboard.press("t");
  const capture = page.getByRole("dialog", { name: "Capture" });
  await expect(capture).toBeVisible();
  await expect(capture).toContainText(`can you check the logo ${tag}`);
  await page.keyboard.press("Escape");
  await expect(capture).toHaveCount(0);

  // AC5.4: H offers Later; "In 1 hour" puts it off (gone until then).
  await item(page, `can you check the logo ${tag}`).click();
  await page.keyboard.press("h");
  const later = page.locator('[data-slot="later-dialog"]');
  await expect(later.getByRole("button", { name: /In 1 hour/ })).toBeVisible();
  await expect(later.getByRole("button", { name: /Tomorrow/ })).toBeVisible();
  await expect(later.getByRole("button", { name: "Pick a time…" })).toBeVisible();
  await later.getByRole("button", { name: /In 1 hour/ }).click();
  await expect(item(page, `can you check the logo ${tag}`)).toHaveCount(0);
  await expect.poll(async () => (await ownerItem(m1))?.later_until ?? null).not.toBeNull();

  // "Done all in this conversation" (More ▾) with Undo.
  await item(page, `Busy ${tag} · 3 new`).click();
  await modeRow(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Done all in this conversation" }).click();
  await expect(item(page, `Busy ${tag} · 3 new`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(item(page, `Busy ${tag} · 3 new`)).toHaveCount(1, { timeout: 15_000 });

  // The direct message, then the line: all done → the zero state.
  await item(page, `Quick one about the tagline ${tag}`).click();
  await page.keyboard.press(" ");
  await item(page, `Busy ${tag} · 3 new`).click();
  await page.keyboard.press(" ");
  await expect(page.getByText("You're caught up.")).toBeVisible();
  await expect.poll(async () => (await ownerItem(d1))?.done_at ?? null).not.toBeNull();

  // Esc leaves Catch up for the conversation.
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/view=catchup/);
});

test("Remind me tomorrow brings a message back once (AC3.4)", async ({ page }) => {
  const plain = await sendAs(room.member, room.general, `Budget numbers are in ${tag}`);
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}&m=${plain}`);
  const row = page
    .getByTestId("message-stream")
    .getByRole("article")
    .filter({
      hasText: `Budget numbers are in ${tag}`,
    });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.hover();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Remind me/ }).click();
  await page
    .locator('[data-slot="later-dialog"]')
    .getByRole("button", { name: /Tomorrow/ })
    .click();
  await expect.poll(async () => (await ownerItem(plain))?.reason ?? null).toBe("reminder");

  // Its time comes (moved to now), the minute job runs: back once, with one notice.
  const it = await ownerItem(plain);
  await rest("service", `chat_catchup?id=eq.${it?.id}`, {
    method: "PATCH",
    body: { later_until: new Date(Date.now() - 60_000).toISOString() },
  });
  await rpc("service", "chat__fire_later", {});
  await rpc("service", "chat__fire_later", {});
  const notices = await rest<unknown[]>(
    "service",
    `notice_deliveries?user_id=eq.${room.owner.user.id}&kind=eq.chat_reminder&message_id=eq.${plain}&select=id`,
  );
  expect(notices).toHaveLength(1);

  await page.goto("/chat?view=catchup");
  await expect(item(page, `Budget numbers are in ${tag}`)).toBeVisible({ timeout: 20_000 });
  await expect(item(page, `Budget numbers are in ${tag}`)).toContainText(
    "you asked to be reminded",
  );
});

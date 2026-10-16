import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-8b · the right panel and the dialogs on the real app (AC15.5,
 * AC8.7's frames, AC11.4's people with state, AC10.9), against the local stack:
 *   scripts/agent/e2e.sh tests/chat-details.spec.ts
 * A Duo room of its own (details-owner@ and details-member@moduo.local). New
 * conversation makes a channel with someone in it; Details lists its people
 * (you first, with presence), Pinned, the empty Decisions and Reply chains
 * frames and a quiet history of every logged change; a pin opens in context
 * and a person opens their card; Browse channels joins a public channel; a
 * direct message with only yourself offers a note; a viewer can't start one.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = {
  email: "details-owner@moduo.local",
  password: "localdetailsowner",
  name: "Ola Nowak",
};
const MEMBER = {
  email: "details-member@moduo.local",
  password: "localdetailsmember",
  name: "Piotr Wis",
};

let room: ChatRoom;
let tag: string;
let channelId = "";

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Details ${tag}`);
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Conversations" });
const details = (page: Page) => page.locator('[data-slot="chat-details"]');
const panel = (page: Page) => page.locator('[data-panel-module="chat"]');

test("Details: history, decisions, chains, people", async ({ page }) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto("/chat");
  await expect(page).toHaveURL(new RegExp(`c=${room.general}`), { timeout: 20_000 });

  // New conversation from the left panel: a channel with Piotr in it.
  await nav(page).getByRole("button", { name: "New conversation" }).click();
  const dialog = page.getByRole("dialog", { name: "New conversation" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(`Launch ${tag}`);
  await dialog.getByLabel("Topic (optional)").fill("Homepage and brand guidelines");
  await dialog.getByLabel("People").fill("Piotr");
  await dialog.getByLabel("People").press("Enter");
  await expect(dialog.getByText(MEMBER.name)).toBeVisible();
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-slot="conversation-toolbar"] h1')).toHaveText(`Launch ${tag}`, {
    timeout: 20_000,
  });
  channelId = new URL(page.url()).searchParams.get("c") ?? "";
  expect(channelId).toBeTruthy();

  // Details is the panel's first view: About, Linked to, People (you first).
  // With Reply chains beside it (CV-12) the title is the view switcher, "Details ▾".
  await expect(panel(page).getByRole("button", { name: "Panel view: Details" })).toBeVisible();
  await expect(details(page).getByText("Homepage and brand guidelines")).toBeVisible();
  const people = details(page).locator('[data-slot="details-people"] button');
  await expect(people).toHaveCount(2, { timeout: 15_000 });
  await expect(people.first()).toContainText(OWNER.name);
  await expect(people.first()).toContainText("you");
  await expect(people.nth(1)).toContainText(MEMBER.name);
  await expect(people.first().locator('[data-slot="presence"]')).toBeVisible();
  // The toolbar counts the people Details read.
  await expect(page.locator('[data-slot="conversation-toolbar"]')).toContainText("2 people");

  // Decisions and Reply chains: their frames, empty until CV-14 / CV-12.
  await expect(details(page).locator('[data-slot="details-decisions"]')).toHaveText(
    "Nothing marked as a decision yet.",
  );
  await expect(details(page).locator('[data-slot="details-chains"]')).toHaveText(
    "No reply chains yet.",
  );

  // A pin and an edit land in Pinned and in the history (AC15.5).
  const id = await sendAs(room.member, channelId, `staging is up ${tag}`);
  await rpc(room.member, "chat_op_pin", { p_message_id: id, p_pinned: true });
  await expect(page.getByRole("article").filter({ hasText: `staging is up ${tag}` })).toBeVisible({
    timeout: 15_000,
  });
  const pinned = details(page).locator('[data-slot="details-pinned"] button');
  await expect(pinned).toHaveCount(1, { timeout: 15_000 });
  await expect(pinned).toContainText(`staging is up ${tag}`);
  const history = details(page).locator('[data-slot="details-history"]');
  await expect(history.locator('[data-op="chat.channel_create"]')).toContainText(
    "You created a channel",
  );
  await expect(history.locator('[data-op="chat.pin"]')).toContainText(
    `${MEMBER.name} pinned a message`,
  );

  // A pin opens in context: an item with "← Details" and "Open in conversation".
  await pinned.click();
  await expect(
    panel(page).getByRole("heading", { name: `Message from ${MEMBER.name}` }),
  ).toBeVisible();
  await expect(
    panel(page).locator('[data-slot="message-in-context"] [data-current]'),
  ).toContainText(`staging is up ${tag}`);
  await expect(panel(page).getByRole("button", { name: "Open in conversation" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Back to Details" }).click();

  // A person opens their card, with Message.
  await people.nth(1).click();
  const card = panel(page).locator('[data-slot="person-card"]');
  await expect(card).toContainText(MEMBER.name);
  await card.getByRole("button", { name: "Message" }).click();
  await expect(page.locator('[data-slot="conversation-toolbar"] h1')).toHaveText(MEMBER.name, {
    timeout: 20_000,
  });
});

test("Browse channels joins a public channel", async ({ page }) => {
  const made = await rpc<{ id: string } | Array<{ id: string }>>(
    room.member,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `Reading ${tag}`,
      p_topic: "Books we're reading",
      p_is_private: false,
      p_member_ids: [],
      p_announcement: false,
    },
  );
  const reading = (Array.isArray(made) ? made[0] : made)?.id;
  expect(reading).toBeTruthy();
  await signInPage(page, room.owner, room.ws);
  await page.goto("/chat?view=browse");
  const browse = page.locator('[data-slot="browse-channels"]');
  await expect(browse.getByRole("heading", { name: "Browse channels" })).toBeVisible({
    timeout: 20_000,
  });
  const row = browse.locator(`[data-browse-channel="${reading}"]`);
  await expect(row).toContainText("Books we're reading · 1 person");
  await row.getByRole("button", { name: `Join Reading ${tag}` }).click();
  await expect(page).toHaveURL(new RegExp(`c=${reading}`), { timeout: 15_000 });
  await expect(page.locator('[data-chat-composer] [contenteditable="true"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    nav(page).getByRole("button", { name: new RegExp(`^Reading ${tag}`) }),
  ).toBeVisible();
});

test("a direct message with only yourself offers a note; a viewer can't start one (AC10.9)", async ({
  page,
}) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  await expect(page.locator('[data-slot="conversation-toolbar"] h1')).toHaveText("General", {
    timeout: 20_000,
  });
  await nav(page).getByRole("button", { name: "New conversation" }).click();
  const dialog = page.getByRole("dialog", { name: "New conversation" });
  await dialog.getByRole("radio", { name: "Direct message" }).click();
  const to = dialog.getByLabel(/^To/);
  await to.fill("Ola");
  await to.press("Enter");
  await expect(dialog.locator('[data-slot="dm-self"]')).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Capture a note" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await rest(
    "service",
    `workspace_members?workspace_id=eq.${room.ws}&user_id=eq.${room.member.user.id}`,
    { method: "PATCH", body: { role: "viewer" } },
  );
  try {
    await signInPage(page, room.member, room.ws);
    await page.goto(`/chat?c=${room.general}`);
    await expect(details(page)).toBeVisible({ timeout: 20_000 });
    await expect(nav(page).getByRole("button", { name: "New conversation" })).toHaveCount(0);
    await details(page)
      .locator('[data-slot="details-people"] button')
      .filter({ hasText: OWNER.name })
      .click();
    await expect(panel(page).locator('[data-slot="person-card"]')).toContainText(OWNER.name);
    await expect(panel(page).getByRole("button", { name: "Message" })).toHaveCount(0);
  } finally {
    await rest(
      "service",
      `workspace_members?workspace_id=eq.${room.ws}&user_id=eq.${room.member.user.id}`,
      { method: "PATCH", body: { role: "member" } },
    );
  }
});

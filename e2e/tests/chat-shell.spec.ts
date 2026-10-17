import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-8a · the shell on the real app (AC2.1, AC1.8, AC10.9), against
 * the local stack:
 *   scripts/agent/e2e.sh tests/chat-shell.spec.ts
 * A Duo room of its own (shell-owner@ and shell-member@moduo.local): Chat
 * lands on General with its welcome, which goes after the first message; the
 * left panel lists your conversations; a public channel you're not in offers
 * Join; an announcement channel and a viewer get a line, not a box; a link to
 * a conversation this workspace doesn't hold says so and stays.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = {
  email: "shell-owner@moduo.local",
  password: "localshellowner",
  name: "Anna Kowalska",
};
const MEMBER = {
  email: "shell-member@moduo.local",
  password: "localshellmember",
  name: "Tomek Bak",
};

let room: ChatRoom;
let tag: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Shell ${tag}`);
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const panel = (page: Page) => page.getByRole("navigation", { name: "Conversations" });
const composer = (page: Page) => page.locator('[data-chat-composer] [contenteditable="true"]');
const line = (page: Page) => page.locator("[data-composer-line]");

test("lands on General with the welcome, which goes after the first message (AC2.1)", async ({
  page,
}) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto("/chat");
  await expect(page).toHaveURL(new RegExp(`c=${room.general}`), { timeout: 20_000 });
  await expect(page.locator('[data-slot="conversation-toolbar"] h1')).toHaveText("General");
  await expect(page.locator('[data-slot="chat-welcome"]')).toHaveText(
    "Reply to keep answers together · @ links anything in Moduo",
  );
  await expect(panel(page).getByRole("button", { name: /^Catch up/ })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: /^General/ })).toBeVisible();
  await expect(composer(page)).toBeVisible();

  await sendAs(room.member, room.general, `hello ${tag}`);
  await expect(page.getByRole("article").filter({ hasText: `hello ${tag}` })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: `hello ${tag}` })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-slot="chat-welcome"]')).toHaveCount(0);
});

test("a public channel you're not in offers Join; joining puts it in your panel", async ({
  page,
}) => {
  const made = await rpc<{ id: string } | Array<{ id: string }>>(
    room.member,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `Design ${tag}`,
      p_topic: "",
      p_is_private: false,
      p_member_ids: [],
      p_announcement: false,
    },
  );
  const id = (Array.isArray(made) ? made[0] : made)?.id;
  expect(id).toBeTruthy();
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${id}`);
  await expect(line(page)).toHaveAttribute("data-composer-line", "join", { timeout: 20_000 });
  await expect(composer(page)).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: new RegExp(`^Design ${tag}`) })).toHaveCount(
    0,
  );
  await line(page).getByRole("button", { name: "Join" }).click();
  await expect(composer(page)).toBeVisible({ timeout: 15_000 });
  await expect(
    panel(page).getByRole("button", { name: new RegExp(`^Design ${tag}`) }),
  ).toBeVisible();
});

test("an announcement channel and a viewer get a line, never a box (AC1.8, AC10.9)", async ({
  page,
}) => {
  await rpc(room.owner, "chat_op_set_announcement", { p_channel_id: room.general, p_on: true });
  await signInPage(page, room.member, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  await expect(line(page)).toHaveText("Only managers post here · Reply privately", {
    timeout: 20_000,
  });
  await expect(composer(page)).toHaveCount(0);
  await rpc(room.owner, "share_op_announce", { p_channel_id: room.general, p_on: false });

  await rest(
    "service",
    `workspace_members?workspace_id=eq.${room.ws}&user_id=eq.${room.member.user.id}`,
    {
      method: "PATCH",
      body: { role: "viewer" },
    },
  );
  try {
    await page.reload();
    await expect(line(page)).toHaveText("You can read this conversation but not post in it", {
      timeout: 20_000,
    });
    await expect(composer(page)).toHaveCount(0);
    const hello = page.getByRole("article").filter({ hasText: `hello ${tag}` });
    await expect(hello).toBeVisible();
    // A viewer still reacts (AC10.9).
    await hello.hover();
    await hello.getByRole("button", { name: "React 👍" }).click();
    await expect(hello.locator("button[aria-pressed='true']")).toBeVisible({ timeout: 15_000 });
  } finally {
    await rest(
      "service",
      `workspace_members?workspace_id=eq.${room.ws}&user_id=eq.${room.member.user.id}`,
      { method: "PATCH", body: { role: "member" } },
    );
  }
});

test("a link to a conversation this workspace doesn't hold says so and stays", async ({ page }) => {
  await signInPage(page, room.owner, room.ws);
  const missing = crypto.randomUUID();
  await page.goto(`/chat?c=${missing}`);
  await expect(page.getByText("That conversation isn't available")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(new RegExp(`c=${missing}`));
});

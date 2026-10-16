import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-13 · linked channels (AC9.1, AC9.2, AC5.1, AC6.1), against the
 * local stack:
 *   scripts/agent/e2e.sh tests/chat-links.spec.ts
 * Its people (links-owner@ and links-member@moduo.local) work in a Duo
 * workspace the spec makes and removes.
 */

test.describe.configure({ mode: "serial", timeout: 150_000 });

const OWNER = { email: "links-owner@moduo.local", password: "locallinksowner", name: "Maja Nowak" };
const MEMBER = {
  email: "links-member@moduo.local",
  password: "locallinksmember",
  name: "Sofia Reyes",
};

let room: ChatRoom;
let tag: string;
let projectId: string;
let projectName: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Links ${tag}`);
  projectId = crypto.randomUUID();
  projectName = `Website ${tag}`;
  await rest("service", "buckets", {
    method: "POST",
    body: {
      id: projectId,
      workspace_id: room.ws,
      owner_id: room.owner.user.id,
      name: projectName,
      is_system: false,
      position: "0001",
    },
  });
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

async function openConversation(page: Page, channelId: string): Promise<void> {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${channelId}`);
  await expect(page.getByTestId("message-stream")).toBeVisible({ timeout: 20_000 });
}

test("Start a conversation for a project: linked channel, its chip, Details, the project's line", async ({
  page,
}) => {
  const channel = await rpc<{ id: string; name: string; linked_id: string }>(
    room.owner,
    "chat_op_start_conversation",
    { p_workspace_id: room.ws, p_type: "bucket", p_id: projectId },
  );
  expect(channel.name).toBe(projectName);
  expect(channel.linked_id).toBe(projectId);
  // The member joins the public channel and posts: the owner has 1 new.
  await rpc(room.member, "chat_op_join", { p_channel_id: channel.id });
  await sendAs(room.member, channel.id, `Homepage draft is up ${tag}`);

  const lines = await rpc<Array<{ relation: string; unread: number }>>(
    room.owner,
    "chat_conversations_for_item",
    { p_type: "project", p_id: projectId },
  );
  expect(lines.find((l) => l.relation === "conversation-of")?.unread).toBe(1);

  await openConversation(page, channel.id);
  await expect(page.locator("[data-slot='link-chip']")).toContainText(projectName);
  const details = page.locator("[data-slot='details-link']");
  await expect(details).toContainText(projectName);

  // Unlink, then link again through "Link to…".
  await details.getByRole("button", { name: "Unlink" }).click();
  await expect(details).toContainText("Not linked to a project, client or team yet.");
  await details.getByRole("button", { name: "Link to…" }).click();
  await page.keyboard.type(projectName);
  await page
    .getByRole("option", { name: new RegExp(projectName) })
    .first()
    .click();
  await expect(details).toContainText(projectName);
  await expect(page.locator("[data-slot='link-chip']")).toContainText(projectName);
});

test("a team link offers its people once", async ({ page }) => {
  const teamId = crypto.randomUUID();
  await rest("service", "teams", {
    method: "POST",
    body: { id: teamId, workspace_id: room.ws, name: `Design ${tag}`, mark: "D" },
  });
  await rest("service", "team_members", {
    method: "POST",
    body: [
      { workspace_id: room.ws, team_id: teamId, user_id: room.owner.user.id },
      { workspace_id: room.ws, team_id: teamId, user_id: room.member.user.id },
    ],
  });
  const channel = await rpc<{ id: string }>(room.owner, "chat_op_create_channel", {
    p_workspace_id: room.ws,
    p_name: `team-room ${tag}`,
    p_topic: "",
    p_is_private: false,
    p_member_ids: [],
    p_announcement: false,
  });
  await openConversation(page, channel.id);
  const details = page.locator("[data-slot='details-link']");
  await details.getByRole("button", { name: "Link to…" }).click();
  await page.keyboard.type(`Design ${tag}`);
  await page
    .getByRole("option", { name: new RegExp(`Design ${tag}`) })
    .first()
    .click();
  const offer = page.locator("[data-slot='team-offer']");
  await expect(offer).toContainText("Add the team's 1 person?");
  await offer.getByRole("button", { name: "Add" }).click();
  await expect(offer).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await rest<Array<{ user_id: string }>>(
            "service",
            `chat_members?channel_id=eq.${channel.id}&user_id=eq.${room.member.user.id}&left_at=is.null&select=user_id`,
          )
        ).length,
    )
    .toBe(1);
});

test("from the project's ⋯ and the company's hub: Start a conversation, then the item's line", async ({
  page,
}) => {
  const launchId = crypto.randomUUID();
  const launch = `Launch ${tag}`;
  await rest("service", "buckets", {
    method: "POST",
    body: {
      id: launchId,
      workspace_id: room.ws,
      owner_id: room.owner.user.id,
      name: launch,
      is_system: false,
      position: "0002",
    },
  });
  const companyId = crypto.randomUUID();
  const company = `Acme ${tag}`;
  await rest("service", "companies", {
    method: "POST",
    body: { id: companyId, workspace_id: room.ws, owner_id: room.owner.user.id, name: company },
  });

  // The project's ⋯ → Start a conversation opens the new channel, linked.
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/tasks?id=${launchId}`);
  await page.getByRole("button", { name: "Project actions" }).first().click();
  await page.getByRole("menuitem", { name: "Start a conversation" }).click();
  await expect(page).toHaveURL(/\/chat/, { timeout: 20_000 });
  await expect(page.locator("[data-slot='link-chip']")).toContainText(launch);

  // Back on the project: its overview shows "Conversation: Launch …".
  await page.goto(`/tasks?id=${launchId}`);
  await page.getByRole("button", { name: "Project actions" }).first().click();
  await page.getByRole("menuitem", { name: "Project details" }).click();
  await expect(page.locator("[data-slot='item-conversation']").first()).toContainText(
    `Conversation: ${launch}`,
    { timeout: 20_000 },
  );

  // The company's hub: ⋯ → Start a conversation, then its Linked shows the line.
  await page.goto(`/contacts?type=company&id=${companyId}`);
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Start a conversation" }).click();
  await expect(page).toHaveURL(/\/chat/, { timeout: 20_000 });
  await expect(page.locator("[data-slot='link-chip']")).toContainText(company);
  await page.goto(`/contacts?type=company&id=${companyId}`);
  await expect(page.locator("[data-slot='item-conversation']").first()).toContainText(
    `Conversation: ${company}`,
    { timeout: 20_000 },
  );
});

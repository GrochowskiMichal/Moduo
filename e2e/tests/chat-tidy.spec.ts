import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-16 · tidying up on the real app (AC8.6, AC5.6, AC8.9), against
 * the local stack:
 *   scripts/agent/e2e.sh tests/chat-tidy.spec.ts
 * A Duo room of its own (tidy-owner@ and tidy-member@moduo.local). ⌘-click
 * picks messages and the bottom bar shows "2 selected · Esc" with Move ·
 * Task · Delete; M asks where to; moving into a conversation the member
 * couldn't read before says so first ("1 person who isn't in … will see
 * this"); both conversations get a quiet line naming who moved them; Undo
 * within 8 s puts them back.
 *
 * "Make a note" (AC8.9) waits on Notes' op (Notes' call N19), which isn't on
 * this branch: the action is hidden and its test is a documented skip.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = { email: "tidy-owner@moduo.local", password: "localtidyowner", name: "Ola Nowak" };
const MEMBER = { email: "tidy-member@moduo.local", password: "localtidymember", name: "Piotr Kos" };

let room: ChatRoom;
let tag: string;
let privateId = "";

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Tidy ${tag}`);
  const made = await rpc<{ id: string } | Array<{ id: string }>>(
    room.owner,
    "chat_op_create_channel",
    {
      p_workspace_id: room.ws,
      p_name: `tidy-${tag}`.toLowerCase(),
      p_topic: "",
      p_is_private: true,
      p_member_ids: [],
      p_announcement: false,
    },
  );
  privateId = Array.isArray(made) ? (made[0]?.id ?? "") : made.id;
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const row = (page: Page, text: string) =>
  page.getByTestId("message-stream").getByRole("article").filter({ hasText: text });
const modeRow = (page: Page) => page.locator('[data-slot="global-bottom-bar"][data-mode]');
const channelOf = async (id: string) =>
  (
    await rest<Array<{ channel_id: string }>>(
      "service",
      `chat_messages?id=eq.${id}&select=channel_id`,
    )
  )[0]?.channel_id;

test.describe("Move to…", () => {
  test("⌘-click two messages, M, the audience warning, both lines, Undo", async ({ page }) => {
    const first = await sendAs(room.owner, privateId, `Draft budget ${tag}`);
    const second = await sendAs(room.owner, privateId, `Numbers from Q3 ${tag}`);

    await signInPage(page, room.owner, room.ws);
    await page.goto(`/chat?c=${privateId}`);
    await expect(row(page, `Numbers from Q3 ${tag}`)).toBeVisible({ timeout: 20_000 });

    // ⌘-click picks; the bottom bar swaps to the mode row.
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await row(page, `Draft budget ${tag}`).click({ modifiers: [mod] });
    await row(page, `Numbers from Q3 ${tag}`).click({ modifiers: [mod] });
    await expect(modeRow(page)).toContainText("2 selected · Esc");
    await expect(modeRow(page).getByRole("button", { name: /Move/ })).toBeVisible();
    await expect(modeRow(page).getByRole("button", { name: /Task/ })).toBeVisible();
    await expect(modeRow(page).getByRole("button", { name: /Delete/ })).toBeVisible();

    // M asks where to; General's people include the member, who isn't in here.
    await page.getByTestId("message-stream").press("m");
    const dialog = page.locator('[data-slot="move-dialog"]');
    await expect(dialog.getByText("Move to…")).toBeVisible();
    await dialog.getByRole("button", { name: /general/i }).click();
    await expect(dialog).toContainText(
      `1 person who isn't in tidy-${tag.toLowerCase()} will see this`,
    );
    expect(await channelOf(first)).toBe(privateId);
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(page.getByText("Moved to general")).toBeVisible();
    await expect(row(page, `Draft budget ${tag}`)).toHaveCount(0);
    await expect(
      page.getByRole("note").filter({ hasText: "You moved 2 messages to" }),
    ).toBeVisible();
    expect(await channelOf(first)).toBe(room.general);
    expect(await channelOf(second)).toBe(room.general);
    // Its author stays; the trail says who moved it and from where.
    const moved = await rest<
      Array<{ author_id: string; moved_by: string; moved_from_channel_id: string }>
    >("service", `chat_messages?id=eq.${first}&select=author_id,moved_by,moved_from_channel_id`);
    expect(moved[0]).toEqual({
      author_id: room.owner.user.id,
      moved_by: room.owner.user.id,
      moved_from_channel_id: privateId,
    });

    // Undo (8 s): back where they were, both lines gone.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row(page, `Draft budget ${tag}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("note").filter({ hasText: "You moved 2 messages to" })).toHaveCount(
      0,
    );
    expect(await channelOf(first)).toBe(privateId);
  });

  test("a member can't move into a conversation they can't read", async ({ page }) => {
    const stray = await sendAs(room.member, room.general, `Stray question ${tag}`);
    // The owner's private channel: refused, nothing moved.
    await expect(
      rpc(room.member, "chat_op_move_messages", {
        p_ids: [stray],
        p_target_channel_id: privateId,
        p_confirm: false,
      }),
    ).rejects.toThrow(/42501|not a member/);
    expect(await channelOf(stray)).toBe(room.general);

    await signInPage(page, room.member, room.ws);
    await page.goto(`/chat?c=${room.general}`);
    await expect(row(page, `Stray question ${tag}`)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Make a note", () => {
  test("three messages become one note in the Notes Inbox, quoted with authors and times", async () => {
    test.skip(
      true,
      "Notes' op for Make a note (Notes' call N19) isn't on this branch; the action stays hidden until it exists (CV-16 record).",
    );
  });
});

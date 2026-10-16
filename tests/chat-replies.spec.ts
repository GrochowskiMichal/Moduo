import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-12 · replies and Wrap up on the real app (AC8.1, AC8.2, AC8.3,
 * AC8.4, AC8.8, AC2.6), against the local stack:
 *   scripts/agent/e2e.sh tests/chat-replies.spec.ts
 * A Duo room of its own (replies-owner@ and replies-member@moduo.local).
 * Replies post in the stream with a quote line; "N replies ›" opens the chain
 * on the right with its own box and Stop following; a reply from that box
 * posts in the stream; nothing folds by itself; Wrap up asks which reply
 * settled it, the replies leave the stream and the root says who wrapped it
 * up, while the other person's unread reply stays in their Catch up; the
 * Reply chains view lists open chains first and wrapped ones under "Wrapped
 * up"; Reply (the toolbar) answers a message from the main box.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = {
  email: "replies-owner@moduo.local",
  password: "localrepliesowner",
  name: "Sofia Ortiz",
};
const MEMBER = {
  email: "replies-member@moduo.local",
  password: "localrepliesmember",
  name: "Jana Lis",
};

let room: ChatRoom;
let tag: string;
let rootId = "";

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Replies ${tag}`);
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const row = (page: Page, text: string) =>
  page.getByTestId("message-stream").getByRole("article").filter({ hasText: text });
const panel = (page: Page) => page.locator('[data-panel-module="chat"]');
const chainItem = (page: Page) => page.locator('[data-slot="chain-item"]');
const composer = (page: Page) => page.locator('[data-chat-composer] [contenteditable="true"]');

/** The member's open Catch up items for a chain (read as the service role). */
const openCatchup = (root: string) =>
  rest<unknown[]>(
    "service",
    `chat_catchup?user_id=eq.${room.member.user.id}&chain_root_id=eq.${root}&done_at=is.null&select=id`,
  );

test.describe("stream quotes, chain panel, Reply chains", () => {
  test("a reply quotes; N replies opens the chain; Wrap up hides the replies", async ({ page }) => {
    rootId = await sendAs(room.owner, room.general, `Logo SVGs from Anna ${tag}?`);
    const r1 = await sendAs(room.member, room.general, `I'll ask her today ${tag}`, rootId);
    await sendAs(room.member, room.general, `Standup moved ${tag}`);
    // A reply to a reply joins the root's chain and quotes the reply it answers.
    await sendAs(room.member, room.general, `Meeting her at 2 ${tag}`, r1);

    await signInPage(page, room.owner, room.ws);
    await page.goto(`/chat?c=${room.general}`);

    // AC8.1: replies sit in the stream with a quote line of what they answer.
    await expect(row(page, `I'll ask her today ${tag}`).first()).toBeVisible({ timeout: 20_000 });
    await expect(
      row(page, `I'll ask her today ${tag}`)
        .first()
        .getByRole("button", {
          name: new RegExp(`Logo SVGs from Anna ${tag}`),
        }),
    ).toBeVisible();
    await expect(
      row(page, `Meeting her at 2 ${tag}`).getByRole("button", {
        name: new RegExp(`I'll ask her today ${tag}`),
      }),
    ).toBeVisible();
    // AC8.8: nothing folds by itself; the talk between replies stays where it was.
    await expect(row(page, `Standup moved ${tag}`)).toBeVisible();
    const root = row(page, `Logo SVGs from Anna ${tag}?`).first();
    await expect(root.locator('[data-slot="chain-replies"]')).toContainText("2 replies");
    await expect(root.locator('[data-slot="chain-replies"]')).toContainText("Jana");

    // AC8.2: "2 replies ›" opens the chain on the right, with its box and Stop following.
    await root.locator('[data-slot="chain-replies"]').click();
    await expect(panel(page).getByRole("heading", { name: "Reply chain" })).toBeVisible();
    await expect(chainItem(page)).toContainText(`I'll ask her today ${tag}`);
    await expect(chainItem(page)).toContainText(`Meeting her at 2 ${tag}`);
    await expect(chainItem(page).getByRole("separator", { name: "2 replies" })).toBeVisible();
    const stop = chainItem(page).getByRole("button", { name: "Stop following" });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(chainItem(page)).toContainText("You stopped following");
    await chainItem(page).getByRole("button", { name: "Follow" }).click();
    await expect(chainItem(page).getByRole("button", { name: "Stop following" })).toBeVisible();

    // A reply from the chain's box posts in the stream, quoting the root.
    const box = chainItem(page).locator('[contenteditable="true"]');
    await box.click();
    await page.keyboard.type(`Got them both ${tag}`);
    await page.keyboard.press("Enter");
    await expect(row(page, `Got them both ${tag}`).first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .locator('[data-testid="message-stream"]')
        .getByRole("article")
        .filter({ hasText: `Got them both ${tag}` })
        .getByRole("button", { name: new RegExp(`Logo SVGs from Anna ${tag}`) }),
    ).toBeVisible();
    await expect(root.locator('[data-slot="chain-replies"]')).toContainText("3 replies", {
      timeout: 15_000,
    });

    // Jana replied in the chain, so Sofia's reply waits in her Catch up.
    await expect.poll(async () => (await openCatchup(rootId)).length).toBeGreaterThan(0);

    // AC8.3: Wrap up asks which reply settled it (the last one picked).
    await panel(page).getByRole("button", { name: "Wrap up" }).click();
    const dialog = page.getByRole("dialog", { name: "Which reply settled it?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(1);
    await expect(
      dialog.locator("label").filter({ has: page.getByRole("radio", { checked: true }) }),
    ).toContainText(`Got them both ${tag}`);
    await dialog.getByRole("button", { name: "Wrap up" }).click();
    await expect(dialog).toHaveCount(0);

    // The replies leave the stream; the root says who wrapped it up and what settled it.
    const stream = page.getByTestId("message-stream");
    await expect(
      stream.getByRole("article").filter({ hasText: `I'll ask her today ${tag}` }),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(
      stream.getByRole("article").filter({ hasText: `Meeting her at 2 ${tag}` }),
    ).toHaveCount(0);
    await expect(
      stream.getByRole("article").filter({ hasText: `Got them both ${tag}` }),
    ).toHaveCount(1); // only the root, quoting the settled reply
    await expect(row(page, `Standup moved ${tag}`)).toBeVisible();
    await expect(root.locator('[data-slot="chain-wrapped"]')).toContainText("Wrapped up by you");
    await expect(root.locator('[data-slot="chain-wrapped"]')).toContainText(`Got them both ${tag}`);
    await expect(chainItem(page).locator('[data-slot="chain-settled"]')).toHaveText("Settled it");
    await expect(panel(page).getByRole("button", { name: "Reopen" })).toBeVisible();

    // The wrap-up is on the server, and Jana's unread reply stays in her Catch up.
    await expect
      .poll(async () => {
        const rows = await rest<Array<{ wrapped_at: string | null; settled_id: string | null }>>(
          "service",
          `chat_messages?id=eq.${rootId}&select=wrapped_at,settled_id`,
        );
        return !!rows[0]?.wrapped_at && !!rows[0]?.settled_id;
      })
      .toBe(true);
    await page.waitForTimeout(1_000);
    expect((await openCatchup(rootId)).length).toBeGreaterThan(0);
  });

  test("Reply chains lists open chains first, wrapped ones below", async ({ page }) => {
    const open = await sendAs(room.member, room.general, `Which font for the deck ${tag}`);
    await sendAs(room.owner, room.general, `Geist, I think ${tag}`, open);

    await signInPage(page, room.owner, room.ws);
    await page.goto(`/chat?c=${room.general}`);
    await expect(row(page, `Geist, I think ${tag}`)).toBeVisible({ timeout: 20_000 });

    // Details' section: both chains, open first.
    const details = page.locator('[data-slot="chat-details"]');
    const compact = details.locator('[data-slot="details-chains"] button');
    await expect(compact).toHaveCount(2, { timeout: 15_000 });
    await expect(compact.first()).toContainText(`Which font for the deck ${tag}`);
    await expect(compact.nth(1)).toContainText(`Logo SVGs from Anna ${tag}`);

    // AC8.4: the Reply chains view (the panel's switcher shows it now).
    await panel(page).getByRole("button", { name: "Panel view: Details" }).click();
    await page.getByRole("menuitemradio", { name: /Reply chains/ }).click();
    const view = page.locator('[data-slot="reply-chains"]');
    await expect(view.getByRole("list", { name: "Open reply chains" })).toContainText(
      `Which font for the deck ${tag}`,
    );
    await expect(view.getByRole("list", { name: "Wrapped up" })).toContainText(
      `Logo SVGs from Anna ${tag}`,
    );
    await expect(view.getByRole("list", { name: "Open reply chains" })).not.toContainText(
      `Logo SVGs from Anna ${tag}`,
    );

    // A row opens its chain as an item.
    await view.locator(`[data-chain="${open}"]`).click();
    await expect(panel(page).getByRole("heading", { name: "Reply chain" })).toBeVisible();
    await expect(chainItem(page)).toContainText(`Geist, I think ${tag}`);
  });

  test("Reply answers from the main box; Esc lets go of it", async ({ page }) => {
    await signInPage(page, room.owner, room.ws);
    await page.goto(`/chat?c=${room.general}`);
    const standup = row(page, `Standup moved ${tag}`);
    await expect(standup).toBeVisible({ timeout: 20_000 });

    // Esc in the empty box lets go of the reply first.
    await standup.hover();
    await standup.getByRole("button", { name: "Reply", exact: true }).click();
    const bar = page.locator('[data-slot="replying-to"]');
    await expect(bar).toContainText(`Replying to ${MEMBER.name}`);
    await expect(composer(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);

    await standup.hover();
    await standup.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(bar).toContainText(`Standup moved ${tag}`);
    await composer(page).click();
    await page.keyboard.type(`Thanks for the heads-up ${tag}`);
    await page.keyboard.press("Enter");
    await expect(bar).toHaveCount(0);
    const answer = row(page, `Thanks for the heads-up ${tag}`);
    await expect(answer).toBeVisible({ timeout: 15_000 });
    await expect(
      answer.getByRole("button", { name: new RegExp(`Standup moved ${tag}`) }),
    ).toBeVisible();
    await expect(standup.first().locator('[data-slot="chain-replies"]')).toContainText("1 reply", {
      timeout: 15_000,
    });
  });
});

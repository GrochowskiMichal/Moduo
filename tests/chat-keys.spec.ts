import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-7b · the composer and the key map (AC4.3, AC4.6, AC4.7, AC2.7,
 * AC9.7), against the local stack:
 *   scripts/agent/e2e.sh tests/chat-keys.spec.ts
 * Its people (keys-owner@ and keys-member@moduo.local) work in a Duo
 * workspace the spec makes and removes.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = { email: "keys-owner@moduo.local", password: "localkeysowner", name: "Sofia Ortiz" };
const MEMBER = { email: "keys-member@moduo.local", password: "localkeysmember", name: "Mike Chen" };

let room: ChatRoom;
let tag: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Keys ${tag}`);
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

async function openGeneral(page: Page): Promise<void> {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  await expect(page.getByTestId("message-stream")).toBeVisible({ timeout: 20_000 });
}

const panel = (page: Page) => page.locator('[data-panel-module="chat"]');
const composer = (page: Page) => page.locator('[data-chat-composer] [contenteditable="true"]');
const row = (page: Page, text: string) =>
  page.getByRole("article").filter({ hasText: text }).first();

async function stored(fragment: string): Promise<string | null> {
  const rows = await rest<Array<{ body: string }>>(
    "service",
    `chat_messages?channel_id=eq.${room.general}&select=body&order=created_at.desc&limit=30`,
  );
  return rows.find((r) => r.body.includes(fragment))?.body ?? null;
}

test("the key map", async ({ page }) => {
  await openGeneral(page);
  const box = composer(page);
  // The composer is focused by default.
  await expect(box).toBeFocused();

  // ⇧⏎ makes a new line; ⏎ sends; the tools drop below once it grows.
  await box.pressSequentially(`line one ${tag}`);
  await box.press("Shift+Enter");
  await box.pressSequentially(`line two ${tag}`);
  await expect(page.locator("[data-composer-box] [aria-label='Send']")).toBeVisible();
  await box.press("Enter");
  await expect(row(page, `line two ${tag}`)).toBeVisible();
  await expect.poll(() => stored(`line one ${tag}`)).toBe(`line one ${tag}\nline two ${tag}`);
  await expect(box).toHaveText("");

  // ⌘⏎ sends too; `+` typed in the composer is just text (it reacts only in the stream).
  await box.pressSequentially(`plus + ${tag}`);
  await box.press("ControlOrMeta+Enter");
  await expect.poll(() => stored(`plus + ${tag}`)).toBe(`plus + ${tag}`);

  // ↑ in an empty composer edits your last message; Esc cancels back here.
  await box.press("ArrowUp");
  const edit = page.getByRole("textbox", { name: "Edit message" });
  await expect(edit).toBeVisible();
  await expect(edit).toHaveText(`plus + ${tag}`);
  await edit.press("Escape");
  await expect(edit).toHaveCount(0);
  await expect(box).toBeFocused();

  // Esc in an empty composer moves focus to the newest message.
  await box.press("Escape");
  await expect(page.getByTestId("message-stream")).toBeFocused();
  await expect(page.locator("[data-selected]")).toContainText(`plus + ${tag}`);
  // The feed names the selected message for screen readers.
  const active = await page.getByTestId("message-stream").getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`#${active}`)).toHaveAttribute("aria-posinset", /\d+/);

  // A letter that isn't a message key types into the composer.
  await page.keyboard.press("w");
  await expect(box).toBeFocused();
  await expect(box).toHaveText("w");
  await box.press("Backspace");

  // `@` finds people first; the pick is a chip, stored as a reference.
  await box.pressSequentially("@Mik");
  const menu = page.getByRole("listbox", { name: "Mention" });
  await expect(menu.getByRole("option").first()).toContainText(MEMBER.name);
  await page.keyboard.press("Tab");
  await box.pressSequentially(`hi ${tag}`);
  await box.press("Enter");
  await expect
    .poll(() => stored(`hi ${tag}`))
    .toBe(`moduo://person/${room.member.user.id} hi ${tag}`);
  await expect(row(page, `hi ${tag}`)).toContainText(`@${MEMBER.name}`);
});

test("code keeps its backticks through an edit; drafts stay", async ({ page }) => {
  await openGeneral(page);
  const box = composer(page);
  // Markdown shortcuts as you type: `code` becomes inline code.
  await box.pressSequentially(`run \`bun test\` now ${tag}`);
  await box.press("Enter");
  await expect.poll(() => stored(`now ${tag}`)).toBe(`run \`bun test\` now ${tag}`);
  await expect(row(page, `now ${tag}`).locator("code")).toHaveText("bun test");
  // The edit opens what was sent, code and all, and saves it back unchanged but for the edit.
  await box.press("ArrowUp");
  const edit = page.getByRole("textbox", { name: "Edit message" });
  await expect(edit.locator("code")).toHaveText("bun test");
  await edit.press("End");
  await edit.pressSequentially("!");
  await edit.press("Enter");
  await expect.poll(() => stored(`now ${tag}!`)).toBe(`run \`bun test\` now ${tag}!`);

  // A draft is kept per conversation, on this device.
  await box.pressSequentially(`draft ${tag}`);
  await page.waitForTimeout(1_500);
  await page.reload();
  await expect(composer(page)).toHaveText(`draft ${tag}`, { timeout: 20_000 });
  await composer(page).press("ControlOrMeta+a");
  await composer(page).press("Backspace");
});

test("/task opens the capture; the new task lands as a chip", async ({ page }) => {
  await openGeneral(page);
  const box = composer(page);
  await box.pressSequentially(`/task Order frames ${tag}`);
  await expect(
    page.getByRole("option", { name: new RegExp(`Task “Order frames ${tag}”`) }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const capture = page.getByRole("dialog", { name: "Capture" });
  await expect(capture).toBeVisible();
  await expect(capture).toContainText(`Order frames ${tag}`);
  await page.keyboard.press("Enter");
  await expect(capture).toHaveCount(0);
  // The chip is in the composer; sending stores the task's reference, never its title.
  await expect(page.locator("[data-chat-composer] [data-lexical-decorator]")).toHaveCount(1, {
    timeout: 15_000,
  });
  await box.pressSequentially(`is the one ${tag}`);
  await box.press("Enter");
  await expect
    .poll(() => stored(`is the one ${tag}`))
    .toMatch(new RegExp(`^moduo://task/[0-9a-f-]{36}\\s+is the one ${tag}$`));
});

test("a message over 8,000 characters is refused with the count", async ({ page }) => {
  await openGeneral(page);
  const box = composer(page);
  await box.fill(`${"x".repeat(8_001)}`);
  await box.press("Enter");
  await expect(page.getByRole("alert")).toContainText("8,001 characters");
  await expect(box).not.toHaveText("");
  await box.press("ControlOrMeta+a");
  await box.press("Backspace");
});

// CV-22: the rows of §16 CV-7a and CV-7b didn't cover: anywhere in Chat
// (⌥↑↓, ⌥⇧↓, ⌥1 ⌥2 from the composer too) and the chain panel (⏎ in its box,
// Esc back). Catch up's keys are proven in chat-catchup.spec.ts.
test("the key map: anywhere in Chat and the chain panel", async ({ page }) => {
  const opened = await rpc<{ id: string } | Array<{ id: string }>>(room.member, "chat_op_open_dm", {
    p_workspace_id: room.ws,
    p_user_ids: [room.owner.user.id],
  });
  const dm = (Array.isArray(opened) ? opened[0] : opened)?.id ?? "";
  expect(dm).toBeTruthy();
  const root = await sendAs(room.member, room.general, `chain root ${tag}`);
  await sendAs(room.member, room.general, `first reply ${tag}`, root);
  await openGeneral(page);
  // The member writes in the direct message after the page is open: it's unread.
  await sendAs(room.member, dm, `ping ${tag}`);
  const box = composer(page);
  await expect(box).toBeFocused();

  // ⌥⇧↓ jumps to the next unread conversation, from the composer too.
  await expect(page.getByRole("link", { name: new RegExp(MEMBER.name) }).first()).toBeVisible({
    timeout: 20_000,
  });
  await box.press("Alt+Shift+ArrowDown");
  await expect(page).toHaveURL(new RegExp(`c=${dm}`));
  // ⌥↑ and ⌥↓ step through conversations; with two, either way is the other.
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page).toHaveURL(new RegExp(`c=${room.general}`));
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page).toHaveURL(new RegExp(`c=${dm}`));
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page).toHaveURL(new RegExp(`c=${room.general}`));

  // ⌥2 and ⌥1 switch the panel's views about this conversation.
  await page.keyboard.press("Alt+Digit2");
  await expect(panel(page).getByRole("button", { name: "Panel view: Reply chains" })).toBeVisible();
  await page.keyboard.press("Alt+Digit1");
  await expect(panel(page).getByRole("button", { name: "Panel view: Details" })).toBeVisible();

  // The chain panel: ⏎ in its box replies in the chain; Esc goes back.
  const rootRow = row(page, `chain root ${tag}`);
  await rootRow.locator('[data-slot="chain-replies"]').click();
  const chain = page.locator('[data-slot="chain-item"]');
  await expect(chain).toContainText(`first reply ${tag}`);
  const chainBox = chain.locator('[contenteditable="true"]');
  await chainBox.click();
  await page.keyboard.type(`from the chain ${tag}`);
  await page.keyboard.press("Enter");
  await expect.poll(() => stored(`from the chain ${tag}`)).toBe(`from the chain ${tag}`);
  const replies = await rest<Array<{ parent_id: string | null }>>(
    "service",
    `chat_messages?channel_id=eq.${room.general}&body=eq.${encodeURIComponent(`from the chain ${tag}`)}&select=parent_id`,
  );
  expect(replies[0]?.parent_id).toBe(root);
  await chainBox.press("Escape");
  await expect(chain).toHaveCount(0);
});

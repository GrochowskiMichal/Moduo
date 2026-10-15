import { expect, type Page, test } from "@playwright/test";

import {
  type ChatRoom,
  makeChatRoom,
  removeChatRoom,
  seedHistory,
  sendAs,
} from "./support/chat-room";
import { rest, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-7a · the stream (AC1.1, AC1.3, AC1.6, AC1.11, AC1.14), against
 * the local stack:
 *   scripts/agent/e2e.sh tests/chat-stream.spec.ts
 * Its people (stream-owner@ and stream-member@moduo.local) work in a Duo
 * workspace the spec makes and removes; history is written as the service
 * role. The presence half of "honest errors" ("Presence isn't available")
 * is drawn by CV-17's presence shapes and CV-8a's states.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = {
  email: "stream-owner@moduo.local",
  password: "localstreamowner",
  name: "Sofia Ortiz",
};
const MEMBER = {
  email: "stream-member@moduo.local",
  password: "localstreammember",
  name: "Mike Chen",
};

let room: ChatRoom;
let tag: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Stream ${tag}`);
});

test.afterAll(async () => {
  await rest("service", `profiles?id=eq.${room?.owner.user.id}`, {
    method: "PATCH",
    body: { plan_tier: "duo" },
  }).catch(() => {});
  await removeChatRoom(room);
});

async function openGeneral(page: Page, extra = ""): Promise<void> {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}${extra}`);
  await expect(page.getByTestId("message-stream")).toBeVisible({ timeout: 20_000 });
}

const composer = (page: Page) => page.locator("[data-chat-composer] textarea");
const row = (page: Page, text: string) =>
  page.getByRole("article").filter({ hasText: text }).first();

async function serverRow(body: string): Promise<{ id: string; deleted_at: string | null } | null> {
  const rows = await rest<Array<{ id: string; deleted_at: string | null; body: string }>>(
    "service",
    `chat_messages?channel_id=eq.${room.general}&select=id,deleted_at,body&order=created_at.desc&limit=50`,
  );
  return rows.find((r) => r.body.includes(body)) ?? null;
}

test("offline send, retry, undo delete", async ({ page, context }) => {
  await seedHistory(room, [{ author: room.member, body: `hello ${tag}`, minutesAgo: 5 }]);
  await openGeneral(page);
  await expect(row(page, `hello ${tag}`)).toBeVisible();

  // Offline: the message sits in place as "Waiting to send", then sends itself.
  await context.setOffline(true);
  await composer(page).fill(`offline ${tag}`);
  await composer(page).press("Enter");
  const waiting = row(page, `offline ${tag}`);
  await expect(waiting).toBeVisible();
  await expect(waiting.getByText("Waiting to send")).toBeVisible();
  expect(await serverRow(`offline ${tag}`)).toBeNull();
  await context.setOffline(false);
  await expect(waiting.getByText("Waiting to send")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await serverRow(`offline ${tag}`))?.id ?? null).not.toBeNull();

  // A refusal (the plan paused) says "Not sent · Retry"; Retry sends it once allowed.
  await rest("service", `profiles?id=eq.${room.owner.user.id}`, {
    method: "PATCH",
    body: { plan_tier: "free" },
  });
  await composer(page).fill(`refused ${tag}`);
  await composer(page).press("Enter");
  const refused = row(page, `refused ${tag}`);
  await expect(refused.getByText("Not sent")).toBeVisible({ timeout: 15_000 });
  await rest("service", `profiles?id=eq.${room.owner.user.id}`, {
    method: "PATCH",
    body: { plan_tier: "duo" },
  });
  await refused.getByRole("button", { name: "Retry" }).click();
  await expect(refused.getByText("Not sent")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (await serverRow(`refused ${tag}`))?.id ?? null).not.toBeNull();

  // Delete: hidden at once, "Deleted · Undo", no confirm; Undo brings it back.
  const mine = row(page, `offline ${tag}`);
  await mine.hover();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await expect(row(page, `offline ${tag}`)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, `offline ${tag}`)).toBeVisible();
  await page.waitForTimeout(8_500);
  expect((await serverRow(`offline ${tag}`))?.deleted_at ?? null).toBeNull();

  // Without Undo, the server deletes it when the toast's time is up.
  await row(page, `offline ${tag}`).hover();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await expect(row(page, `offline ${tag}`)).toHaveCount(0);
  await expect
    .poll(async () => (await serverRow(`offline ${tag}`))?.deleted_at ?? null, { timeout: 15_000 })
    .not.toBeNull();
  await expect(row(page, `offline ${tag}`)).toHaveCount(0);
});

test("floating chip, jump bar, deep link", async ({ page }) => {
  // Two weeks of history, newest last.
  const history = Array.from({ length: 300 }, (_, i) => ({
    author: i % 4 < 2 ? room.member : room.owner,
    body: `history ${tag} #${i}`,
    minutesAgo: (300 - i) * 60 + 10,
  }));
  const ids = await seedHistory(room, history);
  await openGeneral(page);
  await expect(row(page, `history ${tag} #299`)).toBeVisible();

  // Scroll up a few screens and pin a reader's row.
  const stream = page.getByTestId("message-stream");
  await stream.evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollTop - 1500);
  });
  await page.waitForTimeout(400);
  const anchor = page.getByRole("article").nth(2);
  const anchorText = (await anchor.innerText()).split("\n").pop() ?? "";
  const before = (await anchor.boundingBox())?.y ?? 0;

  // A message arrives: the chip says so; the reader's row doesn't move.
  await sendAs(room.member, room.general, `arrived ${tag}`);
  await expect(page.getByRole("button", { name: /^1 new$/ })).toBeVisible({ timeout: 15_000 });
  const after = (await row(page, anchorText).boundingBox())?.y ?? 0;
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /^1 new$/ }).click();
  await expect(row(page, `arrived ${tag}`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d+ new$/ })).toHaveCount(0);

  // A deep link to a message from long ago: a window around it, lit, the jump bar.
  const old = ids[20]!;
  await page.goto(`/chat?c=${room.general}&m=${old}`);
  await expect(page.locator(`[data-message-id="${old}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`[data-message-id="${old}"][data-target]`)).toBeVisible();
  await expect(page.getByText(/Viewing messages from/)).toBeVisible();
  await page.getByRole("button", { name: "Jump to present" }).click();
  await expect(row(page, `arrived ${tag}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Viewing messages from/)).toHaveCount(0);
});

test("live chips, honest errors", async ({ page }) => {
  // A task referenced in a message shows its title and status as they are now.
  // Opening the app makes the owner's Inbox in a new workspace.
  await openGeneral(page);
  const inboxOf = async () =>
    (
      await rest<Array<{ id: string }>>(
        "service",
        `buckets?workspace_id=eq.${room.ws}&owner_id=eq.${room.owner.user.id}&is_system=eq.true&select=id`,
      )
    )[0];
  await expect.poll(async () => (await inboxOf())?.id ?? null, { timeout: 15_000 }).not.toBeNull();
  const inbox = await inboxOf();
  const [task] = await rest<Array<{ id: string }>>("service", "tasks", {
    method: "POST",
    body: {
      workspace_id: room.ws,
      bucket_id: inbox!.id,
      title: `Collect assets ${tag}`,
      status: "todo",
      owner_id: room.owner.user.id,
      assignee_id: room.owner.user.id,
      position: `z${tag}`,
    },
  });
  await sendAs(room.member, room.general, `Can you take moduo://task/${task!.id} today?`);
  const chip = page.getByRole("article").filter({ hasText: "today?" }).first();
  await expect(chip.getByText(`Collect assets ${tag}`)).toBeVisible({ timeout: 15_000 });
  await rest("service", `tasks?id=eq.${task!.id}`, {
    method: "PATCH",
    body: { title: `Collect all assets ${tag}`, updated_at: new Date().toISOString() },
  });
  // The other context's change reaches the chip in place: through Realtime
  // (the Tasks link RF-1 holds while a task chip is on screen), or the
  // re-read when the window comes back (the local stack's WAL poll can lag).
  await page.waitForTimeout(3_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(chip.getByText(`Collect all assets ${tag}`)).toBeVisible({ timeout: 20_000 });
});

test("the New pill sits at the read mark and never jumps", async ({ page }) => {
  await openGeneral(page);
  // Reading at the bottom moves the read mark to the newest message on screen.
  const [newest] = await rest<Array<{ id: string }>>(
    "service",
    `chat_messages?channel_id=eq.${room.general}&deleted_at=is.null&order=created_at.desc,id.desc&limit=1&select=id`,
  );
  await expect
    .poll(
      async () =>
        (
          await rest<Array<{ last_read_id: string | null }>>(
            "service",
            `chat_members?channel_id=eq.${room.general}&user_id=eq.${room.owner.user.id}&select=last_read_id`,
          )
        )[0]?.last_read_id ?? null,
      { timeout: 10_000 },
    )
    .toBe(newest?.id);
  // Others write while the owner is away.
  await page.goto("/home");
  await sendAs(room.member, room.general, `unread one ${tag}`);
  await sendAs(room.member, room.general, `unread two ${tag}`);
  await openGeneral(page);
  const pill = page.getByRole("separator", { name: "New messages" });
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const order = await page
    .locator('[role="separator"][aria-label="New messages"], [role="article"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute("role") === "separator" ? "NEW" : (el.textContent ?? ""))),
    );
  const at = order.indexOf("NEW");
  expect(order[at + 1]).toContain(`unread one ${tag}`);
  // More arrive while reading: the pill stays where it was.
  await sendAs(room.member, room.general, `unread three ${tag}`);
  await expect(row(page, `unread three ${tag}`)).toBeVisible({ timeout: 15_000 });
  const again = await page
    .locator('[role="separator"][aria-label="New messages"], [role="article"]')
    .evaluateAll((els) =>
      els.map((el) => (el.getAttribute("role") === "separator" ? "NEW" : (el.textContent ?? ""))),
    );
  expect(again[again.indexOf("NEW") + 1]).toContain(`unread one ${tag}`);
});

test("the message keys", async ({ page }) => {
  await openGeneral(page);
  await composer(page).fill(`keys ${tag}`);
  await composer(page).press("Enter");
  await expect(row(page, `keys ${tag}`)).toBeVisible();
  await expect.poll(async () => (await serverRow(`keys ${tag}`))?.id ?? null).not.toBeNull();

  // ↑ in an empty composer edits your last message; Esc puts it back.
  await composer(page).press("ArrowUp");
  const edit = page.getByRole("textbox", { name: "Edit message" });
  await expect(edit).toBeVisible();
  await edit.press("Escape");
  await expect(edit).toHaveCount(0);
  await expect(composer(page)).toBeFocused();

  // In the stream, ↑↓ step through messages; E edits your own; R opens its chain.
  await page.getByTestId("message-stream").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("[data-selected]")).toContainText(`keys ${tag}`);
  await page.keyboard.press("e");
  await expect(edit).toBeVisible();
  await edit.fill(`keys edited ${tag}`);
  await edit.press("Enter");
  await expect(row(page, `keys edited ${tag}`)).toContainText("(edited)");
  await expect.poll(async () => (await serverRow(`keys edited ${tag}`))?.id ?? null).not.toBeNull();
  await page.getByTestId("message-stream").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("r");
  await expect(page).toHaveURL(/[?&]t=/);
  // Esc leaves the selection and returns to typing.
  await page.goto(`/chat?c=${room.general}`);
  await page.getByTestId("message-stream").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(composer(page)).toBeFocused();
});

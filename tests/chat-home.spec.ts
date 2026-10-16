import { expect, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom, sendAs } from "./support/chat-room";
import { rest, rpc, runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-22 · Home (AC11.6, AC15.2; prototype round 5 frame 8), against
 * the local stack:
 *   scripts/agent/e2e.sh tests/chat-home.spec.ts
 * Its people (home-chat-owner@ and home-chat-member@moduo.local) work in a Duo
 * workspace the spec makes and removes. The Catch up widget lists what's
 * waiting and opens Catch up; the Team widget shows each person's now line
 * above Tasks' load rows.
 */

test.use({ locale: "en-US", viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

const OWNER = {
  email: "home-chat-owner@moduo.local",
  password: "localhomechatowner",
  name: "Alex Rivera",
};
const MEMBER = {
  email: "home-chat-member@moduo.local",
  password: "localhomechatmember",
  name: "Jana Lind",
};

let room: ChatRoom;
let tag: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Home chat ${tag}`);
});

test.afterAll(async () => {
  if (room) await rpc(room.member, "user_op_clear_status", {}).catch(() => undefined);
  await removeChatRoom(room);
});

test("Catch up widget and the Team line", async ({ page }) => {
  // Jana writes to Alex directly, and is on vacation.
  const opened = await rpc<{ id: string } | Array<{ id: string }>>(room.member, "chat_op_open_dm", {
    p_workspace_id: room.ws,
    p_user_ids: [room.owner.user.id],
  });
  const dm = (Array.isArray(opened) ? opened[0] : opened)?.id ?? "";
  await sendAs(room.member, dm, `Quick question ${tag}`);
  await rpc(room.member, "user_op_set_status", {
    p_patch: { emoji: "🌴", text: "On vacation", dnd: false, clear_at: null, preset: null },
  });

  // Alex's Home: Catch up (M) and Team (L), saved as v1's "chat" type.
  await rest("service", "dashboard_layouts?on_conflict=user_id,workspace_id,layout_key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: room.owner.user.id,
      workspace_id: room.ws,
      layout_key: "home",
      updated_at: new Date().toISOString(),
      layout_data: {
        version: 1,
        pages: [
          {
            id: "home",
            widgets: [
              { id: "w-catchup", type: "chat", size: "M", x: 0, y: 0, config: {} },
              { id: "w-team", type: "team", size: "L", x: 4, y: 0, config: {} },
            ],
          },
        ],
      },
    },
  });

  await signInPage(page, room.owner, room.ws);
  await page.goto("/");

  // The Team widget: Jana's now line sits above Tasks' load.
  const jana = page.locator(`li[data-person="${room.member.user.id}"]`);
  await expect(jana).toContainText(MEMBER.name, { timeout: 30_000 });
  await expect(jana.locator("[data-team-now]")).toContainText("🌴 On vacation");
  await expect(jana.locator("[data-team-now] + [data-team-load]")).toHaveCount(1);

  // The Catch up widget lists the direct message and opens Catch up.
  const widget = page.locator("[data-catchup-widget]");
  const waiting = widget.getByRole("button", {
    name: new RegExp(`${MEMBER.name}.*sent you a message`),
  });
  await expect(waiting).toBeVisible({ timeout: 30_000 });
  // For comparing with frame 8 (kept with the run's results, not in the repo).
  await page.screenshot({ path: test.info().outputPath("home.png") });
  await waiting.click();
  await expect(page).toHaveURL(/\/chat\?.*view=catchup/);
  await expect(page.getByRole("heading", { name: "Catch up" })).toBeVisible({ timeout: 20_000 });
});

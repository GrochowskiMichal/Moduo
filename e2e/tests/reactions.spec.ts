import { expect, test } from "@playwright/test";

import {
  DEV,
  devWorkspace,
  removeRun,
  rest,
  rpc,
  runTag,
  type Session,
  signIn,
  signInPage,
} from "./support/local-stack";

/**
 * Chat v2 CV-7c — your quick reactions (CH16a, CH49): set in Settings → Chat,
 * the same row behind ☺ on a task comment, any emoji as a reaction, back to
 * Moduo's six. Against the local stack (scripts/agent/e2e.sh). The quick row
 * is the dev person's own: it goes back to Moduo's six before and after.
 */

let dev: Session;
let ws: { id: string; inboxId: string };
let tag: string;
let project: { id: string };

test.describe.configure({ mode: "serial" });

const resetRow = () => rpc(dev, "user_op_set_chat_prefs", { p_patch: { reaction_row: null } });

test.beforeAll(async () => {
  dev = await signIn(DEV);
  ws = await devWorkspace(dev);
  tag = runTag();
  await resetRow();
  [project] = await rest<Array<{ id: string }>>(dev, "buckets", {
    method: "POST",
    body: {
      workspace_id: ws.id,
      owner_id: dev.user.id,
      name: `Reactions ${tag}`,
      position: `z${tag}`,
    },
  });
});

test.afterAll(async () => {
  await resetRow();
  await removeRun(ws.id, tag, [project.id]);
});

test("CH16a — your quick row from Settings → Chat shows on a task comment; any emoji reacts", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  await rpc(dev, "tasks_op_create", {
    p_workspace_id: ws.id,
    p_task: { id, title: `Reactions ${tag}`, bucket_id: project.id },
  });

  // Settings → Chat: put 🎉 in the first slot.
  await signInPage(page, dev, ws.id);
  await page.goto("/settings?section=chat");
  const slots = page.getByRole("list", { name: "Your quick reactions" });
  await expect(slots.getByRole("listitem")).toHaveCount(6, { timeout: 15_000 });
  await slots.getByRole("button", { name: /^Slot 1: Thumbs up/ }).click();
  const input = page.getByRole("textbox", { name: "Emoji for slot 1" });
  await input.fill("party");
  await expect(page.getByText("That isn’t an emoji.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use it" })).toBeDisabled();
  await input.fill("🎉");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(slots.getByRole("button", { name: /^Slot 1: 🎉/ })).toBeVisible();
  await expect
    .poll(async () => {
      const prefs = await rpc<{ reaction_row: string[] | null }>(dev, "user_chat_prefs", {});
      return prefs.reaction_row?.[0] ?? null;
    })
    .toBe("🎉");
  await page.keyboard.press("Escape");

  // The comment's ☺ opens the same row: 🎉 first, then Moduo's.
  await page.goto(`/tasks?id=${id}`);
  const box = page.getByRole("textbox", { name: "Comment on this task" });
  await expect(box).toBeVisible({ timeout: 20_000 });
  await box.fill(`Looks good ${tag}`);
  await box.press("ControlOrMeta+Enter");
  const card = page.locator("article", { hasText: `Looks good ${tag}` });
  await card.hover();
  await card.getByRole("button", { name: "React" }).click();
  const row = page.getByRole("group", { name: "Your quick reactions" });
  await expect(row.getByRole("button").first()).toHaveAccessibleName("🎉");
  await row.getByRole("button", { name: "🎉" }).click();
  await expect(card.getByRole("button", { name: "🎉: You" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The chip takes it back.
  await card.getByRole("button", { name: "🎉: You" }).click();
  await expect(card.getByRole("button", { name: "🎉: You" })).toHaveCount(0);

  // Back to Moduo's six.
  await page.goto("/settings?section=chat");
  await page.getByRole("button", { name: "Use Moduo’s six" }).click();
  await expect(
    page.getByRole("list", { name: "Your quick reactions" }).getByRole("button").first(),
  ).toHaveAccessibleName(/^Slot 1: Thumbs up/);
});

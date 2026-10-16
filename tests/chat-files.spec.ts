import { expect, type Page, test } from "@playwright/test";

import { type ChatRoom, makeChatRoom, removeChatRoom } from "./support/chat-room";
import { runTag, signInPage } from "./support/local-stack";

/**
 * Chat v2 CV-9 · Files (AC2.3), against the local stack:
 *   scripts/agent/e2e.sh tests/chat-files.spec.ts
 * A Duo room of its own (files-owner@ and files-member@moduo.local). A pasted
 * screenshot uploads, goes as a message of its own and previews inline with
 * equal space above and below; a PDF previews; a zip is a chip; a file dropped
 * on the conversation joins the next message; the Files view lists them; the
 * other person in the conversation sees them too.
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });

const OWNER = { email: "files-owner@moduo.local", password: "localfilesowner", name: "Hanna Kos" };
const MEMBER = {
  email: "files-member@moduo.local",
  password: "localfilesmember",
  name: "Igor Lis",
};

let room: ChatRoom;
let tag: string;

test.beforeAll(async () => {
  tag = runTag();
  room = await makeChatRoom(OWNER, MEMBER, `Files ${tag}`);
});

test.afterAll(async () => {
  await removeChatRoom(room);
});

const composer = (page: Page) => page.locator("[data-chat-composer]");
const box = (page: Page) => composer(page).getByRole("textbox");
const panel = (page: Page) => page.locator('[data-panel-module="chat"]');

/** A 64 × 40 PNG, made in the page (a screenshot's stand-in). */
async function pasteScreenshot(page: Page, name: string) {
  await box(page).click();
  await box(page).evaluate(async (el, fileName) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, 640, 400);
    }
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b as Blob), "image/png"),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([blob], fileName, { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, name);
}

const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

test("paste, drop, Files view", async ({ page, browser }) => {
  await signInPage(page, room.owner, room.ws);
  await page.goto(`/chat?c=${room.general}`);
  await expect(box(page)).toBeVisible({ timeout: 20_000 });

  // A pasted screenshot: a chip uploads in the composer, then goes on its own.
  await pasteScreenshot(page, `screen-${tag}.png`);
  const chip = composer(page).locator('[data-slot="composer-file"]');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await box(page).press("Enter");
  await expect(chip).toHaveCount(0);

  const image = page
    .locator('[data-slot="file-image"]')
    .filter({ has: page.locator(`img[alt="screen-${tag}.png"]`) });
  await expect(image).toBeVisible({ timeout: 30_000 });
  // Fit inside the 360 × 240 media box, its stored shape kept (640 × 400 → 360 × 225).
  const img = image.locator("img");
  await expect(img).toHaveAttribute("width", "360");
  await expect(img).toHaveAttribute("height", "225");
  // Equal space above and below the media.
  const files = page.locator('[data-slot="message-files"]').filter({ has: image });
  const [top, bottom] = await files.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.marginTop, s.marginBottom];
  });
  expect(top).toBe(bottom);

  // A PDF and a zip picked through + → Upload a file, with words.
  await composer(page)
    .locator('[data-slot="composer-file-input"]')
    .setInputFiles([
      { name: `deck-${tag}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(MINIMAL_PDF) },
      {
        name: `assets-${tag}.zip`,
        mimeType: "application/zip",
        buffer: Buffer.from("PK\u0003\u0004zip"),
      },
    ]);
  await expect(chip).toHaveCount(2);
  await expect(chip.nth(0)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(chip.nth(1)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await box(page).fill(`The deck and the assets ${tag}`);
  await box(page).press("Enter");
  await expect(page.locator('[data-slot="file-pdf"]', { hasText: `deck-${tag}.pdf` })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('[data-slot="file-chip"]', { hasText: `assets-${tag}.zip` }),
  ).toBeVisible();

  // A file dropped on the conversation joins the next message.
  await page.locator(`[data-conversation="${room.general}"]`).evaluate((el, fileName) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["notes"], fileName, { type: "text/plain" }));
    el.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, `notes-${tag}.txt`);
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await box(page).press("Enter");
  await expect(
    page.locator('[data-slot="file-chip"]', { hasText: `notes-${tag}.txt` }),
  ).toBeVisible({
    timeout: 30_000,
  });

  // The Files view lists all four, newest first.
  await panel(page).getByRole("button", { name: "Panel view: Details" }).click();
  await page.getByRole("menuitemradio", { name: /Files/ }).click();
  const list = page.getByRole("list", { name: "Files in this conversation" });
  await expect(list.getByRole("listitem")).toHaveCount(4, { timeout: 15_000 });
  await expect(list.getByRole("listitem").first()).toContainText(`notes-${tag}.txt`);
  for (const name of [`screen-${tag}.png`, `deck-${tag}.pdf`, `assets-${tag}.zip`]) {
    await expect(list).toContainText(name);
  }

  // The other person in the conversation sees them.
  const other = await browser.newPage();
  await signInPage(other, room.member, room.ws);
  await other.goto(`/chat?c=${room.general}`);
  await expect(
    other
      .locator('[data-slot="file-image"]')
      .filter({ has: other.locator(`img[alt="screen-${tag}.png"]`) }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    other.locator('[data-slot="file-chip"]', { hasText: `assets-${tag}.zip` }),
  ).toBeVisible();
  await other.close();
});

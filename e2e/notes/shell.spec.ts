// NR-2 smoke (AC1–AC5, specs/notes-refresh.md): switch to New Notes → ⌘N →
// type → the note sits in the Inbox → drag it into Pages → reload → still
// there; and an untouched ⌘N leaves nothing behind. Pointer moves are
// frame-stepped (synchronous synthetic moves are dropped by dnd-kit).
// Not part of `bun run verify`; needs a running app + an authed session with
// Notes edit access and at least one page in Pages.
import { expect, type Page, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL;

async function useNewNotes(page: Page) {
  await page.goto(`${APP}/notes`);
  const tryNew = page.getByRole("button", { name: "Try the new Notes" });
  if (await tryNew.isVisible().catch(() => false)) await tryNew.click();
  await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
}

const inbox = (page: Page) => page.getByRole("group", { name: "Inbox" });
const pages = (page: Page) => page.getByRole("group", { name: "Pages" });

test.describe("New Notes shell (NR-2)", () => {
  test.skip(!APP, "E2E_APP_URL not set — run against a live authed session");

  test("an untouched ⌘N leaves no Untitled row, even after reload", async ({ page }) => {
    await useNewNotes(page);
    const before = await page.getByRole("treeitem", { name: /Untitled/ }).count();
    await page.keyboard.press("ControlOrMeta+n");
    await expect(page.locator(".notes-editor-v2 [contenteditable]")).toBeFocused();
    // Leave without typing: open the first page instead.
    await pages(page).getByRole("treeitem").first().click();
    await page.reload();
    await expect(page.getByRole("tree", { name: "Notes" })).toBeVisible();
    expect(await page.getByRole("treeitem", { name: /Untitled/ }).count()).toBe(before);
  });

  test("a typed capture lands in the Inbox and files into Pages by drag", async ({ page }) => {
    await useNewNotes(page);
    const title = `NR-2 smoke ${Date.now()}`;
    await page.keyboard.press("ControlOrMeta+n");
    await page.keyboard.type(title);
    const row = inbox(page).getByRole("treeitem", { name: new RegExp(title) });
    await expect(row).toBeVisible({ timeout: 5000 });

    // Drag it onto the Pages header.
    const from = (await row.boundingBox())!;
    const header = page.locator('[data-drop-header="pages"]');
    const to = (await header.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        from.x + 20 + ((to.x + 30 - from.x - 20) * i) / 10,
        from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * i) / 10,
      );
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await expect(pages(page).getByRole("treeitem", { name: new RegExp(title) })).toBeVisible();

    await page.reload();
    await expect(pages(page).getByRole("treeitem", { name: new RegExp(title) })).toBeVisible();
    await expect(inbox(page).getByRole("treeitem", { name: new RegExp(title) })).toHaveCount(0);

    // Clean up: trash it from the keyboard.
    await pages(page)
      .getByRole("treeitem", { name: new RegExp(title) })
      .focus();
    await page.keyboard.press("Backspace");
  });
});

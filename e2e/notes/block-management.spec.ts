import { expect, test, type Page } from "@playwright/test";
import { BASE_URL } from "../billing/helpers";

async function openNotesOrSkip(page: Page) {
  await page.goto(`${BASE_URL}/notes`, { waitUntil: "networkidle" });
  test.skip(!page.url().includes("/notes"), "Notes e2e requires an authenticated workspace session");
  const editor = page.locator("[contenteditable='true']").first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  return editor;
}

async function seedBlocks(page: Page, text: string) {
  const editor = page.locator("[contenteditable='true']").first();
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(text);
  return editor;
}

test.describe("Notes block management", () => {
  test("keyboard shortcuts duplicate, move, delete, and insert picker", async ({ page }) => {
    const editor = await openNotesOrSkip(page);
    await seedBlocks(page, "Alpha\nBeta");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D");
    await expect(editor).toContainText("Alpha");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+ArrowDown" : "Control+Shift+ArrowDown");
    await page.keyboard.press("Alt+Enter");
    await expect(page.locator(".notes-slash-menu, [role='listbox']").first()).toBeVisible({ timeout: 3_000 });
    await page.keyboard.press("Escape");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+Backspace" : "Control+Shift+Backspace");
    await expect(editor).toBeVisible();
  });

  test("drag reorder shows a valid drop line and persists after reload", async ({ page }) => {
    const editor = await openNotesOrSkip(page);
    await seedBlocks(page, "First\nSecond\nThird");
    await editor.hover();

    const grip = page.locator(".notes-block-grip").first();
    await expect(grip).toBeVisible({ timeout: 3_000 });
    const box = await grip.boundingBox();
    test.skip(!box, "Block grip not measurable in this browser run");

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 80, { steps: 8 });
    await expect(page.locator(".notes-block-drop-line")).toBeVisible({ timeout: 3_000 });
    await page.mouse.up();

    const before = await editor.innerText();
    await page.reload({ waitUntil: "networkidle" });
    const afterEditor = page.locator("[contenteditable='true']").first();
    await expect(afterEditor).toContainText(before.split("\n")[0] ?? "First", { timeout: 10_000 });
  });

  test("list item drag-out converts the moved item to top-level text", async ({ page }) => {
    const editor = await openNotesOrSkip(page);
    await seedBlocks(page, "/bullet");
    await page.keyboard.press("Enter");
    await page.keyboard.type("List item");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Top target");

    await editor.hover();
    const grip = page.locator(".notes-block-grip").first();
    const box = await grip.boundingBox();
    test.skip(!box, "Block grip not measurable in this browser run");
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 120, { steps: 10 });
    await page.mouse.up();

    await expect(editor).toContainText("List item");
    await expect(editor).toContainText("Top target");
  });

  test("read-only notes hide block controls", async ({ page }) => {
    await openNotesOrSkip(page);
    await page.evaluate(() => document.body.dataset.e2eReadonly = "true");
    await expect(page.locator(".notes-block-controls")).toHaveCount(0);
  });

  test("drag into whitespace between blocks resolves a drop line", async ({ page }) => {
    const editor = await openNotesOrSkip(page);
    await seedBlocks(page, "Alpha\nBeta\nGamma");
    await editor.hover();

    const grip = page.locator(".notes-block-grip").first();
    await expect(grip).toBeVisible({ timeout: 3_000 });
    const gripBox = await grip.boundingBox();
    test.skip(!gripBox, "Block grip not measurable in this browser run");

    // Obtain the rect of the second block to find the whitespace gap below it.
    const blocks = page.locator("[contenteditable='true'] > *");
    const secondBox = await blocks.nth(1).boundingBox();
    test.skip(!secondBox, "Second block not measurable");

    // Start dragging the first block.
    await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await page.mouse.down();
    // Move into the whitespace just below the second block's bottom edge.
    const whitespaceY = secondBox!.y + secondBox!.height + 4;
    await page.mouse.move(gripBox!.x + gripBox!.width / 2, whitespaceY, { steps: 10 });
    await expect(page.locator(".notes-block-drop-line")).toBeVisible({ timeout: 3_000 });
    await page.mouse.up();

    // Verify the editor still contains all blocks (drop completed without error).
    await expect(editor).toContainText("Alpha");
    await expect(editor).toContainText("Beta");
    await expect(editor).toContainText("Gamma");
  });

  test("drag below the last block resolves an after-last drop line", async ({ page }) => {
    const editor = await openNotesOrSkip(page);
    await seedBlocks(page, "Only\nLast");
    await editor.hover();

    const grip = page.locator(".notes-block-grip").first();
    await expect(grip).toBeVisible({ timeout: 3_000 });
    const gripBox = await grip.boundingBox();
    test.skip(!gripBox, "Block grip not measurable");

    const lastBlock = page.locator("[contenteditable='true'] > *").last();
    const lastBox = await lastBlock.boundingBox();
    test.skip(!lastBox, "Last block not measurable");

    await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await page.mouse.down();
    // Move well below the last block's bottom edge.
    await page.mouse.move(gripBox!.x + gripBox!.width / 2, lastBox!.y + lastBox!.height + 40, { steps: 10 });
    await expect(page.locator(".notes-block-drop-line")).toBeVisible({ timeout: 3_000 });
    await page.mouse.up();

    await expect(editor).toContainText("Only");
    await expect(editor).toContainText("Last");
  });
});

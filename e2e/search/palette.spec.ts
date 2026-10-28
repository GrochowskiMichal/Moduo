// GS-10 smoke (specs/global-search.md AC1, AC8, AC13): a word written only in a
// note's body finds it from ⌘K with a snippet, and Enter lands in the note with
// the match highlighted (the CSS Custom Highlight API, so the check reads the
// painted ranges, not the DOM). Not part of `bun run verify`; needs a running
// app + an authed session with Notes edit access.
import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL;

const editor = ".notes-editor-v2 [contenteditable]";

test.describe("⌘K finds a note by a body word and opens it at the match (GS-10)", () => {
  test.skip(!APP, "E2E_APP_URL not set — run against a live authed session");

  test("find a note by a body word and open it", async ({ page }) => {
    // A word no other note holds, written only in the body.
    const word = `kumquat${Date.now().toString(36)}`;
    const title = `GS-10 smoke ${Date.now()}`;

    await page.goto(`${APP}/notes`);
    await expect(page.locator('[data-drop-header="inbox"]').first()).toBeVisible();
    await page.keyboard.press("ControlOrMeta+n");
    await expect(page.locator(editor)).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    // Push the match below the fold, so landing on it means scrolling to it.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.type(`Filler line ${i}`);
      await page.keyboard.press("Enter");
    }
    await page.keyboard.type(`We tasted a ${word} at lunch`);
    const noteUrl = page.url();

    // Leave the note, so the open is a real landing (and the edit is flushed).
    await page.getByRole("tree", { name: "Pages" }).getByRole("treeitem").first().click();

    // The server indexes the body once the edit is pushed: retry the search.
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByPlaceholder(/Search messages, tasks, notes/);
    await expect(input).toBeVisible();
    const row = page.getByRole("option").filter({ hasText: title });
    await expect(async () => {
      await input.fill("");
      await input.fill(word);
      // AC8: the answer paints quickly once the server has the text.
      await expect(row).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });
    // AC1: the row shows the snippet with the word marked.
    await expect(row.locator('[data-slot="search-snippet"] mark')).toHaveText(word);

    // Walk the selection to the note's row (the Top result, usually) and press Enter.
    for (let i = 0; i < 10 && (await row.first().getAttribute("aria-selected")) !== "true"; i++) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(row.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(new URL(noteUrl).search.replace("?", "\\?")));

    // AC13: the match is highlighted and on screen.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const h = (CSS as any).highlights?.get("note-search-match");
          return h ? [...h].map((r: Range) => r.toString()) : [];
        }),
      )
      .toEqual([word]);
    const inView = await page.evaluate(() => {
      const range = [...(CSS as any).highlights.get("note-search-match")][0] as Range;
      const box = range.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= window.innerHeight;
    });
    expect(inView).toBe(true);

    // A click in the note clears it.
    await page.locator(editor).click();
    await expect
      .poll(() => page.evaluate(() => Boolean((CSS as any).highlights?.get("note-search-match"))))
      .toBe(false);

    // Clean up: trash it from the keyboard.
    await page.getByRole("treeitem", { name: new RegExp(title) }).first().focus();
    await page.keyboard.press("Backspace");
  });
});

import { expect, test } from "@playwright/test";

test("notes tab renders", async ({ page }) => {
  await page.goto("/notes");
  await expect(page.getByRole("button", { name: "New Note" })).toBeVisible();
});

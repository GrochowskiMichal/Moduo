// The e2e smoke (`bun run e2e:smoke`, checks.yml's e2e-smoke job): the web app
// boots and its signed-out pages render, with no Supabase behind it. Nothing
// here signs in or submits a form; the signed-in suites need the local stack
// (`bun run e2e`).

import { expect, type Page, test } from "@playwright/test";

/** Uncaught errors thrown in the page while a test runs. */
function pageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  return errors;
}

test("signed out, the app sends you to sign in", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the sign-in page asks for an email", async ({ page }) => {
  const errors = pageErrors(page);
  const response = await page.goto("/auth");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the plans page renders every plan", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/paywall");
  for (const plan of ["Free", "Pro", "Duo", "Team"]) {
    await expect(page.getByRole("heading", { name: plan, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

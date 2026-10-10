import { expect, test } from "@playwright/test";

/**
 * People round, teams square (tasks-v3 AC1.15; calls 43 + 95; DS-6). Opens the
 * avatar Identity story and reads the rendered shapes and letters: two
 * initials on a coloured fill for people, a rounded square with two letters
 * for teams, the dashed ring for no one. Computed styles only, no baselines.
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/avatars.spec.ts
 */

test.describe("avatars", () => {
  test("people round, teams square", async ({ page }) => {
    await page.goto("/iframe.html?id=components-ui-avatar--identity&viewMode=story");
    await page.locator("#storybook-root, #root").first().waitFor({ state: "visible" });

    const people = page.locator("[data-slot=avatar][data-label]");
    await expect(people.first()).toBeVisible();
    const texts = await people.allTextContents();
    // Two letters each; Maciej and Mike never read alike.
    expect(texts.slice(0, 2)).toEqual(["MA", "MI"]);
    for (const text of texts) expect(text).toMatch(/^\S{2}$/);

    const personShape = await people.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
      return { radius, half: r.width / 2 };
    });
    expect(personShape.radius).toBeGreaterThanOrEqual(personShape.half);

    const team = page.locator("[data-slot=team-mark]").first();
    expect(await team.textContent()).toBe("DS");
    const teamShape = await team.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const radius = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
      return { radius, half: r.width / 2 };
    });
    expect(teamShape.radius).toBeGreaterThan(0);
    expect(teamShape.radius).toBeLessThan(teamShape.half);

    // Initials sit on a coloured fill, not the old neutral muted disc.
    const fill = await people
      .first()
      .locator("[data-slot=avatar-fallback]")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");

    const nobody = page.locator("[data-slot=avatar][data-unassigned]");
    expect(await nobody.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  });
});

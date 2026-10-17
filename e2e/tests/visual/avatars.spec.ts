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

    // Two letters fit inside the circle at every size (the icon rung's 9 px
    // step must win over the fallback's own type step).
    for (const box of await people.all()) {
      const fit = await box.evaluate((el) => {
        // The text node itself: the fallback span fills the circle by design.
        const letters = el.querySelector("[data-slot=avatar-fallback]")?.firstChild;
        const range = document.createRange();
        if (letters) range.selectNodeContents(letters);
        return { text: range.getBoundingClientRect().width, box: el.getBoundingClientRect().width };
      });
      expect(fit.text).toBeLessThanOrEqual(fit.box);
    }

    // Initials sit on a coloured fill, not the old neutral muted disc.
    const fill = await people
      .first()
      .locator("[data-slot=avatar-fallback]")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");

    const nobody = page.locator("[data-slot=avatar][data-unassigned]");
    expect(await nobody.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
  });

  // MOD-96: a person's photo when set, round and filling the circle at every
  // size; the initials on their colour when it can't load or there is none.
  // The story's photos are inline data URLs, so this needs no network.
  test("a photo when set, initials when it fails or is missing", async ({ page }) => {
    await page.goto("/iframe.html?id=components-ui-avatar--person-with-photo&viewMode=story");
    await page.locator("#storybook-root, #root").first().waitFor({ state: "visible" });

    const photos = page.locator("[data-row=photo] [data-slot=avatar]");
    await expect(photos).toHaveCount(4);
    await expect(page.locator("[data-row=photo] img[data-slot=avatar-image]")).toHaveCount(4);
    for (const avatar of await photos.all()) {
      const shape = await avatar.evaluate((el) => {
        const img = el.querySelector("img") as HTMLImageElement;
        const box = el.getBoundingClientRect();
        const pic = img.getBoundingClientRect();
        return {
          loaded: img.complete && img.naturalWidth > 0,
          fit: getComputedStyle(img).objectFit,
          radius: Number.parseFloat(getComputedStyle(el).borderTopLeftRadius),
          half: box.width / 2,
          fills: Math.round(pic.width) === Math.round(box.width),
          text: el.textContent,
        };
      });
      expect(shape.loaded).toBe(true);
      expect(shape.fit).toBe("cover");
      expect(shape.radius).toBeGreaterThanOrEqual(shape.half);
      expect(shape.fills).toBe(true);
      expect(shape.text).toBe("");
    }

    for (const row of ["broken", "none"]) {
      const avatars = page.locator(`[data-row=${row}] [data-slot=avatar]`);
      await expect(avatars).toHaveCount(4);
      await expect(page.locator(`[data-row=${row}] img`)).toHaveCount(0);
      expect(await avatars.allTextContents()).toEqual(["MG", "MG", "MG", "MG"]);
    }
  });
});

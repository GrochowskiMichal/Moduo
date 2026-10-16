import { expect, test } from "@playwright/test";

/**
 * Chat v2 CV-7a · "the look at three densities" (AC14.1, AC14.3): the
 * stream's `Densities` story (src/features/chat/stream/stream.stories.tsx)
 * matches round 5 in structure, read from computed styles and boxes, so
 * there are no baselines to capture: 15 px text at every density, names by
 * weight, the 32 / 28 / 24 px avatar, 24 / 20 / 16 px before a new person and
 * 6 px between one person's lines, one left edge for text, reactions and the
 * reply line, the day separator centred. The composer at rest and grown is
 * CV-7b's. The lint guards (AC14.3) run in `bun run verify`.
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/chat-stream.spec.ts
 */

const STEPS = {
  comfortable: { avatar: 32, person: 24 },
  compact: { avatar: 28, person: 20 },
  dense: { avatar: 24, person: 16 },
} as const;

test("the look at three densities", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/iframe.html?id=features-chat-stream--densities&viewMode=story");
  await page.locator("#storybook-root, #root").first().waitFor({ state: "visible" });

  for (const [step, want] of Object.entries(STEPS)) {
    const section = page.getByTestId(`density-${step}`);
    await expect(section).toBeVisible();
    const look = await section.evaluate((root) => {
      const articles = [...root.querySelectorAll<HTMLElement>('[role="article"]')];
      const body = articles[0]!.querySelector<HTMLElement>('[data-slot="message-body"]')!;
      const name = articles[0]!.querySelector<HTMLElement>('[data-slot="message-author"]')!;
      const avatar = articles[0]!.querySelector<HTMLElement>('[data-slot="avatar"]')!;
      const rect = (el: Element) => el.getBoundingClientRect();
      // Lines of one person: the first two articles; a new person: the third.
      const line = rect(articles[1]!).top - rect(articles[0]!).bottom;
      const lineGap =
        line +
        Number.parseFloat(getComputedStyle(articles[0]!).paddingBottom) +
        Number.parseFloat(getComputedStyle(articles[1]!).paddingTop);
      // A new person: the row's own gap above it plus the lines' 3 px each side.
      const personGap =
        Number.parseFloat(getComputedStyle(articles[0]!.parentElement!).paddingTop) +
        Number.parseFloat(getComputedStyle(articles[0]!).paddingTop) +
        Number.parseFloat(getComputedStyle(articles[1]!).paddingBottom);
      const reactions = articles[1]!.querySelector<HTMLElement>(
        '[data-slot="chip-button"], button[aria-pressed]',
      );
      const day = root.querySelector<HTMLElement>(
        '[role="separator"]:not([aria-label="New messages"]) span',
      )!;
      const dayBox = root.querySelector<HTMLElement>('[role="separator"]')!;
      return {
        bodyPx: Number.parseFloat(getComputedStyle(body).fontSize),
        bodyEverywhere: articles
          .map((a) => a.querySelector<HTMLElement>('[data-slot="message-body"]'))
          .filter((b): b is HTMLElement => !!b && !b.hasAttribute("data-jumbo"))
          .every((b) => getComputedStyle(b).fontSize === "15px"),
        nameWeight: Number(getComputedStyle(name).fontWeight),
        bodyWeight: Number(getComputedStyle(body).fontWeight),
        avatar: rect(avatar).width,
        lineGap,
        personGap,
        edge: [
          rect(name).left,
          rect(body).left,
          reactions ? rect(reactions).left : rect(body).left,
        ],
        dayCentre:
          rect(day).left + rect(day).width / 2 - (rect(dayBox).left + rect(dayBox).width / 2),
        pill: !!root.querySelector('[role="separator"][aria-label="New messages"]'),
      };
    });
    expect(look.bodyPx, `${step}: body text`).toBe(15);
    expect(look.bodyEverywhere, `${step}: 15 px on every row`).toBe(true);
    expect(look.nameWeight, `${step}: the name is heavier`).toBeGreaterThan(look.bodyWeight);
    expect(look.avatar, `${step}: avatar`).toBe(want.avatar);
    expect(Math.round(look.lineGap), `${step}: between one person's lines`).toBe(6);
    expect(Math.round(look.personGap), `${step}: before a new person`).toBe(want.person);
    const [a, b, c] = look.edge;
    expect(Math.abs(a! - b!), `${step}: one left edge (name, text)`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(b! - c!), `${step}: one left edge (text, reactions)`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(look.dayCentre), `${step}: the day is centred`).toBeLessThanOrEqual(1);
    expect(look.pill, `${step}: the New pill`).toBe(true);
  }
  expect(errors).toEqual([]);
});

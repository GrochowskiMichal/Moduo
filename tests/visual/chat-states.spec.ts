import { expect, type Locator, test } from "@playwright/test";

/**
 * Chat v2 CV-8a · "every state" (AC1.8, AC10.9, AC6.5; AC10.3 and §2 for the
 * left panel): the `States` and `Sidebar` stories
 * (src/features/chat/shell/states.stories.tsx) match round 5 frames 1 and 7
 * in structure, read from the DOM and computed styles (no baselines): a new
 * channel, General's first open with the welcome, loading, archived, paused,
 * offline, older history, a viewer, a non-manager in an announcement channel,
 * a former member. A line replaces the composer; never a disabled box.
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/chat-states.spec.ts
 */

const composer = (s: Locator) => s.locator('[data-chat-composer] [contenteditable="true"]');
const line = (s: Locator) => s.locator("[data-composer-line]");

async function noBox(s: Locator) {
  await expect(composer(s)).toHaveCount(0);
  // Never a disabled box in the composer's place.
  await expect(
    s.locator(
      "[data-chat-composer] :is(textarea, input, [contenteditable], [aria-disabled='true'])",
    ),
  ).toHaveCount(0);
}

test("every state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/iframe.html?id=features-chat-states--states&viewMode=story");
  const state = (id: string) => page.locator(`[data-state="${id}"]`);
  await expect(state("new")).toBeVisible();

  // The toolbar: the name (no "#"), Search, ⋯, and no huddle until calls exist.
  const toolbar = state("new").locator('[data-slot="conversation-toolbar"]');
  await expect(toolbar.locator("h1")).toHaveText("Brand refresh");
  await expect(toolbar.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Conversation options" })).toBeVisible();
  await expect(toolbar.locator('[data-slot="huddle"]')).toHaveCount(0);
  const title = await toolbar
    .locator("h1")
    .evaluate((h) => ({
      px: getComputedStyle(h).fontSize,
      w: Number(getComputedStyle(h).fontWeight),
    }));
  expect(title.px).toBe("18px");
  expect(title.w).toBeGreaterThanOrEqual(600);

  // A new channel: its start, and the composer.
  await expect(state("new").locator('[data-slot="conversation-start"] h2')).toHaveText(
    "This is the start of Brand refresh",
  );
  await expect(composer(state("new"))).toHaveCount(1);
  await expect(line(state("new"))).toHaveCount(0);

  // General's first open: everyone is here, and the one-line welcome.
  await expect(state("first").locator('[data-slot="conversation-start"]')).toContainText(
    "Everyone in Moduo Studio is here.",
  );
  await expect(state("first").locator('[data-slot="chat-welcome"]')).toHaveText(
    "Reply to keep answers together · @ links anything in Moduo",
  );
  await expect(state("new").locator('[data-slot="chat-welcome"]')).toHaveCount(0);

  // Loading: skeleton rows, never a blank panel.
  expect(await state("loading").locator('[data-slot="skeleton"]').count()).toBeGreaterThan(2);
  await expect(state("loading").getByRole("article")).toHaveCount(0);

  // Archived: readable, one line in the box's place, Unarchive for a manager.
  await expect(state("archived").getByRole("article")).toHaveCount(2);
  await expect(line(state("archived"))).toHaveText(
    /This channel is archived\. Everything stays readable and searchable\.\s*Unarchive/,
  );
  await expect(state("archived").locator('[data-slot="conversation-toolbar"]')).toContainText(
    "Archived",
  );
  await noBox(state("archived"));

  // Paused: readable; the owner's name; the owner sees Choose a plan.
  await expect(state("paused").getByRole("article")).toHaveCount(2);
  await expect(line(state("paused"))).toHaveText(
    "Chat is paused: this workspace's plan doesn't include it. Anna Kowalska can turn it back on.",
  );
  await expect(line(state("paused")).getByRole("button")).toHaveCount(0);
  await noBox(state("paused"));
  await expect(line(state("paused-owner"))).toContainText(
    "Chat is paused: this workspace's plan doesn't include it.",
  );
  await expect(
    line(state("paused-owner")).getByRole("button", { name: "Choose a plan" }),
  ).toBeVisible();
  await noBox(state("paused-owner"));

  // Offline: reading from this device, the composer stays (sends wait).
  await expect(state("offline").locator('[data-slot="chat-offline"]')).toHaveText(
    "You're offline · reading from this device",
  );
  await expect(composer(state("offline"))).toHaveCount(1);

  // Reading far back: Jump to present.
  await expect(state("older").getByRole("button", { name: "Jump to present" })).toBeVisible();

  // A viewer reads, never posts (AC10.9).
  await expect(state("viewer").getByRole("article")).toHaveCount(2);
  await expect(line(state("viewer"))).toHaveText(
    "You can read this conversation but not post in it",
  );
  await noBox(state("viewer"));

  // A non-manager in an announcement channel (AC1.8).
  await expect(line(state("announcement"))).toHaveText("Only managers post here · Reply privately");
  await expect(
    line(state("announcement")).getByRole("button", { name: "Reply privately" }),
  ).toBeVisible();
  await expect(state("announcement").locator('[data-slot="conversation-toolbar"]')).toContainText(
    "Announcements · only managers post",
  );
  await noBox(state("announcement"));

  // A former member: name kept with a quiet label; the DM reads who left (AC6.5).
  const article = state("former").getByRole("article").first();
  await expect(article.locator('[data-slot="message-author"]')).toHaveText("Jana Lis");
  await expect(article.locator('[data-slot="former-member"]')).toBeVisible();
  await expect(line(state("former"))).toHaveText("Jana Lis left the workspace");
  await noBox(state("former"));

  // Every line sits where the composer goes, one shape for all.
  const shapes = await page.locator("[data-composer-line]").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return `${cs.borderRadius}|${cs.backgroundColor}|${Math.round(el.getBoundingClientRect().height)}`;
    }),
  );
  expect(new Set(shapes).size).toBe(1);

  expect(errors).toEqual([]);
});

test("the left panel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/iframe.html?id=features-chat-states--sidebar&viewMode=story");
  const panel = page.getByTestId("chat-sidebar");
  const nav = panel.getByRole("navigation", { name: "Conversations" });
  await expect(nav).toBeVisible();

  const look = await nav.evaluate((root) => {
    const rows = [
      ...root.querySelectorAll<HTMLElement>(
        '[data-slot="nav-row"], [data-slot="nav-section-header"], [data-slot="sidebar-hairline"]',
      ),
    ];
    return rows.map((el) => {
      const label = el.querySelector<HTMLElement>('[data-slot="nav-row-label"]');
      const count = el.querySelector<HTMLElement>('[data-slot="nav-row-count"]');
      return {
        slot: el.dataset.slot,
        text: (label?.textContent ?? el.textContent ?? "").trim(),
        weight: label ? Number(getComputedStyle(label).fontWeight) : 0,
        count: count?.textContent?.trim() ?? null,
        countBg: count ? getComputedStyle(count).backgroundColor : null,
        privateGlyph: !!el.querySelector('[aria-label="Private"]'),
      };
    });
  });

  // Catch up (with its count) · hairline · Pinned · Channels · Direct messages · New conversation.
  expect(look.map((r) => (r.slot === "sidebar-hairline" ? "—" : r.text))).toEqual([
    "Catch up",
    "—",
    "Pinned",
    "Acme rebrand",
    "Channels",
    "Founders",
    "General",
    "Launch v1",
    "Random",
    "Direct messages",
    "Sofia Ortiz",
    "Mike Chen",
    "New conversation",
  ]);
  const row = (text: string) => look.find((r) => r.text === text)!;
  expect(row("Catch up").count).toBe("3");
  // No "#" before a channel's name; one glyph plus a lock (AC10.3).
  expect(look.some((r) => r.text.startsWith("#"))).toBe(false);
  expect(row("Founders").privateGlyph).toBe(true);
  expect(row("General").privateGlyph).toBe(false);
  // Unread is weight; a number only for what's addressed to you; never a pill.
  expect(row("Launch v1").weight).toBeGreaterThan(row("General").weight);
  expect(row("Launch v1").count).toBeNull();
  expect(row("Sofia Ortiz").count).toBe("2");
  expect(row("Random").weight).toBeGreaterThan(row("General").weight);
  expect(row("Random").count).toBeNull();
  expect(row("Sofia Ortiz").countBg).toBe("rgba(0, 0, 0, 0)");
  // Archived channels aren't rows (they open from the panel's ⋯).
  expect(look.some((r) => r.text === "Website 2025")).toBe(false);

  // Sections collapse.
  await nav.getByRole("button", { name: "Channels", exact: true }).click();
  await expect(nav.getByRole("button", { name: /^General/ })).toHaveCount(0);

  expect(errors).toEqual([]);
});

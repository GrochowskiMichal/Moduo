// The Mail screen's lab states and journeys (MR-16, AC1/AC2/AC14/AC40), kept apart so
// lab.config.ts stays under the size limit. Every one runs on the fixture engine
// (`moduo:mail:engine` = "fixture", features/email/engine/behavior.ts): the seeded reference
// mailbox in memory, so no frame shows real mail and nothing reaches an IMAP server.

import type { Locator, Page } from "@playwright/test";

type Target = string | Locator;
type J = {
  page: Page;
  press: (keys: string) => Promise<void>;
  click: (target: Target, opts?: object) => Promise<void>;
  step: (
    label: string,
    opts?: { expect?: Target | (() => Promise<boolean>); gone?: Target; view?: boolean },
  ) => Promise<void>;
};

const list = (page: Page) => page.getByRole("listbox", { name: "Conversations" });
const rows = (page: Page) => list(page).locator("[data-thread-id]");
const reader = (page: Page) => page.locator("[data-reader-thread]");

/** Switch this page to the fixture engine with `messages` messages, then reload /email. */
export async function onFixture(page: Page, messages = 100_000) {
  await page.evaluate((n) => {
    window.localStorage.setItem("moduo:mail:engine", "fixture");
    window.localStorage.setItem("moduo:mail:fixture-messages", String(n));
  }, messages);
  await page.reload();
  await rows(page).first().waitFor({ state: "visible", timeout: 30_000 });
}

const fixtureState = (messages: number, then?: (page: Page) => Promise<unknown>) => ({
  act: async ({ page }: { page: Page }) => {
    await onFixture(page, messages);
    await then?.(page);
  },
});

export const mailStates = {
  default: fixtureState(5_000),
  /** The reference mailbox at full scale: 100k messages over 6 accounts. */
  dense: fixtureState(100_000),
  /** A thread open in the reader. */
  reading: fixtureState(5_000, async (page) => {
    await rows(page).first().click();
    await reader(page).waitFor();
  }),
  /** The shortcut legend over the list. */
  legend: fixtureState(5_000, (page) => page.keyboard.press("?")),
  offline: { offline: true },
};

const firstId = (page: Page) => rows(page).first().getAttribute("data-thread-id");

export const mailJourneys = [
  {
    id: "mail-open",
    screen: "email",
    goal: "Open Mail and read the newest conversation (Mail paints within 150 ms)",
    target: { keys: 1, clicks: 1 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page);
      await step("mail painted", { expect: rows(page).first() });
      await press("j");
      await step("conversation open", { expect: reader(page), view: true });
    },
    async pointer({ page, click, step }: J) {
      await onFixture(page);
      await step("mail painted", { expect: rows(page).first() });
      await click(rows(page).first());
      await step("conversation open", { expect: reader(page), view: true });
    },
  },
  {
    id: "mail-triage-50",
    screen: "email",
    goal: "Clear 50 conversations with Done, each landing in one frame and moving to the next",
    target: { keys: 51, clicks: 0 },
    async keyboard({ page, press, step }: J) {
      await onFixture(page);
      await press("j");
      await step("first conversation selected", { expect: reader(page) });
      for (let i = 0; i < 50; i += 1) {
        const before = await firstId(page);
        await press("e");
        await step(`done ${i + 1}`, { expect: async () => (await firstId(page)) !== before });
      }
    },
  },
  {
    id: "mail-scroll",
    screen: "email",
    goal: "Scroll through a 100k-message mailbox without dropping below 55 fps",
    target: { keys: 0, clicks: 0 },
    async pointer({ page, step }: J) {
      await onFixture(page);
      const box = await list(page).boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, 1200);
      await step("deep in the list", {
        expect: async () =>
          (await list(page).evaluate((el) => {
            let n: HTMLElement | null = el as HTMLElement;
            while (n && n.scrollHeight <= n.clientHeight + 4) n = n.parentElement;
            return n?.scrollTop ?? 0;
          })) > 10_000,
      });
    },
  },
];

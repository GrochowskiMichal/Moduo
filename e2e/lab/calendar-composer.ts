// The composer's lab pieces (CALR-9): its box, a state mid-sentence and a journey
// that types a place, hops to free time and adds. Kept apart so lab.config.ts
// stays under the size limit.

import type { Page } from "@playwright/test";

type Step = (label: string, opts?: { expect?: unknown; view?: boolean }) => Promise<void>;
type J = {
  page: Page;
  press: (keys: string) => Promise<void>;
  type: (text: string) => Promise<void>;
  step: Step;
};

/** The composer's box: N, ⌘N and the + button open it. */
export const composerInput = (page: Page) => page.getByRole("textbox", { name: "What and when" });

/** The composer mid-sentence, its words lit, its draft on the grid, the invite line. */
export const composingState = {
  act: async ({ page }: { page: Page }) => {
    await page.keyboard.press("n");
    await composerInput(page).fill(
      "Investor prep with sam@outside.io thu morning 90m at the office",
    );
  },
};

/** Type what, when and where; ⇥ hops to the next free time; ↵ adds with Undo. */
export const composeJourney = {
  id: "cal-compose-place",
  screen: "calendar",
  goal: "Type a coffee on Friday morning at a café, hop to a free time, and add it",
  target: { keys: 50, clicks: 0 },
  async keyboard({ press, type, step, page }: J) {
    await press("n");
    await step("composer", { expect: composerInput(page) });
    await type("Coffee with the founders fri morning at Charlotte");
    await step("read back", {
      expect: page.getByRole("dialog", { name: "New event" }).getByText("Charlotte").last(),
      view: true,
    });
    await press("Tab");
    await press("Enter");
    await step("added", { expect: page.getByText("Event added", { exact: true }) });
  },
};

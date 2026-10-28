// Calendar's Plan journeys (placing a task by S, CALR-5), kept beside lab.config.ts so
// the config stays under its size ratchet. Same contract as the config's journeys.

import type { Locator, Page } from "@playwright/test";

type J = {
  page: Page;
  press: (keys: string) => Promise<void>;
  click: (target: string | Locator) => Promise<void>;
  step: (
    label: string,
    opts?: { expect?: string | Locator | (() => Promise<boolean>); gone?: Locator; view?: boolean },
  ) => Promise<void>;
};

const TITLE = "Write the backend engineer role";
const planRow = (page: Page) =>
  page.locator("[data-plan-task-id]").filter({ hasText: TITLE }).first();

export const planJourneys = [
  {
    id: "cal-place-task",
    screen: "calendar",
    goal: "Pick a task in Plan and put it in the next free time that fits",
    target: { keys: 5, clicks: 1 },
    async keyboard({ click, press, step, page }: J) {
      await click(planRow(page));
      await press("s");
      const draft = page.locator("[data-placement-draft]");
      await step("lifted", { expect: draft, view: true });
      const first = JSON.stringify(await draft.boundingBox());
      await press("Tab");
      await step("next free time", {
        expect: async () => JSON.stringify(await draft.boundingBox()) !== first,
      });
      await press("Enter");
      const toast = page.getByText("Task placed").first();
      await step("placed", { expect: toast });
      await press("Meta+z");
      await step("taken back", { gone: toast });
    },
    async pointer({ click, press, step, page }: J) {
      await click(planRow(page));
      await press("s");
      await step("lifted", { expect: page.locator("[data-free-slot]").first(), view: true });
      await click(page.locator("[data-free-slot]").last());
      await step("placed", { expect: page.getByText("Task placed").first() });
    },
  },
];

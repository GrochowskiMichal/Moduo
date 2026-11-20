// The event menus' lab state: the right-click menu on an event (no shortcuts).
// Kept apart so lab.config.ts stays under the size limit.

import type { Page } from "@playwright/test";

// The Booking link view's state, re-exported so the config keeps one import line.
export { bookingLinkState } from "./calendar-booking.ts";

export const rightClickState = {
  act: async ({ page }: { page: Page }) =>
    page
      .getByRole("main")
      .getByText("Design review with Ana", { exact: true })
      .first()
      .click({ button: "right" }),
};

import { describe, expect, it } from "@rstest/core";

import { cancelledNotice } from "./book-cancel-page";
import { confirmationNotice } from "./book-page";

describe("book page · confirmation copy", () => {
  it("promises Google's invite when Google created the event", () => {
    expect(confirmationNotice(true, "tom@becker.studio")).toBe(
      "A calendar invite from Google and a short email with a way to cancel are on their way to tom@becker.studio.",
    );
  });

  it("promises our email with a calendar file on a Zoom-only booking", () => {
    expect(confirmationNotice(false, "tom@becker.studio")).toBe(
      "A short email with the details and a calendar file is on its way to tom@becker.studio.",
    );
  });
});

describe("cancel page · what happens next", () => {
  it("only promises our email when one is on its way", () => {
    expect(cancelledNotice({ googleInvites: true, emailed: true })).toBe(
      "The time is free again. Google will drop the calendar invite.",
    );
    expect(cancelledNotice({ googleInvites: false, emailed: true })).toBe(
      "The time is free again. An email with a calendar update that removes it is on its way.",
    );
    // Canceled after the meeting started: nothing is emailed.
    expect(cancelledNotice({ googleInvites: false, emailed: false })).toBe(
      "The time is free again.",
    );
  });
});

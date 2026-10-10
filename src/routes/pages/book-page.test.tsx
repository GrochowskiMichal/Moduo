import { describe, expect, it } from "@rstest/core";

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

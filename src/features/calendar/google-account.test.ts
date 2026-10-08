import { describe, expect, test } from "@rstest/core";
import { googleCalendarExternalId, parseGoogleExternalId } from "./google-account";

describe("parseGoogleExternalId", () => {
  test("splits a login from a calendar inside it", () => {
    expect(parseGoogleExternalId("google:ada@moduo.app")).toEqual({
      email: "ada@moduo.app",
      calendarId: null,
    });
    const id = googleCalendarExternalId(
      "ada@moduo.app",
      "en.usa#holiday@group.v.calendar.google.com",
    );
    expect(parseGoogleExternalId(id)).toEqual({
      email: "ada@moduo.app",
      calendarId: "en.usa#holiday@group.v.calendar.google.com",
    });
  });

  test("rejects anything that is not a Google account id", () => {
    expect(parseGoogleExternalId("outlook:ada@moduo.app")).toBeNull();
    expect(parseGoogleExternalId("google:")).toBeNull();
  });
});

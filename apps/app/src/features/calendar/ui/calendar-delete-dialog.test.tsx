import { describe, expect, it } from "@rstest/core";

import type { CalendarEventModel } from "../events";
import { cancellationNotice } from "./calendar-delete-dialog";

const base = { sourceAccountId: "acc-g", externalEventId: "g1" } as Pick<
  CalendarEventModel,
  "sourceAccountId" | "externalEventId"
>;
const guest = (email: string, name = "", self?: boolean) => ({
  email,
  name,
  status: "needsAction",
  ...(self ? { self } : {}),
});

describe("cancellationNotice", () => {
  it("names who Google will email, yourself left out", () => {
    expect(
      cancellationNotice({
        ...base,
        attendees: [
          guest("me@x.com", "", true),
          guest("priya@x.com", "Priya"),
          guest("kai@x.com"),
          guest("nora@x.com"),
        ],
      }),
    ).toBe("Priya and 2 others will get a cancellation from Google.");
    expect(
      cancellationNotice({
        ...base,
        attendees: [guest("priya@x.com", "Priya"), guest("kai@x.com", "Kai")],
      }),
    ).toBe("Priya and 1 other will get a cancellation from Google.");
    expect(cancellationNotice({ ...base, attendees: [guest("priya@x.com", "Priya")] })).toBe(
      "Priya will get a cancellation from Google.",
    );
    expect(cancellationNotice({ ...base, attendees: [guest("kai@x.com")] })).toBe(
      "kai@x.com will get a cancellation from Google.",
    );
  });

  it("says nothing without guests, or for an event that isn't Google's", () => {
    expect(cancellationNotice({ ...base, attendees: [guest("me@x.com", "", true)] })).toBeNull();
    expect(cancellationNotice({ ...base, attendees: [] })).toBeNull();
    expect(cancellationNotice({ ...base })).toBeNull();
    expect(
      cancellationNotice({
        sourceAccountId: null,
        externalEventId: null,
        attendees: [guest("priya@x.com", "Priya")],
      }),
    ).toBeNull();
  });
});

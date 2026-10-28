// The guest's side of an offer (CALR-19, specs/calendar-rethink.md AC34): the
// page at /book/r/<slug> asks booking-public in its offer mode, and says so
// plainly when the offer has been picked, released or has run out.

import { describe, expect, it } from "@rstest/core";

import { offerClosedNotice, offerRequest } from "./offer";

describe("the guest page's offer mode", () => {
  it("an offer page asks by the offer, a link page by the link", () => {
    expect(offerRequest({ offer: "intro-4kq7xzt2" })).toEqual({ offer: "intro-4kq7xzt2" });
    expect(offerRequest({ slug: "intro" })).toEqual({ slug: "intro" });
    expect(offerRequest({ slug: "intro", offer: "intro-4kq7xzt2" })).toEqual({
      offer: "intro-4kq7xzt2",
    });
  });

  it("says a picked offer has its time", () => {
    expect(offerClosedNotice("booked", "Robin Hale")).toBe(
      "A time from these has already been picked. Robin Hale has the details.",
    );
  });

  it("says released or expired times aren't on offer any more", () => {
    const text = "These times aren't on offer any more. Ask Robin Hale for new ones.";
    expect(offerClosedNotice("released", "Robin Hale")).toBe(text);
    expect(offerClosedNotice("expired", "Robin Hale")).toBe(text);
  });

  it("an open offer has no notice", () => {
    expect(offerClosedNotice("open", "Robin Hale")).toBeNull();
  });
});

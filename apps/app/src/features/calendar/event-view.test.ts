// AC25 (CALR-10): the pure pieces of the Event view — which event the panel
// follows, the place's two lines and its map, the link's provider, replies,
// whether "Add a Meet link" can work, and the honest who-sees-it line.

import { describe, expect, it } from "@rstest/core";

import {
  canAddMeet,
  followedEventId,
  linkLines,
  mapUrl,
  placeLines,
  replyLabel,
  whoSeesLine,
} from "./event-view";

describe("followedEventId", () => {
  it("follows the selected event while Event or Notes is showing", () => {
    expect(followedEventId("ev-1:1761645600000", "detail", true)).toBe("ev-1");
    expect(followedEventId("ev-2:1761645600000", "notes", true)).toBe("ev-2");
  });

  it("leaves the panel alone otherwise", () => {
    expect(followedEventId("ev-1:1761645600000", "tasks", true)).toBeNull();
    expect(followedEventId("ev-1:1761645600000", "detail", false)).toBeNull();
    expect(followedEventId(null, "detail", true)).toBeNull();
  });
});

describe("placeLines and mapUrl", () => {
  it("splits a place into its name and address at the first comma", () => {
    expect(placeLines("Hale & Co, 12 Rue Oberkampf, Paris")).toEqual({
      name: "Hale & Co",
      address: "12 Rue Oberkampf, Paris",
    });
    expect(placeLines("The office")).toEqual({ name: "The office", address: null });
  });

  it("is no place when empty or when it is only a link", () => {
    expect(placeLines(null)).toBeNull();
    expect(placeLines("   ")).toBeNull();
    expect(placeLines("https://meet.google.com/abc-defg-hij")).toBeNull();
  });

  it("opens the whole place on a map", () => {
    expect(mapUrl("Hale & Co, 12 Rue Oberkampf")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Hale%20%26%20Co%2C%2012%20Rue%20Oberkampf",
    );
  });
});

describe("linkLines", () => {
  it("names the provider and keeps the URL", () => {
    expect(
      linkLines({
        conferenceUrl: "https://meet.google.com/abc-defg-hij",
        conferenceProvider: "google_meet",
      }),
    ).toEqual({ provider: "Google Meet", url: "https://meet.google.com/abc-defg-hij" });
    expect(linkLines({ conferenceUrl: "https://acme.zoom.us/j/123" })).toEqual({
      provider: "Zoom",
      url: "https://acme.zoom.us/j/123",
    });
    expect(linkLines({ conferenceUrl: "https://teams.microsoft.com/l/x" })?.provider).toBe(
      "Microsoft Teams",
    );
    expect(linkLines({ conferenceUrl: "https://whereby.com/room" })?.provider).toBe("Meeting link");
  });

  it("is no link without one", () => {
    expect(linkLines({ location: "The office" })).toBeNull();
  });
});

describe("replyLabel", () => {
  it("reads Google's reply words", () => {
    expect(replyLabel("accepted")).toBe("Accepted");
    expect(replyLabel("declined")).toBe("Declined");
    expect(replyLabel("tentative")).toBe("Maybe");
    expect(replyLabel("needsAction")).toBe("No reply yet");
    expect(replyLabel("")).toBe("No reply yet");
  });
});

describe("canAddMeet", () => {
  it("offers a Meet link only where Google can make one", () => {
    expect(canAddMeet("google", { conferenceUrl: null })).toBe(true);
    // Moduo events have no way to make a Meet link without Google.
    expect(canAddMeet("moduo", { conferenceUrl: null })).toBe(false);
    expect(canAddMeet(null, { conferenceUrl: null })).toBe(false);
    // One link is enough.
    expect(canAddMeet("google", { conferenceUrl: "https://meet.google.com/x" })).toBe(false);
  });
});

describe("whoSeesLine", () => {
  const me = "u-me";
  const members = [
    { userId: me, name: "Robin Hale" },
    { userId: "u-kai", name: "Kai Ito" },
    { userId: "u-nora", name: "Nora Lind" },
    { userId: "u-mei", name: "Mei Chen" },
  ];

  it("says only you when the calendar isn't shared", () => {
    expect(whoSeesLine({ workspaceLevel: null, people: [] }, members, me)).toBe("Only you see it");
  });

  it("names who sees it all and says the rest see Busy", () => {
    expect(
      whoSeesLine(
        {
          workspaceLevel: "freebusy",
          people: [
            { userId: "u-kai", level: "view" },
            { userId: "u-nora", level: "edit" },
          ],
        },
        members,
        me,
      ),
    ).toBe("Kai Ito and Nora Lind see it all · others see “Busy”");
  });

  it("speaks for everyone when one level covers the workspace", () => {
    expect(whoSeesLine({ workspaceLevel: "view", people: [] }, members, me)).toBe(
      "Everyone here sees it all",
    );
    expect(whoSeesLine({ workspaceLevel: "freebusy", people: [] }, members, me)).toBe(
      "Everyone here sees “Busy”",
    );
  });

  it("names a single person by level and leaves out people who see nothing", () => {
    expect(
      whoSeesLine(
        { workspaceLevel: null, people: [{ userId: "u-mei", level: "freebusy" }] },
        members,
        me,
      ),
    ).toBe("Mei Chen sees “Busy”");
    expect(
      whoSeesLine(
        {
          workspaceLevel: null,
          people: [
            { userId: "u-kai", level: "view" },
            { userId: "u-mei", level: "freebusy" },
          ],
        },
        members,
        me,
      ),
    ).toBe("Kai Ito sees it all · Mei Chen sees “Busy”");
  });

  it("never claims private masking", () => {
    const line = whoSeesLine({ workspaceLevel: "view", people: [] }, members, me);
    expect(line).not.toMatch(/private/i);
  });
});

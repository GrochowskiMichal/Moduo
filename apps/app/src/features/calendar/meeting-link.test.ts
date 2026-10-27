import { describe, expect, test } from "@rstest/core";

import { googleMeetingLink, graphMeetingLink, meetingLinkOf } from "./meeting-link";

describe("meeting link", () => {
  test("uses a URL location and names the platform", () => {
    expect(meetingLinkOf({ location: "https://meet.google.com/abc-defg-hij" })).toEqual({
      url: "https://meet.google.com/abc-defg-hij",
      label: "Join Google Meet",
    });
    expect(meetingLinkOf({ location: "https://us05web.zoom.us/j/8123?pwd=x" })?.label).toBe(
      "Join Zoom",
    );
  });

  test("finds a known meeting URL in the description when the location is a place", () => {
    const link = meetingLinkOf({
      location: "Office",
      description: "Agenda\nJoin: https://meet.google.com/xyz-abcd-efg.\nThanks",
    });
    expect(link?.url).toBe("https://meet.google.com/xyz-abcd-efg");
    expect(meetingLinkOf({ location: "Office", description: "no link here" })).toBeNull();
  });

  test("reads the provider's join link from raw events", () => {
    expect(googleMeetingLink({ hangoutLink: "https://meet.google.com/a-b-c" })).toBe(
      "https://meet.google.com/a-b-c",
    );
    expect(
      googleMeetingLink({
        conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/1" }] },
      }),
    ).toBe("https://zoom.us/j/1");
    expect(googleMeetingLink({ location: " https://zoom.us/j/2 " })).toBe("https://zoom.us/j/2");
    expect(googleMeetingLink({})).toBeNull();
    expect(
      graphMeetingLink({ onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/x" } }),
    ).toBe("https://teams.microsoft.com/l/x");
  });
});

describe("meeting link from the event's own link (CALR-6)", () => {
  test("the stored conference URL wins over location and description", () => {
    expect(
      meetingLinkOf({
        conferenceUrl: "https://us02web.zoom.us/j/9",
        location: "https://meet.google.com/abc-defg-hij",
        description: "https://teams.microsoft.com/l/x",
      }),
    ).toEqual({ url: "https://us02web.zoom.us/j/9", label: "Join Zoom" });
  });

  test("a place stays a place when the event has a link", () => {
    expect(
      meetingLinkOf({ conferenceUrl: "https://meet.google.com/a-b-c", location: "Hale & Co" }),
    ).toEqual({ url: "https://meet.google.com/a-b-c", label: "Join Google Meet" });
  });

  test("without a stored link it still reads location, then description", () => {
    expect(meetingLinkOf({ conferenceUrl: null, location: "https://zoom.us/j/2" })?.url).toBe(
      "https://zoom.us/j/2",
    );
  });
});

import { describe, expect, test } from "vitest";
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

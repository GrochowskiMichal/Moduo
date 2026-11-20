import { describe, expect, test } from "@rstest/core";

import { pickVideo, videoBlocker, videoOptions, videoSetting } from "./video";

describe("booking video platform", () => {
  test("reads the stored setting, defaulting to Google Meet", () => {
    expect(videoSetting("zoom")).toBe("zoom");
    expect(videoSetting("guest_choice")).toBe("guest_choice");
    expect(videoSetting(null)).toBe("google_meet");
    expect(videoSetting("moduo_video")).toBe("google_meet");
  });

  test("offers only platforms the host has connected", () => {
    const both = { google_meet: true, zoom: true };
    expect(videoOptions("guest_choice", both)).toEqual(["google_meet", "zoom"]);
    expect(videoOptions("guest_choice", { google_meet: false, zoom: true })).toEqual(["zoom"]);
    expect(videoOptions("zoom", { google_meet: true, zoom: false })).toEqual([]);
    expect(videoOptions("google_meet", both)).toEqual(["google_meet"]);
  });

  test("keeps the guest's pick only when it is offered", () => {
    expect(pickVideo(["google_meet", "zoom"], "zoom")).toBe("zoom");
    expect(pickVideo(["google_meet"], "zoom")).toBe("google_meet");
    expect(pickVideo([], "zoom")).toBeNull();
  });
});

describe("videoBlocker", () => {
  const none = { google_meet: false, zoom: false };
  const both = { google_meet: true, zoom: true };
  test("needs the one login a single platform uses", () => {
    expect(videoBlocker("google_meet", none)).toBe("Connect Google to use Google Meet.");
    expect(videoBlocker("google_meet", { google_meet: true, zoom: false })).toBeNull();
    expect(videoBlocker("zoom", { google_meet: true, zoom: false })).toBe(
      "Connect Zoom to use Zoom.",
    );
    expect(videoBlocker("zoom", { google_meet: false, zoom: true })).toBeNull();
  });
  test("needs both logins for Their choice", () => {
    expect(videoBlocker("guest_choice", none)).toBe(
      "Connect Google and Zoom so guests can choose.",
    );
    expect(videoBlocker("guest_choice", { google_meet: true, zoom: false })).toBe(
      "Connect Zoom too, so guests can choose.",
    );
    expect(videoBlocker("guest_choice", both)).toBeNull();
  });
});

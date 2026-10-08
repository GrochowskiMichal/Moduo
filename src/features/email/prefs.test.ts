// EM-10/DF-6 — the email prefs sanitizer round-trips both domains.

import { describe, expect, it } from "@rstest/core";

import { sanitizeEmailPrefs } from "./prefs";

describe("sanitizeEmailPrefs", () => {
  it("round-trips a valid prefs object", () => {
    const prefs = sanitizeEmailPrefs({
      senderOverrides: { "news@corp.com": "newsletters" },
      imageAllowedSenders: ["boss@corp.com"],
    });
    expect(prefs.senderOverrides["news@corp.com"]).toBe("newsletters");
    expect(prefs.imageAllowedSenders).toEqual(["boss@corp.com"]);
  });

  it("fills imageAllowedSenders for pre-DF-6 stored values", () => {
    const prefs = sanitizeEmailPrefs({ senderOverrides: {} });
    expect(prefs.imageAllowedSenders).toEqual([]);
  });

  it("lowercases, trims, dedupes and drops junk in imageAllowedSenders", () => {
    const prefs = sanitizeEmailPrefs({
      imageAllowedSenders: [" Boss@Corp.com ", "boss@corp.com", "", 42, null],
    });
    expect(prefs.imageAllowedSenders).toEqual(["boss@corp.com"]);
  });

  it("returns empty prefs for garbage input", () => {
    expect(sanitizeEmailPrefs(null)).toEqual({ senderOverrides: {}, imageAllowedSenders: [] });
    expect(sanitizeEmailPrefs("x")).toEqual({ senderOverrides: {}, imageAllowedSenders: [] });
  });
});

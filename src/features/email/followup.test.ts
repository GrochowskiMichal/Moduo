import { describe, expect, it } from "vitest";

import { followUpClearedByReply } from "./followup";

const self = ["me@fastmail.com", "me@gmail.com"];

describe("followUpClearedByReply", () => {
  it("clears when a counterpart replies after the follow-up was armed", () => {
    expect(
      followUpClearedByReply({
        messages: [
          { fromEmail: "me@fastmail.com", timestampMs: 1_000 }, // my sent message
          { fromEmail: "boss@corp.com", timestampMs: 2_000 }, // their reply
        ],
        selfAddresses: self,
        armedAtMs: 1_500,
      }),
    ).toBe(true);
  });

  it("does NOT clear on a self-reply (AC7 edge case)", () => {
    expect(
      followUpClearedByReply({
        messages: [
          { fromEmail: "me@fastmail.com", timestampMs: 1_000 },
          { fromEmail: "me@gmail.com", timestampMs: 3_000 }, // replied from my OTHER account
        ],
        selfAddresses: self,
        armedAtMs: 1_500,
      }),
    ).toBe(false);
  });

  it("ignores a counterpart message OLDER than the arm time", () => {
    expect(
      followUpClearedByReply({
        messages: [{ fromEmail: "boss@corp.com", timestampMs: 500 }],
        selfAddresses: self,
        armedAtMs: 1_500,
      }),
    ).toBe(false);
  });

  it("with no arm time, any counterpart message clears", () => {
    expect(
      followUpClearedByReply({
        messages: [{ fromEmail: "boss@corp.com", timestampMs: 500 }],
        selfAddresses: self,
        armedAtMs: null,
      }),
    ).toBe(true);
  });

  it("matches self addresses case-insensitively", () => {
    expect(
      followUpClearedByReply({
        messages: [{ fromEmail: "ME@Gmail.com", timestampMs: 3_000 }],
        selfAddresses: self,
        armedAtMs: 1_500,
      }),
    ).toBe(false);
  });

  it("no messages → not cleared", () => {
    expect(followUpClearedByReply({ messages: [], selfAddresses: self, armedAtMs: null })).toBe(
      false,
    );
  });

  it("a self-reply and a NEWER counterpart reply → cleared", () => {
    expect(
      followUpClearedByReply({
        messages: [
          { fromEmail: "me@gmail.com", timestampMs: 2_000 },
          { fromEmail: "boss@corp.com", timestampMs: 4_000 },
        ],
        selfAddresses: self,
        armedAtMs: 1_500,
      }),
    ).toBe(true);
  });
});

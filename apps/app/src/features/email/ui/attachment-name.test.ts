// specs/mail-improve.md MI-0, AC18 and AC20: long names truncate in the middle, so the
// version and the extension stay visible. `middleParts` splits a name into a head that
// truncates with one ellipsis and a tail that never does.

import { describe, expect, it } from "@rstest/core";

import { middleParts } from "./attachment-name";

describe("middle truncation (AC18)", () => {
  it("keeps the end of the stem and the extension in the tail", () => {
    expect(middleParts("Hale & Co pilot agreement v3.2 final.pdf")).toEqual({
      head: "Hale & Co pilot agreement v",
      tail: "3.2 final.pdf",
    });
    expect(middleParts("deck.key")).toEqual({ head: "", tail: "deck.key" });
  });

  it("names without an extension keep their last characters", () => {
    expect(middleParts("Quarterly planning notes for the board", 8)).toEqual({
      head: "Quarterly planning notes for t",
      tail: "he board",
    });
  });

  it("the head and tail always join back to the name", () => {
    for (const name of ["a", "x".repeat(200), "report-2026-11-08.final.v12.xlsx", "README"]) {
      const { head, tail } = middleParts(name);
      expect(head + tail).toBe(name);
    }
  });
});

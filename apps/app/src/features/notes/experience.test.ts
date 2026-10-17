import { beforeEach, describe, expect, it } from "@rstest/core";
import {
  DEFAULT_PREFERENCES,
  readLocalPreferences,
  sanitizePreferences,
  updatePreferences,
} from "../../lib/preferences";
import { notesExperienceOf, switchNotesExperience } from "./experience";

describe("experience pref — the New Notes switch (NR-2, AC1)", () => {
  beforeEach(() => {
    localStorage.clear();
    updatePreferences({ notesExperience: "classic" });
  });

  it("defaults to classic, and a junk or missing value reads as classic", () => {
    expect(DEFAULT_PREFERENCES.notesExperience).toBe("classic");
    expect(sanitizePreferences({}).notesExperience).toBe("classic");
    expect(sanitizePreferences({ notesExperience: "beta" }).notesExperience).toBe("classic");
    expect(notesExperienceOf(sanitizePreferences({ notesExperience: "next" }))).toBe("next");
  });

  it("writes through the synced preferences record, mirrored locally", () => {
    updatePreferences({ notesExperience: "next" });
    expect(readLocalPreferences().notesExperience).toBe("next");
    // The rest of the record survives the patch (it is one synced domain).
    expect(readLocalPreferences().landingView).toBe(DEFAULT_PREFERENCES.landingView);
  });

  it("flushes the open note before swapping", async () => {
    const order: string[] = [];
    await switchNotesExperience("next", {
      flushOpenNote: async () => {
        await Promise.resolve();
        order.push("flush");
      },
      write: (patch) => order.push(`write:${patch.notesExperience}`),
    });
    expect(order).toEqual(["flush", "write:next"]);
  });

  it("still swaps when the flush fails (the edits wait in the local outbox)", async () => {
    const writes: string[] = [];
    await switchNotesExperience("classic", {
      flushOpenNote: () => Promise.reject(new Error("offline")),
      write: (patch) => writes.push(patch.notesExperience),
    });
    expect(writes).toEqual(["classic"]);
  });
});

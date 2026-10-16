import { describe, expect, it } from "@rstest/core";

import type { PersonNow } from "@/lib/statuses/model";
import { teamNowText } from "./now-line";

const NOW = new Date("2026-10-13T12:00:00Z");

function person(extra: Partial<PersonNow> = {}): PersonNow {
  return {
    userId: "p",
    status: null,
    dnd: false,
    focusing: false,
    focusUntil: null,
    focusTaskId: null,
    focusTaskTitle: null,
    ...extra,
  };
}

describe("the Team widget's now line (AC11.6, CH70)", () => {
  it("says Active, Away, Focusing or the status, and nothing for someone with nothing to say", () => {
    expect(teamNowText(undefined, "reachable", NOW)).toBe("Active");
    expect(teamNowText(undefined, "away", NOW)).toBe("Away");
    expect(teamNowText(undefined, "offline", NOW)).toBe("");
    expect(teamNowText(person({ focusing: true, focusTaskTitle: "Hero v3" }), "focusing", NOW)).toBe(
      "Focusing on Hero v3",
    );
    expect(
      teamNowText(
        person({
          status: { emoji: "🌴", text: "On vacation", dnd: true, clearAt: null, preset: null, setAt: NOW.toISOString() },
          dnd: true,
        }),
        "dnd",
        NOW,
      ),
    ).toContain("On vacation");
  });

  it("a task title shows only when chat_now sent one (its person shares it and the viewer can see it)", () => {
    expect(teamNowText(person({ focusing: true }), "focusing", NOW)).toBe("Focusing");
  });
});

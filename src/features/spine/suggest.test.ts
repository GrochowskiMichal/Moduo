// Proves AC11 — auto-suggest is deterministic and load-bearing, never auto-
// applied. The scorer builds candidates ONLY from the three deterministic
// signals (shared-tag / email-domain / time-window), ranks them by weighted
// signal strength, merges multi-signal pairs, and suppresses any pair the user
// has declined or already linked. There is no path here that writes a link.

import { describe, expect, it } from "vitest";

import { deriveLinkKey, type EntityRef } from "../../lib/entity-links";
import {
  SIGNAL_WEIGHTS,
  scoreSuggestions,
  suggestionReason,
  topSuggestion,
  type RawLinkSuggestion,
  type SuggestionSignal,
} from "./suggest";

const FOCUS: EntityRef = { type: "contact", id: "c1" };

function raw(
  over: Partial<RawLinkSuggestion> & Pick<RawLinkSuggestion, "otherType" | "otherId" | "signal">,
): RawLinkSuggestion {
  return { otherLabel: "Acme Corp", otherIcon: null, suggestedKind: "references", strength: 1, ...over };
}

describe("scoreSuggestions", () => {
  it("builds a candidate from each deterministic signal (shared-tag / email-domain / time-window)", () => {
    const out = scoreSuggestions(FOCUS, [
      raw({ otherType: "note", otherId: "n1", signal: "shared-tag", strength: 2, otherLabel: "Account plan" }),
      raw({ otherType: "company", otherId: "co1", signal: "email-domain", suggestedKind: "works-at", otherLabel: "Acme" }),
      raw({ otherType: "task", otherId: "t1", signal: "time-window", otherLabel: "Ship it" }),
    ]);
    expect(out.map((s) => s.other.id).sort()).toEqual(["co1", "n1", "t1"]);
    const byId = new Map(out.map((s) => [s.other.id, s]));
    expect(byId.get("n1")?.signals).toEqual(["shared-tag"]);
    expect(byId.get("co1")?.signals).toEqual(["email-domain"]);
    expect(byId.get("t1")?.signals).toEqual(["time-window"]);
  });

  it("ranks a stronger signal above a weaker one; shared-tag strength scales the score", () => {
    const out = scoreSuggestions(FOCUS, [
      raw({ otherType: "task", otherId: "weak", signal: "time-window", otherLabel: "Z" }),
      raw({ otherType: "note", otherId: "strong", signal: "shared-tag", strength: 3, otherLabel: "A" }),
    ]);
    expect(out[0].other.id).toBe("strong");
    expect(out[0].score).toBe(SIGNAL_WEIGHTS["shared-tag"] * 3);
    expect(out[1].score).toBe(SIGNAL_WEIGHTS["time-window"]);
  });

  it("merges multiple signals for the same pair into one ranked suggestion", () => {
    const out = scoreSuggestions(FOCUS, [
      raw({ otherType: "company", otherId: "co1", signal: "email-domain", suggestedKind: "works-at" }),
      raw({ otherType: "company", otherId: "co1", signal: "time-window" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].signals).toEqual(["email-domain", "time-window"]); // strongest first
    expect(out[0].score).toBe(SIGNAL_WEIGHTS["email-domain"] + SIGNAL_WEIGHTS["time-window"]);
    // a meaningful kind wins over the generic default when a pair carries both.
    expect(out[0].suggestedKind).toBe("works-at");
  });

  it("does not double-count a repeated (pair, signal) raw row", () => {
    const out = scoreSuggestions(FOCUS, [
      raw({ otherType: "note", otherId: "n1", signal: "shared-tag", strength: 2 }),
      raw({ otherType: "note", otherId: "n1", signal: "shared-tag", strength: 2 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(SIGNAL_WEIGHTS["shared-tag"] * 2);
  });

  it("suppresses a declined pair from future candidates", () => {
    const declined = deriveLinkKey(FOCUS, { type: "company", id: "co1" });
    const out = scoreSuggestions(
      FOCUS,
      [raw({ otherType: "company", otherId: "co1", signal: "email-domain" })],
      { declinedPairKeys: [declined] },
    );
    expect(out).toHaveLength(0);
  });

  it("suppresses an already-linked pair (optimistic)", () => {
    const linked = deriveLinkKey(FOCUS, { type: "note", id: "n1" });
    const out = scoreSuggestions(
      FOCUS,
      [raw({ otherType: "note", otherId: "n1", signal: "shared-tag" })],
      { linkedPairKeys: [linked] },
    );
    expect(out).toHaveLength(0);
  });

  it("never suggests the focus itself and ignores unknown signals", () => {
    const out = scoreSuggestions(FOCUS, [
      raw({ otherType: FOCUS.type, otherId: FOCUS.id, signal: "shared-tag" }),
      raw({ otherType: "task", otherId: "t1", signal: "bogus" as unknown as SuggestionSignal }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("is pure — identical input yields identical output and mutates nothing (no auto-apply)", () => {
    const input = [raw({ otherType: "company", otherId: "co1", signal: "email-domain" })];
    const a = scoreSuggestions(FOCUS, input);
    const b = scoreSuggestions(FOCUS, input);
    expect(a).toEqual(b);
    expect(input).toHaveLength(1); // the raw input is not consumed or tagged
  });
});

describe("topSuggestion", () => {
  it("returns the highest-ranked suggestion, or null when empty (max one at rest)", () => {
    expect(topSuggestion([])).toBeNull();
    const out = scoreSuggestions(FOCUS, [
      raw({ otherType: "task", otherId: "t1", signal: "time-window", otherLabel: "B" }),
      raw({ otherType: "note", otherId: "n1", signal: "shared-tag", otherLabel: "A" }),
    ]);
    expect(topSuggestion(out)?.other.id).toBe("n1");
  });
});

describe("suggestionReason", () => {
  it("explains the strongest firing signal in plain words", () => {
    const [emailDomain] = scoreSuggestions(FOCUS, [
      raw({ otherType: "company", otherId: "co1", signal: "email-domain" }),
    ]);
    expect(suggestionReason(emailDomain)).toBe("Same email domain");

    const [sharedTag] = scoreSuggestions(FOCUS, [
      raw({ otherType: "note", otherId: "n1", signal: "shared-tag" }),
    ]);
    expect(suggestionReason(sharedTag)).toBe("Shares tags");
  });
});

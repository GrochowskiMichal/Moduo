// Connective-tissue spine — block CT-6 unit coverage (AC11).
//
// Proves the deterministic half: scoring fires on shared-tag / address-match /
// time-window only, ranking is stable, a recorded decline removes the pair from
// future candidates, and the only creation pathway is an explicit accept that
// stamps origin='suggest' — there is no auto-apply path.

import { describe, expect, it } from "vitest";
import { deriveLinkKey, type EntityRef } from "../../lib/entity-links";
import {
  SHARED_TAG_CAP,
  SUGGESTION_ORIGIN,
  SUGGESTION_SIGNALS,
  SUGGESTION_WEIGHTS,
  acceptSuggestionInput,
  buildSuggestions,
  scoreCandidate,
  selectTopSuggestion,
  signalsFor,
  suggestionReason,
  type SuggestionCandidate,
} from "./suggest";

const focus: EntityRef = { type: "contact", id: "00000000-0000-0000-0000-0000000000aa" };

function candidate(over: Partial<SuggestionCandidate> = {}): SuggestionCandidate {
  return {
    target: { type: "company", id: "00000000-0000-0000-0000-0000000000bb" },
    label: "Acme Corp",
    icon: "building-2",
    suggestedKind: "references",
    sharedTagCount: 0,
    addressMatch: false,
    nearInTime: false,
    ...over,
  };
}

describe("scoreCandidate — deterministic signals only", () => {
  it("fires on shared tags, scaled by count and capped", () => {
    expect(scoreCandidate(candidate({ sharedTagCount: 1 }))).toBe(SUGGESTION_WEIGHTS["shared-tag"]);
    expect(scoreCandidate(candidate({ sharedTagCount: 2 }))).toBe(
      SUGGESTION_WEIGHTS["shared-tag"] * 2,
    );
    // Beyond the cap, extra shared tags do not keep inflating the score.
    expect(scoreCandidate(candidate({ sharedTagCount: 99 }))).toBe(
      SUGGESTION_WEIGHTS["shared-tag"] * SHARED_TAG_CAP,
    );
  });

  it("fires on an address (email-domain) match", () => {
    expect(scoreCandidate(candidate({ addressMatch: true }))).toBe(
      SUGGESTION_WEIGHTS["address-match"],
    );
  });

  it("fires on the time window as a (weak) booster", () => {
    expect(scoreCandidate(candidate({ nearInTime: true }))).toBe(
      SUGGESTION_WEIGHTS["time-window"],
    );
  });

  it("sums the fired signals", () => {
    const score = scoreCandidate(candidate({ sharedTagCount: 1, addressMatch: true, nearInTime: true }));
    expect(score).toBe(
      SUGGESTION_WEIGHTS["shared-tag"] +
        SUGGESTION_WEIGHTS["address-match"] +
        SUGGESTION_WEIGHTS["time-window"],
    );
  });

  it("scores a signal-less candidate at zero", () => {
    expect(scoreCandidate(candidate())).toBe(0);
  });
});

describe("signalsFor / suggestionReason", () => {
  it("lists fired signals strongest-first and never invents one", () => {
    expect(signalsFor(candidate({ sharedTagCount: 2, nearInTime: true }))).toEqual([
      "shared-tag",
      "time-window",
    ]);
    expect(signalsFor(candidate())).toEqual([]);
    // Every reported signal is from the closed set.
    for (const s of signalsFor(candidate({ sharedTagCount: 1, addressMatch: true, nearInTime: true }))) {
      expect(SUGGESTION_SIGNALS).toContain(s);
    }
  });

  it("explains the most specific signal in one sentence-case line", () => {
    expect(suggestionReason(["address-match"])).toBe("Same email domain");
    expect(suggestionReason(["shared-tag"])).toBe("Shared tag");
    expect(suggestionReason(["shared-tag", "time-window"])).toBe("Shared tag, around the same time");
  });
});

describe("buildSuggestions — ranking, suppression, hygiene", () => {
  const strong = candidate({
    target: { type: "company", id: "11111111-1111-1111-1111-111111111111" },
    label: "Strong",
    addressMatch: true,
    sharedTagCount: 2,
  });
  const weak = candidate({
    target: { type: "task", id: "22222222-2222-2222-2222-222222222222" },
    label: "Weak",
    sharedTagCount: 1,
  });

  it("ranks by score, strongest first", () => {
    const built = buildSuggestions(focus, [weak, strong]);
    expect(built.map((s) => s.label)).toEqual(["Strong", "Weak"]);
    expect(built[0].score).toBeGreaterThan(built[1].score);
    expect(built[0].signals[0]).toBe("shared-tag");
  });

  it("breaks score ties stably by label", () => {
    const a = candidate({ target: { type: "task", id: "aaaa1111-0000-0000-0000-000000000001" }, label: "Beta", sharedTagCount: 1 });
    const b = candidate({ target: { type: "task", id: "aaaa1111-0000-0000-0000-000000000002" }, label: "Alpha", sharedTagCount: 1 });
    expect(buildSuggestions(focus, [a, b]).map((s) => s.label)).toEqual(["Alpha", "Beta"]);
  });

  it("removes a declined pair from future candidates", () => {
    const declined = deriveLinkKey(focus, strong.target);
    const built = buildSuggestions(focus, [strong, weak], [declined]);
    expect(built.map((s) => s.label)).toEqual(["Weak"]);
    expect(built.some((s) => s.pairKey === declined)).toBe(false);
  });

  it("drops self-links, signal-less candidates, and duplicate pairs", () => {
    const selfCand = candidate({ target: focus, label: "Self", sharedTagCount: 5 });
    const noSignal = candidate({ target: { type: "note", id: "33333333-3333-3333-3333-333333333333" }, label: "Quiet" });
    const dup = candidate({ ...weak, label: "Weak (dup)" });
    const built = buildSuggestions(focus, [selfCand, noSignal, weak, dup]);
    expect(built.map((s) => s.label)).toEqual(["Weak"]); // self + no-signal + dup all gone
  });

  it("stamps the direction-agnostic pair key on each suggestion", () => {
    const built = buildSuggestions(focus, [weak]);
    expect(built[0].pairKey).toBe(deriveLinkKey(focus, weak.target));
    // Direction-agnostic: keyed the same regardless of focus/target order.
    expect(built[0].pairKey).toBe(deriveLinkKey(weak.target, focus));
  });
});

describe("selectTopSuggestion — max one at rest (AC11)", () => {
  it("returns the single strongest, or null when empty", () => {
    const built = buildSuggestions(focus, [
      candidate({ target: { type: "task", id: "44444444-4444-4444-4444-444444444444" }, label: "One", sharedTagCount: 1 }),
      candidate({ target: { type: "task", id: "55555555-5555-5555-5555-555555555555" }, label: "Two", sharedTagCount: 3 }),
    ]);
    expect(selectTopSuggestion(built)?.label).toBe("Two");
    expect(selectTopSuggestion([])).toBeNull();
  });
});

describe("accept — explicit, origin=suggest, never auto-applied (AC11)", () => {
  it("shapes createLink input stamped origin='suggest' with the suggested kind", () => {
    const [suggestion] = buildSuggestions(focus, [
      candidate({ addressMatch: true, suggestedKind: "works-at", label: "Acme" }),
    ]);
    const input = acceptSuggestionInput(focus, suggestion, { focusLabel: "Jane Doe", focusIcon: "user" });
    expect(input).toMatchObject({
      source: focus,
      target: suggestion.target,
      relationKind: "works-at",
      origin: SUGGESTION_ORIGIN,
      sourceLabel: "Jane Doe",
      targetLabel: "Acme",
    });
    expect(input.origin).toBe("suggest");
  });

  it("is a pure shaper — produces data only, with no write side effect", () => {
    const [suggestion] = buildSuggestions(focus, [candidate({ sharedTagCount: 1 })]);
    // Calling it repeatedly is deterministic and never mutates the suggestion —
    // the only way to persist is for a caller to pass this to createLink.
    const first = acceptSuggestionInput(focus, suggestion);
    const second = acceptSuggestionInput(focus, suggestion);
    expect(first).toEqual(second);
    expect(suggestion.score).toBe(scoreCandidate(suggestion));
  });
});

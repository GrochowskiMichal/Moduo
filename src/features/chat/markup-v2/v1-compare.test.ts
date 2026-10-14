import { describe, expect, it } from "@rstest/core";

import { parseStored } from "./parse";
import { serializeBlocks } from "./serialize";
import { compareConversion, lineChanges } from "./v1-compare";
import { V1_FIXTURE } from "./v1-fixture";

// What the drafted SQL converter made of the hand-made v1 fixture (50 bodies,
// every v1 token kind and the edge cases): each result parses, leaves no v1
// token or label, and draws as v1 drew it, except for the listed kinds.

/** Rows drawn differently on purpose, and why (docs/build/chat-v2/CV-0-S4.md). */
const EXPECTED_DIFFERENT: Record<string, string> = {
  f04: "@channel glued to words gets spaces so it stays a token",
  f14: "a one-line fence: v1 took the word for a language",
  f22: "lines starting '- ' are a list now (accepted)",
  f23: "lines starting '1. ' are a list now (accepted)",
  f24: "[text](url) is a link now (accepted)",
  f46: "a fence without a break after its first word",
  f47: "a fence without a break after its first word",
  f48: "one-line fences",
};

describe("chat__v1_to_v2 on the v1 fixture", () => {
  it("every result parses to a fixed point with no v1 token or label left", () => {
    for (const [id, v1, v2] of V1_FIXTURE) {
      const stored = serializeBlocks(parseStored(v2));
      expect(serializeBlocks(parseStored(stored)), id).toBe(stored);
      const c = compareConversion(v1, v2);
      expect(c.tokenLeft, id).toBe(false);
      expect(c.labelLeft, id).toBe(false);
    }
  });

  it("draws as v1 drew it except the accepted and intended changes", () => {
    const different = V1_FIXTURE.filter(([, v1, v2]) => !compareConversion(v1, v2).same).map(
      ([id]) => id,
    );
    expect(different).toEqual(Object.keys(EXPECTED_DIFFERENT));
  });
});

describe("lineChanges", () => {
  it("names lines that read as Markdown structure, outside code and v1 tokens", () => {
    expect(lineChanges("Plan:\n- a\n2. b\n[x](https://y.z)")).toEqual([
      "dash-line",
      "numbered-line",
      "markdown-link",
    ]);
    expect(lineChanges("`- a` <moduo:task:00000000-0000-4000-8000-000000000001|[x](y)>")).toEqual(
      [],
    );
    expect(lineChanges("see ```code``` here")).toEqual(["fence-word", "inline-fence"]);
  });
});

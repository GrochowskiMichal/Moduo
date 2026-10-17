import { describe, expect, it } from "@rstest/core";

import { forgetMessageTree, messageTree, messageTreeCount, TREE_CACHE_LIMIT } from "./cache";
import { EDITOR_CASES } from "./corpus";

// Spike 4's bar: 30 rows parsed (the tree a row is drawn from) in ≤ 5 ms.
// The rows are a realistic screen: short lines, a few long paragraphs with
// marks and references, a list, a code block, a quote.

const LONG =
  "Quick update on **onboarding**: the *empty states* now explain instead of decorate, " +
  "the checklist moved to moduo://task/0b6f9a8e-3c1d-4e2f-9a7b-1c2d3e4f5a6b and the copy " +
  "review is on moduo://date/2026-10-20. Still open: `apps/web` build warnings, the ~~old~~ " +
  "new illustration set (see [the board](https://moduo.app/board?id=42)) and whether " +
  "moduo://person/7cd06b5f-ad8e-4f9a-8be2-8d9eafb0c1d2 can take the Polish strings — " +
  "zażółć gęślą jaźń :shipit: 🎉 https://example.com/very/long/path_with_underscores?q=1. ";

const SCREEN: string[] = [
  ...EDITOR_CASES.slice(0, 18).map((c) => c.stored),
  LONG.repeat(2),
  LONG,
  "- one\n- two **bold**\n- three moduo://task/0b6f9a8e-3c1d-4e2f-9a7b-1c2d3e4f5a6b\n- four\n- five",
  `\`\`\`ts\n${"const value = compute(input, { fast: true });\n".repeat(20)}\`\`\``,
  "> Empty states should *explain*, not decorate.\n> — the brief\n\nAgreed, @channel let's ship.",
  "ok",
  "👍",
  "Lunch?",
  "@channel standup moves to **10:30** from tomorrow",
  "Hey moduo://person/7cd06b5f-ad8e-4f9a-8be2-8d9eafb0c1d2 can you look at the new empty states before Thursday?",
  "1. design\n2. build\n3. **ship**",
  "Deploy at 16:00 today. Any migrations? One, additive only.",
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

describe("30 rows, cold", () => {
  it("parse in ≤ 5 ms (median and p95 over 200 screens)", () => {
    expect(SCREEN).toHaveLength(30);
    const runs: number[] = [];
    for (let r = 0; r < 200; r++) {
      forgetMessageTree();
      const start = performance.now();
      SCREEN.forEach((body, k) => {
        messageTree(`m${k}`, `2026-10-14T10:00:${r}`, body);
      });
      runs.push(performance.now() - start);
    }
    const sorted = [...runs].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] as number;
    // The numbers the record quotes (docs/build/chat-v2/CV-0-S4.md).
    console.info(
      `chat markup perf: 30 rows cold · first ${runs[0]?.toFixed(2)} ms · median ${median(runs).toFixed(3)} ms · p95 ${p95.toFixed(3)} ms · max ${sorted[sorted.length - 1]?.toFixed(2)} ms`,
    );
    expect(median(runs)).toBeLessThanOrEqual(5);
    expect(p95).toBeLessThanOrEqual(5);
  });

  it("a warm screen is a cache hit (same id and updated_at)", () => {
    forgetMessageTree();
    const first = SCREEN.map((body, k) => messageTree(`m${k}`, "t1", body));
    const again = SCREEN.map((body, k) => messageTree(`m${k}`, "t1", body));
    again.forEach((tree, k) => {
      expect(tree).toBe(first[k]);
    });
    // An edit moves updated_at: a fresh tree.
    expect(messageTree("m0", "t2", "edited")).not.toBe(first[0]);
  });

  it("the cache is bounded, oldest out", () => {
    forgetMessageTree();
    for (let k = 0; k < TREE_CACHE_LIMIT + 10; k++) messageTree(`x${k}`, "t", "hi");
    expect(messageTreeCount()).toBe(TREE_CACHE_LIMIT);
    const kept = messageTree(`x${TREE_CACHE_LIMIT + 9}`, "t", "hi");
    expect(messageTree(`x${TREE_CACHE_LIMIT + 9}`, "t", "hi")).toBe(kept);
    forgetMessageTree();
  });
});

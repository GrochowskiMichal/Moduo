import { PLAN_TIERS } from "@contracts/vocabularies";
import { describe, expect, it } from "vitest";

import { PLAN_CARDS, planCard, priceFor, TIER_RANK, tierRank } from "./plans";

describe("plan catalog matches the landing pricing", () => {
  it("prices (monthly / yearly per month)", () => {
    const p = (id: Parameters<typeof planCard>[0]) => {
      const c = planCard(id);
      if (!c) throw new Error(`missing ${id}`);
      return [priceFor(c, "monthly"), priceFor(c, "yearly")];
    };
    expect(p("free")).toEqual([0, 0]);
    expect(p("pro")).toEqual([12, 10]);
    expect(p("duo")).toEqual([20, 16]);
    expect(p("team")).toEqual([15, 12]);
  });

  it("shows free, pro, duo, team in order — founder is never sold", () => {
    expect(PLAN_CARDS.map((c) => c.id)).toEqual(["free", "pro", "duo", "team"]);
  });
});

describe("tier ranking", () => {
  it("ranks every tier in the contract and puts founder on top", () => {
    for (const t of PLAN_TIERS) expect(typeof TIER_RANK[t]).toBe("number");
    expect(tierRank("founder")).toBeGreaterThan(tierRank("team"));
    expect(tierRank("team")).toBeGreaterThan(tierRank("duo"));
    expect(tierRank("duo")).toBeGreaterThan(tierRank("pro"));
    expect(tierRank("pro")).toBeGreaterThan(tierRank("free"));
  });
});

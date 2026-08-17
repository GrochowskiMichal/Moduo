import { describe, expect, it } from "vitest";

import type { PlanTier } from "./contracts/vocabularies.ts";
import {
  assertPlanTierForWrite,
  tierFromPriceId,
} from "./stripe-tier.ts";

describe("stripe-tier", () => {
  const priceMap: Record<string, PlanTier> = {
    price_pro_monthly: "pro",
    price_founders: "founder",
  };

  it("maps known price ids to canonical plan tiers", () => {
    expect(tierFromPriceId("price_pro_monthly", priceMap)).toBe("pro");
    expect(tierFromPriceId("price_founders", priceMap)).toBe("founder");
    expect(tierFromPriceId("unknown_price", priceMap)).toBe("free");
  });

  it("rejects legacy founders spelling on write paths", () => {
    expect(assertPlanTierForWrite("founder")).toBe("founder");
    expect(assertPlanTierForWrite("founders")).toBe("free");
    expect(assertPlanTierForWrite("enterprise")).toBe("free");
  });
});

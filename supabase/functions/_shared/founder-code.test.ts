// MOD-583 · founder promotion codes: unguessable, nothing from the email, and
// bound to the recipient's own Stripe customer.
import { describe, expect, it } from "@rstest/core";

import {
  FOUNDER_CODE_ALPHABET,
  FOUNDER_CODE_LENGTH,
  FOUNDER_CODE_PREFIX,
  founderCustomerId,
  founderPromoCode,
} from "./founder-code.ts";

describe("founderPromoCode", () => {
  it("is the prefix and 16 symbols from the alphabet, at least 12 random characters", () => {
    const code = founderPromoCode();
    expect(code.startsWith(FOUNDER_CODE_PREFIX)).toBe(true);
    const suffix = code.slice(FOUNDER_CODE_PREFIX.length);
    expect(suffix).toHaveLength(FOUNDER_CODE_LENGTH);
    expect(FOUNDER_CODE_LENGTH).toBeGreaterThanOrEqual(12);
    for (const ch of suffix) expect(FOUNDER_CODE_ALPHABET).toContain(ch);
  });

  it("comes from crypto.getRandomValues, one byte per symbol, without bias", () => {
    const seen: number[] = [];
    const code = founderPromoCode((bytes) => {
      seen.push(bytes.length);
      bytes.set(Array.from({ length: bytes.length }, (_, i) => i * 32 + i));
      return bytes;
    });
    expect(seen).toEqual([FOUNDER_CODE_LENGTH]);
    // Byte i*32+i maps to symbol i: the top bits never pick the symbol.
    expect(code).toBe(FOUNDER_CODE_PREFIX + FOUNDER_CODE_ALPHABET.slice(0, FOUNDER_CODE_LENGTH));
    expect(FOUNDER_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(FOUNDER_CODE_ALPHABET).size).toBe(32);
    expect(FOUNDER_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });

  it("doesn't repeat across many draws", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => founderPromoCode()));
    expect(codes.size).toBe(2000);
  });

  it("never draws on Math.random", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random used");
    };
    try {
      expect(() => founderPromoCode()).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

describe("founderCustomerId", () => {
  const profiles = [
    { id: "u-anna", stripe_customer_id: "cus_current" },
    { id: "u-bo", stripe_customer_id: null },
  ];

  it("is the customer Moduo made for the account and the account still points at", () => {
    expect(
      founderCustomerId(
        [
          { id: "cus_dashboard", metadata: {} },
          { id: "cus_stale", metadata: { supabase_user_id: "u-anna" } },
          { id: "cus_current", metadata: { supabase_user_id: "u-anna" } },
        ],
        profiles,
      ),
    ).toBe("cus_current");
  });

  it("is none for a customer with no account, or an account with no customer yet", () => {
    expect(founderCustomerId([], profiles)).toBeNull();
    expect(founderCustomerId([{ id: "cus_x", metadata: null }], profiles)).toBeNull();
    expect(founderCustomerId([{ id: "cus_b", metadata: { supabase_user_id: "u-bo" } }], profiles)).toBeNull();
    expect(
      founderCustomerId([{ id: "cus_current", metadata: { supabase_user_id: "u-other" } }], profiles),
    ).toBeNull();
  });
});

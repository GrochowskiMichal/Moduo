import { describe, expect, it } from "@rstest/core";

import {
  isPasswordProvider,
  MIN_PASSWORD_LENGTH,
  providerLabel,
  validateNewPassword,
} from "./account";

describe("validateNewPassword (AC4)", () => {
  it("rejects a password shorter than the minimum", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least/);
  });

  it("rejects a mismatched confirmation", () => {
    expect(validateNewPassword("longenough1", "different11")).toMatch(/don't match/);
  });

  it("accepts a valid, matching pair", () => {
    const pw = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword(pw, pw)).toBeNull();
  });
});

describe("providerLabel (AC3)", () => {
  it("maps known providers to friendly labels", () => {
    expect(providerLabel("email")).toBe("Email");
    expect(providerLabel("google")).toBe("Google");
    expect(providerLabel("azure")).toBe("Microsoft");
  });

  it("title-cases an unknown provider and defaults an absent one to Email", () => {
    expect(providerLabel("okta")).toBe("Okta");
    expect(providerLabel(null)).toBe("Email");
  });
});

describe("isPasswordProvider (AC4 — who sees the password form)", () => {
  it("treats email + unknown/absent as password-capable", () => {
    expect(isPasswordProvider("email")).toBe(true);
    expect(isPasswordProvider(null)).toBe(true);
    expect(isPasswordProvider(undefined)).toBe(true);
  });

  it("treats OAuth providers as having no password", () => {
    expect(isPasswordProvider("google")).toBe(false);
    expect(isPasswordProvider("github")).toBe(false);
  });
});

import { describe, expect, it } from "@rstest/core";

import { providerLabel } from "./account";

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

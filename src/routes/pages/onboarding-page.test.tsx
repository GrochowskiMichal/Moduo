import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { OnboardingPage } from "./onboarding-page";

const h = rs.hoisted(() => ({
  navigate: rs.fn((_to: unknown) => Promise.resolve()),
  isWeb: true,
}));

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
rs.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({
    isSignedIn: true,
    loading: false,
    runtime: {
      capabilities: { isWeb: h.isWeb },
      workspace: { list: async () => [], create: async () => ({}) },
    },
  }),
}));

afterEach(() => cleanup());

describe("OnboardingPage — trial footnote (TX-9a AC47)", () => {
  it("says the no-card trial lasts 14 days, and a card makes it 30", () => {
    h.isWeb = true;
    render(<OnboardingPage />);
    const note = screen.getByText(/trial/).closest("p");
    expect(note?.textContent).toBe(
      "Your 14-day trial is active. Add a card under Settings → Billing any time to extend it to 30 days.",
    );
    expect(note?.textContent).not.toContain("7-day");
  });

  it("leaves the footnote out on desktop", () => {
    h.isWeb = false;
    render(<OnboardingPage />);
    expect(screen.queryByText(/trial/)).toBeNull();
  });
});

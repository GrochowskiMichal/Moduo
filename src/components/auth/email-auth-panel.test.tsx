import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import type { ModuoRuntime } from "@/lib/runtime";
import { AuthContext, type AuthContextValue } from "@/providers/auth-provider";

import { EmailAuthPanel } from "./email-auth-panel";

const cloudRuntime = {
  capabilities: { hasLocalMnemonic: false },
  auth: { sendOtp: async () => ({ data: {}, error: null }) },
} as unknown as ModuoRuntime;

const auth: AuthContextValue = {
  userId: null,
  userEmail: null,
  accessToken: null,
  isSignedIn: false,
  loading: false,
  configError: null,
  runtime: cloudRuntime,
  planTier: "free",
  signOut: async () => {},
  refreshPlanTier: async () => {},
};

afterEach(cleanup);

function renderPanel(notice?: string | null) {
  return render(
    <AuthContext.Provider value={auth}>
      <EmailAuthPanel notice={notice} />
    </AuthContext.Provider>,
  );
}

describe("EmailAuthPanel notice", () => {
  it("shows the dropped-link notice on the email step", async () => {
    renderPanel("Links don't sign you in here. Enter your email to get a 6-digit code.");
    expect(await screen.findByText("Log in or create account")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Links don't sign you in here.");
  });

  it("shows nothing extra without a notice", async () => {
    renderPanel(null);
    expect(await screen.findByText("Log in or create account")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

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

function renderPanel(notice?: string | null, value: AuthContextValue = auth) {
  return render(
    <AuthContext.Provider value={value}>
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

type SendOtp = ModuoRuntime["auth"]["sendOtp"];

function withSendOtp(sendOtp: SendOtp): AuthContextValue {
  return {
    ...auth,
    runtime: { ...cloudRuntime, auth: { sendOtp } } as unknown as ModuoRuntime,
  };
}

async function requestCode(email = "tom@becker.studio") {
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
  });
}

describe("EmailAuthPanel resend countdown", () => {
  afterEach(() => {
    rs.useRealTimers();
  });

  it("disables Resend for 60 seconds after each send, counting down, and says how long the code works", async () => {
    let calls = 0;
    renderPanel(
      null,
      withSendOtp(async () => {
        calls += 1;
        return { data: {}, error: null };
      }),
    );
    // Wait for the email step with real timers (findBy* polls), then freeze time.
    await screen.findByPlaceholderText("you@example.com");
    rs.useFakeTimers();
    await requestCode();

    expect(
      screen.getByText("Enter the six-digit code we sent. It works for 10 minutes."),
    ).toBeTruthy();
    const resend = () => screen.getByRole("button", { name: /Resend/ }) as HTMLButtonElement;
    expect(resend().textContent).toBe("Resend in 1:00");
    expect(resend().disabled).toBe(true);

    await act(async () => {
      await rs.advanceTimersByTimeAsync(1000);
    });
    expect(resend().textContent).toBe("Resend in 0:59");

    await act(async () => {
      await rs.advanceTimersByTimeAsync(59_000);
    });
    expect(resend().disabled).toBe(false);
    expect(resend().textContent).toContain("Resend code");

    await act(async () => {
      fireEvent.click(resend());
    });
    expect(calls).toBe(2);
    expect(resend().textContent).toBe("Resend in 1:00");
  });

  it("going back and continuing with the same address inside the minute reuses the sent code", async () => {
    let calls = 0;
    renderPanel(
      null,
      withSendOtp(async () => {
        calls += 1;
        return { data: {}, error: null };
      }),
    );
    await screen.findByPlaceholderText("you@example.com");
    await requestCode();
    fireEvent.click(screen.getByRole("button", { name: "Back to email" }));
    await requestCode();
    expect(calls).toBe(1);
    expect(screen.getByText("Check your email")).toBeTruthy();
  });

  it("shows our words, not Supabase's, for a rate limit and a failed send", async () => {
    renderPanel(
      null,
      withSendOtp(async () => ({
        data: {},
        error: {
          message: "email rate limit exceeded",
          code: "over_email_send_rate_limit",
          status: 429,
        },
      })),
    );
    await screen.findByPlaceholderText("you@example.com");
    await requestCode();
    expect(screen.getByRole("alert").textContent).toBe(
      "Too many code requests right now. Try again in a few minutes.",
    );
    cleanup();

    renderPanel(
      null,
      withSendOtp(async () => ({
        data: {},
        error: {
          message: "Error sending magic link email",
          code: "unexpected_failure",
          status: 500,
        },
      })),
    );
    await screen.findByPlaceholderText("you@example.com");
    await requestCode();
    expect(screen.getByRole("alert").textContent).toBe(
      "We couldn't send your code. Try again in a minute.",
    );
  });
});

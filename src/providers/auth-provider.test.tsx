import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, render, waitFor } from "@testing-library/react";

import { type AuthContextValue, AuthProvider, useAuth } from "./auth-provider";

// A runtime whose auth events the test fires by hand, as auth-js would.
const fake = rs.hoisted(() => {
  const state = {
    emit: null as null | ((event: string, session: unknown) => void),
  };
  const session = { user: { id: "u1", email: "u1@example.com" }, access_token: "token-u1" };
  const runtime = {
    auth: {
      getSession: rs.fn(async () => ({ data: { session } })),
      onAuthStateChange: rs.fn((callback: (event: string, session: unknown) => void) => {
        state.emit = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      }),
      signOut: rs.fn(async () => {
        state.emit?.("SIGNED_OUT", null);
      }),
    },
    workspace: { getProfile: rs.fn(async () => ({ data: null })) },
  };
  return { state, runtime };
});

const analytics = rs.hoisted(() => ({
  signedIn: rs.fn(async () => {}),
  signedOut: rs.fn(async () => {}),
  setAnalyticsUser: rs.fn(async (_userId: string | null) => {}),
}));

rs.mock("../lib/runtime", () => ({
  initRuntime: async () => fake.runtime,
  runtimeConfigError: null,
}));
rs.mock("../lib/analytics", () => ({
  Analytics: { app: { signedIn: analytics.signedIn, signedOut: analytics.signedOut } },
  setAnalyticsUser: analytics.setAnalyticsUser,
}));

async function renderAuth() {
  let auth: AuthContextValue | null = null;
  function Probe() {
    auth = useAuth();
    return null;
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(fake.state.emit).not.toBeNull());
  return () => auth as unknown as AuthContextValue;
}

beforeEach(() => {
  fake.state.emit = null;
  rs.clearAllMocks();
});

describe("AuthProvider — signing out and analytics (PRIV-3)", () => {
  it("tracks nothing when auth-js signs out on its own, like after the account was deleted elsewhere", async () => {
    await renderAuth();

    act(() => fake.state.emit?.("SIGNED_OUT", null));

    expect(analytics.setAnalyticsUser).toHaveBeenLastCalledWith(null);
    expect(analytics.signedOut).not.toHaveBeenCalled();
  });

  it("tracks app_signed_out once when the person signs out, before the sign-out itself", async () => {
    const auth = await renderAuth();

    await act(() => auth().signOut());

    expect(analytics.signedOut).toHaveBeenCalledTimes(1);
    expect(analytics.signedOut.mock.invocationCallOrder[0]).toBeLessThan(
      fake.runtime.auth.signOut.mock.invocationCallOrder[0],
    );
    expect(analytics.setAnalyticsUser).toHaveBeenLastCalledWith(null);
  });
});

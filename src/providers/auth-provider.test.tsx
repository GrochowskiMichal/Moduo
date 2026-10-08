import { beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, render, waitFor } from "@testing-library/react";

import { type AuthContextValue, AuthProvider, useAuth } from "./auth-provider";

// A runtime whose auth events the test fires by hand, as auth-js would. `profile` is what
// the profile read answers for the signed-in account (see the answers below).
const fake = rs.hoisted(() => {
  const state = {
    emit: null as null | ((event: string, session: unknown) => void),
    profile: { data: { plan_tier: "free" }, error: null } as { data: unknown; error: unknown },
    profileGate: null as null | Promise<void>,
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
    workspace: {
      getProfile: rs.fn(async (_userId: string) => {
        if (state.profileGate) await state.profileGate;
        return state.profile;
      }),
    },
  };
  return { state, session, runtime };
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

/** Let pending promise jobs (the profile read and what follows it) run. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const startedFor = (userId: string) =>
  analytics.setAnalyticsUser.mock.calls.some(([id]) => id === userId);

// What the profile read answers: the account's row; no row (the account was deleted, which
// PostgREST reports as PGRST116 for `.single()`); or a failure that says nothing either way.
const EXISTS = { data: { plan_tier: "free" }, error: null };
const DELETED = { data: null, error: { code: "PGRST116", message: "no rows" } };
const OFFLINE = { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };

beforeEach(() => {
  fake.state.emit = null;
  fake.state.profile = EXISTS;
  fake.state.profileGate = null;
  rs.clearAllMocks();
});

describe("AuthProvider — signing out and analytics (PRIV-3)", () => {
  it("tracks nothing when auth-js signs out on its own, like after the account was deleted elsewhere", async () => {
    await renderAuth();
    await settle();

    act(() => fake.state.emit?.("SIGNED_OUT", null));

    expect(analytics.setAnalyticsUser).toHaveBeenLastCalledWith(null);
    expect(analytics.signedOut).not.toHaveBeenCalled();
  });

  it("tracks app_signed_out once when the person signs out, before the sign-out itself", async () => {
    const auth = await renderAuth();
    await settle();

    await act(() => auth().signOut());

    expect(analytics.signedOut).toHaveBeenCalledTimes(1);
    expect(analytics.signedOut.mock.invocationCallOrder[0]).toBeLessThan(
      fake.runtime.auth.signOut.mock.invocationCallOrder[0],
    );
    expect(analytics.setAnalyticsUser).toHaveBeenLastCalledWith(null);
  });
});

describe("AuthProvider — analytics starts only for an account the server still has (PRIV-3)", () => {
  it("starts once the profile read confirms the account, and tracks the sign-in once", async () => {
    await renderAuth();
    await waitFor(() => expect(startedFor("u1")).toBe(true));

    act(() => fake.state.emit?.("INITIAL_SESSION", fake.session));
    await settle();

    expect(analytics.signedIn).toHaveBeenCalledTimes(1);
  });

  it("never starts for a cached session whose account was deleted elsewhere", async () => {
    fake.state.profile = DELETED;
    await renderAuth();
    await settle();

    act(() => fake.state.emit?.("INITIAL_SESSION", fake.session));
    await settle();

    expect(startedFor("u1")).toBe(false);
    expect(analytics.setAnalyticsUser).toHaveBeenCalledWith(null);
    expect(analytics.signedIn).not.toHaveBeenCalled();
  });

  it("keeps analytics running when a later profile read fails, rather than resetting the person", async () => {
    await renderAuth();
    await waitFor(() => expect(startedFor("u1")).toBe(true));

    fake.state.profile = OFFLINE;
    act(() => fake.state.emit?.("SIGNED_IN", fake.session));
    await settle();

    expect(analytics.setAnalyticsUser).not.toHaveBeenCalledWith(null);
  });

  it("doesn't start on a failed read at launch, and starts once a later read confirms the account", async () => {
    fake.state.profile = OFFLINE;
    await renderAuth();
    await settle();
    expect(startedFor("u1")).toBe(false);

    fake.state.profile = EXISTS;
    act(() => fake.state.emit?.("INITIAL_SESSION", fake.session));
    await waitFor(() => expect(startedFor("u1")).toBe(true));
  });

  it("ignores a profile answer that arrives after the person signed out", async () => {
    let answer: () => void = () => {};
    fake.state.profileGate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await renderAuth();

    act(() => fake.state.emit?.("SIGNED_OUT", null));
    answer();
    await settle();

    expect(startedFor("u1")).toBe(false);
    expect(analytics.signedIn).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

// Who is signed in, as the runtime reports it; null when nobody is, or no runtime.
const auth = rs.hoisted(() => ({
  session: null as null | { user: { id: string }; access_token: string },
  hasRuntime: true,
}));

rs.mock("./runtime", () => ({
  getRuntime: () =>
    auth.hasRuntime
      ? { auth: { getSession: async () => ({ data: { session: auth.session } }) } }
      : null,
}));
rs.mock("./runtime.web", () => ({ SUPABASE_URL: "https://project.supabase.test" }));

import { requestAnalyticsForget } from "./analytics-forget";

const fetchMock = rs.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));

beforeEach(() => {
  auth.session = { user: { id: "u1" }, access_token: "token-u1" };
  auth.hasRuntime = true;
  fetchMock.mockClear();
  rs.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  rs.unstubAllGlobals();
});

describe("requestAnalyticsForget", () => {
  it("asks the server as the signed-in person, and reports when it's taken", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    expect(await requestAnalyticsForget("u1")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.test/functions/v1/analytics-forget",
      { method: "POST", headers: { Authorization: "Bearer token-u1" } },
    );
  });

  it("never sends it under someone else's session, which would erase their analytics", async () => {
    auth.session = { user: { id: "u2" }, access_token: "token-u2" };

    expect(await requestAnalyticsForget("u1")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits while nobody is signed in, or before the runtime is up", async () => {
    auth.session = null;
    expect(await requestAnalyticsForget("u1")).toBe(false);

    auth.hasRuntime = false;
    expect(await requestAnalyticsForget("u1")).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 502, 503])("keeps the request for later on a %s", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"x"}', { status }));

    expect(await requestAnalyticsForget("u1")).toBe(false);
  });

  it("keeps the request for later when the network fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(await requestAnalyticsForget("u1")).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import type { CaptureResult } from "posthog-js";

// A stand-in for the posthog-js singleton that models what matters here, like the real
// one: capture() sends nothing unless opted in; reset() drops the opt-in and the
// anonymous id, and a new device id only with reset(true). `sent` is what would have
// left the device. (analytics.posthog.test.ts runs the real library.)
const ph = rs.hoisted(() => {
  const state = {
    optedIn: false,
    distinctId: "anon-0",
    deviceId: "device-0",
    resets: 0,
    sent: [] as Array<{ event: string; props: unknown; distinctId: string; deviceId: string }>,
  };
  return {
    state,
    init: rs.fn(),
    opt_in_capturing: rs.fn(() => {
      state.optedIn = true;
    }),
    opt_out_capturing: rs.fn(() => {
      state.optedIn = false;
    }),
    has_opted_in_capturing: rs.fn(() => state.optedIn),
    get_distinct_id: rs.fn(() => state.distinctId),
    identify: rs.fn((id: string) => {
      state.distinctId = id;
      if (state.optedIn) {
        state.sent.push({
          event: "$identify",
          props: {},
          distinctId: id,
          deviceId: state.deviceId,
        });
      }
    }),
    reset: rs.fn((resetDeviceId?: boolean) => {
      state.resets += 1;
      state.optedIn = false;
      state.distinctId = `anon-${state.resets}`;
      if (resetDeviceId) state.deviceId = `device-${state.resets}`;
    }),
    capture: rs.fn((event: string, props?: unknown) => {
      if (!state.optedIn) return;
      state.sent.push({ event, props, distinctId: state.distinctId, deviceId: state.deviceId });
    }),
  };
});

rs.mock("posthog-js", () => ({ default: ph }));

// The server call that deletes what PostHog holds (PRIV-3): true = the server took it.
const forget = rs.hoisted(() => ({ request: rs.fn(async (_userId: string) => true) }));
rs.mock("./analytics-forget", () => ({ requestAnalyticsForget: forget.request }));

type AnalyticsModule = typeof import("./analytics");

// The key and host are read when the module loads, so each test loads a fresh copy.
async function loadAnalytics(env: { key?: string; host?: string } = {}): Promise<AnalyticsModule> {
  rs.resetModules();
  rs.stubEnv("PUBLIC_POSTHOG_KEY", env.key ?? "phc_test");
  rs.stubEnv("PUBLIC_POSTHOG_HOST", env.host ?? "");
  return import("./analytics");
}

function initConfig() {
  expect(ph.init).toHaveBeenCalledTimes(1);
  return ph.init.mock.calls[0][1];
}

const sentEvents = () => ph.state.sent.map((s) => s.event);

// Each fresh module copy adds a window "storage" listener; drop them between tests so
// an old copy can't react to a later test's events.
const storageListeners: EventListenerOrEventListenerObject[] = [];
const addEventListener = window.addEventListener.bind(window);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  rs.clearAllMocks();
  Object.assign(ph.state, {
    optedIn: false,
    distinctId: "anon-0",
    deviceId: "device-0",
    resets: 0,
    sent: [],
  });
  rs.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "storage" && listener) storageListeners.push(listener);
    addEventListener(type, listener, options);
  });
});

afterEach(() => {
  for (const listener of storageListeners.splice(0)) {
    window.removeEventListener("storage", listener);
  }
  rs.restoreAllMocks();
  rs.unstubAllEnvs();
  Reflect.deleteProperty(window, "doNotTrack");
});

describe("analytics — off unless set up and opted in", () => {
  it("does nothing at all in a build without a PostHog key", async () => {
    const a = await loadAnalytics({ key: "" });
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    await a.track("app_signed_in");

    expect(a.isAnalyticsAvailable()).toBe(false);
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.state.sent).toEqual([]);
  });

  it("doesn't load PostHog for a signed-in person who hasn't opted in", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.Analytics.app.signedIn("cloud");

    expect(a.getAnalyticsConsent("u1")).toBeNull();
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.state.sent).toEqual([]);
  });

  it.each(["1", "yes"])(
    "doesn't load PostHog when the browser sends Do Not Track (%s), even after opting in",
    async (dnt) => {
      Object.defineProperty(window, "doNotTrack", { value: dnt, configurable: true });
      const a = await loadAnalytics();
      await a.setAnalyticsUser("u1");
      await a.setAnalyticsConsent("u1", "granted");
      await a.track("app_signed_in");

      expect(a.isAnalyticsAvailable()).toBe(false);
      expect(ph.init).not.toHaveBeenCalled();
    },
  );
});

describe("analytics — after opting in", () => {
  it("starts PostHog opted out on the EU host, under app-only storage names, with every automatic capture pinned off", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");

    expect(ph.init.mock.calls[0][0]).toBe("phc_test");
    expect(initConfig()).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      persistence: "localStorage",
      persistence_name: "moduo_app",
      consent_persistence_name: "__ph_opt_in_out_moduo_app",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_surveys: true,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      mask_personal_data_properties: true,
    });
  });

  it("uses PUBLIC_POSTHOG_HOST when it's set", async () => {
    const a = await loadAnalytics({ host: "https://ph.example.com" });
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");

    expect(initConfig().api_host).toBe("https://ph.example.com");
  });

  it("opts in, identifies by user id alone, then tracks", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    await a.Analytics.app.signedIn("cloud");

    expect(localStorage.getItem("moduo:consent:u1")).toBe("granted");
    expect(ph.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    // No traits argument at all — so no email or name can ride along.
    expect(ph.identify.mock.calls).toEqual([["u1"]]);
    expect(ph.state.sent).toMatchObject([
      { event: "$identify", distinctId: "u1" },
      { event: "app_signed_in", props: { method: "cloud" }, distinctId: "u1" },
    ]);
  });

  it("opts in on load for someone who said yes earlier on this device", async () => {
    localStorage.setItem("moduo:consent:u1", "granted");
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.track("app_signed_in");

    expect(sentEvents()).toEqual(["$identify", "app_signed_in"]);
  });

  it("drops an event if the person withdrew before it was sent", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted"); // PostHog loaded and opted in
    const tracked = a.track("app_page_viewed", { page: "tasks" }); // queued while still a yes
    void a.setAnalyticsConsent("u1", "denied"); // the no lands before that step runs
    await tracked;

    expect(sentEvents()).toEqual(["$identify"]);
  });

  it("tries loading PostHog again when it failed the first time", async () => {
    localStorage.setItem("moduo:consent:u1", "granted");
    ph.init.mockImplementationOnce(() => {
      throw new Error("chunk failed to load");
    });
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    expect(ph.state.sent).toEqual([]);

    await a.track("app_page_viewed", { page: "tasks" });

    expect(sentEvents()).toEqual(["$identify", "app_page_viewed"]);
  });

  it("never sends an event under an id PostHog holds for someone else", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    ph.state.distinctId = "someone-else"; // e.g. a stale identity a bailed reconcile left
    await a.track("app_page_viewed", { page: "tasks" });

    expect(sentEvents()).toEqual(["$identify"]);
  });
});

describe("analytics — consent is per person and can be withdrawn", () => {
  it("withdrawing opts out, resets the device id, and drops later events", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    const deviceWhileOptedIn = ph.state.deviceId;
    await a.setAnalyticsConsent("u1", "denied");
    await a.track("app_page_viewed", { page: "tasks" });

    expect(ph.opt_out_capturing).toHaveBeenCalled();
    expect(ph.reset).toHaveBeenLastCalledWith(true);
    expect(ph.has_opted_in_capturing()).toBe(false);
    expect(ph.state.deviceId).not.toBe(deviceWhileOptedIn);
    expect(sentEvents()).toEqual(["$identify"]);
  });

  it("someone else signing in on the same device isn't tracked on the first person's yes", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    await a.setAnalyticsUser("u2");
    await a.track("app_signed_in");

    expect(a.getAnalyticsConsent("u2")).toBeNull();
    expect(ph.has_opted_in_capturing()).toBe(false);
    expect(ph.get_distinct_id()).not.toBe("u1");
    expect(ph.state.sent.map((s) => s.distinctId)).toEqual(["u1"]);
  });

  it("two people who both said yes never share an id or a device id", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsConsent("u2", "granted");
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    await a.track("app_page_viewed", { page: "tasks" });
    await a.setAnalyticsUser("u2");
    await a.track("app_page_viewed", { page: "notes" });

    const u1 = ph.state.sent.filter((s) => s.distinctId === "u1");
    const u2 = ph.state.sent.filter((s) => s.distinctId === "u2");
    expect(u1.map((s) => s.event)).toEqual(["$identify", "app_page_viewed"]);
    expect(u2.map((s) => s.event)).toEqual(["$identify", "app_page_viewed"]);
    expect(new Set(u1.map((s) => s.deviceId)).size).toBe(1);
    expect(u2[0].deviceId).not.toBe(u1[0].deviceId);
  });

  it("captures the sign-out event before opting out", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");

    // The auth provider's order on SIGNED_OUT.
    void a.Analytics.app.signedOut();
    await a.setAnalyticsUser(null);

    expect(ph.state.sent).toMatchObject([
      { event: "$identify", distinctId: "u1" },
      { event: "app_signed_out", distinctId: "u1" },
    ]);
    expect(ph.has_opted_in_capturing()).toBe(false);
  });

  it("signing out wipes PostHog's storage, even for someone who opted in", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    // What the real library holds while opted in (the fake doesn't write storage). The
    // window id it writes directly, so opt_out_capturing() + reset() leave it behind.
    localStorage.setItem("ph_moduo_app", '{"distinct_id":"u1"}');
    localStorage.setItem("__ph_opt_in_out_moduo_app", "1");
    sessionStorage.setItem("ph_moduo_app_window_id", "w1");
    await a.setAnalyticsUser(null);

    expect(localStorage.getItem("ph_moduo_app")).toBeNull();
    expect(localStorage.getItem("__ph_opt_in_out_moduo_app")).toBeNull();
    expect(sessionStorage.getItem("ph_moduo_app_window_id")).toBeNull();
    expect(localStorage.getItem("moduo:consent:u1")).toBe("granted");
  });

  it("keeps an opted-in person's PostHog identity when their session only failed to restore at startup", async () => {
    // e.g. the app opened offline with an expired token: nobody at first, then
    // TOKEN_REFRESHED brings the same person back — who should keep their device id.
    localStorage.setItem("moduo:consent:u1", "granted");
    localStorage.setItem("ph_moduo_app", '{"distinct_id":"u1","$device_id":"d1"}');
    localStorage.setItem("__ph_opt_in_out_moduo_app", "1");
    sessionStorage.setItem("ph_moduo_app_window_id", "w1");
    const a = await loadAnalytics();
    await a.setAnalyticsUser(null);

    expect(localStorage.getItem("ph_moduo_app")).toBe('{"distinct_id":"u1","$device_id":"d1"}');
    expect(localStorage.getItem("__ph_opt_in_out_moduo_app")).toBe("1");
    expect(sessionStorage.getItem("ph_moduo_app_window_id")).toBe("w1");
    expect(ph.init).not.toHaveBeenCalled();
  });

  it("applies a choice made in another tab", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");

    localStorage.setItem("moduo:consent:u1", "granted");
    window.dispatchEvent(new StorageEvent("storage", { key: "moduo:consent:u1" }));
    await rs.waitFor(() => expect(ph.identify).toHaveBeenCalledWith("u1"));

    localStorage.setItem("moduo:consent:u1", "denied");
    window.dispatchEvent(new StorageEvent("storage", { key: "moduo:consent:u1" }));
    await rs.waitFor(() => expect(ph.opt_out_capturing).toHaveBeenCalled());
    expect(ph.has_opted_in_capturing()).toBe(false);
  });

  it.each([
    ["nobody is signed in", null],
    ["the person signed in hasn't opted in", "u1"],
  ])("clears what an earlier session left behind when %s", async (_label, userId) => {
    localStorage.setItem("ph_moduo_app", '{"distinct_id":"u0"}');
    localStorage.setItem("__ph_opt_in_out_moduo_app", "1");
    sessionStorage.setItem("ph_moduo_app_window_id", "w1");
    // Not ours: the landing's PostHog (same origin on /book) and other app keys.
    localStorage.setItem("ph_phc_landing_posthog", "{}");
    localStorage.setItem("__ph_opt_in_out_phc_landing", "1");
    localStorage.setItem("moduo.appearance", "{}");
    const a = await loadAnalytics();
    await a.setAnalyticsUser(userId);

    expect(localStorage.getItem("ph_moduo_app")).toBeNull();
    expect(localStorage.getItem("__ph_opt_in_out_moduo_app")).toBeNull();
    expect(sessionStorage.getItem("ph_moduo_app_window_id")).toBeNull();
    expect(localStorage.getItem("ph_phc_landing_posthog")).toBe("{}");
    expect(localStorage.getItem("__ph_opt_in_out_phc_landing")).toBe("1");
    expect(localStorage.getItem("moduo.appearance")).toBe("{}");
    expect(ph.init).not.toHaveBeenCalled();
  });

  it("ignores a consent change from another tab until the auth provider has reported", async () => {
    // At startup nobody is known yet; wiping now would cost an opted-in person their ids.
    localStorage.setItem("moduo:consent:u1", "granted");
    localStorage.setItem("ph_moduo_app", '{"distinct_id":"u1"}');
    await loadAnalytics();
    window.dispatchEvent(new StorageEvent("storage", { key: "moduo:consent:u2" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(localStorage.getItem("ph_moduo_app")).toBe('{"distinct_id":"u1"}');
    expect(ph.init).not.toHaveBeenCalled();
  });

  it("useAnalyticsConsent follows the stored choice", async () => {
    const a = await loadAnalytics();
    // The fresh module copy brings a fresh React; render with the testing library that
    // shares it, or the hook call throws "Invalid hook call".
    const { act, renderHook } = await import("@testing-library/react");
    const { result, unmount } = renderHook(() => a.useAnalyticsConsent("u1"));
    expect(result.current).toBeNull();

    await act(() => a.setAnalyticsConsent("u1", "granted"));
    expect(result.current).toBe("granted");

    await act(() => a.setAnalyticsConsent("u1", "denied"));
    expect(result.current).toBe("denied");
    unmount();
  });
});

// What prepareEvent stamps under test: no Tauri shell, no channel env, localhost, and
// no MODUO_VERSION (see features/settings/about.ts).
const SOURCE_IN_TESTS = {
  surface: "app",
  platform: "web",
  environment: "development",
  app_version: "0.0.0",
};

describe("analytics — outgoing events (before_send)", () => {
  async function beforeSend() {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    return initConfig().before_send as (event: CaptureResult | null) => CaptureResult | null;
  }

  it("cuts URLs to the route root and drops emails, query- and referrer-derived values", async () => {
    const scrub = await beforeSend();
    const out = scrub({
      uuid: "e1",
      event: "app_signed_in",
      properties: {
        $current_url: "https://app.moduo.app/p/s3cr3tShareToken?invite=abc#access_token=xyz",
        $pathname: "/book/jane-doe",
        $referrer: "https://www.google.com/search?q=jane+doe+moduo",
        $referring_domain: "www.google.com",
        $host: "app.moduo.app",
        $session_entry_url: "https://app.moduo.app/join",
        $session_entry_utm_source: "newsletter",
        $session_entry_gclid: "CLICKID123",
        $search_engine: "google",
        ph_keyword: "jane doe moduo",
        method: "cloud",
        count: 3,
        note: "ping jane@example.com",
        encoded: "/contacts/jane%40example.com",
      },
      $set: { $initial_referrer: "https://www.google.com/" },
      $set_once: {
        $current_url: "tauri://localhost/notes?note=n1",
        utm_source: "newsletter",
        gclid: "CLICKID123",
      },
    });

    expect(out?.properties).toEqual({
      $current_url: "https://app.moduo.app/p",
      $pathname: "/book",
      $referrer: "https://www.google.com/search",
      $referring_domain: "www.google.com",
      $host: "app.moduo.app",
      method: "cloud",
      count: 3,
      ...SOURCE_IN_TESTS,
    });
    expect(out?.$set).toEqual({});
    expect(out).not.toHaveProperty("$set_once");
  });

  it("tags every event as the app's, so it can be told apart from the landing's", async () => {
    const scrub = await beforeSend();
    // An incoming `surface` can't override it.
    const out = scrub({ uuid: "e3", event: "app_signed_in", properties: { surface: "landing" } });

    expect(out?.properties).toEqual(SOURCE_IN_TESTS);
  });

  it("keeps the desktop shell's URLs readable", async () => {
    const scrub = await beforeSend();
    const out = scrub({
      uuid: "e2",
      event: "app_page_viewed",
      properties: { $current_url: "tauri://localhost/notes?note=n1" },
    });

    expect(out?.properties.$current_url).toBe("tauri://localhost/notes");
  });

  it("passes a null event through", async () => {
    const scrub = await beforeSend();
    expect(scrub(null)).toBeNull();
  });
});

describe("analytics — the code itself stays off the page until consent", () => {
  // The privacy policy says PostHog's code isn't loaded before someone says yes. Two
  // lines keep that true; this trips if either goes (gotchas/build-ci.md, prefetch).
  it("names the posthog-js chunk and keeps it out of the async-chunk prefetch", () => {
    const analytics = readFileSync(resolve(process.cwd(), "src/lib/analytics.ts"), "utf8");
    const rsbuild = readFileSync(resolve(process.cwd(), "rsbuild.config.ts"), "utf8");

    expect(analytics).toMatch(/webpackChunkName:\s*"posthog"\s*\*\/\s*"posthog-js"/);
    expect(rsbuild).toMatch(/prefetch: \{[^}]*exclude: \[[^\]]*posthog/);
  });
});

describe("analytics — switching off deletes what was sent (PRIV-3)", () => {
  async function optedInThenOff(a: AnalyticsModule) {
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    await a.setAnalyticsConsent("u1", "denied");
  }

  const pending = (userId: string) => localStorage.getItem(`moduo:analytics-forget:${userId}`);

  it("asks the server right away, while the person is still signed in", async () => {
    const a = await loadAnalytics();
    await optedInThenOff(a);
    await settle();

    expect(forget.request).toHaveBeenCalledTimes(1);
    expect(forget.request).toHaveBeenCalledWith("u1");
    expect(pending("u1")).toBeNull();
  });

  it("asks nothing for a first no: nothing was ever sent", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "denied");
    await settle();

    expect(forget.request).not.toHaveBeenCalled();
    expect(pending("u1")).toBeNull();
  });

  it("keeps the request until the server takes it, and sends it again when that person is back", async () => {
    forget.request.mockResolvedValueOnce(false); // offline, or a 502/503
    const a = await loadAnalytics();
    await optedInThenOff(a);
    await settle();
    expect(pending("u1")).not.toBeNull();

    // The next launch, signed in as the same person.
    const b = await loadAnalytics();
    await b.setAnalyticsUser("u1");
    await rs.waitFor(() => expect(forget.request).toHaveBeenCalledTimes(2));
    await rs.waitFor(() => expect(pending("u1")).toBeNull());
  });

  it("drops a request the server hasn't taken when the person says yes again", async () => {
    forget.request.mockResolvedValueOnce(false);
    const a = await loadAnalytics();
    await optedInThenOff(a);
    await settle();
    await a.setAnalyticsConsent("u1", "granted");
    expect(pending("u1")).toBeNull();

    const b = await loadAnalytics();
    await b.setAnalyticsUser("u1");
    await settle();
    expect(forget.request).toHaveBeenCalledTimes(1);
  });

  it("doesn't let an older request's answer clear a newer switch-off", async () => {
    let answerFirst: (taken: boolean) => void = () => {};
    forget.request.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          answerFirst = resolve;
        }),
    );
    forget.request.mockResolvedValueOnce(false); // the newer one doesn't get through
    const a = await loadAnalytics();
    await optedInThenOff(a); // the first request, still waiting on the server
    await settle();
    await a.setAnalyticsConsent("u1", "granted");
    await a.setAnalyticsConsent("u1", "denied");
    await settle();

    answerFirst(true);
    await settle();

    expect(forget.request).toHaveBeenCalledTimes(2);
    expect(pending("u1")).not.toBeNull(); // the newer switch-off is still owed
  });

  it("leaves another person's pending request for their own session", async () => {
    localStorage.setItem("moduo:analytics-forget:u2", "earlier");
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await settle();

    expect(forget.request).not.toHaveBeenCalled();
    expect(pending("u2")).toBe("earlier");
  });
});

describe("analytics — after the account is deleted (PRIV-3)", () => {
  it("sends nothing more under the erased id, sign-out included, and forgets the choice", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    const before = ph.state.sent.length;

    await a.forgetAnalyticsAccount("u1");
    // What the auth provider does on SIGNED_OUT.
    await a.Analytics.app.signedOut();
    await a.setAnalyticsUser(null);

    expect(ph.state.sent.slice(before)).toEqual([]);
    expect(ph.state.optedIn).toBe(false);
    expect(a.getAnalyticsConsent("u1")).toBeNull();
    // The server erased everything as part of the deletion: nothing more to ask.
    expect(forget.request).not.toHaveBeenCalled();
  });

  it("drops a deletion request still pending on this device", async () => {
    forget.request.mockResolvedValueOnce(false);
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    await a.setAnalyticsConsent("u1", "denied");
    await settle();
    expect(localStorage.getItem("moduo:analytics-forget:u1")).not.toBeNull();

    await a.forgetAnalyticsAccount("u1");

    expect(localStorage.getItem("moduo:analytics-forget:u1")).toBeNull();
  });
});

/** Let queued promise jobs (the dynamic import, the request) run. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

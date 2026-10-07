import { act, cleanup, renderHook } from "@testing-library/react";
import type { CaptureResult } from "posthog-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the posthog-js singleton that models what matters here, like the real
// one: capture() sends nothing unless opted in; reset() drops the opt-in and the
// anonymous id, and a new device id only with reset(true). `sent` is what would have
// left the device. (analytics.posthog.test.ts runs the real library.)
const ph = vi.hoisted(() => {
  const state = {
    optedIn: false,
    distinctId: "anon-0",
    deviceId: "device-0",
    resets: 0,
    sent: [] as Array<{ event: string; props: unknown; distinctId: string; deviceId: string }>,
  };
  return {
    state,
    init: vi.fn(),
    opt_in_capturing: vi.fn(() => {
      state.optedIn = true;
    }),
    opt_out_capturing: vi.fn(() => {
      state.optedIn = false;
    }),
    has_opted_in_capturing: vi.fn(() => state.optedIn),
    get_distinct_id: vi.fn(() => state.distinctId),
    identify: vi.fn((id: string) => {
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
    reset: vi.fn((resetDeviceId?: boolean) => {
      state.resets += 1;
      state.optedIn = false;
      state.distinctId = `anon-${state.resets}`;
      if (resetDeviceId) state.deviceId = `device-${state.resets}`;
    }),
    capture: vi.fn((event: string, props?: unknown) => {
      if (!state.optedIn) return;
      state.sent.push({ event, props, distinctId: state.distinctId, deviceId: state.deviceId });
    }),
  };
});

vi.mock("posthog-js", () => ({ default: ph }));

type AnalyticsModule = typeof import("./analytics");

// The key and host are read when the module loads, so each test loads a fresh copy.
async function loadAnalytics(env: { key?: string; host?: string } = {}): Promise<AnalyticsModule> {
  vi.resetModules();
  vi.stubEnv("PUBLIC_POSTHOG_KEY", env.key ?? "phc_test");
  vi.stubEnv("PUBLIC_POSTHOG_HOST", env.host ?? "");
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
  vi.clearAllMocks();
  Object.assign(ph.state, {
    optedIn: false,
    distinctId: "anon-0",
    deviceId: "device-0",
    resets: 0,
    sent: [],
  });
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "storage" && listener) storageListeners.push(listener);
    addEventListener(type, listener, options);
  });
});

afterEach(() => {
  cleanup();
  for (const listener of storageListeners.splice(0)) {
    window.removeEventListener("storage", listener);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

  it("clears the window id PostHog keeps in sessionStorage once it's opted out", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");
    await a.setAnalyticsConsent("u1", "granted");
    // posthog-js writes this one directly; opt_out_capturing() + reset() leave it behind.
    sessionStorage.setItem("ph_moduo_app_window_id", "w1");
    await a.setAnalyticsUser(null);

    expect(sessionStorage.getItem("ph_moduo_app_window_id")).toBeNull();
  });

  it("applies a choice made in another tab", async () => {
    const a = await loadAnalytics();
    await a.setAnalyticsUser("u1");

    localStorage.setItem("moduo:consent:u1", "granted");
    window.dispatchEvent(new StorageEvent("storage", { key: "moduo:consent:u1" }));
    await vi.waitFor(() => expect(ph.identify).toHaveBeenCalledWith("u1"));

    localStorage.setItem("moduo:consent:u1", "denied");
    window.dispatchEvent(new StorageEvent("storage", { key: "moduo:consent:u1" }));
    await vi.waitFor(() => expect(ph.opt_out_capturing).toHaveBeenCalled());
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

  it("useAnalyticsConsent follows the stored choice", async () => {
    const a = await loadAnalytics();
    const { result } = renderHook(() => a.useAnalyticsConsent("u1"));
    expect(result.current).toBeNull();

    await act(() => a.setAnalyticsConsent("u1", "granted"));
    expect(result.current).toBe("granted");

    await act(() => a.setAnalyticsConsent("u1", "denied"));
    expect(result.current).toBe("denied");
  });
});

describe("analytics — outgoing scrub (before_send)", () => {
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
    });
    expect(out?.$set).toEqual({});
    expect(out).not.toHaveProperty("$set_once");
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

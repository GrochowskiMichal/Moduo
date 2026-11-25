// Analytics consent. PostHog (EU cloud, the current landing's project; the token is public) is
// loaded only after the visitor accepts, and never on a local host. The choice is kept under the
// same key as apps/landing, so a visitor is asked once on moduo.app.
import { onPage, onScroll } from "../engine";

const KEY = "moduo:consent";
const TOKEN = "phc_D4Y3CbRVFLqkufdCmhtb2XukD2xgV3GQfXjxemtEhqiN";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

type Choice = "granted" | "denied";

const read = (): Choice | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
};
const write = (v: Choice) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode: ask again next time */
  }
};

type PostHog = {
  init: (token: string, opts: Record<string, unknown>) => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
  register: (props: Record<string, unknown>) => void;
};
let loading = false;

// PostHog's loader snippet, unminified: window.posthog is an array that queues calls (and the
// init config in _i) until array.js arrives and replays them.
const METHODS = [
  "capture",
  "register",
  "identify",
  "reset",
  "opt_in_capturing",
  "opt_out_capturing",
];
type Stub = unknown[] & Record<string, unknown> & { _i: unknown[]; __SV?: number };

function stub(): PostHog {
  const w = window as unknown as { posthog?: Stub };
  const e = (w.posthog ?? []) as Stub;
  if (e.__SV) return e as unknown as PostHog;
  w.posthog = e;
  e._i = [];
  e.init = (token: string, opts: Record<string, unknown>) => {
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://eu-assets.i.posthog.com/static/array.js";
    document.head.appendChild(s);
    e.people = (e.people as unknown[]) ?? [];
    for (const m of METHODS) e[m] = (...args: unknown[]) => e.push([m, ...args]);
    e._i.push([token, opts, undefined]);
  };
  e.__SV = 1;
  return e as unknown as PostHog;
}

function loadAnalytics() {
  if (loading || LOCAL.test(location.hostname)) return;
  loading = true;
  const host = location.hostname;
  stub().init(TOKEN, {
    api_host: "https://eu.i.posthog.com",
    ui_host: "https://eu.posthog.com",
    defaults: "2025-11-30",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    capture_pageleave: true,
    autocapture: true,
    respect_dnt: true,
    session_recording: { maskAllInputs: true },
    loaded: (p: PostHog) =>
      p.register({
        surface: "landing",
        environment: host === "moduo.app" || host === "www.moduo.app" ? "production" : "staging",
      }),
  });
}

// Browsers sending Do Not Track are never asked, as on apps/landing: analytics stays off unless
// the visitor opens Cookie settings themselves.
const dnt = () =>
  navigator.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1";

export function startConsent() {
  if (read() === "granted") loadAnalytics();

  onPage(() => {
    const banner = document.querySelector<HTMLElement>("[data-consent]");
    if (!banner) return;
    // pinned: opened on purpose (Cookie settings), so it stays put until answered.
    const show = (pinned = false) => {
      if (pinned) banner.classList.add("is-pinned");
      if (!banner.hidden) return;
      banner.hidden = false;
      banner.classList.add("is-in");
    };
    let offScroll: (() => void) | null = null;
    // Asked only once the page's first screen is behind the visitor, so it never covers a hero
    // or the home page's scene (each page waits again: the card persists across pages). From
    // there it rides with the header: away while you read down, back when you head up.
    if (!read() && !dnt()) {
      if (!banner.classList.contains("is-pinned")) {
        banner.hidden = true;
        banner.classList.remove("is-in");
      }
      // On home the first screen is the whole signature scene: wait until it has played.
      const scene = document.documentElement.classList.contains("motion")
        ? document.querySelector<HTMLElement>("[data-scene]")
        : null;
      offScroll = onScroll(({ y }) => {
        if (
          scene ? scene.getBoundingClientRect().bottom > innerHeight * 0.75 : y < innerHeight * 0.75
        )
          return;
        show();
        offScroll?.();
        offScroll = null;
      });
    }
    // The privacy policy sends people to /#cookie-settings to change their choice.
    if (location.hash === "#cookie-settings") {
      show(true);
      history.replaceState(history.state, "", location.pathname + location.search);
    }

    const choose = (e: Event) => {
      const v = (e.currentTarget as HTMLElement).dataset.consentChoice as Choice;
      write(v);
      banner.hidden = true;
      banner.classList.remove("is-in", "is-pinned");
      const ph = (window as unknown as { posthog?: PostHog }).posthog;
      if (v === "granted") {
        if (ph) ph.opt_in_capturing();
        else loadAnalytics();
      } else ph?.opt_out_capturing();
    };
    const buttons = [...banner.querySelectorAll<HTMLElement>("[data-consent-choice]")];
    buttons.forEach((b) => b.addEventListener("click", choose));
    const open = () => show(true);
    const reopeners = [...document.querySelectorAll<HTMLElement>("[data-consent-open]")];
    reopeners.forEach((r) => r.addEventListener("click", open));
    return () => {
      offScroll?.();
      buttons.forEach((b) => b.removeEventListener("click", choose));
      reopeners.forEach((r) => r.removeEventListener("click", open));
    };
  });
}

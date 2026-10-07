/**
 * Thin analytics wrapper around PostHog — safe by default.
 *
 * Usage:
 *   import { Analytics, setAnalyticsUser } from "../lib/analytics";
 *   setAnalyticsUser(session?.user.id ?? null); // the auth provider does this
 *   Analytics.app.pageViewed("tasks");
 *
 * Nothing is sent, stored or even downloaded unless all of this holds:
 *   1. the build has PUBLIC_POSTHOG_KEY (no live build does as of 2026-10-07) and the
 *      browser isn't sending Do Not Track;
 *   2. someone is signed in;
 *   3. that person opted in on this device: `moduo:consent:<userId>` = "granted" — the
 *      per-person twin of the landing's `moduo:consent`, set by the one-time question
 *      after sign-in (components/app/analytics-consent-prompt.tsx) or in Settings →
 *      Preferences → Privacy.
 * Even then PostHog starts opted out (opt_out_capturing_by_default +
 * opt_out_persistence_by_default, as on the landing) and is opted in only for that
 * person. Signing out, switching to someone who hasn't opted in, or withdrawing consent
 * opts it out again and wipes its storage. New events stop at once; ones captured just
 * before can still go out with PostHog's current batch (or its retries of a failed
 * send, until the page reloads) — posthog-js has no way to drop those.
 *
 * Only the explicit `track()` calls below are captured, plus PostHog's `$identify` —
 * never autocapture, pageviews, session replay, heatmaps or surveys, whatever the
 * PostHog project's remote settings say. People are identified by their user id alone,
 * never an email or a name, and each person gets their own device id. Before anything
 * leaves, URLs are cut to their route root and values that hold an email, or that
 * PostHog lifted from a query string or a search engine's referrer, are dropped. Every
 * event carries `surface: "app"`: the landing shares the PostHog project and sends
 * `surface: "landing"`.
 *
 * The privacy policy (landing/privacy.html on prod-landing, §04 Analytics and §11
 * Cookies) describes all of this; change it in the same breath as anything here. Set
 * the key only once moduo.app/privacy shows "In the Moduo app". Deleting a person's
 * PostHog data isn't automatic yet (PRIV-3). See docs/decisions/permissions.md (2026-10-07).
 */

import type { CaptureResult, PostHog, PostHogConfig } from "posthog-js";
import { useSyncExternalStore } from "react";
import { APP_VERSION, DESKTOP_CHANNEL, IS_DESKTOP } from "../features/settings/about";

type Properties = Record<string, string | number | boolean | null | undefined>;

export type AnalyticsConsent = "granted" | "denied";

const PH_KEY = (import.meta.env.PUBLIC_POSTHOG_KEY ?? "").trim();
// rsbuild defines an unset PUBLIC_* var as "" rather than undefined, so `??` alone
// would never fall back. EU cloud, like the landing.
const PH_HOST = (import.meta.env.PUBLIC_POSTHOG_HOST ?? "").trim() || "https://eu.i.posthog.com";

const CONSENT_KEY_PREFIX = "moduo:consent:";

// PostHog's own storage, named for the app rather than the project key. The booking
// page serves this app on the landing's origin, where the landing keeps its PostHog
// storage under the key — so clearing ours can never touch the landing's.
const PH_STORAGE_NAME = "moduo_app"; // → `ph_moduo_app` (+ `ph_moduo_app_…` in sessionStorage)
const PH_CONSENT_NAME = "__ph_opt_in_out_moduo_app";

// undefined until the auth provider reports in, so a first "nobody is signed in" still
// clears what an earlier session left behind (see clearAbandonedPostHogState).
let currentUserId: string | null | undefined;
let posthog: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

// Every PostHog call runs in order, so an event tracked just before sign-out is
// captured before the opt-out that follows it.
let queue: Promise<void> = Promise.resolve();

function enqueue(step: () => void | Promise<void>): Promise<void> {
  queue = queue.then(step).catch((err: unknown) => {
    console.warn("[analytics]", err);
  });
  return queue;
}

/** Whether analytics can run at all: this build has a PostHog key and the browser isn't
 *  sending Do Not Track (then, as on the landing, we don't even ask). */
export function isAnalyticsAvailable(): boolean {
  if (PH_KEY === "") return false;
  // The same signals, and the same yes-like values, as PostHog's respect_dnt.
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const win = typeof window === "undefined" ? undefined : window;
  const signals: unknown[] = [
    nav?.doNotTrack,
    (nav as { msDoNotTrack?: unknown } | undefined)?.msDoNotTrack,
    (win as { doNotTrack?: unknown } | undefined)?.doNotTrack,
  ];
  return !signals.some((v) => v === true || v === 1 || v === "1" || v === "yes" || v === "true");
}

// ── Consent (per person, on this device) ──────────────────────────────────────

/** This person's analytics choice on this device, or null if they haven't made one. */
export function getAnalyticsConsent(userId: string): AnalyticsConsent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY_PREFIX + userId);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Record this person's choice and apply it straight away. Settles once PostHog
 *  reflects it. */
export function setAnalyticsConsent(userId: string, consent: AnalyticsConsent): Promise<void> {
  try {
    // Remove first: if the write then fails, the choice reads as "not granted".
    localStorage.removeItem(CONSENT_KEY_PREFIX + userId);
    localStorage.setItem(CONSENT_KEY_PREFIX + userId, consent);
  } catch {
    // Storage unavailable — nothing reads as granted, so analytics stays off.
  }
  notifyConsent();
  if (userId === currentUserId) void enqueue(reconcile);
  return queue;
}

const consentListeners = new Set<() => void>();

function notifyConsent() {
  for (const listener of consentListeners) listener();
}

function subscribeConsent(listener: () => void) {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

/** Live read of a person's choice, for the Settings toggle. */
export function useAnalyticsConsent(userId: string | null): AnalyticsConsent | null {
  return useSyncExternalStore(
    subscribeConsent,
    () => (userId ? getAnalyticsConsent(userId) : null),
    () => null,
  );
}

// A choice made in another tab applies here too (withdrawing included).
if (PH_KEY && typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !event.key.startsWith(CONSENT_KEY_PREFIX)) return;
    notifyConsent();
    // Before the auth provider reports, there's nobody to reconcile for yet.
    if (currentUserId !== undefined) void enqueue(reconcile);
  });
}

function consented(userId: string | null | undefined): userId is string {
  return (
    typeof userId === "string" &&
    isAnalyticsAvailable() &&
    getAnalyticsConsent(userId) === "granted"
  );
}

// ── PostHog ───────────────────────────────────────────────────────────────────

const POSTHOG_CONFIG: Partial<PostHogConfig> = {
  api_host: PH_HOST,
  // As on the landing: nothing is captured or stored until opt_in_capturing(), which
  // reconcile() calls only for a person who said yes.
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
  respect_dnt: true,
  persistence: "localStorage", // the app sets no cookies
  persistence_name: PH_STORAGE_NAME,
  consent_persistence_name: PH_CONSENT_NAME,
  person_profiles: "identified_only",
  // Explicit track() calls only. Each switch is pinned here because the client
  // setting wins over the project's remote one (the landing's project records sessions).
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: false,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_web_experiments: true,
  // No remote-config or feature-flag calls and no extra scripts: events are the only traffic.
  advanced_disable_flags: true,
  advanced_disable_feature_flags: true,
  disable_external_dependency_loading: true,
  save_referrer: false,
  save_campaign_params: false,
  disableDeviceModel: true,
  // What PostHog keeps on the device (the session's entry URL) mustn't hold tokens either:
  // no URL fragments (auth redirects put tokens there), and these query values masked,
  // along with ad click ids.
  disable_capture_url_hashes: true,
  mask_personal_data_properties: true,
  custom_personal_data_properties: [
    "token",
    "invite",
    "code",
    "access_token",
    "refresh_token",
    "session_id",
  ],
  before_send: prepareEvent,
};

function loadPostHog(): Promise<PostHog | null> {
  // Named so rsbuild.config.ts can keep it out of the async-chunk prefetch: nobody
  // downloads analytics code before they opt in.
  loading ??= import(/* webpackChunkName: "posthog" */ "posthog-js")
    .then(({ default: ph }) => {
      ph.init(PH_KEY, POSTHOG_CONFIG);
      posthog = ph;
      return ph;
    })
    .catch((err: unknown) => {
      console.warn("[analytics] PostHog failed to load", err);
      loading = null;
      return null;
    });
  return loading;
}

/** Bring PostHog in line with whoever is signed in now and what they chose. */
async function reconcile() {
  const userId = currentUserId;
  if (!consented(userId)) {
    if (posthog) {
      // Opt out first (it turns PostHog's storage off), then forget the person, the
      // session and the device id.
      posthog.opt_out_capturing();
      posthog.reset(true);
    }
    clearStoredPostHogState();
    return;
  }
  const ph = await loadPostHog();
  // Signed out, switched or withdrew while it loaded: the reconcile queued for that wins.
  if (!ph || currentUserId !== userId || !consented(userId)) return;
  // A new person starts from a clean slate — new anonymous and device ids — so nothing
  // links them to whoever used this device before. reset() also clears PostHog's own
  // opt-in, so it must come before opt_in_capturing(); opting out first keeps it from
  // warning that it turned capturing off when the previous person had opted in.
  if (ph.get_distinct_id() !== userId) {
    ph.opt_out_capturing();
    ph.reset(true);
  }
  if (!ph.has_opted_in_capturing()) ph.opt_in_capturing({ captureEventName: false });
  if (ph.get_distinct_id() !== userId) ph.identify(userId);
}

/** PostHog keys that opting out leaves behind (its window id in sessionStorage) or that an
 *  earlier session left when PostHog never loaded in this one (its ids and opt-in). Once
 *  opted out it writes no more. */
function clearStoredPostHogState() {
  const isOurs = (key: string) =>
    key === `ph_${PH_STORAGE_NAME}` ||
    key.startsWith(`ph_${PH_STORAGE_NAME}_`) ||
    key === PH_CONSENT_NAME;
  try {
    for (const store of [localStorage, sessionStorage]) {
      for (const key of Object.keys(store).filter(isOurs)) store.removeItem(key);
    }
  } catch {
    // Storage unavailable — then nothing was stored there either.
  }
}

/** Startup with nobody signed in. That can be a session that only failed to restore
 *  (offline, a token refresh that failed) and comes back a moment later, so the stored
 *  PostHog identity of someone who opted in on this device stays. Anything else is left
 *  over from an earlier session and goes. */
function clearAbandonedPostHogState() {
  if (!consented(storedPostHogDistinctId())) clearStoredPostHogState();
}

/** Who PostHog's stored state belongs to (posthog-js keeps it as JSON under `ph_<name>`). */
function storedPostHogDistinctId(): string | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`ph_${PH_STORAGE_NAME}`) ?? "null");
    const id = (stored as { distinct_id?: unknown } | null)?.distinct_id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** Who is signed in (null when nobody is). The auth provider calls this on every session
 *  change. Settles once PostHog reflects it. */
export function setAnalyticsUser(userId: string | null): Promise<void> {
  if (userId !== currentUserId) {
    const atStartup = currentUserId === undefined;
    currentUserId = userId;
    if (PH_KEY) void enqueue(atStartup && userId === null ? clearAbandonedPostHogState : reconcile);
  }
  return queue;
}

/** Track a named event with optional properties — dropped unless the signed-in person
 *  opted in, and never sent under anyone else's id. */
export function track(event: string, properties?: Properties): Promise<void> {
  const userId = currentUserId;
  if (!consented(userId)) return Promise.resolve();
  return enqueue(() => {
    if (posthog?.get_distinct_id() === userId) posthog.capture(event, properties);
  });
}

// ── Outgoing events (before_send) ─────────────────────────────────────────────

/** No known channel: this machine (dev server, a local desktop build) or some other host,
 *  like a Vercel preview, which shouldn't read as local development. */
function localOrPreview(): "development" | "preview" {
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
  return local ? "development" : "preview";
}

// Where every app event came from. The landing sends to the same PostHog project
// with `surface: "landing"`, so filter or break down by `surface` to keep the two
// apart. Stamped in before_send rather than registered as super properties, so a
// reset() can't drop them.
const EVENT_SOURCE = {
  surface: "app",
  platform: IS_DESKTOP ? "desktop" : "web",
  environment: DESKTOP_CHANNEL ?? localOrPreview(),
  app_version: APP_VERSION,
} as const;

function prepareEvent(event: CaptureResult | null): CaptureResult | null {
  const scrubbed = scrubEvent(event);
  if (!scrubbed) return null;
  return { ...scrubbed, properties: { ...scrubbed.properties, ...EVENT_SOURCE } };
}

const URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;
const EMAIL_PATTERN = /[^\s@/:]+(?:@|%40)[^\s@/]+\.[a-z]{2,}/i;
// Attribution PostHog adds on its own from the entry URL's query string (campaign tags,
// ad click ids) and from a search engine's referrer (the search terms): the
// `$session_entry_…` / `$initial_…` copies, and the search keyword itself.
const DERIVED_KEY_PATTERN = /^(?:\$session_entry_|\$initial_)|^(?:ph_keyword|\$search_engine)$/;

/** Cut every URL to its route root — deeper segments are ids, share tokens and booking
 *  slugs, and queries/hashes carry invite, join and auth tokens — and drop any value
 *  that holds an email address or that PostHog lifted from a query string or referrer.
 *  `$set_once` (the first visit's URL, referrer and campaign tags) goes entirely. */
function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;
  const { $set_once: _firstVisitAttribution, ...rest } = event;
  const scrubbed: CaptureResult = { ...rest, properties: scrubProperties(event.properties) };
  if (event.$set) scrubbed.$set = scrubProperties(event.$set);
  return scrubbed;
}

function scrubProperties(props: CaptureResult["properties"]): CaptureResult["properties"] {
  const out: CaptureResult["properties"] = {};
  for (const [key, value] of Object.entries(props)) {
    if (DERIVED_KEY_PATTERN.test(key)) continue;
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const next = URL_PATTERN.test(value)
      ? routeRootUrl(value)
      : key.endsWith("pathname")
        ? routeRoot(value)
        : value;
    if (next === null || EMAIL_PATTERN.test(next)) continue;
    out[key] = next;
  }
  return out;
}

function routeRoot(pathname: string): string {
  const first = pathname.split(/[/?#]/).find(Boolean);
  return first ? `/${first}` : "/";
}

function routeRootUrl(value: string): string | null {
  try {
    const url = new URL(value);
    // Not url.origin: it is "null" for the desktop shell's tauri:// scheme.
    return `${url.protocol}//${url.host}${routeRoot(url.pathname)}`;
  } catch {
    return null;
  }
}

// ── Typed event helpers ────────────────────────────────────────────────────────

export const Analytics = {
  onboarding: {
    started: () => track("onboarding_started"),
    stepCompleted: (step: string) => track("onboarding_step_completed", { step }),
    cloudSignUp: (method: "email") => track("onboarding_cloud_signup", { method }),
    cloudSignIn: () => track("onboarding_cloud_signin"),
    localCreated: () => track("onboarding_local_profile_created"),
    mnemonicRevealed: () => track("onboarding_mnemonic_revealed"),
  },
  billing: {
    upgradeClicked: (feature: string, tier: string) =>
      track("billing_upgrade_clicked", { feature, tier }),
    checkoutRedirected: (tier: string) => track("billing_checkout_redirected", { tier }),
    portalOpened: () => track("billing_portal_opened"),
    tierChanged: (from: string, to: string) => track("billing_tier_changed", { from, to }),
  },
  app: {
    signedIn: (method: "local" | "cloud") => track("app_signed_in", { method }),
    signedOut: () => track("app_signed_out"),
    pageViewed: (page: string) => track("app_page_viewed", { page }),
  },
} as const;

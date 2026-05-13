/**
 * Thin analytics wrapper around PostHog.
 *
 * Usage:
 *   import { track, identify, resetIdentity } from "../lib/analytics";
 *   track("onboarding_step_completed", { step: "create_phrase" });
 *
 * PostHog is loaded lazily so it never blocks the critical path.
 * If PUBLIC_POSTHOG_KEY is not set, all calls are no-ops (desktop builds, tests).
 */

type Properties = Record<string, string | number | boolean | null | undefined>;

const PH_KEY = (import.meta.env.PUBLIC_POSTHOG_KEY as string | undefined) ?? "";
const PH_HOST = (import.meta.env.PUBLIC_POSTHOG_HOST as string | undefined) ?? "https://app.posthog.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ph: any = null;
let _initPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPostHog(): Promise<any | null> {
  if (!PH_KEY) return null;
  if (_ph) return _ph;

  if (!_initPromise) {
    _initPromise = import("posthog-js").then(({ default: posthog }) => {
      posthog.init(PH_KEY, {
        api_host: PH_HOST,
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        persistence: "localStorage",
        loaded: (ph: unknown) => { _ph = ph; },
      });
      _ph = posthog;
    });
  }

  await _initPromise;
  return _ph;
}

/** Track a named event with optional properties. */
export async function track(event: string, properties?: Properties) {
  const ph = await getPostHog();
  ph?.capture(event, properties);
}

/** Associate subsequent events with a user identity. */
export async function identify(userId: string, traits?: Properties) {
  const ph = await getPostHog();
  ph?.identify(userId, traits);
}

/** Clear the current identity (call on sign-out). */
export async function resetIdentity() {
  const ph = await getPostHog();
  ph?.reset();
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
    checkoutRedirected: (tier: string) =>
      track("billing_checkout_redirected", { tier }),
    portalOpened: () => track("billing_portal_opened"),
    tierChanged: (from: string, to: string) =>
      track("billing_tier_changed", { from, to }),
  },
  app: {
    signedIn: (method: "local" | "cloud") => track("app_signed_in", { method }),
    signedOut: () => track("app_signed_out"),
    pageViewed: (page: string) => track("app_page_viewed", { page }),
  },
} as const;

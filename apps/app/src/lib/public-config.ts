// The app's public, per-host settings (Supabase project, analytics, push key,
// web origin, installer channel). On the hosted web app the edge Worker
// (apps/app/edge/worker.ts) writes them into the page as
// `window.__MODUO_CONFIG__`, so one build serves staging and prod with each
// host's own values. Desktop, dev and any page without that object use the
// build-time values (`import.meta.env.PUBLIC_*`, defined in rsbuild.config.ts).
//
// Every value is a string, "" when unset; callers keep their own defaults.
// A malformed or partial edge object never empties a value: each field falls
// back to its build-time value on its own, except the Supabase URL and key,
// which only ever come as a pair so a page can't mix two projects.

export type PublicConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  stripePublishableKey: string;
  posthogKey: string;
  posthogHost: string;
  vapidPublicKey: string;
  webOrigin: string;
  stagingPortal: string;
  desktopChannel: string;
};

export const PUBLIC_CONFIG_KEYS = [
  "supabaseUrl",
  "supabasePublishableKey",
  "stripePublishableKey",
  "posthogKey",
  "posthogHost",
  "vapidPublicKey",
  "webOrigin",
  "stagingPortal",
  "desktopChannel",
] as const satisfies readonly (keyof PublicConfig)[];

declare global {
  interface Window {
    __MODUO_CONFIG__?: unknown;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The values baked in at build time. rsbuild defines an unset PUBLIC_* var as "". */
export function buildTimeConfig(): PublicConfig {
  return {
    supabaseUrl: str(import.meta.env.PUBLIC_SUPABASE_URL),
    supabasePublishableKey: str(import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    stripePublishableKey: str(import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY),
    posthogKey: str(import.meta.env.PUBLIC_POSTHOG_KEY),
    posthogHost: str(import.meta.env.PUBLIC_POSTHOG_HOST),
    vapidPublicKey: str(import.meta.env.PUBLIC_VAPID_PUBLIC_KEY),
    webOrigin: str(import.meta.env.PUBLIC_WEB_ORIGIN),
    stagingPortal: str(import.meta.env.PUBLIC_STAGING_PORTAL),
    desktopChannel: str(import.meta.env.PUBLIC_DESKTOP_CHANNEL),
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

/** Edge values over build-time ones, field by field (see the header). Pure, for tests. */
export function resolvePublicConfig(edge: unknown, fallback: PublicConfig): PublicConfig {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) return { ...fallback };
  const raw = edge as Record<string, unknown>;
  const out: PublicConfig = { ...fallback };
  for (const key of PUBLIC_CONFIG_KEYS) {
    if (key === "supabaseUrl" || key === "supabasePublishableKey") continue;
    const value = str(raw[key]);
    if (value) out[key] = value;
  }
  const url = str(raw.supabaseUrl);
  const key = str(raw.supabasePublishableKey);
  if (url && key && isHttpsUrl(url)) {
    out.supabaseUrl = url;
    out.supabasePublishableKey = key;
  }
  return out;
}

let cached: PublicConfig | null = null;

/** This page's config. Read once: the edge object is written before the bundle runs. */
export function publicConfig(): PublicConfig {
  if (!cached) {
    const edge = typeof window !== "undefined" ? window.__MODUO_CONFIG__ : undefined;
    cached = resolvePublicConfig(edge, buildTimeConfig());
  }
  return cached;
}

/** Tests only: forget the cached read. */
export function resetPublicConfigForTests(): void {
  cached = null;
}

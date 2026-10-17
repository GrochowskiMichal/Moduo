// Pure helpers for the app's edge Worker (worker.ts): the per-environment
// public config, the inline script that hands it to the page, and the response
// headers. No Workers globals here, so the unit tests run in plain Node.
//
// The config keys must match apps/app/src/lib/public-config.ts (a test checks).

/** Worker vars per environment, set in apps/app/wrangler.jsonc. All optional. */
export type ConfigEnv = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  VAPID_PUBLIC_KEY?: string;
  WEB_ORIGIN?: string;
  STAGING_PORTAL?: string;
  DESKTOP_CHANNEL?: string;
};

export type EdgeConfig = Record<string, string>;

function value(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * The config this environment injects. An unset or empty var is left out, so
 * the app falls back to its build-time value for that key instead of "".
 */
export function configFromEnv(env: ConfigEnv): EdgeConfig {
  const all: EdgeConfig = {
    supabaseUrl: value(env.SUPABASE_URL),
    supabasePublishableKey: value(env.SUPABASE_PUBLISHABLE_KEY),
    stripePublishableKey: value(env.STRIPE_PUBLISHABLE_KEY),
    posthogKey: value(env.POSTHOG_KEY),
    posthogHost: value(env.POSTHOG_HOST),
    vapidPublicKey: value(env.VAPID_PUBLIC_KEY),
    webOrigin: value(env.WEB_ORIGIN),
    stagingPortal: value(env.STAGING_PORTAL),
    desktopChannel: value(env.DESKTOP_CHANNEL),
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== ""));
}

/**
 * The inline script body. `<`, U+2028 and U+2029 are escaped so no value can
 * close the script tag or break the line, whatever a var holds.
 */
export function configScript(config: EdgeConfig): string {
  const json = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.__MODUO_CONFIG__=${json};`;
}

/** The CSP source for an inline script body: 'sha256-<base64>'. */
export async function scriptHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

/**
 * Report-only for now: it only logs to the console what it would block.
 * Enforcing it is Phase 3 (specs/platform-v2.md). `extraScriptSrc` adds the
 * hash of the injected config script on HTML the Worker serves.
 */
export function contentSecurityPolicy(extraScriptSrc: readonly string[] = []): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...extraScriptSrc, "https://eu-assets.i.posthog.com"].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://eu.i.posthog.com https://eu-assets.i.posthog.com",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Headers every response carries. The same set is in public/_headers for files
 * served without the Worker (a test keeps the two equal). `frame-ancestors` is
 * also sent enforced, with X-Frame-Options, because report-only can't block.
 */
export function securityHeaders(cspExtraScriptSrc: readonly string[] = []): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Content-Security-Policy-Report-Only": contentSecurityPolicy(cspExtraScriptSrc),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

/** Revalidate on every load: index.html, /config.json and the push service workers. */
export const NO_CACHE = "no-cache";
/** Hashed files under /static/ never change. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

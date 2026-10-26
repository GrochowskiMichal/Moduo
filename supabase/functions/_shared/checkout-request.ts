/**
 * The pure half of create-checkout-session's request handling (MOD-550), kept
 * free of esm.sh imports so the backend tests can load it.
 *
 * - The body carries a plan, never a discount: a coupon id from the caller
 *   would hand anyone who learns one (the founder coupon, a dashboard one) a
 *   paid tier for free, past every promotion-code rule. Discounts come only
 *   from promotion codes typed into Stripe Checkout (`allow_promotion_codes`).
 * - Stripe sends the browser back only to Moduo's own hosts. The dev server's
 *   loopback origins count only when the function itself runs on the local
 *   stack, so production never returns anyone to a port on their machine.
 */

/** Hosts Stripe may send the browser back to, everywhere. */
export const REDIRECT_ORIGINS: readonly string[] = [
  "https://app.moduo.app",
  "https://staging.moduo.app",
  "https://app.staging.moduo.app",
  "https://moduo.app",
  "https://www.moduo.app",
];

/** The dev server (`bun run dev:web`): allowed only on the local stack. */
export const DEV_REDIRECT_ORIGINS: readonly string[] = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
];

const LOCAL_STACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "kong", "host.docker.internal"]);

/**
 * Whether the function runs on the local stack: its SUPABASE_URL is loopback,
 * or Kong inside the stack's Docker network. A hosted project's is
 * https://<ref>.supabase.co.
 */
export function isLocalStack(supabaseUrl: string | null | undefined): boolean {
  try {
    const host = new URL(supabaseUrl ?? "").hostname.toLowerCase();
    return LOCAL_STACK_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export type RedirectEnv = {
  /** The function's own SUPABASE_URL. */
  supabaseUrl: string | null | undefined;
  /** APP_URL, one more origin the project names for itself. */
  appUrl: string | null | undefined;
};

function originOf(value: string | null | undefined): string | null {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

/** `candidate` when it is a URL on one of our own origins, else `fallback` (no open redirect). */
export function safeRedirectWith(
  candidate: string | undefined | null,
  fallback: string,
  env: RedirectEnv,
): string {
  if (!candidate) return fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fallback;
  }
  if (url.username || url.password) return fallback;
  const allowed = new Set(REDIRECT_ORIGINS);
  if (isLocalStack(env.supabaseUrl)) for (const o of DEV_REDIRECT_ORIGINS) allowed.add(o);
  const extra = originOf(env.appUrl);
  if (extra) allowed.add(extra);
  return allowed.has(url.origin) ? url.toString() : fallback;
}

export type CheckoutBody = {
  plan: string | undefined;
  interval: string | undefined;
  seats: number | undefined;
  withCard: boolean;
  successUrl: string | undefined;
  cancelUrl: string | undefined;
};

/** The fields a checkout may carry. Anything else (`coupon`, `couponCode`, `discounts`) is ignored. */
export function checkoutBody(raw: unknown): CheckoutBody {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    plan: str(input.plan),
    interval: str(input.interval) ?? str(input.billing_cycle) ?? str(input.billing),
    seats: typeof input.seats === "number" && Number.isInteger(input.seats) ? input.seats : undefined,
    withCard: input.withCard === true,
    successUrl: str(input.successUrl),
    cancelUrl: str(input.cancelUrl),
  };
}

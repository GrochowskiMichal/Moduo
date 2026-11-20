/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  readonly PUBLIC_ALPHA_VANTAGE_API_KEY?: string;
  readonly PUBLIC_FINNHUB_API_KEY?: string;
  readonly PUBLIC_MARKETSTACK_API_KEY?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  /** "desktop" | "web" — set at build time by rsbuild.config.ts */
  readonly MODUO_TARGET?: string;
  /** App version (package.json) — set at build time by rsbuild.config.ts */
  readonly MODUO_VERSION?: string;
  /** "0" keeps the dev-only TanStack Devtools off. */
  readonly MODUO_DEVTOOLS?: string;
  /** Build id (short git SHA, or "dev") — set at build time by rsbuild.config.ts */
  readonly MODUO_BUILD?: string;
  /** Stripe — set in .env.local */
  readonly PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  readonly PUBLIC_STRIPE_PRICE_PRO_MONTHLY?: string;
  readonly PUBLIC_STRIPE_PRICE_PRO_YEARLY?: string;
  readonly PUBLIC_STRIPE_PRICE_TEAM_MONTHLY?: string;
  readonly PUBLIC_STRIPE_PRICE_TEAM_YEARLY?: string;
  /** PostHog analytics — optional, no-op when unset */
  readonly PUBLIC_POSTHOG_KEY?: string;
  readonly PUBLIC_POSTHOG_HOST?: string;
  /** Web Push (TV-D12): the VAPID public key; unset = browser notifications unavailable */
  readonly PUBLIC_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

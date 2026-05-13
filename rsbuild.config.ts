import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

function readLocalEnvValue(name: string): string {
  const localPath = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(localPath)) return "";
  const text = fs.readFileSync(localPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key !== name) continue;
    const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    return value;
  }
  return "";
}

const alphaVantageKey = readLocalEnvValue("PUBLIC_ALPHA_VANTAGE_API_KEY");
const finnhubKey = readLocalEnvValue("PUBLIC_FINNHUB_API_KEY");
const marketstackKey = readLocalEnvValue("PUBLIC_MARKETSTACK_API_KEY");
const supabaseUrl = readLocalEnvValue("PUBLIC_SUPABASE_URL");
const supabaseAnonKey = readLocalEnvValue("PUBLIC_SUPABASE_ANON_KEY");
const stripePublishableKey = readLocalEnvValue("PUBLIC_STRIPE_PUBLISHABLE_KEY");
const stripePriceProMonthly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_PRO_MONTHLY");
const stripePriceProYearly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_PRO_YEARLY");
const stripePriceTeamMonthly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_TEAM_MONTHLY");
const stripePriceTeamYearly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_TEAM_YEARLY");
// PostHog — disabled until needed; leave empty so analytics.ts is a no-op
const posthogKey = readLocalEnvValue("PUBLIC_POSTHOG_KEY");
const posthogHost = readLocalEnvValue("PUBLIC_POSTHOG_HOST");

// MODUO_TARGET: "web" for web builds, "desktop" for Tauri builds (default).
const target = (process.env.MODUO_TARGET as string | undefined) ?? "desktop";
const isWeb = target === "web";

const tauriStub = path.resolve(__dirname, "src/lib/tauri-api-stub.ts");

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: "./src/main.tsx",
    },
    define: {
      "import.meta.env.PUBLIC_ALPHA_VANTAGE_API_KEY": JSON.stringify(alphaVantageKey),
      "import.meta.env.PUBLIC_FINNHUB_API_KEY": JSON.stringify(finnhubKey),
      "import.meta.env.PUBLIC_MARKETSTACK_API_KEY": JSON.stringify(marketstackKey),
      "import.meta.env.PUBLIC_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
      "import.meta.env.MODUO_TARGET": JSON.stringify(target),
      "import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY": JSON.stringify(stripePublishableKey),
      "import.meta.env.PUBLIC_STRIPE_PRICE_PRO_MONTHLY": JSON.stringify(stripePriceProMonthly),
      "import.meta.env.PUBLIC_STRIPE_PRICE_PRO_YEARLY": JSON.stringify(stripePriceProYearly),
      "import.meta.env.PUBLIC_STRIPE_PRICE_TEAM_MONTHLY": JSON.stringify(stripePriceTeamMonthly),
      "import.meta.env.PUBLIC_STRIPE_PRICE_TEAM_YEARLY": JSON.stringify(stripePriceTeamYearly),
      "import.meta.env.PUBLIC_POSTHOG_KEY": JSON.stringify(posthogKey),
      "import.meta.env.PUBLIC_POSTHOG_HOST": JSON.stringify(posthogHost),
      "globalThis.__PUBLIC_ALPHA_VANTAGE_API_KEY__": JSON.stringify(alphaVantageKey),
      "globalThis.__PUBLIC_FINNHUB_API_KEY__": JSON.stringify(finnhubKey),
      "globalThis.__PUBLIC_MARKETSTACK_API_KEY__": JSON.stringify(marketstackKey),
      "globalThis.__MODUO_TARGET__": JSON.stringify(target),
    },
  },
  html: {
    template: "./index.html",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // In web builds, replace @tauri-apps/api/core with a stub so the
      // Tauri runtime is never bundled into the web output.
      ...(isWeb ? { "@tauri-apps/api/core": tauriStub } : {}),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8081,
    strictPort: true,
  },
  output: {
    distPath: {
      root: isWeb ? "dist/web" : "dist",
    },
  },
});

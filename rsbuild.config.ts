import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

function readLocalEnvValue(name: string): string {
  const localPath = path.resolve(__dirname, ".env.local");
  if (fs.existsSync(localPath)) {
    const text = fs.readFileSync(localPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      if (key !== name) continue;
      return line
        .slice(idx + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1")
        .replace(/^'(.*)'$/, "$1");
    }
  }
  // Fall back to process.env so CI / Vercel builds work without .env.local
  return process.env[name] ?? "";
}

const alphaVantageKey = readLocalEnvValue("PUBLIC_ALPHA_VANTAGE_API_KEY");
const finnhubKey = readLocalEnvValue("PUBLIC_FINNHUB_API_KEY");
const marketstackKey = readLocalEnvValue("PUBLIC_MARKETSTACK_API_KEY");
const supabaseUrl = readLocalEnvValue("PUBLIC_SUPABASE_URL");
const supabasePublishableKey = readLocalEnvValue("PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const stripePublishableKey = readLocalEnvValue("PUBLIC_STRIPE_PUBLISHABLE_KEY");
const stripePriceProMonthly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_PRO_MONTHLY");
const stripePriceProYearly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_PRO_YEARLY");
const stripePriceTeamMonthly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_TEAM_MONTHLY");
const stripePriceTeamYearly = readLocalEnvValue("PUBLIC_STRIPE_PRICE_TEAM_YEARLY");
// PostHog — disabled until needed; leave empty so analytics.ts is a no-op
const posthogKey = readLocalEnvValue("PUBLIC_POSTHOG_KEY");
const posthogHost = readLocalEnvValue("PUBLIC_POSTHOG_HOST");
// Deployed web origin for public share links (NO-9b). On web, window.location
// .origin is used when unset; desktop (tauri://) needs this to point at the
// deployed web app so a shared /p/<token> link resolves.
const publicWebOrigin = readLocalEnvValue("PUBLIC_WEB_ORIGIN");

// Staging portal — set to "true" in the Vercel moduo-staging env vars.
// Adds download buttons (Mac .dmg / Windows .exe) to the auth page.
const stagingPortal = readLocalEnvValue("PUBLIC_STAGING_PORTAL");
// Production desktop build — set to "production" to advertise the prod installers.
const desktopChannel = readLocalEnvValue("PUBLIC_DESKTOP_CHANNEL");

// Comma-separated allowlist of emails that may sign in on staging.
// Empty string = no restriction (dev / production). Staging Vercel sets this.
const stagingAllowlist = readLocalEnvValue("PUBLIC_STAGING_ALLOWLIST");

// MODUO_TARGET: "web" for web builds, "desktop" for Tauri builds (default).
const target = (process.env.MODUO_TARGET as string | undefined) ?? "desktop";
const isWeb = target === "web";

// App version + build id surfaced in Settings → About (DF-19i) and Diagnostics
// (DF-19g). Version comes from package.json; the build id is the short git SHA
// (CI may override with MODUO_BUILD) and degrades to "dev" when git isn't
// available.
function readPackageVersion(): string {
  // CI release builds inject the same version they stamp into tauri.conf.json,
  // so About and the updater compare like with like.
  const injected = process.env.MODUO_VERSION?.trim();
  if (injected) return injected;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function readBuildId(): string {
  const injected = process.env.MODUO_BUILD?.trim();
  if (injected) return injected;
  try {
    // Silence git's fatal-message on the no-repo path; the catch handles it.
    return (
      execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim() || "dev"
    );
  } catch {
    return "dev";
  }
}
const appVersion = readPackageVersion();
const appBuild = readBuildId();

const tauriStub = path.resolve(__dirname, "src/lib/tauri-api-stub.ts");

export default defineConfig({
  plugins: [pluginReact({ reactCompiler: true })],
  source: {
    entry: {
      index: "./src/main.tsx",
    },
    define: {
      "import.meta.env.PUBLIC_ALPHA_VANTAGE_API_KEY": JSON.stringify(alphaVantageKey),
      "import.meta.env.PUBLIC_FINNHUB_API_KEY": JSON.stringify(finnhubKey),
      "import.meta.env.PUBLIC_MARKETSTACK_API_KEY": JSON.stringify(marketstackKey),
      "import.meta.env.PUBLIC_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
      "import.meta.env.MODUO_TARGET": JSON.stringify(target),
      "import.meta.env.MODUO_VERSION": JSON.stringify(appVersion),
      "import.meta.env.MODUO_BUILD": JSON.stringify(appBuild),
      "import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY": JSON.stringify(stripePublishableKey),
      "import.meta.env.PUBLIC_STRIPE_PRICE_PRO_MONTHLY": JSON.stringify(stripePriceProMonthly),
      "import.meta.env.PUBLIC_STRIPE_PRICE_PRO_YEARLY": JSON.stringify(stripePriceProYearly),
      "import.meta.env.PUBLIC_STRIPE_PRICE_TEAM_MONTHLY": JSON.stringify(stripePriceTeamMonthly),
      "import.meta.env.PUBLIC_STRIPE_PRICE_TEAM_YEARLY": JSON.stringify(stripePriceTeamYearly),
      "import.meta.env.PUBLIC_POSTHOG_KEY": JSON.stringify(posthogKey),
      "import.meta.env.PUBLIC_POSTHOG_HOST": JSON.stringify(posthogHost),
      "import.meta.env.PUBLIC_WEB_ORIGIN": JSON.stringify(publicWebOrigin),
      "import.meta.env.PUBLIC_STAGING_PORTAL": JSON.stringify(stagingPortal),
      "import.meta.env.PUBLIC_DESKTOP_CHANNEL": JSON.stringify(desktopChannel),
      "import.meta.env.PUBLIC_STAGING_ALLOWLIST": JSON.stringify(stagingAllowlist),
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
      "@contracts": path.resolve(__dirname, "supabase/functions/_shared/contracts"),
      // In web builds, replace Tauri packages with stubs so the runtime
      // is never bundled into the web output.
      ...(isWeb
        ? {
            "@tauri-apps/api/core": tauriStub,
            "@tauri-apps/plugin-updater": path.resolve(
              __dirname,
              "src/lib/tauri-plugin-updater-stub.ts",
            ),
            "@tauri-apps/plugin-process": path.resolve(
              __dirname,
              "src/lib/tauri-plugin-process-stub.ts",
            ),
          }
        : {}),
    },
  },
  server: {
    host: "0.0.0.0",
    // Honor an externally assigned port (e.g. the Claude preview harness sets
    // PORT with autoPort); default stays 8081 for the normal dev scripts.
    port: process.env.PORT ? Number(process.env.PORT) : 8081,
    strictPort: true,
  },
  output: {
    distPath: {
      root: isWeb ? "dist/web" : "dist",
    },
  },
});

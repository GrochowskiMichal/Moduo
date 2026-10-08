/**
 * Vercel build entry point — switches between the landing placeholder and the
 * full Rsbuild web app based on the MODUO_BUILD_TARGET env var.
 *
 *   MODUO_BUILD_TARGET=landing  → full web build, marketing page at /, app shell at /app.html
 *   MODUO_BUILD_TARGET=app (or unset) → runs `bun run build:web`
 *
 * Set per-branch in Vercel Project Settings → Environment Variables:
 *   staging-landing / prod-landing branches  →  MODUO_BUILD_TARGET=landing
 *   staging-app / prod-app branches          →  MODUO_BUILD_TARGET=app (or omit)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const target = process.env.MODUO_BUILD_TARGET ?? "app";

if (target === "landing") {
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  const file = ref === "staging-landing" ? "staging.html" : "index.html";
  console.log(`[vercel-build] Building landing (${file}, branch=${ref || "unknown"})…`);
  // The marketing page stays at /. Booking links are /book on this same host,
  // so the app shell has to be in this deployment too (its /assets are what
  // /book loads). app.html is that shell; index.html is the landing page.
  execSync("bun run build:web", { stdio: "inherit", cwd: root });
  const outDir = path.join(root, "dist", "web");
  fs.renameSync(path.join(outDir, "index.html"), path.join(outDir, "app.html"));
  fs.copyFileSync(path.join(root, "landing", file), path.join(outDir, "index.html"));
  // Marketing subpages ride along on the public landing (staging keeps its portal at /).
  // Each one also needs a host rewrite in vercel.json (/manifesto → /manifesto.html, …).
  if (file === "index.html") {
    for (const page of ["manifesto.html", "privacy.html", "terms.html"]) {
      fs.copyFileSync(path.join(root, "landing", page), path.join(outDir, page));
    }
  }
  // The landing's own static files (share image, founder photos, …) go to /assets too.
  const assets = path.join(root, "landing", "assets");
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(outDir, "assets"), { recursive: true });
  // Staging keeps its portal at /, so the marketing page is published for review at
  // /landing.html (never indexed) before it's promoted to prod-landing.
  if (ref === "staging-landing") {
    let page = fs.readFileSync(path.join(root, "landing", "index.html"), "utf8");
    if (!/name="robots"/.test(page)) {
      page = page.replace(
        "<head>",
        '<head>\n    <meta name="robots" content="noindex, nofollow" />',
      );
    }
    fs.writeFileSync(path.join(outDir, "landing.html"), page);
  }
  console.log("[vercel-build] Landing build complete → dist/web/index.html + app.html");
} else {
  console.log("[vercel-build] Building web app…");
  execSync("bun run build:web", { stdio: "inherit", cwd: root });
}

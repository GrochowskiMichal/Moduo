/**
 * Vercel build entry point — switches between the landing placeholder and the
 * full Rsbuild web app based on the MODUO_BUILD_TARGET env var.
 *
 *   MODUO_BUILD_TARGET=landing  → full web build + apps/landing on top: marketing page at /, app shell at /app.html
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

import { readBaseVersion, webBuildId, webVersion } from "./release/version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const target = process.env.MODUO_BUILD_TARGET ?? "app";

// Settings → About and min_build read these (rsbuild.config.ts). Vercel clones
// shallow, so the build id is the commit SHA, not a commit count.
process.env.MODUO_VERSION = webVersion(readBaseVersion(), process.env.VERCEL_GIT_COMMIT_REF);
// Without a SHA (a CLI deploy), rsbuild falls back to `git rev-parse`.
if (process.env.VERCEL_GIT_COMMIT_SHA) {
  process.env.MODUO_BUILD = webBuildId(process.env.VERCEL_GIT_COMMIT_SHA);
}
console.log(
  `[vercel-build] Version ${process.env.MODUO_VERSION} · build ${process.env.MODUO_BUILD ?? "(git)"}`,
);

if (target === "landing") {
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  const staging = ref === "staging-landing";
  console.log(
    `[vercel-build] Building landing (${staging ? "staging" : "prod"}, branch=${ref || "unknown"})…`,
  );
  // The marketing page stays at /. Booking links are /book on this same host,
  // so the app shell has to be in this deployment too (its /static files are
  // what /book loads). app.html is that shell; index.html is the landing page.
  // PLAT-5 drops the app build from here once /book routes to the app Worker.
  execSync("bun run build:web", { stdio: "inherit", cwd: root });
  const outDir = path.join(root, "apps", "app", "dist", "web");
  fs.renameSync(path.join(outDir, "index.html"), path.join(outDir, "app.html"));
  // apps/landing builds the static landing on its own (index, subpages, assets;
  // on staging the portal at / and the marketing page at /landing.html).
  const landing = path.join(root, "apps", "landing");
  execSync(`node build.mjs${staging ? " --staging" : ""}`, { stdio: "inherit", cwd: landing });
  fs.cpSync(path.join(landing, "dist"), outDir, { recursive: true });
  console.log("[vercel-build] Landing build complete → apps/app/dist/web/index.html + app.html");
} else {
  console.log("[vercel-build] Building web app…");
  execSync("bun run build:web", { stdio: "inherit", cwd: root });
}
// vercel.json outputDirectory: apps/app/dist/web.

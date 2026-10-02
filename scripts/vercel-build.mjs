/**
 * Vercel build entry point — switches between the landing placeholder and the
 * full Rsbuild web app based on the MODUO_BUILD_TARGET env var.
 *
 *   MODUO_BUILD_TARGET=landing  → copies landing/index.html to dist/web/
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
  const outDir = path.join(root, "dist", "web");
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(root, "landing", file), path.join(outDir, "index.html"));
  // Static assets (share image, …) go to /assets, which the SPA rewrite leaves alone.
  const assets = path.join(root, "landing", "assets");
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(outDir, "assets"), { recursive: true });
  console.log("[vercel-build] Landing build complete → dist/web/index.html");
} else {
  console.log("[vercel-build] Building web app…");
  execSync("bun run build:web", { stdio: "inherit", cwd: root });
}

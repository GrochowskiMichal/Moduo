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
  console.log("[vercel-build] Building landing placeholder…");
  const outDir = path.join(root, "dist", "web");
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(path.join(root, "landing", "index.html"), path.join(outDir, "index.html"));
  console.log("[vercel-build] Landing build complete → dist/web/index.html");
} else {
  console.log("[vercel-build] Building web app…");
  execSync("bun run build:web", { stdio: "inherit", cwd: root });
}
